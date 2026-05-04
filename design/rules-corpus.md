# Rules corpus

**Status:** proposed. Lands as one new plugin (`@vtt/rules-corpus`), one new tool (`tools/rules-extract`), one new skill (`.claude/skills/rules-lookup/`), and a migration of `@vtt/pdf-book` onto `@vtt/assets` to fix a pre-existing storage gap. The rules corpus plugin is built on top of that centralized asset layer; it does not introduce a third storage path.

## The problem

To build game systems that *implement the rules as written*, both the AI author (during plugin development) and the mvtt runtime (during play) need to look up authoritative rule text by topic and resolve it to a page in the rulebook. There is no such facility today, and three structural pieces are missing:

1. **No rule index.** Game-system implementations today encode mechanics in code with no link back to the rulebook section that justified them. A change to the implementation has no audit trail to the source. An AI author has no programmatic way to ask "what does the book say about flanking?" — they fall back to re-extracting the PDF on every session, which is slow, lossy, and non-deterministic. The existing `torchbearer-reference-extraction` skill is on-demand and per-question; a comprehensive index is missing.

2. **PDFs aren't centralized.** `@vtt/assets` is the world-scoped byte-blob plugin, with sha256 dedup, a metadata trait, fine-grained per-asset visibility, and a hardened upload + visibility-resolved fetch path. `@vtt/pdf-book` does not use it. PDFs upload through the generic `POST /api/plugin-data/<worldId>/<rest>` route, land at `data/plugin-data/<worldId>/@vtt/pdf-book/books/<bookId>/<filename>.pdf`, and the `Book`'s `PdfDocument` trait stores the URL directly. Result: no dedup (the same SRD in three worlds stores three copies), no per-PDF visibility (it's inherited from the `Book`), no asset library, no metadata trait to query. Rules-corpus needs a single canonical "the bytes of this PDF" identity to key its extraction artifacts against; today no such identity exists.

3. **Copyright posture isn't articulated.** Extracted text from a copyrighted rulebook is a derivative. Committing it would be republishing it. The infrastructure must guarantee that nothing produced by the extraction pipeline ever reaches the source tree, on any developer machine, on any branch.

## Approach

Three structural decisions:

1. **Migrate `@vtt/pdf-book` onto `@vtt/assets`.** A `Book` no longer stores a URL; it stores `assetId: AssetId`. The PDF's bytes, mime, sha256, and size live on the `Asset` entity. Visibility is per-asset. Pre-launch, no users — we just change the code and delete the old code path (per the project's no-backcompat rule).

