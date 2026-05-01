#!/usr/bin/env node
// Apply the AGPL license header (scripts/license-header.txt) to every source
// file under packages/ that does not already start with it. Idempotent: files
// that already begin with the header marker are left untouched.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const HEADER_PATH = join(REPO_ROOT, "scripts", "license-header.txt");

export const HEADER_MARKER = "// MVTT, An RPG virtual tabletop";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vite",
  ".cache",
]);

export async function* walkSourceFiles(dir = PACKAGES_DIR) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      yield* walkSourceFiles(path);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      if (dot < 0) continue;
      if (SOURCE_EXTENSIONS.has(entry.name.slice(dot))) yield path;
    }
  }
}

export function hasHeader(content) {
  return content.startsWith(HEADER_MARKER);
}

async function main() {
  const headerRaw = await readFile(HEADER_PATH, "utf8");
  const header = headerRaw.endsWith("\n") ? headerRaw : `${headerRaw}\n`;

  let updated = 0;
  let skipped = 0;
  for await (const file of walkSourceFiles()) {
    const content = await readFile(file, "utf8");
    if (hasHeader(content)) {
      skipped++;
      continue;
    }
    const separator = content.length === 0 || content.startsWith("\n") ? "" : "\n";
    await writeFile(file, header + separator + content);
    console.log(`added: ${relative(REPO_ROOT, file)}`);
    updated++;
  }
  console.log(`\n${updated} file(s) updated, ${skipped} already had the header.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
