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

// Compile a hand-authored working directory into an `AdventureBundle`
// that's byte-shape-identical to what `buildBundle` produces from a
// live world. The CLI in `tools/build-adventure-bundle/` is a thin
// wrapper around `buildBundleFromDir` + `bundleToZip`.
//
// Working-dir layout (single-note, multi-page is the recommended
// shape — see design/adventures.md and the recommendation discussion
// at the time this was added):
//
//   <dir>/
//     bundle.json                   # top-level manifest fields
//     notes/<note-dir>/index.md     # optional frontmatter: title, bundlePath
//     notes/<note-dir>/NN-slug.md   # ordered pages; frontmatter: title
//     assets/<filename>             # raw bytes; sha256+slug auto-derived
//
// Page bodies are markdown verbatim — fenced ```character / ```monster
// / ```encounter / ```loot / ```item / ```setdesign blocks pass through
// untouched and materialise on import via `runBlockParse`. Asset refs
// in bodies use `[[asset:<slug>]]` / `![[asset:<slug>]]` and are
// rewritten to live entity ids at import time via the descriptor's
// `sourceEntityId` field.

import { readFile, readdir, stat as statPath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, join, resolve } from "node:path";
import * as YAML from "js-yaml";
import {
  BundleManifestSchema,
  sha256Hex,
  type AdventureBundle,
  type BundleManifest,
} from "./bundle.js";
import { validateBlockBodies } from "./block-parse-system.js";
import type { BlockKindIndex } from "../shared/block-kinds.js";

/** Options for `buildBundleFromDir`. */
export interface BuildFromDirOptions {
  /** Absolute path to the working directory. Must contain `bundle.json`. */
  dir: string;
  /**
   * Optional block-kind index for the bundle's game system. When
   * supplied, every fenced block in every page is validated against
   * its kind's schema (the same YAML + wiki-link + Zod path the
   * importer runs) and the build aborts with a precise report if any
   * block is malformed. Omit to skip the check — the bundle still
   * builds, and bad blocks surface at import time as before.
   *
   * The CLI builds this from the `gameSystem` named in `bundle.json`;
   * see `tools/build-adventure-bundle/build.ts`.
   */
  kindIndex?: BlockKindIndex;
}

type ManifestTop = Pick<
  BundleManifest,
  | "bundleId"
  | "name"
  | "version"
  | "summary"
  | "author"
  | "gameSystem"
  | "requires"
>;

/**
 * Parse top-level manifest fields from `bundle.json`. We piggyback on
 * `BundleManifestSchema` by feeding it stubbed `notes` / `assets`
 * arrays — that way author typos in the top-level shape surface with
 * the same zod errors the importer would produce, and any
 * future schema additions don't silently drift.
 */
function parseBundleTop(raw: string): ManifestTop {
  const json = JSON.parse(raw) as Record<string, unknown>;
  const stub = { ...json, notes: [], assets: [] } satisfies Record<string, unknown>;
  const parsed = BundleManifestSchema.parse(stub);
  return {
    bundleId: parsed.bundleId,
    name: parsed.name,
    version: parsed.version,
    summary: parsed.summary,
    author: parsed.author,
    gameSystem: parsed.gameSystem,
    requires: parsed.requires,
  };
}

/**
 * Pull a `---`-fenced YAML frontmatter block off the top of a markdown
 * file. Lenient — no frontmatter is fine, returns `{}` data and the
 * full body. Strict on shape — if the fence is present but the inner
 * YAML is malformed, `js-yaml` will throw and the build aborts.
 */
function splitFrontmatter(raw: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };
  const yamlBlock = match[1] ?? "";
  const body = match[2] ?? "";
  const parsed = YAML.load(yamlBlock);
  const data: Record<string, unknown> =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return { data, body };
}

