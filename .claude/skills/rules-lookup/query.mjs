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

// Local-only rules lookup. Reads `chunks.jsonl` files from any
// rules-corpus dir under data/plugin-data/<worldId>/@vtt/rules-corpus/
// (or an explicit --corpus path), runs a simple BM25-flavoured search,
// prints ranked chunks with both page numbers.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_DATA_DIR = resolve(REPO_ROOT, "data");

function usage() {
  process.stderr.write(
    [
      "Usage: rules-lookup <query> [options]",
      "",
      "Options:",
      "  --system <tag>       Filter corpora by tag (case-insensitive).",
      "  --corpus <dir>       Use a specific corpus directory.",
      "  --limit <n>          Max results (default 5).",
      "  --list               List discovered corpora and exit.",
      "  --data-dir <dir>     Override the scan root (default: <repo>/data).",
      "  --json               Emit machine-readable JSON.",
      "  --help               Show this message.",
      "",
    ].join("\n"),
  );
}

function discoverCorpora(dataDir) {
  const root = resolve(dataDir, "plugin-data");
  if (!existsSync(root)) return [];
  const corpora = [];
  for (const worldEntry of safeReaddir(root)) {
    const worldDir = resolve(root, worldEntry);
    if (!isDir(worldDir)) continue;
    const corpusRoot = resolve(worldDir, "@vtt", "rules-corpus");
    if (!isDir(corpusRoot)) continue;
    for (const assetEntry of safeReaddir(corpusRoot)) {
      const corpusDir = resolve(corpusRoot, assetEntry);
      const manifestPath = resolve(corpusDir, "manifest.json");
      const chunksPath = resolve(corpusDir, "chunks.jsonl");
      if (!existsSync(manifestPath) || !existsSync(chunksPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        corpora.push({
          dir: corpusDir,
          worldId: worldEntry,
          assetId: assetEntry,
          manifest,
        });
      } catch {
        // ignore malformed
      }
    }
  }
  return corpora;
}

function selectCorpora(all, opts) {
  if (opts.corpus) {
    const dir = resolve(opts.corpus);
    const manifestPath = resolve(dir, "manifest.json");
    if (!existsSync(manifestPath)) {
      die(`no manifest.json at ${dir}`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return [{ dir, worldId: "(adhoc)", assetId: "(adhoc)", manifest }];
  }
  if (opts.system) {
    const needle = opts.system.toLowerCase();
    return all.filter((c) => {
      const tags = (c.manifest.tags ?? []).map((t) => t.toLowerCase());
      const title = (c.manifest.title ?? "").toLowerCase();
      return tags.includes(needle) || title.includes(needle);
    });
  }
  return all;
}

function loadChunks(corpusDir) {
  const path = resolve(corpusDir, "chunks.jsonl");
  const raw = readFileSync(path, "utf8");
  const out = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip
    }
  }
  return out;
}

// ---- BM25-flavoured search ------------------------------------------

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "to", "for", "is", "be",
  "with", "as", "by", "at", "it", "this", "that", "you", "your", "are",
  "from", "but", "not", "if", "do", "can", "may", "will", "have", "has",
]);

function tokenize(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9'\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function bm25Score(query, docs) {
  // BM25 with k1=1.5, b=0.75. Each doc is { tokens: string[] }.
  // Returns array of scores, doc-index aligned.
  const N = docs.length;
  const avgdl = docs.reduce((a, d) => a + d.tokens.length, 0) / Math.max(N, 1);
  const df = new Map();
  for (const d of docs) {
    const seen = new Set();
    for (const t of d.tokens) seen.add(t);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const k1 = 1.5;
  const b = 0.75;
  const queryTokens = tokenize(query);
  const scores = new Array(N).fill(0);
  for (const qt of queryTokens) {
    const n = df.get(qt) ?? 0;
    if (n === 0) continue;
    const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);
    for (let i = 0; i < N; i++) {
      const d = docs[i];
      let f = 0;
      for (const t of d.tokens) if (t === qt) f++;
      if (f === 0) continue;
      const norm = 1 - b + b * (d.tokens.length / Math.max(avgdl, 1));
      scores[i] += idf * ((f * (k1 + 1)) / (f + k1 * norm));
    }
  }
  // Bonus: match in headingPath weighs heavier.
  for (let i = 0; i < N; i++) {
    const heading = docs[i].headingTokens;
    for (const qt of queryTokens) {
      if (heading.includes(qt)) scores[i] *= 1.5;
    }
  }
  return scores;
}

