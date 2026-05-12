// mvtt, an RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of mvtt.
//
// mvtt is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// mvtt is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with mvtt.  If not, see <https://www.gnu.org/licenses/>.

import { z, type EntityId, type World } from "@vtt/substrate";
import {
  BelongsToNote,
  Headings,
  Note,
  NoteOrdering,
  Page,
  PageHistory,
  PageOrdering,
} from "@vtt/notes/shared";
import { Permissions, everyone, ownedBy } from "@vtt/permissions/shared";
import { Asset } from "@vtt/assets/shared";
import {
  BLOCK_ENTITY_INDEX_ID,
  BlockEntityIndex,
} from "../shared/traits.js";
import { AdventureProvenance } from "../shared/traits.js";
import { scanFencedBlocks } from "../shared/parse-blocks.js";
import { runBlockParse } from "./block-parse-system.js";
import {
  buildBlockKindIndex,
  type BlockKindIndex,
} from "../shared/block-kinds.js";

/**
 * Manifest carried at the top of every `.advt` bundle. `bundleId` is
 * a stable UUID — the update flow keys on it (re-imports of the same
 * `(bundleId, version)` are detected and de-duped). `name`, `version`,
 * `author`, and `summary` are display metadata.
 *
 * `requires` lists semver-pinned plugin dependencies (e.g.
 * `["@vtt/system-torchbearer@^2"]`) — the import service refuses on
 * mismatch.
 */
export const BundleManifestSchema = z.object({
  bundleId: z.string().min(1).max(120),
  name: z.string().min(1).max(240),
  version: z.string().min(1).max(60),
  summary: z.string().max(2000).default(""),
  author: z.string().max(240).default(""),
  gameSystem: z.string().max(120).optional(),
  requires: z.array(z.string().min(1).max(240)).default([]),
  exportedAt: z.string().max(60).optional(),
  notes: z.array(
    z.object({
      bundlePath: z.string().min(1).max(480),
      title: z.string().min(1).max(240),
      pages: z.array(
        z.object({
          title: z.string().min(1).max(240),
          body: z.string(),
          /** sha256 of the body — provenance carries this. */
          sha256: z.string().length(64),
        }),
      ),
    }),
  ),
  /**
   * Asset descriptors. v1 stores the raw bytes alongside as
   * `Uint8Array`s in the bundle struct (not in the manifest).
   * The manifest carries metadata only — name + sha + size + mime
   * + the source-world entity id (for import-time ref rewrite).
   */
  assets: z.array(
    z.object({
      sha256: z.string().length(64),
      name: z.string().min(1).max(240),
      mime: z.string().max(120),
      bytes: z.number().int().min(0),
      sourceEntityId: z.string().min(1).max(120).optional(),
    }),
  ),
});

export type BundleManifest = z.infer<typeof BundleManifestSchema>;

/**
 * In-memory bundle representation. The HTTP zip-stream is built from
 * this struct; the import service consumes the same struct after
 * unzipping. Pure functions over it are easy to test.
 */
export interface AdventureBundle {
  readonly manifest: BundleManifest;
  /** sha256 → bytes. Empty for v1 unless callers populate it. */
  readonly assets: ReadonlyMap<string, Uint8Array>;
}

/**
 * Synchronous sha256 implementation that doesn't depend on Node's
 * `crypto` module — keeps the bundle helpers usable from tests + the
 * eventual server endpoint without a per-side branch.
 *
 * Adapted from a public-domain reference; only used for content-
 * addressing so the perf cost is irrelevant for note-sized bodies.
 */
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return sha256Bytes(bytes);
}

