# Notes

**Status:** proposed. Lands as two plugins: `@vtt/notes` (the notes UX, the wiki-link grammar, the link-kind registry) and `@vtt/assets` (entities + storage + visibility for any byte blob a plugin wants to embed). Notes depends on assets. **No substrate additions** — built from existing primitives (entities, traits, events, commands, slots, presence channel, plugin-data uploads).

## The problem

A VTT without notes makes the GM run their game out of a Google Doc in a second window. That's the failure mode every VTT eventually addresses, and most do it badly: floating "journal" windows, opaque WYSIWYG editors that can't round-trip, link rot on rename, no co-authoring story, image attachments stuck in someone's screenshot folder.

We want one notes system that:

- Is markdown all the way down — the canonical representation is plain text, not a WYSIWYG tree.
- Edits like Obsidian's _Live Preview_: each line shows raw markdown when the cursor is in it and renders in place when you leave.
- Lets you link to anything in the world — notes, characters, scenes, assets — with a uniform syntax that survives renames and refactoring.
- Is extensible by other plugins without the notes plugin having to know about them. The character plugin teaches notes how to link to characters.
- Has first-class support for inline images via paste / drop / upload.
- Has explicit, per-note and per-page permissions that compose with the rest of the world's visibility model.
- Supports concurrent users without CRDTs, by using the substrate's existing CAS pattern.

This document is the design; `design/scaffold-mapping.md` will get a row when the plugins land.

## Plugin layout

```
packages/notes/src/
  shared/    Note + NotePage traits, commands, events, the wiki-link
             grammar, the link-kind registry contract
  server/    parser passes (headings + outgoing links), backlink
             materialisation, FTS5 maintenance, server-side validators,
             page-lock enforcement
  client/    Solid views (NotesPage, NotePicker, NoteEditor),
             CodeMirror live-preview decoration, [[ autocomplete,
             link chip + peek renderer
  manifest.ts

packages/assets/src/
  shared/    Asset trait, RegisterAsset/DeleteAsset/SetAssetVisibility
             commands, asset link kind
  server/    upload route, fetch route with EntityVisibility check,
             sha256 dedup, spawn/despawn systems
  client/    upload helpers, paste/drop adapter, asset preview, eventually
             the asset library view
  manifest.ts
```

`@vtt/notes` declares `dependsOn: ["@vtt/substrate", "@vtt/permissions", "@vtt/assets"]`. `@vtt/assets` declares `dependsOn: ["@vtt/substrate", "@vtt/permissions"]`.