2. **Build `@vtt/rules-corpus` as an opt-in indexer over assets.** It subscribes to nothing automatically. A `IndexRules { assetId, tags? }` command, dispatched explicitly (UI button, REST endpoint, or dev tool), kicks off extraction for that one asset. Not every PDF is a rulebook (handouts, scenarios, character backstories don't need indexing). Status, manifest, and corpus pointer live on a per-corpus entity owned by a per-world `RulesLibrary` sentinel.

3. **One artifact set, two consumers.** Extraction writes a content-addressed corpus directory (keyed by `assetId`, which is itself sha256-derived under the assets plugin) once. Both the runtime (via `QueryRules` command) and the AI author (via the `rules-lookup` skill) read the same files. Runtime queries cross the wire as commands+events. The skill reads the local data dir directly — it's a dev-time tool, not a runtime client. In dev the developer *is* their GM, so the local data dir is populated naturally by the same upload-and-index flow players use in production.

## Two page numbers, both tracked

PDF readers and physical books disagree about page numbers, and we need to be useful to readers of both. Every chunk and every query result carries two page references:

- **`pdfPage`** — the 1-based index in the PDF file. This is what `pdf.js` needs to navigate to a page; it's how we deep-link from a query result into the runtime viewer.
- **`printedPage`** — the page number printed on the physical page, as the reader of a paper book would read it. This is what the AI author cites in code comments and what the rulebook's own cross-references use.

These are usually offset by some constant (covers, copyright, ToC, and foreword push printed-page numbering down — printed p.1 is often PDF p.7), but the offset is *not* always constant. Inserted color plates, unnumbered chapter title pages, appendices with letter-prefix numbering (`A-12`), and Roman numerals on front matter (`vii`) all break a simple "subtract N" rule. So `printedPage` is `string | number | null`, not just an integer offset of `pdfPage`.

The chunker derives `printedPage` per page, in priority order:

1. **PDF outline.** When the PDF ships with a bookmark/outline that encodes printed-page destinations, use it.
2. **Header/footer scan.** Look for an integer or Roman numeral in the top or bottom band of the page, monotonic with neighbors. Tag with that.
3. **Manifest override.** The CLI accepts a `--page-map` JSON file mapping `pdfPage → printedPage` for ranges where automatic detection fails. Persisted into the manifest as `pageMap`.
4. **Null.** If outline + scan don't produce a confident answer and there's no override, leave `printedPage: null`. Better to say "I don't know" than to lie.

Page-spanning chunks carry `pdfPageRange: [first, last]` and `printedPageRange: [first, last] | null` correspondingly. Citations everywhere lead with printed and parenthesize PDF: `"Combat → Flanking" (printed p.142, PDF p.148)`. The runtime UI binds the deep-link button to `pdfPage` and shows `printedPage` in the label. Code comments cite printed pages because they're stable across PDF reprints — a re-export with a different intro can shift `pdfPage` without touching `printedPage`.

## Centralizing PDF storage on `@vtt/assets`

This is a precondition, not a side quest. Concretely:

- `Asset` trait gains: nothing structural (mime/size/sha256/filename already cover it). MIME allow-list expands to include `application/pdf`; per-MIME size cap raises to 250 MB for PDFs (matching the existing pdf-book limit). Image cap stays 5 MB.
- `Book` entity (in `@vtt/pdf-book`) replaces `PdfDocument { url }` with `BookSource { assetId }`. Mirror system on the client looks up the asset's URL (`/plugin-data/<worldId>/assets/<assetId>`) when rendering. Cache-bust via the asset's sha256 (immutable post-upload, so the URL is permanently stable; no `?v=` needed).
- `SetPdfDocument` command becomes `SetBookSource { bookId, assetId }`. Validator checks the asset exists, has `application/pdf` mime, and the caller has read visibility on it.
- The generic `POST /api/plugin-data/...` route stays for non-asset plugin data (per-plugin JSON, ad-hoc files), but PDFs go through `/api/worlds/:id/assets/upload`.
- pdf-book's prefix-validation security check goes away — replaced by the asset visibility resolver, which is stricter and uniform.

Migration is a single PR; nothing in production to preserve.

## Data layout

```
data/
  plugin-data/<worldId>/
    assets/<assetId>                              # raw bytes (existing, unchanged)
    @vtt/rules-corpus/<assetId>/
      manifest.json     # { status, title, pageCount, sourceSha, tags[], chunkerVersion,
                        #   indexedAt, pageMap: Record<pdfPage, printedPage> }
      chunks.jsonl      # one chunk per heading-bounded section (with both page numbers) — canonical
      pages/<pdfPage>.txt     # per-page raw text, keyed by PDF page index
      images/p<pdfPage>-<n>.png
  mvtt.db                                       # FTS5 search index lives here, not in the corpus dir
  rules-corpus-registry.json                      # dev-only alias map (optional, gitignored)
```

Why content-addressed by `assetId` (which is sha256-derived) and not by `corpusId`: dedup across re-uploads inside a world is automatic. Re-upload of the same PDF is a no-op at the asset layer; re-issue of `IndexRules` against the existing assetId is a no-op at the corpus layer (manifest already says `status: "ready"`).

Why per-world and not global: it preserves the existing per-world isolation guarantee. `WorldsService.hardDelete` already wipes `data/plugin-data/<worldId>/` recursively; nothing new to teach it. Cross-world dedup of identical SRDs is deferred to phase 2 — the cost is one duplicated extraction per world, which is bounded and acceptable.

The search index is the one piece that does *not* live in the per-world dir: it lives in `mvtt.db` as an FTS5 virtual table (`rules_chunks_fts`) tagged by `worldId` + `corpusId` + `chunkId`. `chunks.jsonl` remains the canonical source of truth — the FTS5 table is rebuildable from it at any time. `WorldsService.hardDelete` gains one extra SQL step (`DELETE FROM rules_chunks_fts WHERE worldId = ?`) alongside the existing recursive `rm`.

The whole `data/` tree is gitignored; no extraction artifacts ever enter the repo. The `rules-corpus-registry.json` (dev convenience) lives outside per-world dirs and is also gitignored. `mvtt.db` is also gitignored (already true today).

## The `@vtt/rules-corpus` plugin

```
packages/rules-corpus/src/
  shared/
    traits.ts        # RulesLibrary (sentinel), RulesCorpus, RulesCorpusStatus
    events.ts        # RulesIndexingStarted, RulesIndexingCompleted, RulesIndexingFailed,
                     # RulesCorpusRemoved, RulesQueryResult
    commands.ts      # IndexRules, RemoveRulesCorpus, QueryRules
  server/
    systems.ts       # spawn corpus entity on Started; update status traits; cleanup on Removed
    extract-runner.ts# spawns child process to run tools/rules-extract; on success, INSERTs chunks
                     # into rules_chunks_fts; emits RulesIndexingCompleted
    query.ts         # SELECT … FROM rules_chunks_fts MATCH ? for QueryRules; emits RulesQueryResult
    schema.ts        # FTS5 virtual-table definition; idempotent CREATE
    index.ts
  client/
    RulesLibraryView.tsx  # GM-only library: list of indexed corpora, status badges, reindex/remove
    RulesQueryPanel.tsx   # search box → dispatches QueryRules → renders results with page deep-links
  manifest.ts
```

### Traits

| Trait | Shape | Owner |
|---|---|---|
| `RulesLibrary` | `{}` (sentinel marker) | per-world, one entity, GM-write/world-read |
| `RulesCorpus` | `{ assetId, status: "pending" \| "indexing" \| "ready" \| "failed", error?: string, tags: string[], indexedAt?: number, pageCount?: number, title?: string }` | one per indexed asset, child of the library sentinel |

The sentinel pattern follows the same shape as other plugins' singletons (initiative tracker, dice tray). The library entity itself has no data; it exists so its child set is the corpus list.

### Commands

| Command | Validates | Apply emits |
|---|---|---|
| `IndexRules { assetId, tags?: string[] }` | caller is GM; asset exists; mime is `application/pdf`; corpus for this asset doesn't already exist | `RulesIndexingStarted { corpusId, assetId, tags }` (corpusId = `world.allocateId()`) |
| `RemoveRulesCorpus { corpusId }` | caller is GM; corpus exists | `RulesCorpusRemoved { corpusId, assetId }` |
| `QueryRules { corpusId, query, k? }` | caller has read visibility on the corpus; corpus is `ready` | `RulesQueryResult { corpusId, results, queryEcho }` (sender-targeted, not broadcast) |

`QueryRules` follows the request/response-via-event pattern used elsewhere — server reads the on-disk index, emits a sender-only event with the top-k chunks. The handler doesn't write any traits.

### Systems

- **CorpusMirror** (universal): `RulesIndexingStarted` → `world.spawnAt(corpusId, [RulesCorpus({ status: "pending", ... }), Permissions(...)])`. `RulesIndexingCompleted` / `RulesIndexingFailed` → updates the trait. `RulesCorpusRemoved` → despawns.
- **ExtractRunner** (server-only): subscribes to `RulesIndexingStarted`. Spawns a child process: `node tools/rules-extract/dist/cli.js --asset-path <…> --out-dir <…> --tags <…>`. On clean exit, streams `chunks.jsonl` into `rules_chunks_fts` (one transaction, `worldId` + `corpusId` + `chunkId` + page numbers + `headingPath` + `text`), then emits `RulesIndexingCompleted { corpusId, manifest }`. On non-zero exit, emits `RulesIndexingFailed { corpusId, error }`. Status transitions via the universal mirror.
- **CorpusCleanup** (server-only): subscribes to `RulesCorpusRemoved`. `DELETE FROM rules_chunks_fts WHERE corpusId = ?` followed by `rm -rf data/plugin-data/<worldId>/@vtt/rules-corpus/<assetId>/`. Does not touch the underlying asset (the user may keep the PDF for reading even after un-indexing it).

Following the rules in `CLAUDE.md`: no system dispatches commands; all writes happen by emitting events; ids come from `world.allocateId()` in `apply`; the mirror calls `world.spawnAt`.

## The extraction pipeline (`tools/rules-extract`)

A standalone CLI, not part of the substrate. Argv-driven, no IPC with the parent server beyond exit code and stdout JSON. This decouples the chunker's lifecycle from the substrate's, lets the chunker evolve at its own pace, and means a wedged extraction can be killed without taking down the world.

### Pipeline

```
PDF  ──unpdf.extractText─────►  per-page text + per-item font/transform info
                              │
                              ├──►  pdfimages -all -p ────►  images/p<pdfPage>-<n>.png
                              │
                              ▼
                         heading-aware chunker
                              │
                              ▼
        chunks.jsonl  +  pages/<pdfPage>.txt  +  manifest.json
                              │
                              ▼
              (server) INSERT rows into rules_chunks_fts (in mvtt.db)
```

### Tooling

| Stage | Tool | Notes |
|---|---|---|
| Text extraction | [`unpdf`](https://github.com/unjs/unpdf) | Thin wrapper over `pdfjs-dist`. Same engine the runtime viewer uses; if a glyph extracts wrong, it'll render wrong too — they fail consistently. |
| Image extraction | `pdfimages -all -p` (poppler-utils) | One subprocess; emits page-numbered images. Document the system dep in README. |
| Chunking | hand-written, ~few hundred lines | Walks text items, treats font-size jumps as section boundaries, carries a `headingPath` array on every chunk, anchors to both `pdfPage` and `printedPage`. This is the part that determines lookup quality and is worth owning. |
| Search index | **SQLite FTS5** (already in `mvtt.db` for the notes plugin) | `rules_chunks_fts` virtual table, `bm25()` ranking, `snippet()`/`highlight()` for the runtime UI, optional `trigram` tokenizer for substring matches. No new dependency. Server inserts after extraction; the CLI itself never touches the db. Embeddings phase 2 lands as a `rules_chunks_vec` virtual table via `sqlite-vec` in the same db, joined on `chunkId`. |
| OCR (deferred) | tesseract | Only if a scanned PDF appears. Not in v1. |

### Chunker rules

- Each chunk is bounded by heading transitions detected via font-size deltas and (when present) the PDF's bookmarks/outline.
- A chunk carries: `id`, `pdfPage` (first PDF-page index of the chunk), `pdfPageRange: [first, last]` when it spans page breaks, `printedPage: string | number | null` (resolved via outline → header/footer scan → manifest override, in that order), `printedPageRange: [first, last] | null` correspondingly, `headingPath: string[]`, `text` (cleaned, dehyphenated, paragraph-collapsed), `imageRefs: string[]` (relative paths to images on the same pages), `tokens: number`.
- Hard cap on chunk size (~2000 tokens) to keep BM25 ranking honest; chunks larger than the cap are split on paragraph boundaries with a synthetic `headingPath` suffix `[...parent, "(cont.)"]`.
- The chunker emits a `pageMap` (`Record<pdfPage, printedPage>`) into the manifest so the runtime and the skill can resolve the printed number for any page without re-scanning text. Pages with no confident printed number are simply absent from the map.
- A `chunkerVersion` field in `manifest.json` lets us invalidate corpora when we change chunking *or* page-detection; the ExtractRunner can decide to re-run if the version drifts.

### CLI shape

```
pnpm rules-extract \
  --asset-path  data/plugin-data/<worldId>/assets/<assetId> \
  --out-dir     data/plugin-data/<worldId>/@vtt/rules-corpus/<assetId> \
  --tags        torchbearer,tb \
  --title       "Torchbearer 2nd Edition" \
  --page-map    optional/path/to/page-map.json   # { "1": "i", "7": 1, "152": "A-1", ... }
```

Emits a single JSON object on stdout on success (the manifest), or a non-zero exit + JSON error on failure.

### System dependencies

- `pdfimages` (poppler-utils) — `apt install poppler-utils` / `brew install poppler` / `pacman -S poppler`. The server checks for it on boot when `@vtt/rules-corpus` is in the active plugin set; missing → log a warning, mark every `IndexRules` as failed with a clear "install poppler-utils" error.

## The `rules-lookup` skill (dev-time)

```
.claude/skills/rules-lookup/
  SKILL.md
  query.ts          # lightweight CLI: opens mvtt.db read-only, runs FTS5 MATCH, prints chunks
```

The skill opens the local `mvtt.db` read-only (SQLite WAL mode handles concurrent readers fine; the running dev server holds writes). Corpus discovery is one query: `SELECT corpusId, title, tags FROM rules_corpora`. The skill maps `tags[]` and `title` to user-facing aliases. Invocation:

```
rules-lookup --system torchbearer "edge advantage on attacks"
rules-lookup --asset <assetId> "..."
rules-lookup --list                    # print all locally-discovered corpora
```

Output is a small JSON-or-pretty-printed list of `{ headingPath, pdfPage, pdfPageRange, printedPage, printedPageRange, text, imageRefs }` for the top-k chunks. Pretty-printed mode renders a one-line citation header per result (`Combat → Flanking — printed p.142 (PDF p.148)`) before the body. The AI author reads it and writes mechanics with explicit *printed-page* references in code comments at hot spots only (per CLAUDE.md: comments only when the *why* is non-obvious — a citation is exactly that).

The skill never re-extracts. If a corpus's status is `pending` or `indexing`, the skill says so and exits — telling the AI "wait" rather than returning empty results.

There is **no** server-side query path for the AI author. The skill is local-only. In production, players use the runtime `QueryRules` command via the `RulesQueryPanel` view; the skill is irrelevant to them. In development, the developer's local `pnpm dev` server populates the same data dir the skill reads from. One pipeline, two consumers, no special dev mode.

## Considered alternatives

| Option | Shape | Rejected because |
|---|---|---|
| **Auto-index every uploaded PDF** | `@vtt/rules-corpus` subscribes to `AssetRegistered` and indexes any `application/pdf`. | Most PDFs aren't rulebooks. Indexing is minutes-long and produces tens of MB of artifacts; running it on every handout, scenario, and player backstory is wrong. Explicit `IndexRules` keeps the cost tied to intent. |
| **Skip the pdf-book migration; rules-corpus reads from pdf-book's URLs** | Leave pdf-book's storage alone; rules-corpus extracts from `data/plugin-data/<worldId>/@vtt/pdf-book/books/<bookId>/<filename>.pdf`. | Two storage paths is the bug; rules-corpus would entrench it by depending on both. The migration is a single PR pre-launch. Do it. |
| **Cross-world content-addressed corpus dir** | `data/corpus/<sha256>/` outside per-world tree, with per-world manifests pointing in. | Saves disk on duplicate SRDs across worlds. Costs: world hard-delete needs reference counting; per-world visibility on derived chunks gets ambiguous; orphan cleanup needs a sweeper. Not worth it for v1; per-world duplication is bounded. Re-evaluate at phase 2. |
| **MiniSearch instead of FTS5** | Pure-JS BM25 index, JSON-serialised inside the corpus dir. | Would be a new dep that does what `mvtt.db` already does (the notes plugin uses FTS5 today). FTS5 gives us `bm25()` ranking, `snippet()`/`highlight()` for the runtime UI, multiple tokenizers, and `sqlite-vec` for phase-2 embeddings on the same db. The one MiniSearch advantage — index lives in the per-world dir so hard-delete is just `rm -rf` — costs us a single `DELETE FROM rules_chunks_fts WHERE worldId=?` to recover. Worth it. |
| **Embeddings + vector DB instead of FTS5** | Sentence-transformers or Anthropic embeddings; sqlite-vec or chroma for retrieval. | Strictly more recall on synonym-heavy queries, but adds a model dep and embedding compute — all to bump recall past where BM25 over heading-aware chunks already gets us. Phase 2 path is clean: add a `rules_chunks_vec` virtual table via `sqlite-vec` in the same db, joined on `chunkId`. Same chunks, two indexes, merged at query time. |
| **LLM-pre-parsed structured rule modules** | One-time AI pass converts PDF into typed TS modules (`rules.combat.flanking = {...}`); AI author imports them. | Maximum legibility but premature schema; expensive and lossy extraction; painful to update on errata; the structuring step is itself an open-ended AI problem. The AI author can build typed rule structures *as part of writing the game system*, citing the corpus — that gives us the same destination through a more honest path. |
| **MCP server instead of a skill** | Expose `rules_lookup` as an MCP tool. | An MCP server is appropriate when the tool needs to talk to *something* (a service, a network resource). This tool only reads local files; a skill (file-read + small CLI) is simpler and has fewer moving parts. Reconsider if/when the corpus moves off-machine. |

## Phase 2 / open questions

- **Cross-world dedup.** Move the corpus dir out of per-world storage into `data/corpus/<sha256>/`, add reference counting, teach `WorldsService.hardDelete` to skip shared corpora.
- **Embeddings via `sqlite-vec`.** Add a `rules_chunks_vec` virtual table to `mvtt.db` populated by a second extraction stage; query path runs FTS5 + vec searches in parallel and merges (reciprocal-rank fusion or weighted score). `chunks.jsonl` stays the canonical source so old corpora upgrade cleanly by re-inserting from disk.
- **Outline-based chunking improvements.** Many TTRPG PDFs ship with a usable bookmark tree; the chunker should prefer outline boundaries over font-size heuristics when present.
- **Page renders.** `pdftoppm` to produce per-page PNGs at a reasonable DPI, served to the runtime as preview thumbnails alongside the chunk results. Useful for the `RulesQueryPanel` UI.
- **Errata / multi-version rulebooks.** Same game system, two PDFs (core + errata). Probably solved by allowing multiple `RulesCorpus` entities under one library, each tagged, and letting `QueryRules` span all of them. Defer until we hit it.
- **Printed-page detection failure modes.** Track per-page detection confidence; surface uncertain mappings in `RulesLibraryView` so the GM can correct them via an in-UI editor that writes back to `pageMap` in the manifest. Until then, low-confidence mappings stay `null` and citations parenthesize only the PDF page.
- **Cite-as-you-code lint.** A linter that flags game-system mechanics code without a nearby corpus citation. Probably premature; revisit once we have one full game system implemented and can see whether citation drift becomes a real problem.
