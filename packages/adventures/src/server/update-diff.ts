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

import type { EntityId, World } from "@vtt/substrate";
import { Note, NoteOrdering, Page, PageOrdering, BelongsToNote } from "@vtt/notes/shared";
import { AdventureProvenance } from "../shared/traits.js";
import { scanFencedBlocks } from "../shared/parse-blocks.js";
import { runBlockParse } from "./block-parse-system.js";
import type { BlockKindIndex } from "../shared/block-kinds.js";
import { type AdventureBundle, sha256Hex } from "./bundle.js";

/**
 * Per-note diff classification (per design/adventures.md
 * § "Update flow"):
 *
 * - `new` — the bundle adds a note the world doesn't have. Auto-add
 *   on confirm.
 * - `unchanged` — the bundle's note body matches the world's body
 *   (sha256 equal). No-op.
 * - `fast-forward` — the world's note body matches what the bundle
 *   *previously* shipped (no local edits since import) and the new
 *   bundle has a different body. Auto-update on confirm.
 * - `conflict` — both the world and the bundle changed. Per-block
 *   merge dialog needed.
 * - `removed-upstream` — the world has a note from this bundleId
 *   that's no longer in the new bundle. Tombstone candidate.
 */
export type NoteDiffKind = "new" | "unchanged" | "fast-forward" | "conflict" | "removed-upstream";

export interface NoteDiff {
  readonly kind: NoteDiffKind;
  readonly bundlePath: string;
  /** Title of the note in the new bundle (or current world for `removed-upstream`). */
  readonly title: string;
  /** Existing world entity, if any. */
  readonly worldNoteId?: EntityId;
  /** New body the bundle ships, if any. */
  readonly newBody?: string;
  /** Per-block class breakdown for `conflict` / `fast-forward`. */
  readonly blocks: ReadonlyArray<BlockDiff>;
}

export interface BlockDiff {
  readonly kind: "block-new" | "block-removed" | "block-unchanged" | "block-changed";
  readonly blockKey: string;
  /** Body of the block in the new bundle, if present. */
  readonly newBlockBody?: string;
  /** Body of the block in the world's current page, if present. */
  readonly currentBlockBody?: string;
}

export interface UpdateDiff {
  readonly bundleId: string;
  readonly currentVersion?: string;
  readonly newVersion: string;
  readonly notes: ReadonlyArray<NoteDiff>;
}

/**
 * Compute a per-note (and per-block) diff between the live world's
 * already-imported bundle and a freshly-uploaded version.
 *
 * The world stores `AdventureProvenance` on every imported note. We
 * build a map keyed by `bundlePath` so the new bundle's notes can be
 * matched against existing ones.
 */
export function computeUpdateDiff(
  world: World,
  newBundle: AdventureBundle,
  recognizedKinds: ReadonlySet<string>,
): UpdateDiff {
  const m = newBundle.manifest;
  const existingByPath = collectExistingByPath(world, m.bundleId);
  let currentVersion: string | undefined;
  for (const ex of existingByPath.values()) {
    currentVersion = ex.version;
    break;
  }
  const noteDiffs: NoteDiff[] = [];
  const seenPaths = new Set<string>();

  for (const newNote of m.notes) {
    seenPaths.add(newNote.bundlePath);
    const existing = existingByPath.get(newNote.bundlePath);
    const newBody = newNote.pages.map((p) => p.body).join("\n\n");
    if (!existing) {
      noteDiffs.push({
        kind: "new",
        bundlePath: newNote.bundlePath,
        title: newNote.title,
        newBody,
        blocks: blocksFromBody(newBody, recognizedKinds).map((b) => ({
          kind: "block-new",
          blockKey: b.blockKey,
          newBlockBody: b.body,
        })),
      });
      continue;
    }
    const currentBodySha = sha256Hex(existing.body);
    const newBodySha = sha256Hex(newBody);
    if (currentBodySha === newBodySha) {
      noteDiffs.push({
        kind: "unchanged",
        bundlePath: newNote.bundlePath,
        title: newNote.title,
        worldNoteId: existing.noteId,
        blocks: [],
      });
      continue;
    }
    // Was the world body unchanged from what the LAST bundle shipped?
    // If so, fast-forward; otherwise conflict.
    if (existing.originalSha256 === currentBodySha) {
      noteDiffs.push({
        kind: "fast-forward",
        bundlePath: newNote.bundlePath,
        title: newNote.title,
        worldNoteId: existing.noteId,
        newBody,
        blocks: diffBlocks(existing.body, newBody, recognizedKinds),
      });
    } else {
      noteDiffs.push({
        kind: "conflict",
        bundlePath: newNote.bundlePath,
        title: newNote.title,
        worldNoteId: existing.noteId,
        newBody,
        blocks: diffBlocks(existing.body, newBody, recognizedKinds),
      });
    }
  }
  // Notes the previous bundle shipped that this one doesn't.
  for (const [path, existing] of existingByPath) {
    if (seenPaths.has(path)) continue;
    noteDiffs.push({
      kind: "removed-upstream",
      bundlePath: path,
      title: existing.title,
      worldNoteId: existing.noteId,
      blocks: [],
    });
  }

  return {
    bundleId: m.bundleId,
    ...(currentVersion !== undefined && { currentVersion }),
    newVersion: m.version,
    notes: noteDiffs,
  };
}