function sha256Bytes(message: Uint8Array): string {
  // SHA-256 constants
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  // Pad
  const len = message.length;
  const bits = len * 8;
  const padLen = (((len + 9 + 63) >> 6) << 6) - len;
  const padded = new Uint8Array(len + padLen);
  padded.set(message);
  padded[len] = 0x80;
  // Append length as 64-bit big-endian (we only encode the low 32 bits — fine for our sizes).
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bits >>> 0, false);

  const W = new Uint32Array(64);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i += 1) {
      W[i] = dv.getUint32(chunk + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(W[i - 15]!, 7) ^ rotr(W[i - 15]!, 18) ^ (W[i - 15]! >>> 3);
      const s1 = rotr(W[i - 2]!, 17) ^ rotr(W[i - 2]!, 19) ^ (W[i - 2]! >>> 10);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = [H[0]!, H[1]!, H[2]!, H[3]!, H[4]!, H[5]!, H[6]!, H[7]!];
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const T1 = (h + S1 + ch + K[i]! + W[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const T2 = (S0 + mj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + T1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (T1 + T2) >>> 0;
    }
    H[0] = (H[0]! + a) >>> 0;
    H[1] = (H[1]! + b) >>> 0;
    H[2] = (H[2]! + c) >>> 0;
    H[3] = (H[3]! + d) >>> 0;
    H[4] = (H[4]! + e) >>> 0;
    H[5] = (H[5]! + f) >>> 0;
    H[6] = (H[6]! + g) >>> 0;
    H[7] = (H[7]! + h) >>> 0;
  }
  return Array.from(H, (n) => n.toString(16).padStart(8, "0")).join("");
}
function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

export interface BuildBundleOptions {
  readonly bundleId: string;
  readonly name: string;
  readonly version: string;
  readonly summary?: string;
  readonly author?: string;
  readonly gameSystem?: string;
  readonly requires?: ReadonlyArray<string>;
  /** Note entity ids selected for export. */
  readonly noteIds: ReadonlyArray<EntityId>;
  /**
   * Optional hook for loading asset bytes by entity id. When provided,
   * `buildBundle` walks `[[asset:<id>]]` and `![[asset:<id>]]`
   * references in note bodies and includes the bytes in the bundle.
   * Returns null when the asset is missing or unreadable.
   */
  readonly loadAssetBytes?: (
    assetId: EntityId,
  ) => Uint8Array | null | Promise<Uint8Array | null>;
  /**
   * When true, run `computeReferenceClosure` and synthesize fenced
   * blocks for uncoverable entities (manually-created via UI, no
   * BlockEntityIndex provenance). The synthesized blocks are
   * appended to a `notes/captured.md` note so the import target can
   * resolve the references. Default: false.
   */
  readonly captureUncoverables?: boolean;
  /**
   * Block-kind index — required when `captureUncoverables` is true so
   * the closure can recognize fenced blocks in note bodies.
   */
  readonly kindIndex?: import("../shared/block-kinds.js").BlockKindIndex;
}

/**
 * Walk the selected notes + their pages and produce an
 * `AdventureBundle` ready for serialization. v1: assets are not yet
 * wired through (TODO: scan asset references and bundle bytes).
 *
 * Reference closure is computed but for v1 ONLY records auxiliary
 * include candidates in the `assets` field as advisory data — the
 * actual closure-and-include flow is owned by the export UI which
 * iterates `closure.auxiliaryNoteIds` and re-builds with the expanded
 * `noteIds` set. This keeps `buildBundle` pure and side-effect free.
 */
export async function buildBundle(
  world: World,
  opts: BuildBundleOptions,
): Promise<AdventureBundle> {
  const noteEntries: BundleManifest["notes"] = [];
  for (const noteId of opts.noteIds) {
    if (!world.has(noteId)) continue;
    const note = world.get(noteId, [Note, NoteOrdering]) as
      | { Note: { title: string }; NoteOrdering: { ordinal: number } }
      | undefined;
    if (!note) continue;
    const pages: BundleManifest["notes"][number]["pages"] = [];
    for (const row of world.query([Page, BelongsToNote, PageOrdering])) {
      const v = row.values as {
        Page: { title: string; body: string };
        BelongsToNote: { noteId: EntityId };
        PageOrdering: { ordinal: number };
      };
      if (v.BelongsToNote.noteId !== noteId) continue;
      pages.push({
        title: v.Page.title,
        body: v.Page.body,
        sha256: sha256Hex(v.Page.body),
      });
    }
    pages.sort((a, b) => a.title.localeCompare(b.title));
    noteEntries.push({
      bundlePath: `notes/${slugForPath(note.Note.title)}.md`,
      title: note.Note.title,
      pages,
    });
  }

  // Collect every Asset entity that needs to ride along in the
  // bundle. Two sources:
  //   1. Inline wiki-link references in note bodies: `[[asset:<id>]]`
  //      / `![[asset:<id>]]`. Covers GM-typed images and the asset
  //      link kind.
  //   2. Every Asset entity in the world. Post-refactor, plugin
  //      traits (CharacterToken.assetId, Scene.backgroundAssetId,
  //      TokenImage.assetId, PdfDocument.assetId, …) point at Asset
  //      entities by id. Tracing those references from inside
  //      adventures would require importing every consumer plugin,
  //      which inverts the dependency graph. The pragmatic v1: union
  //      every Asset entity in the world — dedup at import is by
  //      sha256 so the cost of bundling an asset the target world
  //      already has is just the manifest entry. Future work can
  //      narrow this when there's an `AssetReferenceFinder` slot for
  //      plugins to declare their own roots.
  const referencedAssetIds = new Set<EntityId>();
  for (const row of world.query([Asset])) {
    referencedAssetIds.add(row.id as EntityId);
  }
  for (const note of noteEntries) {
    for (const page of note.pages) {
      const matches = page.body.matchAll(/!?\[\[asset:([^\]|]+)/g);
      for (const m of matches) {
        const ref = m[1]!.trim();
        if (world.has(ref as EntityId)) {
          referencedAssetIds.add(ref as EntityId);
        }
      }
    }
  }
  const assetDescriptors: BundleManifest["assets"] = [];
  const assetBytesMap = new Map<string, Uint8Array>();
  if (opts.loadAssetBytes) {
    for (const aid of referencedAssetIds) {
      const got = world.get(aid, [Asset]) as
        | { Asset: { sha256: string; mime: string; sizeBytes: number; filename: string | null } }
        | undefined;
      if (!got) continue;
      const bytes = await opts.loadAssetBytes(aid);
      if (!bytes) continue;
      assetBytesMap.set(got.Asset.sha256, bytes);
      assetDescriptors.push({
        sha256: got.Asset.sha256,
        name: got.Asset.filename ?? aid,
        mime: got.Asset.mime,
        bytes: got.Asset.sizeBytes,
        sourceEntityId: aid,
      });
    }
  }

  // Capture uncoverable entities (no block provenance) by synthesizing
  // a fenced block for each into a notes/captured.md note. Each
  // synthesized block re-creates the entity's authored fields so the
  // import target's parse system can re-materialize it.
  if (opts.captureUncoverables && opts.kindIndex) {
    const closure = computeReferenceClosure(world, opts.noteIds, opts.kindIndex);
    if (closure.uncoverable.length > 0) {
      const captured = synthesizeCapturedBlocks(world, closure.uncoverable);
      if (captured.length > 0) {
        noteEntries.push({
          bundlePath: "notes/captured.md",
          title: "Captured (auto-generated)",
          pages: [
            {
              title: "Captured entities",
              body: captured.join("\n\n"),
              sha256: sha256Hex(captured.join("\n\n")),
            },
          ],
        });
      }
    }
  }

  const manifest: BundleManifest = {
    bundleId: opts.bundleId,
    name: opts.name,
    version: opts.version,
    summary: opts.summary ?? "",
    author: opts.author ?? "",
    ...(opts.gameSystem !== undefined && { gameSystem: opts.gameSystem }),
    requires: opts.requires ? [...opts.requires] : [],
    exportedAt: new Date().toISOString(),
    notes: noteEntries,
    assets: assetDescriptors,
  };

  return { manifest, assets: assetBytesMap };
}

/**
 * For each uncoverable entity id, build a best-effort fenced block
 * from its traits. v1: handles characters / items via known trait
 * names; falls back to a stub block with just the name for unknown
 * shapes. Returns the block strings ready to concatenate into a note
 * body.
 */
function synthesizeCapturedBlocks(
  world: World,
  entityIds: ReadonlyArray<EntityId>,
): string[] {
  const out: string[] = [];
  for (const eid of entityIds) {
    const traits = world.traitsOn(eid);
    // Detect the entity's "kind" by trait composition.
    const isCharacter = Array.from(traits.keys()).some(
      (n) => n === "@vtt/characters/Character",
    );
    const isItem = Array.from(traits.keys()).some(
      (n) => n === "@vtt/items/ItemIdentity",
    );
    if (isItem) {
      const ident = traits.get(
        "@vtt/items/ItemIdentity" as unknown as import("@vtt/substrate").TraitName,
      ) as
        | { name: string; description: string }
        | undefined;
      const name = ident?.name ?? eid;
      out.push(
        [
          `\`\`\`item ${name}`,
          `# id: ${eid}`,
          `description: ${JSON.stringify(ident?.description ?? "")}`,
          "```",
        ].join("\n"),
      );
    } else if (isCharacter) {
      const ch = traits.get(
        "@vtt/characters/Character" as unknown as import("@vtt/substrate").TraitName,
      ) as
        | { name: string }
        | undefined;
      const name = ch?.name ?? eid;
      out.push(
        [
          `\`\`\`character ${name}`,
          `# id: ${eid}`,
          "```",
        ].join("\n"),
      );
    } else {
      // Unknown entity kind — emit a comment-only block so the GM
      // can manually fix it on the import side.
      out.push(`<!-- captured entity ${eid} (unknown kind, manual fix needed) -->`);
    }
  }
  return out;
}

function slugForPath(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "untitled";
}

/**
 * Reference-closure analysis. Walks the selected notes' fenced blocks,
 * resolves wiki-link targets to entity ids via the BlockEntityIndex,
 * and classifies each referenced entity:
 *
 *   - `inSelected`     — block-authored on a selected note (already in)
 *   - `inUnselected`   — block-authored on a different note (offer aux)
 *   - `systemSeeded`   — has system-seed provenance with no overrides;
 *                        safe to leave as wiki-link (target world's
 *                        seed will provide it)
 *   - `uncoverable`    — manually-created entity (no block, no seed
 *                        provenance) — must be captured to bundle
 *
 * The returned closure is advisory: callers re-invoke `buildBundle`
 * with an expanded `noteIds` set after deciding which auxiliary
 * notes to include.
 */
export interface ReferenceClosure {
  readonly inSelected: ReadonlyArray<EntityId>;
  readonly inUnselected: ReadonlyArray<{
    entityId: EntityId;
    noteId: EntityId;
    blockKey: string;
    kind: string;
  }>;
  readonly systemSeeded: ReadonlyArray<EntityId>;
  readonly uncoverable: ReadonlyArray<EntityId>;
}

export function computeReferenceClosure(
  world: World,
  selectedNoteIds: ReadonlyArray<EntityId>,
  kindIndex: BlockKindIndex,
): ReferenceClosure {
  const indexValue = world.get(BLOCK_ENTITY_INDEX_ID, [BlockEntityIndex]) as
    | {
        BlockEntityIndex: {
          entries: Record<
            string,
            {
              noteId: EntityId;
              blockKey: string;
              kind: string;
              entityId: EntityId;
            }
          >;
        };
      }
    | undefined;
  const indexEntries = indexValue?.BlockEntityIndex.entries ?? {};
  // Build fast lookups: entityId → indexEntry, and selected note set.
  const entryByEntityId = new Map<
    EntityId,
    {
      noteId: EntityId;
      blockKey: string;
      kind: string;
      entityId: EntityId;
    }
  >();
  for (const e of Object.values(indexEntries)) {
    entryByEntityId.set(e.entityId, e);
  }
  const selectedSet = new Set(selectedNoteIds);

  // Collect every wiki-link reference from the blocks on selected notes.
  const referencedNames = new Set<string>();
  const recognized = new Set<string>(kindIndex.byName.keys());
  for (const noteId of selectedNoteIds) {
    for (const row of world.query([Page, BelongsToNote])) {
      const v = row.values as {
        Page: { body: string };
        BelongsToNote: { noteId: EntityId };
      };
      if (v.BelongsToNote.noteId !== noteId) continue;
      const blocks = scanFencedBlocks(v.Page.body, recognized);
      for (const b of blocks) {
        // Find every `[[kind:body]]` reference in the YAML body.
        const matches = b.body.matchAll(/\[\[([^\]]+)\]\]/g);
        for (const m of matches) {
          referencedNames.add(m[1]!.trim());
        }
      }
    }
  }

  const inSelected: EntityId[] = [];
  const inUnselected: ReferenceClosure["inUnselected"][number][] = [];
  const systemSeeded: EntityId[] = [];
  const uncoverable: EntityId[] = [];

  for (const refName of referencedNames) {
    // The ref looks like `kind:body`. We resolve by walking the
    // BlockEntityIndex for a matching blockKey OR by name lookup.
    const target = resolveRefToEntity(world, refName, indexEntries);
    if (!target) continue;
    const indexEntry = entryByEntityId.get(target);
    if (indexEntry) {
      if (selectedSet.has(indexEntry.noteId)) {
        inSelected.push(target);
      } else {
        inUnselected.push({
          entityId: target,
          noteId: indexEntry.noteId,
          blockKey: indexEntry.blockKey,
          kind: indexEntry.kind,
        });
      }
      continue;
    }
    if (isSystemSeeded(world, target)) {
      systemSeeded.push(target);
    } else {
      uncoverable.push(target);
    }
  }

  return { inSelected, inUnselected, systemSeeded, uncoverable };
}

function resolveRefToEntity(
  world: World,
  refName: string,
  indexEntries: Record<
    string,
    { noteId: EntityId; blockKey: string; kind: string; entityId: EntityId }
  >,
): EntityId | null {
  const colon = refName.indexOf(":");
  const body = colon > 0 ? refName.slice(colon + 1).trim() : refName.trim();
  // First check the BlockEntityIndex by slug match against the body.
  const slug = body
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  for (const e of Object.values(indexEntries)) {
    if (e.blockKey === slug) return e.entityId;
  }
  // Fall back to a name lookup against the two common name-bearing
  // traits. We probe each trait family separately because World has
  // no "iterate all entities" — `query([...])` filters by trait
  // intersection. This is the same shape StartEncounter / AwardLoot
  // already use.
  const target = body.toLowerCase();
  for (const traitName of [
    "@vtt/items/ItemIdentity",
    "@vtt/characters/Character",
  ]) {
    const trait = { name: traitName } as unknown as import("@vtt/substrate").TraitMeta;
    let rows: ReturnType<World["query"]>;
    try {
      rows = world.query([trait]);
    } catch {
      continue;
    }
    for (const row of rows) {
      const v = (row.values as Record<string, { name?: string }>)[
        traitName.split("/").pop()!
      ];
      if (v?.name && v.name.toLowerCase() === target) return row.id;
    }
  }
  return null;
}

function isSystemSeeded(world: World, entityId: EntityId): boolean {
  const traits = world.traitsOn(entityId);
  for (const [traitName, value] of traits.entries()) {
    if (traitName.endsWith("DerivedFrom") || traitName.endsWith("/ItemDerivedFrom")) {
      const v = value as { pluginName?: string; overrides?: ReadonlyArray<string> };
      if (
        v.pluginName &&
        v.pluginName !== "@vtt/adventures" &&
        (v.overrides?.length ?? 0) === 0
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Optional hook for `importBundle` to upload bundled asset bytes into
 * the target world's assets pipeline. The hook receives bytes + the
 * manifest's asset descriptor; it returns the live entity id the
 * note bodies should reference. Without this hook, asset references
 * remain as the bundle-side ids (typically broken on the target).
 */
export interface ImportBundleHooks {
  saveAssetBytes?: (
    bytes: Uint8Array,
    descriptor: BundleManifest["assets"][number],
  ) => EntityId | Promise<EntityId>;
  /**
   * User id to record as the owner of imported notes (and pages by
   * inheritance). Defaults to `read: everyone, write: everyone` when
   * absent — fine for unit tests, wrong for HTTP imports where the
   * GM should own the result. The HTTP route threads `session.userId`
   * here.
   */
  importerUserId?: string;
}

/**
 * Materialize a bundle into a target world. Creates note + page
 * entities, sets bodies (which the BlockParseSystem then uses to
 * spawn block entities deterministically), and stamps
 * `AdventureProvenance` on each note.
 *
 * If `hooks.saveAssetBytes` is provided, asset bytes from
 * `bundle.assets` are uploaded via the hook and `[[asset:<oldId>]]`
 * references in note bodies are rewritten to `[[asset:<newId>]]` so
 * they resolve in the target world.
 *
 * v1: writes traits directly via `world.spawn` / `world.set` — no
 * commands dispatched. Cleaner integration with the proper command
 * pipeline lands when the HTTP route is wired.
 */
export async function importBundle(
  world: World,
  bundle: AdventureBundle,
  kindIndex: BlockKindIndex,
  hooks: ImportBundleHooks = {},
): Promise<{
  notesCreated: number;
  pagesCreated: number;
  noteIds: EntityId[];
  assetsUploaded: number;
}> {
  const m = bundle.manifest;

  // Upload assets first; build a sourceEntityId → newAssetEntityId
  // rewrite map (so body refs `[[asset:<sourceId>]]` rewrite to the
  // live target-world ids).
  const assetIdRewrite = new Map<string, EntityId>();
  let assetsUploaded = 0;
  if (hooks.saveAssetBytes) {
    for (const desc of m.assets) {
      const bytes = bundle.assets.get(desc.sha256);
      if (!bytes) continue;
      const newId = await hooks.saveAssetBytes(bytes, desc);
      if (desc.sourceEntityId) {
        assetIdRewrite.set(desc.sourceEntityId, newId);
      }
      assetsUploaded += 1;
    }
  }

  // Permissions for every imported note / page. The HTTP route hands
  // us the GM's userId; standalone callers (unit tests, scripts)
  // typically don't, so we fall back to the public-everyone shape so
  // the imported notes are at least visible. Without Permissions
  // attached, `useQuery([Note, Permissions])`-style hub queries skip
  // the imported entities entirely — that's the bug this branch
  // fixes.
  const importPermissions = hooks.importerUserId
    ? ownedBy(hooks.importerUserId)
    : { read: everyone(), write: everyone() };

  const noteIds: EntityId[] = [];
  let pagesCreated = 0;
  for (let i = 0; i < m.notes.length; i += 1) {
    const n = m.notes[i]!;
    const noteId = world.spawn([
      Note({ title: n.title, createdAt: Date.now() }),
      NoteOrdering({ ordinal: i }),
      Permissions(importPermissions),
      AdventureProvenance({
        bundleId: m.bundleId,
        bundleName: m.name,
        version: m.version,
        bundlePath: n.bundlePath,
        // sha256 of the first page body — the merge engine recomputes
        // per-page on update. Using the first page is a v1 simplification.
        originalSha256: n.pages[0]?.sha256 ?? sha256Hex(""),
      }),
    ]);
    noteIds.push(noteId);
    for (let j = 0; j < n.pages.length; j += 1) {
      const p = n.pages[j]!;
      // Rewrite asset references if we have a rewrite map (key from
      // descriptor.sha256 → new entity id). The bundle's body refs an
      // assetId from the source world; we look up which sha256 that id
      // corresponds to via the manifest, then map sha → newId.
      let body = p.body;
      if (assetIdRewrite.size > 0) {
        body = body.replace(/(!?\[\[asset:)([^\]|]+)/g, (_match, prefix, ref) => {
          // The original-world entity id IS the bundle-side reference.
          // Find its sha256 by descriptor.name === ref OR via a more
          // robust descriptor lookup if names collide. For v1 we
          // rewrite by directly mapping the ref string (the source
          // entity id) to a new id when the assetIdRewrite map was
          // built with the source entity id as a key.
          const newId = assetIdRewrite.get(ref);
          if (newId) return `${prefix}${newId}`;
          return `${prefix}${ref}`;
        });
      }
      const pageId = world.spawn([
        BelongsToNote({ noteId }),
        Page({ title: p.title, body, bodyRev: 1 }),
        PageOrdering({ ordinal: j }),
        // Mirror the trait set the normal `PageSpawnSystem` attaches:
        // Headings (read by the heading-nav rail), PageHistory (read
        // by the version-history panel), and Permissions (inherited
        // from the parent note — same shape as the cascade system).
        // Without these, imported pages render but every consumer
        // that filters by them quietly drops the row.
        Headings({ items: [] }),
        PageHistory({ entries: [] }),
        Permissions(importPermissions),
      ]);
      // Now run the parse system manually to materialize block entities.
      runBlockParse(world, pageId, body, kindIndex);
      pagesCreated += 1;
    }
  }
  return { notesCreated: m.notes.length, pagesCreated, noteIds, assetsUploaded };
}

/**
 * Convenience: build a bundle and turn it into a JSON-serialisable
 * shape. Real zip serialization lands when the HTTP route ships.
 */
export function bundleToJson(bundle: AdventureBundle): string {
  return JSON.stringify(bundle.manifest, null, 2);
}

export function bundleFromJson(json: string): AdventureBundle {
  const m = BundleManifestSchema.parse(JSON.parse(json));
  return { manifest: m, assets: new Map() };
}

void buildBlockKindIndex;
