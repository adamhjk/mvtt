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
 *   pnpm tsx tools/build-adventure-bundle/build.ts <working-dir> [--out <path>]
 *
 * Defaults `--out` to `<working-dir-basename>.advt.zip` next to the
 * working dir. Working-dir layout is documented at the top of
 * `packages/adventures/src/server/build-from-dir.ts`.
 */

import { writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { bundleToZip } from "@vtt/adventures/server";
import { buildBundleFromDir } from "@vtt/adventures/server/build-from-dir";

interface CliArgs {
  dir: string;
  out: string;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  const args = argv.slice(2);
  let dir: string | null = null;
  let out: string | null = null;
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
      "usage: build-adventure-bundle <working-dir> [--out <path>]",
    );
  }
  const absDir = resolve(dir);
  const absOut = out !== null
    ? resolve(out)
    : join(dirname(absDir), `${basename(absDir)}.advt.zip`);
  return { dir: absDir, out: absOut };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const bundle = await buildBundleFromDir({ dir: args.dir });
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
      "",
    ].join("\n"),
  );
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`build-adventure-bundle: ${msg}\n`);
  process.exit(1);
});