interface ExistingNote {
  readonly noteId: EntityId;
  readonly title: string;
  readonly version: string;
  readonly originalSha256: string;
  readonly body: string;
}

function collectExistingByPath(world: World, bundleId: string): Map<string, ExistingNote> {
  const out = new Map<string, ExistingNote>();
  for (const row of world.query([Note, AdventureProvenance])) {
    const v = row.values as {
      Note: { title: string };
      AdventureProvenance: {
        bundleId: string;
        bundlePath: string;
        version: string;
        originalSha256: string;
      };
    };
    if (v.AdventureProvenance.bundleId !== bundleId) continue;
    // Concatenate page bodies in ordinal order to compare against the
    // bundle's per-page concatenated body.
    const pages: Array<{ body: string; ordinal: number }> = [];
    for (const pageRow of world.query([Page, BelongsToNote, PageOrdering])) {
      const pv = pageRow.values as {
        Page: { body: string };
        BelongsToNote: { noteId: EntityId };
        PageOrdering: { ordinal: number };
      };
      if (pv.BelongsToNote.noteId !== row.id) continue;
      pages.push({ body: pv.Page.body, ordinal: pv.PageOrdering.ordinal });
    }
    pages.sort((a, b) => a.ordinal - b.ordinal);
    out.set(v.AdventureProvenance.bundlePath, {
      noteId: row.id,
      title: v.Note.title,
      version: v.AdventureProvenance.version,
      originalSha256: v.AdventureProvenance.originalSha256,
      body: pages.map((p) => p.body).join("\n\n"),
    });
  }
  return out;
}

function blocksFromBody(body: string, recognized: ReadonlySet<string>) {
  return scanFencedBlocks(body, recognized);
}

/**
 * Merge two markdown bodies block-by-block according to the GM's
 * per-block choices. For each block in the *new* body:
 *   - If `blockChoices[blockKey] === "take-theirs"`, use the new
 *     body's block content.
 *   - Else default to keep-mine: use the current body's block
 *     content (or insert the new block if it didn't exist).
 *
 * Surrounding prose between blocks is taken from the current body
 * (we keep the GM's prose edits). Blocks the new body removed are
 * also kept by default; the GM can hand-edit to drop them.
 */
function mergeBlockBodies(
  current: string,
  next: string,
  blockChoices: Readonly<Record<string, "take-theirs" | "keep-mine">>,
  recognized: ReadonlySet<string>,
): string {
  const cur = scanFencedBlocks(current, recognized);
  const nxt = scanFencedBlocks(next, recognized);
  const curMap = new Map(cur.map((b) => [b.blockKey, b]));
  const nxtMap = new Map(nxt.map((b) => [b.blockKey, b]));

  // Strategy: walk the CURRENT body, replacing each fenced block
  // whose key is "take-theirs" with the corresponding new block's
  // raw text. Append blocks in the new body that the current didn't
  // have (only if "take-theirs"). Surrounding prose stays.
  let result = "";
  let cursor = 0;
  for (const b of cur) {
    result += current.slice(cursor, b.rangeStart);
    const choice = blockChoices[b.blockKey] ?? "keep-mine";
    if (choice === "take-theirs") {
      const nb = nxtMap.get(b.blockKey);
      if (nb) {
        result += next.slice(nb.rangeStart, nb.rangeEnd);
      } else {
        // The new body removed this block. "take-theirs" with no
        // corresponding new block means drop it.
      }
    } else {
      result += current.slice(b.rangeStart, b.rangeEnd);
    }
    cursor = b.rangeEnd;
  }
  result += current.slice(cursor);
  // Append blocks that exist in the new body but not the current.
  for (const nb of nxt) {
    if (curMap.has(nb.blockKey)) continue;
    const choice = blockChoices[nb.blockKey] ?? "keep-mine";
    if (choice === "take-theirs") {
      result += "\n\n" + next.slice(nb.rangeStart, nb.rangeEnd);
    }
  }
  return result;
}