function preIndex(chunks) {
  return chunks.map((c) => ({
    chunk: c,
    tokens: tokenize(c.body ?? ""),
    headingTokens: tokenize((c.headingPath ?? []).join(" ")),
  }));
}

// ---- Output --------------------------------------------------------

function snippet(body, query, maxChars = 320) {
  if (!body) return "";
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return body.slice(0, maxChars);
  const lower = body.toLowerCase();
  let bestIdx = -1;
  for (const t of queryTokens) {
    const idx = lower.indexOf(t);
    if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) bestIdx = idx;
  }
  if (bestIdx < 0) return body.slice(0, maxChars);
  const start = Math.max(0, bestIdx - 80);
  const end = Math.min(body.length, start + maxChars);
  let out = body.slice(start, end);
  if (start > 0) out = "…" + out;
  if (end < body.length) out = out + "…";
  return out;
}

function citationLine(chunk) {
  const heading = (chunk.headingPath ?? []).join(" → ") || "(unnamed)";
  const printed =
    chunk.printedPage !== null && chunk.printedPage !== undefined
      ? `printed p.${chunk.printedPage}${chunk.printedPageEnd ? `–${chunk.printedPageEnd}` : ""}`
      : "printed p.?";
  const pdf = `PDF p.${chunk.pdfPage}${chunk.pdfPageEnd ? `–${chunk.pdfPageEnd}` : ""}`;
  return `${heading} — ${printed} (${pdf})`;
}

function prettyPrint(query, hits) {
  if (hits.length === 0) {
    process.stdout.write(`no matches for "${query}"\n`);
    return;
  }
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    process.stdout.write(`\n─── ${i + 1} ${"─".repeat(50)}\n`);
    process.stdout.write(`  ${citationLine(h.chunk)}\n`);
    process.stdout.write(`  ${"─".repeat(50)}\n`);
    const text = snippet(h.chunk.body, query)
      .split("\n")
      .map((l) => "  " + l)
      .join("\n");
    process.stdout.write(text + "\n");
  }
  process.stdout.write("\n");
}

function listCorpora(corpora) {
  if (corpora.length === 0) {
    process.stdout.write("no corpora found.\n");
    return;
  }
  for (const c of corpora) {
    const tags = (c.manifest.tags ?? []).join(",") || "(none)";
    process.stdout.write(
      `${c.manifest.title ?? "(untitled)"}  [${tags}]\n` +
        `  pages: ${c.manifest.pageCount}  worldId: ${c.worldId}\n` +
        `  dir:   ${c.dir}\n\n`,
    );
  }
}

// ---- Main ---------------------------------------------------------

function safeReaddir(p) {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}
function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function die(msg) {
  process.stderr.write(`rules-lookup: ${msg}\n`);
  process.exit(1);
}

function main() {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        system: { type: "string" },
        corpus: { type: "string" },
        limit: { type: "string" },
        list: { type: "boolean" },
        "data-dir": { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean" },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    process.stderr.write(`error parsing args: ${err.message}\n`);
    usage();
    process.exit(2);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    usage();
    process.exit(0);
  }
  const dataDir = values["data-dir"] ?? DEFAULT_DATA_DIR;
  const all = discoverCorpora(dataDir);

  if (values.list) {
    listCorpora(all);
    process.exit(0);
  }

  const query = positionals.join(" ").trim();
  if (query.length === 0 && !values.corpus) {
    usage();
    process.exit(2);
  }

  const selected = selectCorpora(all, values);
  if (selected.length === 0) {
    die("no corpus matched. Run with --list to see available corpora.");
  }

  const limit = Number(values.limit ?? "5");
  const allHits = [];
  for (const corpus of selected) {
    const chunks = loadChunks(corpus.dir);
    const indexed = preIndex(chunks);
    const scores = bm25Score(query, indexed);
    for (let i = 0; i < indexed.length; i++) {
      if (scores[i] > 0) {
        allHits.push({
          score: scores[i],
          chunk: indexed[i].chunk,
          corpus: { worldId: corpus.worldId, assetId: corpus.assetId, title: corpus.manifest.title },
        });
      }
    }
  }
  allHits.sort((a, b) => b.score - a.score);
  const top = allHits.slice(0, Math.max(1, Math.min(limit, 50)));

  if (values.json) {
    process.stdout.write(JSON.stringify({ query, hits: top }, null, 2) + "\n");
  } else {
    prettyPrint(query, top);
  }
}

main();
