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

/**
 * Compile a hand-authored adventure working directory into a
 * `.advt.zip` bundle ready for `POST /api/worlds/<id>/adventures/import`.
 *
 * Usage:
 *   pnpm tsx tools/build-adventure-bundle/build.ts <working-dir> [--out <path>] [--no-block-check]
 *
 * Defaults `--out` to `<working-dir-basename>.advt.zip` next to the
 * working dir. Working-dir layout is documented at the top of
 * `packages/adventures/src/server/build-from-dir.ts`.
 *
 * Block validation: by default every fenced `character` / `monster` /
 * `npc` / `item` / `encounter` / `loot` block is validated against the
 * schema contributed by the bundle's `gameSystem` plugin (the same
 * YAML + wiki-link + Zod path the importer runs). A malformed block
 * aborts the build with a precise report. `--no-block-check` skips it
 * (also auto-skipped, with a warning, for a game system this tool
 * doesn't know how to load).
 */

import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { bundleToZip } from "@vtt/adventures/server";
import { buildBundleFromDir } from "@vtt/adventures/server/build-from-dir";
import {
  buildBlockKindIndexFromPlugins,
  type BlockKindIndex,
} from "@vtt/adventures/shared";
import type { PluginDef } from "@vtt/substrate";
import systemTorchbearer from "@vtt/system-torchbearer";

/**
 * Game-system plugins this tool knows how to load for block-schema
 * validation, keyed by the `gameSystem` string authors put in
 * `bundle.json`. Add a line here when a new game system ships block
 * kinds. A bundle whose game system isn't listed still builds — the
 * block check is skipped with a warning.
 */
const KNOWN_GAME_SYSTEMS: Readonly<Record<string, PluginDef>> = {
  "@vtt/system-torchbearer": systemTorchbearer,
};

interface CliArgs {
  dir: string;
  out: string;
  blockCheck: boolean;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  const args = argv.slice(2);
  let dir: string | null = null;
  let out: string | null = null;
  let blockCheck = true;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--out" || a === "-o") {
      const next = args[i + 1];
      if (!next) {
        throw new Error("--out requires a path argument");
      }
      out = next;
      i += 1;
      continue;
    }
    if (a === "--no-block-check") {
      blockCheck = false;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`unknown flag: ${a}`);
    }
    if (dir === null) {
      dir = a;
      continue;
    }
    throw new Error(`unexpected positional argument: ${a}`);
  }
  if (dir === null) {
    throw new Error(
      "usage: build-adventure-bundle <working-dir> [--out <path>] [--no-block-check]",
    );
  }
  const absDir = resolve(dir);
  const absOut = out !== null
    ? resolve(out)
    : join(dirname(absDir), `${basename(absDir)}.advt.zip`);
  return { dir: absDir, out: absOut, blockCheck };
}

/**
 * Resolve the block-kind index for the bundle's game system, or null
 * when the check is disabled or the system is unknown. Reads
 * `gameSystem` straight out of `bundle.json` so we can pick the plugin
 * before `buildBundleFromDir` runs.
 */
async function resolveKindIndex(
  dir: string,
  blockCheck: boolean,
): Promise<BlockKindIndex | undefined> {
  if (!blockCheck) return undefined;
  let gameSystem: string;
  try {
    const raw = await readFile(join(dir, "bundle.json"), "utf8");
    gameSystem = (JSON.parse(raw) as { gameSystem?: string }).gameSystem ?? "";
  } catch {
    return undefined; // buildBundleFromDir will report the missing/bad bundle.json
  }
  const plugin = KNOWN_GAME_SYSTEMS[gameSystem];
  if (!plugin) {
    process.stderr.write(
      `build-adventure-bundle: no block schemas registered for gameSystem ` +
        `${JSON.stringify(gameSystem)}; skipping block validation. ` +
        `Add it to KNOWN_GAME_SYSTEMS or pass --no-block-check to silence.\n`,
    );
    return undefined;
  }
  return buildBlockKindIndexFromPlugins([plugin]);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const kindIndex = await resolveKindIndex(args.dir, args.blockCheck);
  const bundle = await buildBundleFromDir({ dir: args.dir, kindIndex });
  const zip = bundleToZip(bundle);
  await writeFile(args.out, zip);
  const totalPages = bundle.manifest.notes.reduce(
    (n, note) => n + note.pages.length,
    0,
  );
  process.stdout.write(
    [
      `wrote ${args.out}`,
      `  bundle ${bundle.manifest.name} ${bundle.manifest.version}`,
      `  notes  ${bundle.manifest.notes.length}`,
      `  pages  ${totalPages}`,
      `  assets ${bundle.manifest.assets.length}`,
      `  bytes  ${zip.length}`,
      `  blocks ${kindIndex ? "validated" : "not checked"}`,
      "",
    ].join("\n"),
  );
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`build-adventure-bundle: ${msg}\n`);
  process.exit(1);
});