/** Humanise `04-the-barrow-entrance` → "The Barrow Entrance". */
function humaniseSlug(slug: string): string {
  return slug
    .replace(/^[0-9]+[-_]?/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Strip extension and the numeric `NN-` prefix → stable asset slug. */
function assetSlug(filename: string): string {
  const noExt = filename.replace(/\.[^./]+$/, "");
  return noExt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
};

function mimeFor(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function sha256OfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const NOTE_INDEX_FILENAME = "index.md";
const PAGE_FILE_RE = /^([0-9]+)[-_].+\.md$/;

async function readDirEntries(
  dir: string,
): Promise<{ name: string; isDir: boolean; isFile: boolean }[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: { name: string; isDir: boolean; isFile: boolean }[] = [];
  for (const name of entries) {
    const s = await statPath(join(dir, name));
    out.push({ name, isDir: s.isDirectory(), isFile: s.isFile() });
  }
  return out;
}

async function buildNote(
  noteDir: string,
  dirName: string,
): Promise<BundleManifest["notes"][number]> {
  const entries = await readDirEntries(noteDir);
  const indexEntry = entries.find((e) => e.isFile && e.name === NOTE_INDEX_FILENAME);
  let title = humaniseSlug(dirName);
  let bundlePath = dirName;
  if (indexEntry) {
    const indexRaw = await readFile(join(noteDir, NOTE_INDEX_FILENAME), "utf8");
    const { data } = splitFrontmatter(indexRaw);
    if (typeof data.title === "string" && data.title.trim().length > 0) {
      title = data.title.trim();
    }
    if (typeof data.bundlePath === "string" && data.bundlePath.trim().length > 0) {
      bundlePath = data.bundlePath.trim();
    }
  }

  const pageEntries = entries
    .filter((e) => e.isFile && PAGE_FILE_RE.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  if (pageEntries.length === 0) {
    throw new Error(
      `note directory ${noteDir} contains no page files (expected NN-slug.md)`,
    );
  }

  const pages: BundleManifest["notes"][number]["pages"] = [];
  for (const entry of pageEntries) {
    const raw = await readFile(join(noteDir, entry.name), "utf8");
    const { data, body } = splitFrontmatter(raw);
    const trimmedBody = body.replace(/^\s+|\s+$/g, "");
    let pageTitle: string;
    if (typeof data.title === "string" && data.title.trim().length > 0) {
      pageTitle = data.title.trim();
    } else {
      const stem = entry.name.replace(/\.md$/, "");
      pageTitle = humaniseSlug(stem);
    }
    pages.push({
      title: pageTitle,
      body: trimmedBody,
      sha256: sha256Hex(trimmedBody),
    });
  }

  return { bundlePath, title, pages };
}

async function buildAssets(assetsDir: string): Promise<{
  descriptors: BundleManifest["assets"];
  bytesBySha: Map<string, Uint8Array>;
}> {
  const entries = await readDirEntries(assetsDir);
  const fileEntries = entries.filter((e) => e.isFile).sort((a, b) => a.name.localeCompare(b.name));
  const descriptors: BundleManifest["assets"] = [];
  const bytesBySha = new Map<string, Uint8Array>();
  const slugSeen = new Set<string>();
  for (const entry of fileEntries) {
    const path = join(assetsDir, entry.name);
    const buf = await readFile(path);
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const sha = sha256OfBytes(bytes);
    let slug = assetSlug(entry.name);
    if (slug.length === 0) {
      throw new Error(`asset filename ${entry.name} yields an empty slug`);
    }
    if (slugSeen.has(slug)) {
      throw new Error(
        `asset slug collision: ${entry.name} → ${slug}. Rename one of the colliding files.`,
      );
    }
    slugSeen.add(slug);
    descriptors.push({
      sha256: sha,
      name: entry.name,
      mime: mimeFor(entry.name),
      bytes: bytes.length,
      sourceEntityId: slug,
    });
    bytesBySha.set(sha, bytes);
  }
  return { descriptors, bytesBySha };
}

/**
 * Compile a working directory into an `AdventureBundle`. The returned
 * bundle can be passed straight to `bundleToZip` (or to `importBundle`
 * in tests). Throws on missing `bundle.json`, malformed frontmatter,
 * empty note dirs, or asset-slug collisions — the build is meant to
 * fail loudly during authoring rather than silently produce a broken
 * zip.
 */
export async function buildBundleFromDir(
  opts: BuildFromDirOptions,
): Promise<AdventureBundle> {
  const dir = resolve(opts.dir);

  // Top-level manifest fields.
  const bundleJsonPath = join(dir, "bundle.json");
  let bundleRaw: string;
  try {
    bundleRaw = await readFile(bundleJsonPath, "utf8");
  } catch {
    throw new Error(`missing bundle.json at ${bundleJsonPath}`);
  }
  const top = parseBundleTop(bundleRaw);

  // Notes.
  const notesDir = join(dir, "notes");
  const noteDirEntries = await readDirEntries(notesDir);
  const noteDirs = noteDirEntries
    .filter((e) => e.isDir)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (noteDirs.length === 0) {
    throw new Error(`no note directories found under ${notesDir}`);
  }
  const notes: BundleManifest["notes"] = [];
  for (const entry of noteDirs) {
    notes.push(await buildNote(join(notesDir, entry.name), entry.name));
  }

  // Block-schema validation (opt-in via kindIndex). Runs the same
  // YAML + wiki-link + Zod path the importer uses, so authoring
  // mistakes (bad enum, missing required field, malformed YAML) fail
  // the build here instead of silently shipping a zip that breaks on
  // import. Reference resolution is *not* checked — that needs a
  // seeded world and is the importer's / export-closure's job.
  if (opts.kindIndex) {
    const report: string[] = [];
    for (const note of notes) {
      for (const page of note.pages) {
        for (const err of validateBlockBodies(page.body, opts.kindIndex)) {
          const where = `${note.title} › ${page.title} › \`\`\`${err.kind} ${err.info}`.trim();
          if (err.stage === "yaml" || err.issues.length === 0) {
            report.push(`  ${where}\n      ${err.message}`);
          } else {
            for (const issue of err.issues) {
              report.push(`  ${where}\n      ${issue.path}: ${issue.message}`);
            }
          }
        }
      }
    }
    if (report.length > 0) {
      throw new Error(
        `block validation failed (${report.length} issue${report.length === 1 ? "" : "s"}):\n${report.join("\n")}`,
      );
    }
  }

  // Assets.
  const { descriptors, bytesBySha } = await buildAssets(join(dir, "assets"));

  const manifest: BundleManifest = {
    bundleId: top.bundleId,
    name: top.name,
    version: top.version,
    summary: top.summary,
    author: top.author,
    gameSystem: top.gameSystem,
    requires: top.requires,
    exportedAt: new Date().toISOString(),
    notes,
    assets: descriptors,
  };
  const validated = BundleManifestSchema.parse(manifest);
  return { manifest: validated, assets: bytesBySha };
}