function diffBlocks(current: string, next: string, recognized: ReadonlySet<string>): BlockDiff[] {
  const cur = blocksFromBody(current, recognized);
  const nxt = blocksFromBody(next, recognized);
  const curMap = new Map(cur.map((b) => [b.blockKey, b]));
  const nxtMap = new Map(nxt.map((b) => [b.blockKey, b]));
  const out: BlockDiff[] = [];
  for (const b of nxt) {
    const c = curMap.get(b.blockKey);
    if (!c) {
      out.push({
        kind: "block-new",
        blockKey: b.blockKey,
        newBlockBody: b.body,
      });
    } else if (c.body === b.body) {
      out.push({ kind: "block-unchanged", blockKey: b.blockKey });
    } else {
      out.push({
        kind: "block-changed",
        blockKey: b.blockKey,
        newBlockBody: b.body,
        currentBlockBody: c.body,
      });
    }
  }
  for (const c of cur) {
    if (nxtMap.has(c.blockKey)) continue;
    out.push({
      kind: "block-removed",
      blockKey: c.blockKey,
      currentBlockBody: c.body,
    });
  }
  return out;
}

/**
 * One resolution choice the GM submits from the diff dialog. The
 * note-level actions (`take-theirs` / `keep-mine` / `skip` /
 * `import-new`) apply to the whole note. The `merge` action lets the
 * GM resolve per-block: `blockChoices` maps blockKey → "take-theirs"
 * (replace the world's block with the bundle's) or "keep-mine"
 * (keep the world's block as-is). Block keys missing from the map
 * default to "keep-mine".
 */
export type NoteResolution =
  | { bundlePath: string; action: "take-theirs" }
  | { bundlePath: string; action: "keep-mine" }
  | { bundlePath: string; action: "skip" }
  | { bundlePath: string; action: "import-new" }
  | {
      bundlePath: string;
      action: "merge";
      blockChoices: Readonly<Record<string, "take-theirs" | "keep-mine">>;
    };

/**
 * Apply the GM's resolution choices to the world. Pages are rewritten
 * in place; the BlockParseSystem then re-converges block entities to
 * the new authored fields. `take-theirs` updates the world body and
 * bumps the provenance's `originalSha256`. `keep-mine` does nothing.
 * `import-new` creates a fresh note from the bundle.
 */