Both ride along with the universal infrastructure tier (always loaded into every world's Registry), the same way `@vtt/identity` and `@vtt/permissions` do. Notes is genre-neutral.

## The wiki-link kind registry

This is the load-bearing piece. The notes plugin owns the grammar; **every plugin that wants to be linkable contributes a _kind_** that owns the resolution, rendering, and activation semantics for its own references.

### Grammar

One uniform syntax, parsed identically everywhere a markdown text input is rendered:

```
[[ kind:body#anchor | alias ]]      reference (rendered as an inline chip)
![[ kind:body#anchor | alias ]]     embed (rendered as the kind's embed widget)
```

- `kind:` is the kind name (e.g. `note`, `character`, `scene`, `asset`). Omitted = default kind, which is `note`.
- `body` is opaque to the grammar; each kind parses it.
- `#anchor` is opaque to the grammar; each kind decides what an anchor means (heading id for notes, sheet section for characters, token id for scenes).
- `|alias` is optional display override. Without it, the chip uses the kind's reactive `display(ref)` so renames propagate automatically.

A sigil shortcut MAY be registered alongside a kind for ergonomic typing (`@` for character means `[[@Krell]]` parses as `[[character:Krell]]`). Sigils are sugar; the canonical normalised form always uses `kind:body`.

### Storage normalisation

The user types `[[Goblin Cave]]`. On `SetPageBody` the parser resolves `Goblin Cave` against the default kind's `autocomplete` results plus the on-screen cursor context, picks the unambiguous match, and rewrites the token to its normalised form `[[note:noteId|Goblin Cave]]` — a stable id with the _current_ display name as the alias.

If the user types `[[Goblin Cave|the cave]]` the alias is preserved verbatim. If they type just `[[Goblin Cave]]`, the alias slot is treated as derived from the target's title and re-rendered from the live trait at view time. This is the rename-resilience contract: a renamed target is reflected everywhere the alias was implicit, and untouched everywhere the alias was explicit.

### `defineLinkKind`

Lives in `@vtt/notes` and is exported for any plugin to call from its manifest:

```ts
defineLinkKind({
  name: "character",
  sigil: "@",                                     // optional
  parse:        (body, anchor, world)        => Ref | Invalid,
  display:      (ref, world)                 => string,         // reactive
  target:       (ref, world)                 => EntityRef | null,
  activate:     (ref, ctx)                   => LinkActivation, // click semantics
  embed:        (ref)                        => JSX.Element,    // for ![[…]]
  autocomplete: (query, world)               => Suggestion[],
  indexEvents:  EventName[],                                    // for the LinkTargets index
})
```

`LinkActivation` is a tagged union the notes plugin renderer interprets:

```ts
type LinkActivation =
  | { type: "peek"; render: () => JSX.Element }
  | { type: "navigate"; pageKind: string; entityId: EntityId }
  | { type: "command"; command: CommandName; payload: unknown }
  | { type: "custom"; run: (ctx: ActivationCtx) => void };
```

A character plugin might register `peek` as the default action and `navigate` as the cmd-click alternate (open the full sheet in a workbench tab). A scene plugin might register `navigate` only — clicking switches the active scene tab. Each plugin owns the click semantics; notes never branches on kind.

### What notes doesn't do

The notes plugin doesn't import characters, scenes, or assets. It has no knowledge of which kinds exist. Its renderer:

1. Parses tokens with the grammar.
2. Looks up `kind` in the link-kind registry.
3. Calls `display(ref)` to render the chip text or `embed(ref)` for image-style embeds.
4. On click, calls `activate(ref)` and dispatches the result.

A new linkable plugin lands by calling `defineLinkKind` and showing up in autocomplete; nothing in notes changes.

### Default kind

`note` is the default kind. `[[Goblin Cave]]` with no prefix means `[[note:…]]`. This is the only privilege notes' own kind has — it's the prefixless fallback. All other kinds require the `kind:` prefix or a registered sigil.

### Broken refs

A kind whose plugin isn't loaded, or whose target was deleted, renders the chip in a "redacted" or "deleted" state with the original alias preserved. The token text in storage is untouched; re-loading the plugin or restoring the target rehydrates the chip. Same posture for visibility-denied refs (see Permissions below).

## ECS model

### Entities

A **Note** is an entity. A **NotePage** is an entity. Pages are not array elements on the note — each page needs its own id (link target, independent visibility, independent CAS) so it must be its own entity.

### Traits

```ts
Note          { title: string; createdAt: number }
NoteOrdering  { ordinal: number }                    // for sidebar list order

BelongsToNote { noteId: EntityId }
Page          { title: string; body: string; bodyRev: number }
PageOrdering  { ordinal: number }                    // order within a note
Headings      { items: { id: string; text: string; level: 1 | 2 | 3 | 4 | 5 | 6 }[] }
PageDraft     { body: string }                       // transient — in-flight edits
PageHistory   { entries: { rev: number; savedAt: number; savedBy: UserId }[] } // capped at 20
EditorLock    { userId: UserId; clientId: ConnectionId; since: number; expires: number }
```

`PageDraft` and `EditorLock` are both _trait-level transient_ — they reconstitute on next session, never persist. `PageHistory` is durable.

Plus the existing permission traits, attached as needed:

```ts
OwnedBy           on every Note (creator)
EntityVisibility  on every Note (default: everyone), optionally on NotePage
```

A `NotePage` without `EntityVisibility` inherits the parent note's. A `NotePage` _with_ one is intersected with the parent (see Permissions).

`Headings` is derived state — maintained by a server-side parse system, never written to directly. Heading ids are content-hashed (`hd:` + first 6 chars of sha1 over normalised heading text + occurrence index) so they're stable across rephrases.

### Commands

```
CreateNote          { title }
RenameNote          { noteId, title }
DeleteNote          { noteId }
SetNoteVisibility   { noteId, visibility }
ReorderNotes        { noteIds }                                    // optional v1.1

AddPage             { noteId, title, afterPageId? }
RenamePage          { pageId, title }
RemovePage          { pageId }
ReorderPages        { noteId, pageIds }
SetPageVisibility   { pageId, visibility | "inherit" }

BeginEdit           { pageId, causalState: { hasNoLiveLock: bool } }   // lock acquire
ExtendEditLock      { pageId }                                          // 10s heartbeat
EndEdit             { pageId }                                          // lock release
SetDraftBody        { pageId, body }                                    // transient draft
SetPageBody         { pageId, body, causalState: { lastSeenRev } }      // durable, CAS
```

`SetDraftBody` and `SetPageBody` are the hot path during an edit session — drafts every ~1s (transient), durable saves every ~5min and on `EndEdit`. Everything else is rare admin.

### Events

Each command emits its corresponding `*Created` / `*Renamed` / `*Deleted` / `*Reordered` / `*VisibilityChanged` / `*BodySet` event. Plus two derived events emitted by the parse system:

```
LinkAdded    { sourcePageId, ref }
LinkRemoved  { sourcePageId, ref }
```

These are `transient: false, broadcast: true` — durable so backlinks survive cold-boot replay, and broadcast so clients can maintain their inverted indexes incrementally.

### Systems

| System                              | Trigger                                                 | Work                                                                                   |
| ----------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `NoteSpawnSystem`                   | `NoteCreated`                                           | `world.spawnAt(noteId, [Note, NoteOrdering, OwnedBy, EntityVisibility])`               |
| `NoteRenameSystem`                  | `NoteRenamed`                                           | `world.set(noteId, Note, { ...prev, title })`                                          |
| `NoteDeleteSystem`                  | `NoteDeleted`                                           | despawn note entity; emit `RemovePage` for each child page                             |
| `PageSpawnSystem`                   | `PageAdded`                                             | `spawnAt(pageId, [BelongsToNote, Page, PageOrdering])`                                 |
| `PageBodyParseSystem`               | `PageBodySet`                                           | parse mdast → derive `Headings` and emit `LinkAdded`/`LinkRemoved` deltas vs. previous |
| `PageDraftMirrorSystem`             | `PageBodyDraft`                                         | write transient `PageDraft.body`; cleared on `EditEnded`                               |
| `PageHistoryAppendSystem`           | `PageBodySet`                                           | append `{ rev, savedAt, savedBy }` to `PageHistory.entries`; trim to last 20           |
| `LockReleaseSystem` _(server-only)_ | `ConnectionClosed`                                      | dispatch `EndEdit` for any locks held by the closed `clientId`                         |
| `PageMirrorSystem`                  | `PageBodySet`, `PageRenamed`, …                         | mirror trait writes                                                                    |
| `FtsIndexSystem` _(server-only)_    | `PageBodySet`, `PageRenamed`, `NoteRenamed`, `*Deleted` | maintain SQLite FTS5 virtual table                                                     |
| `LinkTargetsIndexSystem` _(server)_ | every kind's `indexEvents`                              | maintain the denormalised `LinkTargets` snapshot pushed to clients                     |

Sentinel-entity coordination isn't needed for v1; nothing waits on anything else. Page deletion cascades cleanly via emitted events — `NoteDeleted` causes the system to _emit_ `PageDeleted` events; it never deletes from inside another delete.

## Editor

CodeMirror 6. Not ProseMirror.

ProseMirror's mental model is a structured tree serialised to markdown on save. That model fights "the line under the cursor is raw markdown." CM6 treats the document _as_ markdown and uses `Decoration.replace` to swap rendered widgets in for any range that doesn't currently contain the cursor. This is exactly the Obsidian Live Preview shape.

### Stack

| Concern                                  | Library                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| Editor core                              | `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`          |
| Markdown highlighting + syntax tree      | `@codemirror/lang-markdown`, `@lezer/markdown`                           |
| Live-preview decoration                  | custom `ViewPlugin` (~150 lines)                                         |
| Wiki-link Lezer extension                | custom (~50 lines), shared grammar with the server-side remark plugin    |
| Canonical parse for index work           | `unified` + `remark-parse` + `remark-gfm` + custom wiki-link extension   |
| mdast → Solid render (peek, chip, embed) | ~80 lines, no library                                                    |
| Future co-edit cursors                   | `y-codemirror.next` paths exist if we ever need them; **not used in v1** |

The Lezer grammar (editor-side, incremental) and the remark grammar (server-side, canonical) MUST agree on the wiki-link syntax. The grammar is small (~5 productions); shipping it twice with a shared fixture suite is cheaper than abstracting it once.

### Live-preview decoration

```
state                         decoration
─────────                     ──────────
**bold text**                 *bold text*  ← cursor here, raw shown
^cursor

**bold text**                 [bold text in <strong> widget]
                              ^cursor elsewhere
```

The decoration runs on every `EditorState` update. For each node in the syntax tree:

1. If the cursor (or any selection range) overlaps the node's range, leave it as raw text.
2. Else, replace the range with a widget rendered from that node:
   - `Heading` → styled `<h1..h6>` widget
   - `Strong` / `Emphasis` / `InlineCode` → inline styled widgets
   - `Image` (`![[asset:…]]`) → `<img>` widget
   - `WikiLink` (`[[…]]`) → link chip widget bound to the kind's `display()`
   - `Blockquote` / `List` / `Code` block → block-level rendered widgets

Block-level widgets (images, fenced code) leave the original line as a single zero-width target so the cursor can re-enter them with the arrow keys.

### Paste handler

A separate `EditorView.domEventHandlers({ paste, drop })` plugin:

```
on paste/drop:
  if clipboard contains files of type image/*:
    preventDefault
    for each file:
      preprocess in browser  (resize → 3000x3000 max, recompress to webp 0.85,
                              strip exif, reject if final > 5MB)
      POST /api/worlds/<id>/assets/upload
      receive { assetId }
      insert "![[asset:<assetId>]]" at cursor
```

No library; native APIs end-to-end.

### Autocomplete

A CodeMirror autocomplete extension wired to a `[[` trigger:

1. On `[[` typed, open the popover.
2. Query the client-side `LinkTargets` snapshot (see Search) by current substring.
3. Show grouped results — Notes, Characters, Scenes, Assets, etc. — each kind's results coming from its `autocomplete()` over the snapshot.
4. Selection inserts the normalised token (`[[character:abc123|Krell]]`); typing `]]` accepts the top match by default.
5. A `+ "create new note: foo…"` entry at the bottom dispatches `CreateNote` and inserts the resulting normalised link.

## Permissions

Notes inherit the world's existing visibility model. `@vtt/permissions` already ships `OwnedBy`, `EntityVisibility`, and the builders `everyone() / gmOnly() / actors([...]) / ofRole(...)`. Notes is one more consumer.

### The four user-facing levels

| Picker label     | Builder                          |
| ---------------- | -------------------------------- |
| GM only          | `gmOnly()`                       |
| All players      | `everyone()`                     |
| Specific players | `actors([userId, …])`            |
| Owner only       | `actors([ownerId])` (degenerate) |

The substrate already enforces "GM sees everything" centrally, so all four resolve correctly without notes-side logic.

### Note vs page

Both `Note` and `NotePage` carry `EntityVisibility`. The notes plugin registers an `entityVisibility` resolver for `NotePage` that **intersects** the page's own rule with the parent note's:

```
visibility(page, recipient)
  = visibility(parentNote, recipient)
  ∩ ownVisibility(page, recipient)
```

A page can never be wider than its note. The picker disables broader options on the page and explains why. A page with no `EntityVisibility` trait fully inherits — that's the default and most common case.

### Edit vs read

Read is `EntityVisibility`. Edit is `OwnedBy` + `requireOwnerOrGm` in the command validators. The two axes are independent:

| Pattern                       | Read                          | Edit                        |
| ----------------------------- | ----------------------------- | --------------------------- |
| GM lore                       | gmOnly                        | GM only (owner)             |
| Published handout             | everyone                      | GM only (owner)             |
| GM-curated, shared with Alice | actors([Alice])               | GM only (owner)             |
| Alice's journal               | everyone (or actors([Alice])) | Alice (owner) + GM god-mode |

Player-authored notes are GM-readable by default. No "private from GM" preset in v1. Add later if asked.

### Knock-ons

- **Links:** a link to a target the recipient can't see renders as a redacted chip — `display(ref)` returns null and the renderer falls back. Storage is untouched; if visibility changes later, the chip rehydrates.
- **Autocomplete:** each kind's `autocomplete()` runs over a snapshot already filtered per recipient by the substrate. No leaking of unseen titles.
- **Search:** post-FTS visibility filter on the server. Same posture as autocomplete.
- **Backlinks:** computed client-side from visible notes only. Naturally filtered (see Search). Sidesteps the field-level visibility gap entirely.
- **Asset URLs:** the asset fetch route runs the standard `EntityVisibility` resolver — see `@vtt/assets` below.

## Collab editing

Server-authoritative, no CRDTs (per `basics.md` non-goals). Notes uses an **explicit edit mode** gated by a real lock trait, plus auto-save while editing so readers see live incremental updates.

### Read mode is the default

A note opens in **read mode**: rendered preview, no editor. Click **Edit** to enter edit mode; click **Done** to leave. Same shape as every wiki / Confluence editor — explicit, no accidental edits, no cursor-focus juggling. The live-preview decoration described in the Editor section only runs in edit mode; read mode is a static markdown render, lighter and faster.

### Lock trait + commands

```ts
EditorLock {
  userId:   UserId
  clientId: ConnectionId
  since:    number       // epoch ms
  expires:  number       // epoch ms; lock is dead past this
}
```

Optional trait on a `NotePage`. Three commands:

- `BeginEdit { pageId, causalState: { hasNoLiveLock: bool } }` — validate: requester can edit (owner or GM) AND no live `EditorLock` exists OR the live lock is already held by this same `userId+clientId`. Apply emits `EditBegun`; spawn-mirror system writes `EditorLock`.
- `ExtendEditLock { pageId }` — heartbeat. Validate: requester holds the lock. Apply emits `EditLockExtended`; system bumps `expires`.
- `EndEdit { pageId }` — validate: requester holds the lock. Apply emits `EditEnded`; mirror system clears the trait.

The `hasNoLiveLock` CAS flag covers two-clients-acquire-at-once: the second writer fails validation because the first already wrote the trait.

### Heartbeat + auto-release

The editing client sends `ExtendEditLock` every 10 seconds; the validator bumps `expires` by 30 seconds. If the client disconnects, no further extensions arrive — once `expires` passes, the next `BeginEdit` succeeds.

The substrate also emits `ConnectionClosed` whenever a connection drops. A server-side `LockReleaseSystem` reacts to it and dispatches `EndEdit` for any locks held by that `clientId`, so closed-tab releases happen in seconds rather than waiting on the 30s heartbeat expiry.

### Auto-save while editing — two-tier

`PageBodySet` carries the full body. Logging one per keystroke would make the event log explode for any seriously-edited note. The flow is two-tier:

| Tier       | Cadence                                                                            | Command                      | Event                      | Logged?                                 |
| ---------- | ---------------------------------------------------------------------------------- | ---------------------------- | -------------------------- | --------------------------------------- |
| Draft      | every ~1s while typing                                                             | `SetDraftBody`               | `PageBodyDraft`            | no — `transient: true, broadcast: true` |
| Checkpoint | every ~30s while editing, **only if the body changed since the last durable save** | `SetPageBody`                | `PageBodySet`              | yes — durable                           |
| Final      | on `EndEdit` (skipped if no changes since last checkpoint)                         | `SetPageBody` then `EndEdit` | `PageBodySet`, `EditEnded` | yes — durable                           |

Drafts broadcast to all readers but never hit disk. The server-side mirror system writes a transient `PageDraft { body }` trait on the page; readers' rendered views blend `PageDraft` over `Page.body` when present, so they see the editing user's work sub-second.

Checkpoints are the safety belt: if Alice's tab dies, she loses at most ~30s of typing. The "only if changed" rule keeps a paused session from logging redundant events — staring at the editor without typing produces zero durable events. A typical 10-minute edit with active typing produces ~20 durable events; an hour-long edit ~120. Each event is one body, well within SQLite's comfortable range; substrate-level compaction (see Version history below) is the long-term answer when this becomes ops-relevant.

The lock guarantees only one writer at a time. CAS stays on `SetPageBody` as a belt for the disconnection race:

```
1. Alice editing; lock held by Alice/clientA
2. Network blip — clientA's heartbeat stops
3. ConnectionClosed → LockReleaseSystem releases the lock
4. Bob clicks Edit, acquires lock, types, auto-saves (bodyRev advances)
5. Alice's clientA reconnects with a queued SetPageBody at the old bodyRev
6. CAS rejects (bodyRev mismatch)
7. Alice's UI surfaces a non-blocking "couldn't save your edits" with the
   draft text copied to clipboard, and the rendered view re-syncs to
   authoritative state
```

No merge UI. The explicit lock makes conflicts rare enough that the recovery is "here's your text — paste it back the next time you take the lock."

### Other readers' UX

When the lock is held:

- **Edit** button is replaced by "**Alice is editing**" with avatar + name. Disabled.
- **Read view** continues to render and updates live as auto-saves commit.
- A subtle pulse on the avatar signals active typing (presence-channel "typing" ping, not the lock).

When the lock is held by yourself in another tab, the button reads "**Editing in another tab**" with a switch-focus affordance.

### Version history and log retention

Bodies are big; the substrate's event log is append-only. The two-tier auto-save above keeps drafts off disk entirely — only checkpoints and finals are logged — but a 30s cadence still produces tens to low hundreds of body-bearing events per long session, and pages accumulate them over time.

Notes ships a metadata-only history trait, capped:

```ts
PageHistory {
  entries: { rev: number; savedAt: number; savedBy: UserId }[]   // capped at 20
}
```

The `PageBodySet` mirror system appends and trims. The trait is small (a few hundred bytes regardless of edit volume); UI shows "last 20 edits" as a who-and-when timeline.

The actual _bodies_ for old revisions live in the event log, addressable by `(pageId, rev)`. As long as those events are still in the log, a future "Restore version" UI can fetch them. After enough sessions and a snapshot, older bodies become candidates for compaction — but that requires substrate-level support (an `event.compactable` flag plus post-snapshot pruning in the persistence layer). **Not in v1**; called out as a v2 trigger when log size becomes a real ops concern.

For v1: capped metadata trait + the inherent "only log when changed" guard is the retention story. SQLite handles thousands of body events per page comfortably (each 10–50 KB), so even heavy editing for months stays in the ops-fine range. When that ceases to be true, substrate-level compaction is the answer — and notes will likely be the plugin that triggers shipping it.

### What this is not

Two users typing into the same note at the same time is structurally impossible — the lock prevents it. v1 trades concurrent editing for simplicity; the auto-save + live read-mode update means co-authorship in practice is _turn-taking with no friction_, not a merge engine.

### v2 trigger

If groups want true simultaneous multi-author editing (multiple people typing in different paragraphs of the same page at once), upgrade to **block-level locks**: page becomes `Block[]`, each `{ id, kind, body, rev }`, the lock trait moves to the block. Storage migration is a one-time replay (each existing page becomes one block per top-level mdast node). No client API change beyond per-block dispatch.

## Search and autocomplete

Three surfaces with three different latency budgets.

### `[[` autocomplete (<50ms)

Client-side fzf over a denormalised `LinkTargets` snapshot. Each registered kind contributes `{ kind, ref, display, aliases }` rows. Maintained by `LinkTargetsIndexSystem` on the server, pushed to clients on connect, updated incrementally per kind's `indexEvents`. Visibility-filtered before send.

For 500 notes + 50 characters + 20 scenes the snapshot is well under 100KB; the index works as a single client-side artifact. Delta updates kick in if it grows; not needed in v1.

### Notes palette / search-as-you-type (<150ms)

SQLite FTS5 virtual table maintained server-side:

```
notes_fts(noteId, pageId, title, body, headings)
```

Notes plugin contributes an HTTP route `/api/worlds/:id/notes/search?q=…` (matching the existing `/api/worlds`, `/api/game-systems`, `/api/plugin-data` shape). Query runs FTS5 with BM25, post-filters results by `EntityVisibility`, returns the survivors with snippets.

The FTS table is maintained by `FtsIndexSystem` reacting to `PageBodySet` / `*Renamed` / `*Deleted`. Lives in the same `data/mvtt.db` as everything else.

### Backlinks (instant on open)

**Computed client-side, on demand.** A `useBacklinks(targetRef)` Solid memo:

1. `useQuery(NotePage)` — already filtered to the recipient's visible pages.
2. Parse each visible page body (memoised by content hash).
3. Build inverted index `targetRef → [{ pageId, anchor }, …]`.
4. Look up the requested target.

Each client only has the notes it can see, so the backlinks list is _naturally_ filtered per recipient — no field-level visibility primitive needed. Memoisation keeps re-parsing bounded; only the changed page re-parses on edit.

This is one of the rare cases where doing the obvious thing on the client is _more_ correct than doing it on the server.

## The `@vtt/assets` plugin

Promoted to its own bounded context because it solves the asset problem for the whole substrate, not just notes.

### Entity shape

```ts
Asset {
  mime:       string
  sizeBytes:  number
  sha256:     string
  filename?:  string
  width?:     number    // images only
  height?:    number    // images only
}
OwnedBy           // who uploaded
EntityVisibility  // default: everyone()
```

Bytes are immutable post-upload (anything that wants to modify becomes a new asset). Mutable state (visibility, ownership, filename) lives in the existing permission traits + an explicit `RenameAsset` command.

### Storage

World-scoped: `data/plugin-data/<worldId>/assets/<assetId>`. Plugin-agnostic. Hard-deleting a world wipes the directory along with everything else.

### Upload flow

```
client                                server
  │                                      │
  │  POST /api/worlds/:id/assets/upload  │
  │  (multipart with file)               │
  │ ───────────────────────────────────► │
  │                                      │ 1. authn world member
  │                                      │ 2. validate mime + size
  │                                      │ 3. compute sha256
  │                                      │ 4. dedup: if Asset(sha256)
  │                                      │    exists → return its id
  │                                      │ 5. write bytes to temp path
  │                                      │ 6. dispatch RegisterAsset
  │                                      │    server-side as user
  │                                      │ 7. apply allocates assetId,
  │                                      │    emits AssetRegistered
  │                                      │ 8. spawn-mirror system
  │                                      │ 9. atomic rename temp →
  │                                      │    assets/<assetId>
  │  { assetId }                         │
  │ ◄─────────────────────────────────── │
  │                                      │
  │  insert ![[asset:<assetId>]] at cursor
```

Two-phase satisfies the substrate's "ids allocated in `apply`" rule. Temp file is GCed if the dispatch fails for any reason (rare).

### Fetch flow with visibility

`/plugin-data/<worldId>/assets/<assetId>` is no longer a static-files-with-membership-gate. The handler:

1. Authn: world member.
2. Look up `Asset` entity by `assetId`.
3. Run the standard `EntityVisibility` resolver against the requester.
4. 403 on deny, serve bytes on allow.
5. `Cache-Control: public, max-age=31536000, immutable` — assetIds never collide.

### Asset link kind

Registered by `@vtt/assets`. Polymorphic by mime:

```ts
defineLinkKind({
  name: "asset",
  embed: (ref) => {
    const asset = useTrait(ref.entityId, Asset);
    const url   = `/plugin-data/${worldId}/assets/${ref.entityId}`;
    return Switch on asset()?.mime.split("/")[0]:
      "image" → <img src={url} alt={ref.alias ?? asset()?.filename} />
      "video" → <video src={url} controls />
      "audio" → <audio src={url} controls />
      // pdf etc. as plugins land
  },
  display:  (ref, world) => world.get(ref.entityId, Asset)?.filename ?? "asset",
  target:   (ref) => ({ entityId: ref.entityId }),
  activate: (ref) => ({ type: "peek", render: () => <AssetPreview ref={ref} /> }),
});
```

`![[asset:xyz]]` works the same in a note, a chat message, a character bio, a scene description. One renderer everywhere.

### Commands

```
RegisterAsset       { mime, sizeBytes, sha256, filename?, visibility }
DeleteAsset         { assetId }
RenameAsset         { assetId, filename }
SetAssetVisibility  { assetId, visibility }
```

`DeleteAsset` validate: owner or GM. On apply: emits `AssetDeleted`. Systems despawn the entity and remove the file from disk. Existing `![[asset:…]]` references in notes become deleted-asset chips; users can manually remove them.

### Default visibility + ergonomic guard

Default for new uploads is `everyone()`. When embedding into a page whose effective visibility is _narrower_ than the asset's, the editor shows an inline soft hint ("This image is visible to all players; this note is GM-only") with a one-click _match note visibility_ button. We never auto-tighten — the asset might be embedded in five other places.

### Future asset library

Falls out for free now that Asset is an entity:

- Grid view of all visible assets in the world.
- Search by filename, mime, embed-count.
- Bulk select → set visibility / delete.
- "Orphaned" filter (assets with zero `[[asset:…]]` references) reuses the client-side inverted index.
- Drag from library into any markdown editor.

Ships when someone needs it; no migration.

## UI

Option A — _the codex_ — matches the existing pattern for Characters and Scenes: opening the Notes tab without a selected note shows the picker / create flow, the same shape as opening Characters or Scenes empty.

### Picker (no note selected)

```
┌── Notes ──────────────────────────────────────────────────────────────┐
│                                                                       │
│   filter: ____________________                              + new     │
│   ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│   ▸  Goblin Cave              Locations          opened 2m            │
│   ▸  Mossfen Tree             Locations          backlinks 4          │
│   ▸  Krell                    NPCs                                    │
│   ▸  Old Mira                 NPCs                                    │
│   ▸  Session 13 Recap         Sessions                                │
│   …                                                                   │
└───────────────────────────────────────────────────────────────────────┘
```

Same affordances as the Characters and Scenes pickers: filter row, list, "+ new" button. Create flow is one-click → empty note with a default first page → straight into the editor. No modal.

### Note open — read mode (default)

```
┌── Notes ▸ Goblin Cave ──────────────────────────────────── [ Edit ] ──┐
│ ◧ ┌── pages ──────────┐ │  # The Goblin Cave                          │
│   │ ◉ Map             │ │                                             │
│   │ ○ Inhabitants     │ │  A damp warren cut into the cliffs north of │
│   │ ○ Tactics         │ │   Mossfen .                                 │
│   │ ─────────────────│ │                                             │
│   │ + add page        │ │  ┌────────────────────────────────┐         │
│   └───────────────────┘ │  │  ░▒▓ cave-map.png  ▓▒░         │         │
│                         │  └────────────────────────────────┘         │
│   visibility 🌐 all     │                                             │
│   owner: GM             │  ## Inhabitants                             │
│                         │  • Krell — chief, paranoid                  │
│                         │  • Two scouts, one trapper                  │
└───────────────────────────────────────────────────────────────────────┘
```

### Note open — edit mode

```
┌── Notes ▸ Goblin Cave ──────────────────────────────────── [ Done ] ──┐
│ ◧ ┌── pages ──────────┐ │  # The Goblin Cave                          │
│   │ ◉ Map             │ │                                             │
│   │ ○ Inhabitants     │ │  A damp warren cut into the cliffs north of │
│   │ ○ Tactics         │ │   [[Mossfen]] .              ← cursor: raw  │
│   │ ─────────────────│ │                                             │
│   │ + add page        │ │  ![[asset:cave-map]]                        │
│   └───────────────────┘ │                                             │
│                         │  ## Inhabitants                             │
│   visibility 🌐 all     │ > - **Krell** — chief, paranoid             │
│   owner: GM             │   • Krell — chief, paranoid                 │
│                         │   • Two scouts, one trapper                 │
│                         │                                             │
│                         │  ───────  auto-saved 1s ago  ────────────── │
└───────────────────────────────────────────────────────────────────────┘
```

### Note open — someone else is editing

```
┌── Notes ▸ Goblin Cave ──────────────  [ ● Alice is editing ]  ────────┐
│   …                     │  rendered view; updates live as Alice saves │
└───────────────────────────────────────────────────────────────────────┘
```

- Left rail: collapsible page list, drag-to-reorder via the existing dnd helper used by scene/characters.
- Right: rendered markdown in read mode; live-preview editor in edit mode.
- **Edit / Done** button toggles modes. While editing, auto-save commits ~every 1s and the heartbeat extends the lock every 10s.
- When another user holds the lock, the button is replaced by a name+avatar badge; the read view continues to update live.
- Note-level visibility / owner indicator at the bottom of the rail; click to edit (gated to owner / GM).
- Page-level visibility shown as a small lock icon next to each page name when narrowed below the note's; click to edit.
- "+ add page" appends and focuses the new page (auto-acquires the lock for the new page).

### Cross-plugin surfaces

Two slot/contract surfaces for any plugin that wants to consume the wiki-link UX:

- `<LinkChip ref={token} />` — renders any wiki-link token as a chip with the right kind's display + activate.
- `<LinkAutocomplete />` — a CodeMirror extension factory exported for embedding `[[` autocomplete in any markdown text input.

Chat, character-sheet bio fields, scene descriptions all consume these. They never import character / scene / asset internals — only the link-kind registry and these two contracts. Loose coupling, identical to existing slots.

## Anti-patterns to refuse

From the ECS skill, plus notes-specific:

- A new substrate primitive for any of this. We don't need one.
- A second markdown parser. Two parsers (Lezer for the editor, remark for canonical) is unavoidable; **three is wrong**.
- Client-allocated asset ids. The HTTP upload handler dispatches `RegisterAsset` and waits for the event before responding; ids come from the server, same as every other entity.
- `![[asset:…]]` rendering directly to a `<img>` from the markdown renderer without going through the asset link kind. The kind is the only path; that's how visibility, mime polymorphism, and broken-asset states stay consistent.
- A `Backlinks` trait stored authoritatively. It would force field-level visibility into the substrate prematurely. Compute on the client.
- Importing characters / scenes from the notes plugin. The link-kind registry is the only seam.
- Auto-rewriting old wiki-link tokens on rename. Renames just emit `*Renamed`; the live `display(ref)` re-renders. Storage is untouched.
- Mutating `Page.body` from a system. Bodies change exclusively via `SetPageBody`.
- Adding `Headings` writes from anywhere except `PageBodyParseSystem`. It's derived state with one writer.
- Persisting drafts. `PageBodyDraft` is `transient: true`; `PageDraft` trait is transient. Anything else corrupts the bloat-prevention story.
- Putting bodies in `PageHistory.entries`. It's metadata only; bodies live in the event log.
- Issuing `SetPageBody` or `SetDraftBody` without holding a current `EditorLock` for that page. The validators reject; clients shouldn't try.
- Mocking the SQLite FTS table in tests. Use a real in-process SQLite per `basics.md` testing posture.

## Testing

Per `CLAUDE.md`'s three-layer rule:

- **Unit tests** in every package: every command (given/when/then), every system (happy + branches + no-op), every schema (accepted + rejected). Plus the wiki-link grammar fixture suite, run against both the Lezer parser and the remark parser to keep them aligned.
- **Wire smoke** in `packages/server/src/notes.smoke.test.ts`: round-trip `CreateNote` → `AddPage` → `SetPageBody` → assert backlinks index updates server-side, assert FTS query returns the page. One assets-smoke alongside it covering upload + fetch + visibility-deny.
- **Component tests** under `packages/notes/src/client/` and `packages/assets/src/client/`: mount via `buildTestClient`, assert chip rendering for each kind (with a stub kind registered), autocomplete results, paste-image insertion, owner-gating on the visibility picker.

The CodeMirror live-preview decoration is canvas-adjacent — jsdom renders it but doesn't exercise the real text-measurement paths. We test the _descriptors_ (which decoration applies to which range, what the chip's props are) in jsdom; the actual visual flip is verified in the browser.

