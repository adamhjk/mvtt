---
name: rules-lookup
description: Look up rule text from a game-system rulebook that has been extracted into a local rules corpus by `tools/rules-extract`. Use this skill any time you are implementing a game-system plugin (e.g. `@vtt/system-torchbearer`) and need to consult the rules-as-written before encoding a mechanic. Returns ranked chunks of source text with both PDF page index (for deep-linking into the pdf-book viewer) and the printed page number that appears in the physical book (for code citations and human cross-reference). Search is local-only — runs against `chunks.jsonl` files under `data/plugin-data/<worldId>/@vtt/rules-corpus/<assetId>/` on the developer's machine. Trigger when: writing or modifying any system/game mechanics file inside `packages/system-*` or any subdir whose authority is "the rulebook said so"; verifying a rule before encoding it; resolving "what does the book say about X?" for any mechanic, condition, ability, action, or table. Do NOT trigger for general programming questions, substrate work, or non-rules code.
---

# rules-lookup

Look up rule text from a game-system rulebook that has been extracted into a local rules corpus. This skill is the AI-author counterpart to the runtime "find rule" UI — same artifacts, two consumers.

## Mental model

The mvtt repo's rules-corpus pipeline extracts a PDF rulebook into a directory of artifacts:

```
<corpus-dir>/
  manifest.json                 # title, pageCount, tags, pageMap, sourceSha
  chunks.jsonl                  # one JSON object per heading-bounded section
  pages/<pdfPage>.txt           # full per-page text
  images/p<pdfPage>-<n>.png     # extracted images
```

Each chunk in `chunks.jsonl` carries:

```json
{
  "chunkId": "<16-hex>",
  "pdfPage": 142,
  "pdfPageEnd": null,
  "printedPage": 138,
  "printedPageEnd": null,
  "headingPath": ["Combat", "Attacks", "Flanking"],
  "body": "When you flank a foe …",
  "tokens": 412,
  "imageRefs": ["p-142-001.png"]
}
```

**Two page numbers, both matter.** `pdfPage` is the index into the file (what `pdf.js` needs to deep-link). `printedPage` is what the physical book prints in its corner (what you cite in code comments — stable across PDF re-exports). When citing a rule in code, use the printed page; the runtime can resolve to PDF page via the corpus manifest's `pageMap`.

When the skill returns chunks, **read the body carefully**, write the mechanic so it matches the rules-as-written, and put a brief printed-page citation in the relevant code comment. Example:

```ts
// TB2 p.68: Will tests with Faith are fate-blessed (reroll one ‘1’)
```

## When to use

- Implementing a new mechanic in a game-system plugin: search the rule first, encode second.
- Verifying an existing implementation against the source — pull the chunk and diff in your head.
- Disambiguating a vague mechanic name a player or tester used ("how does _fate_ work?").
- Deciding chunker tuning (e.g. seeing whether headings are getting picked up correctly).

## How to use

The repo ships a small Node CLI at `.claude/skills/rules-lookup/query.mjs`. Invoke it via:

```
node .claude/skills/rules-lookup/query.mjs <query> [options]
```

### Options

| Flag               | Meaning                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `--system <tag>`   | Filter corpora by tag (case-insensitive). Most common: `--system torchbearer`.              |
| `--corpus <dir>`   | Point at a specific corpus directory directly. Useful for ad-hoc PDFs outside the data dir. |
| `--limit <n>`      | Max results (default 5).                                                                    |
| `--list`           | List discovered corpora and exit; useful first run.                                         |
| `--data-dir <dir>` | Override the data-dir scan root (default: `<repo>/data`).                                   |

### Discovery

Without `--corpus`, the skill scans `<data-dir>/plugin-data/*/@vtt/rules-corpus/*/manifest.json` and matches by tags or title substring. If exactly one corpus matches, it queries that one. If multiple match, it lists candidates and asks you to disambiguate. The skill never re-extracts on its own — if a corpus is missing, run `tools/rules-extract` first.

### Output

Pretty-printed by default — one heading-path citation per result, with PDF and printed page, then the body snippet (~10 lines). Pass `--json` for machine-readable output.

```
─── 1 ────────────────────────────────────────────────
  Combat → Attacks → Flanking — printed p.138 (PDF p.142)
  ─────────────────────────────────────────────────────
  When you flank a foe, your attack is fate-blessed: reroll
  one '1' on the attack pool. The flanking ally must be on
  the opposite side of the target …
```

## Workflow recipe

```
# Once per game system per dev machine
pnpm --filter @vtt/server exec node --import tsx \
  ../rules-extract/src/cli.ts \
  --asset-path /path/to/rulebook.pdf \
  --out-dir data/plugin-data/<worldId>/@vtt/rules-corpus/<assetId> \
  --tags torchbearer,tb \
  --title "Torchbearer 2nd Edition"

# Then any time during development
node .claude/skills/rules-lookup/query.mjs --system torchbearer "edge advantage"
node .claude/skills/rules-lookup/query.mjs --system tb "fate dice when"
node .claude/skills/rules-lookup/query.mjs --list
```

## Limits

- **No semantic search yet.** Search is BM25-flavoured term matching over chunk bodies. Synonyms aren't bridged: a search for "edge" will not surface text that uses "advantage" instead. Phrase-match in quotes for tight queries; loose terms otherwise.
- **Chunk granularity depends on the PDF outline.** Books with a deep outline produce small, well-titled chunks; outline-less PDFs fall back to font-size-based heading detection (good but coarser).
- **Status check.** If `manifest.json` says the extraction is older than what's in `git log -- packages/rules-extract`, re-extract — the chunker may have improved.

## Anti-patterns

- Do **not** invent rules. If the skill returns nothing relevant, say so — don't fill in plausibly-shaped mechanics.
- Do **not** scrape the PDF directly with another tool — the corpus is the canonical entry point and the only way to maintain consistent citations.
- Do **not** cite `pdfPage` in code comments. Use `printedPage`. The PDF page index changes if the publisher re-exports; the printed page is forever.
- If you need a fact that the chunker fragmented across two chunks, surface both chunks in the skill output rather than guessing what's in between.