export function applyUpdateResolution(
  world: World,
  bundle: AdventureBundle,
  resolutions: ReadonlyArray<NoteResolution>,
  kindIndex: BlockKindIndex,
): { applied: number; skipped: number } {
  const m = bundle.manifest;
  const noteByPath = new Map(m.notes.map((n) => [n.bundlePath, n]));
  const existingByPath = collectExistingByPath(world, m.bundleId);
  let applied = 0;
  let skipped = 0;

  for (const res of resolutions) {
    if (res.action === "skip" || res.action === "keep-mine") {
      skipped += 1;
      continue;
    }
    const newNote = noteByPath.get(res.bundlePath);
    if (!newNote) continue;
    if (res.action === "merge") {
      const ex = existingByPath.get(res.bundlePath);
      if (!ex) {
        skipped += 1;
        continue;
      }
      const recognized = new Set<string>(kindIndex.byName.keys());
      const mergedBody = mergeBlockBodies(
        ex.body,
        newNote.pages.map((p) => p.body).join("\n\n"),
        res.blockChoices,
        recognized,
      );
      // Write the merged body back to the world's first page; keep
      // surplus pages alone (rare; v1 simplification).
      const worldPages: Array<{ pageId: EntityId; ordinal: number }> = [];
      for (const pageRow of world.query([Page, BelongsToNote, PageOrdering])) {
        const pv = pageRow.values as {
          BelongsToNote: { noteId: EntityId };
          PageOrdering: { ordinal: number };
        };
        if (pv.BelongsToNote.noteId !== ex.noteId) continue;
        worldPages.push({ pageId: pageRow.id, ordinal: pv.PageOrdering.ordinal });
      }
      worldPages.sort((a, b) => a.ordinal - b.ordinal);
      const firstPage = worldPages[0];
      if (firstPage) {
        const before = world.get(firstPage.pageId, [Page]) as
          | { Page: { title: string; bodyRev: number } }
          | undefined;
        world.set(firstPage.pageId, Page, {
          title: before?.Page.title ?? "Untitled",
          body: mergedBody,
          bodyRev: (before?.Page.bodyRev ?? 0) + 1,
        });
        runBlockParse(world, firstPage.pageId, mergedBody, kindIndex);
      }
      world.set(ex.noteId, AdventureProvenance, {
        bundleId: m.bundleId,
        bundleName: m.name,
        version: m.version,
        bundlePath: res.bundlePath,
        originalSha256: sha256Hex(newNote.pages.map((p) => p.body).join("\n\n")),
      });
      applied += 1;
      continue;
    }
    if (res.action === "import-new") {
      // Fresh note creation, same as importBundle's per-note path.
      const noteId = world.spawn([
        Note({ title: newNote.title, createdAt: Date.now() }),
        NoteOrdering({ ordinal: world.query([Note]).length }),
        AdventureProvenance({
          bundleId: m.bundleId,
          bundleName: m.name,
          version: m.version,
          bundlePath: newNote.bundlePath,
          originalSha256: sha256Hex(newNote.pages.map((p) => p.body).join("\n\n")),
        }),
      ]);
      for (let j = 0; j < newNote.pages.length; j += 1) {
        const p = newNote.pages[j]!;
        const pageId = world.spawn([
          BelongsToNote({ noteId }),
          Page({ title: p.title, body: p.body, bodyRev: 1 }),
          PageOrdering({ ordinal: j }),
        ]);
        runBlockParse(world, pageId, p.body, kindIndex);
      }
      applied += 1;
      continue;
    }
    // take-theirs
    const ex = existingByPath.get(res.bundlePath);
    if (!ex) continue;
    // Rewrite each page in place. v1: simple zip of the existing
    // pages to the new pages by ordinal — surplus bundle pages are
    // appended; surplus world pages are removed.
    const worldPages: Array<{ pageId: EntityId; ordinal: number }> = [];
    for (const pageRow of world.query([Page, BelongsToNote, PageOrdering])) {
      const pv = pageRow.values as {
        BelongsToNote: { noteId: EntityId };
        PageOrdering: { ordinal: number };
      };
      if (pv.BelongsToNote.noteId !== ex.noteId) continue;
      worldPages.push({ pageId: pageRow.id, ordinal: pv.PageOrdering.ordinal });
    }
    worldPages.sort((a, b) => a.ordinal - b.ordinal);

    for (let j = 0; j < newNote.pages.length; j += 1) {
      const p = newNote.pages[j]!;
      const wp = worldPages[j];
      if (wp) {
        const before = world.get(wp.pageId, [Page]) as
          | { Page: { body: string; bodyRev: number } }
          | undefined;
        const nextRev = (before?.Page.bodyRev ?? 0) + 1;
        world.set(wp.pageId, Page, {
          title: p.title,
          body: p.body,
          bodyRev: nextRev,
        });
        runBlockParse(world, wp.pageId, p.body, kindIndex);
      } else {
        const pageId = world.spawn([
          BelongsToNote({ noteId: ex.noteId }),
          Page({ title: p.title, body: p.body, bodyRev: 1 }),
          PageOrdering({ ordinal: j }),
        ]);
        runBlockParse(world, pageId, p.body, kindIndex);
      }
    }
    // Update the provenance to point at the new bundle's body sha.
    world.set(ex.noteId, AdventureProvenance, {
      bundleId: m.bundleId,
      bundleName: m.name,
      version: m.version,
      bundlePath: newNote.bundlePath,
      originalSha256: sha256Hex(newNote.pages.map((p) => p.body).join("\n\n")),
    });
    applied += 1;
  }

  return { applied, skipped };
}