## Open questions / v2 triggers

| Item                                                                                    | v1 posture                                                      | v2 trigger                                                             |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Block-level locks for simultaneous multi-author editing                                 | Page-level lock + auto-save                                     | Groups want to edit the same page in parallel                          |
| Substrate-level event-log compaction (`event.compactable` flag + post-snapshot pruning) | Per-session bound + capped `PageHistory`                        | Event log size becomes a real ops concern (likely first felt by notes) |
| Field-level visibility (filter array fields per recipient)                              | Sidestepped via client-side backlinks                           | Some other plugin actually needs it                                    |
| Per-note-visibility check on asset URLs (vs. asset-own visibility)                      | Asset has its own `EntityVisibility`; this is the correct model | n/a — the asset-entity design solves it                                |
| Asset library UI                                                                        | Not shipped; data model supports it                             | First user asks                                                        |
| Co-authored notes (multiple owners with edit rights)                                    | Owner + GM only                                                 | Multi-author campaigns                                                 |
| Versioning / page history                                                               | Not shipped; event log already records every `PageBodySet`      | UI for browsing/restoring versions                                     |
| Templates (NPC, Location, Session Recap)                                                | Hand-rolled by users                                            | Pattern emerges; ship as a slot for plugins to fill                    |
| Cross-world linking                                                                     | Out of scope per `basics.md` non-goals                          | n/a                                                                    |

## Glossary deltas

Adds to the project vocabulary:

- **Wiki-link** — a `[[…]]` token embedded in markdown; resolves through the link-kind registry.
- **Kind** (in this context) — a registered link namespace (`note`, `character`, `scene`, `asset`, …) owned by a contributing plugin.
- **Asset** — an immutable byte blob owned by `@vtt/assets`, addressable by stable id, polymorphic on mime when embedded.
- **Page** — a NotePage entity; the unit of editing, visibility narrowing, and CAS.
- **Backlink** — a derived reverse reference from a wiki-link's source page to its target; computed client-side, not stored.
