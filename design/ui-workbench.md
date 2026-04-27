# UI Workbench

**Status:** proposed. Replaces the four-surface scaffold in `@vtt/shell-default` with a tabbed, splittable workspace, a persistent chat rail, and a fuzzy command palette. Lands as a new plugin `@vtt/shell-workbench`. **No substrate additions** — built entirely from existing primitives (surfaces, views, slots, traits, events, commands).

## The problem

Existing VTTs solve "show me my character sheet, the scene, the journal" with floating draggable windows. This is the most-cited UX failure of the genre — players spend more time arranging windows than playing. mvtt's scaffold today goes the other way: a fixed `Header / Main / Sidebar / Footer` grid that's fine for one view at a time but doesn't scale to "I want to see my sheet *and* the map" or "I want to switch to my journal without losing my place."

## Approach

A single tabbed workspace where every tab is a *Page* (a plugin's content type bound to a specific entity). Tabs can be split into edge-docked panes (left/right/top/bottom). A fuzzy command palette navigates and acts on the same Page registry. Two quick-focus modes — pane cycle and zen-maximize — keep keyboard hands productive. Chat is a persistent right rail.

Three properties make this defensible against the same window-juggling drift:

1. **Spatial commitment is bounded.** Hard cap of 4 leaf panes. After that the palette is the answer; you're not spawning a fifth window.
2. **The picker IS the tab header.** No "open dialog → choose → close." A tab's first dropdown is content-type, second is the specific entity. Re-target by changing either.
3. **Navigation has a non-spatial fallback.** The same Page index that drives pickers also drives the palette. On phones the palette becomes the primary navigator.

## Considered alternatives

| Option | Shape | Rejected because |
|---|---|---|
| **Stage + tray** | One scene/map dominates; pinned pages peek from a bottom dock. | Privileges scene over sheet/journal. Fits combat-heavy systems; misses narrative play. |
| **Pure split (no tabs)** | Every visible thing is a pane; max 2. | Hard cap was right but no standby slots — wanting a third thing means swapping a pane. |
| **Pure tabs (no splits)** | Browser-style tabs only. | Reintroduces "where did I leave my sheet" — same failure mode as floating windows along one axis. |
| **Floating windows** | The genre default. | The thing we're fixing. |

The chosen design is split + tabs + palette: bounded space for what you're actively working with, indexed search for everything else.

## Layout

### Desktop default (one pane)

```
┌──────────────────────────────────────────────────────────────────┬──────────────┐
│ ┃▼ Characters ▸ Brunhilda┃ ▼ Scenes ▸ Tomb │ ▼ Journals ▸ Q1 │+│  # table     │
│ ────────────────────────────────────────────────────────────────  │              │
│                                                                   │  Greta:      │
│        [active tab fills the pane]                                │  I cast      │
│                                                                   │  magic       │
│        ╲ each tab header is a live picker:                        │  missile…    │
│        ╲   first dropdown = content TYPE                          │              │
│        ╲   second dropdown = ENTITY of that type                  │  GM: roll    │
│        ╲   change either and the tab re-points in place           │  a d20       │
│                                                                   │              │
│                                                                   │  ┌────────┐  │
│                                                                   │  │ /roll  │  │
│                                                                   │  └────────┘  │
└──────────────────────────────────────────────────────────────────┴──────────────┘
                       Workspace                                       ChatRail
```

### After splitting a tab to the right edge

```
┌─────────────────────────────────────┬───────────────────────────────┬──────────────┐
│ ┃▼ Characters ▸ Brunhilda┃ ▼ J ▸ Q1│ ┃▼ Scenes ▸ Tomb┃ + new       │  # table     │
│ ─────────────────────────────────── │ ───────────────────────────── │  …           │
│                                     │                               │              │
│   [character sheet]                 │  [token map]                  │              │
└─────────────────────────────────────┴───────────────────────────────┴──────────────┘
```

Drop zones during a tab drag:

```
        ┌────────────────────────────┐
        │            ▲ top           │
        │  ◀ left      pane    right │
        │            ▼ bottom        │
        └────────────────────────────┘
```

Recursive splitting is allowed up to **4 leaf panes total**. Beyond that the UI rejects the split and surfaces a "use the palette" hint.

### Quick switcher (`⌘K` / `Ctrl-K`)

```
                ┌──────────────────────────────────────────────┐
                │  >  brun_                                    │
                │  ──────────────────────────────────────────  │
                │  ◉ Characters · Brunhilda the Bold       ⏎  │
                │  ○ Journals   · Brunhilda's diary            │
                │  ○ Handouts   · Brunhilda's letter to King   │
                │  ○ Scenes     · Brunhilda's hideout          │
                │  ──────────────────────────────────────────  │
                │  ⏎     focus existing tab if open,           │
                │        otherwise replace active tab          │
                │  ⌘⏎    open in a new tab                     │
                │  ⌘\    split active pane to the right        │
                │  ⌘-    split active pane below               │
                │  ⌘.    zen — maximize active pane            │
                └──────────────────────────────────────────────┘
```

The palette searches **Pages ∪ palette-commands** — both contributed via slots. So plugins can drop verbs (`/roll 2d6`, `End turn`, `Mute Greta`) into the same widget that navigates to nouns. VS Code / Obsidian's command-palette pattern, for free.

### Quick focus

Two modes, both reach the active pane without the mouse:

| Hotkey | Action |
|---|---|
| `⌘1` … `⌘4` | Focus pane N (in tree order). Tabs and chat keep their state. |
| `⌘.` | Zen — temporarily hide every pane except the active one. Press again to restore. |

The active pane is the focus target for `+ new tab`, palette `⏎`, and the split keystrokes (`⌘\`, `⌘-`).

### Reactive collapse

The palette is what makes this graceful at every size — navigation no longer depends on seeing the splits.

| Width        | Workspace             | Tabs           | Chat rail        | Palette                |
|--------------|-----------------------|----------------|------------------|------------------------|
| ≥1024 px     | full split tree       | as drawn       | docked right     | overlay on hotkey      |
| 640–1023 px  | one pane visible, others reachable via a pane switcher in the header | as drawn | bottom edge-sheet on tap | overlay on hotkey      |
| <640 px      | one pane              | swipeable strip, one tab at a time | full-screen sheet | becomes **primary navigation** — tap a search button in the header |

The mental model is identical at every width — splits collapse, but tabs and palette remain. There's no separate "mobile" model to learn.

## Vocabulary

| Term | Meaning |
|---|---|
| **Page** | A `(pageKind, entityId)` pair. The unit a tab points at. |
| **PageKind** | A category of content a plugin can render (`Characters`, `Scenes`, `Journals`). Plugin-namespaced (`@vtt/scene/scenes`, `@vtt/character/characters`). |
| **PageProvider** | A plugin contribution: an icon, label, `listEntities(ctx) → Page[]`, and `render(entityId) → ViewRef` for one PageKind. |
| **Tab** | A Page plus per-tab UI state (scroll position, sub-tab inside a sheet). Belongs to exactly one Pane. |
| **Pane** | A leaf in the workspace tree. Holds an ordered list of Tabs and an active Tab. |
| **Workspace** | A tree whose internal nodes are split-axis containers (`row` or `column` with proportions) and whose leaves are Panes. |
| **Workbench** | The shell plugin (`@vtt/shell-workbench`) that owns the whole layout. |

## Architecture

The Workbench is a plugin that declares slots and surfaces and owns a per-user `WorkspaceState` trait. Other plugins fill those slots — no plugin-to-Workbench coupling beyond the published slot schemas. The substrate's existing `single | stacked | per-entity` surface kinds and the existing slot mechanism are sufficient.

### Plugin: `@vtt/shell-workbench`

Replaces `@vtt/shell-default` as the standard shell. Coexistence is not a goal — pick one at boot.

#### Slots declared

| Slot | Filled by | Schema (sketch) |
|---|---|---|
| `@vtt/shell-workbench/pages` | every plugin that owns first-class user-facing content | `{ kind: PageKindName; icon; label; listEntities: (ctx) => Page[]; render: (entityId) => ViewRef }` |
| `@vtt/shell-workbench/palette-commands` | any plugin that wants verbs in the palette | `{ id: QualifiedName; label; hint?; run: (ctx) => void }` |
| `@vtt/shell-workbench/chat-rail-widgets` | dice tray, initiative tracker, presence indicator, etc. | stacked above the chat composer |

A `PageProvider`'s `render` returns a Solid component (view ref). If a plugin author wants *other* plugins to extend the rendering of one of their pages (e.g. a journal page with a "comments" extension point), they declare their own `single` or `stacked` surface and mount it inside their `render`. That's a plugin-design choice, not a substrate concern.

#### Surfaces declared

| Surface | Kind | Notes |
|---|---|---|
| `WorkbenchRootSurface` | single | The new fill of `RootSurface`. |
| `WorkbenchHeaderSurface` | stacked | Replaces `HeaderSurface`. Logo, presence chips, palette trigger, GM tools. |
| `PaletteSurface` | stacked | Palette overlay; plugins can drop ad-hoc UI here (e.g. a date picker for a "schedule next session" command). |

The page-render surface point is *the slot*, not a new surface kind. The Workbench reads the active tab, looks up the PageProvider for its `pageKind`, and mounts `provider.render(entityId)`.

#### Views

- `WorkbenchView` (fills `RootSurface`) — top-level layout (header + workspace + chat rail + palette overlay).
- `WorkspaceTreeView` — recursive renderer over the split tree (panes + splitters).
- `PaneView` — tab strip + active page renderer.
- `TabPickerView` — the in-header `▼ Type ▸ Entity` two-step.
- `PaletteView` — fuzzy search over Pages ∪ palette-commands.
- `ChatRailView` — mounts existing `ChatStreamSurface` + composer + `chat-rail-widgets`.

#### Commands

Workspace mutations go through the substrate's `CommandPipeline` like any other command — they validate against current `WorkspaceState`, emit events, and replicate to the user's other connections via the visibility filter.

| Command | Effect |
|---|---|
| `OpenPage` | Activate or open a Tab for `(pageKind, entityId)` in the active Pane. |
| `OpenPageInNewTab` | Open in a new Tab in the active Pane. |
| `OpenPageAsSplit` | Open in a new Pane split off the active one (direction param). |
| `CloseTab` | Remove a Tab. If the Pane empties, collapse it from the tree. |
| `MoveTab` | Drag a Tab to another Pane (or to an edge to spawn a new Pane). |
| `RetargetTab` | Change the `pageKind` or `entityId` of an existing Tab in place. |
| `FocusPane` | `⌘N`. |
| `ToggleZen` | `⌘.`. |

Workspace events are marked **`transient: true`** (skip the durable event log) and **`broadcast: true`** (replicate over the wire to the user's other connections). The trait itself persists; only the per-mutation events are ephemeral. Cold boot loads the latest snapshot — no UI-mutation history to replay.

## Registering page kinds

The Workbench is useless without things to put in tabs. Plugins teach it by registering **page providers** — a definer in the same family as `defineTrait` / `defineEvent` / `defineCommand`.

### The definer

```ts
import { definePageProvider } from "@vtt/shell-workbench";
import { Scene, Name } from "../shared/index.js";
import { SceneCanvasView } from "./SceneCanvasView.js";

export const ScenesPageProvider = definePageProvider({
  kind: "@vtt/scene/scenes",     // qualified name, branded like trait/event
  icon: "map",
  label: "Scenes",                // shown in the picker dropdown & palette group header

  // What entities of this kind are available to *this user right now*?
  // Reactive — runs through world.query, so EntityVisibility already filters
  // and additions/removals stream into the picker & palette live.
  list: ({ world }) =>
    world.query([Scene, Name]).map((row) => ({
      id:    row.entityId,
      label: row.traits.Name.value,
      hint:  row.traits.Scene.tags?.join(" "),   // optional secondary search field
    })),

  // What should bootstrap-on-join open if the user's template asks for
  // "a Scenes tab" but doesn't name one? Returns null to skip.
  defaultEntity: ({ world }) => world.findOne([Scene, ActiveScene])?.entityId ?? null,

  // The per-tab render. Receives the bound entity (may be null for
  // "kind selected, entity not yet picked") plus the persisted uiState.
  render: ({ entityId, uiState, setUiState }) =>
    entityId
      ? <SceneCanvasView entityId={entityId} state={uiState} setState={setUiState} />
      : <PickAScenePrompt />,
});
```

In the manifest:

```ts
export default definePlugin({
  name: "@vtt/scene",
  // ...
  fills: {
    "@vtt/shell-workbench/pages": [ScenesPageProvider],
  },
});
```

That's the whole developer-facing surface. Multiple PageKinds per plugin (`Characters`, `NPCs`, `Inventory`) = multiple providers in the array.

### What falls out for free

- **Permissions** — `list` runs through `world.query`, which the substrate's snapshot filter already partitions per recipient via `EntityVisibility`. Players can't list things they can't see; GM listings include private content. No new plumbing.
- **Live updates** — `list` is reactive (Solid-bridged), so a new scene shows up in the open palette / dropdown without a refresh.
- **Tab identity & dedup** — a Tab's identity is `(kind, entityId)`. `dispatch(OpenPage({ kind, entityId }))` from anywhere — palette, a token click, a cross-plugin button — focuses the existing tab if already open, otherwise opens a new one. No "is this already open?" check at the call site.
- **Cross-plugin opens** — `OpenPage` is the universal "show this thing" verb. The scene plugin's token-click handler dispatches `OpenPage({ kind: "@vtt/character/characters", entityId: tokenOwnerId })` — it doesn't import anything from `@vtt/character`, just references the kind by its qualified-name string, same as referencing an event name.
- **Swappability** — register a higher-priority provider for the same `kind` and you replace the rendering. Same priority story as views. `@vtt/character-sheet-fancy` overrides the default sheet without forking `@vtt/character`.

### Decisions worth noting

| Decision | Choice | Rationale |
|---|---|---|
| Empty-entity tabs | First-class — a tab can have `entityId: null` and the provider's `render` shows whatever it wants ("pick a character to view"). | Makes "I want to browse Characters" a normal operation; avoids forcing every provider to invent a "no entity" state. |
| Sub-extension within a page | Lives inside the provider's `render`, not in the slot schema. The journal plugin declares its own `JournalPageContentSurface` (stacked) and mounts it. | Keeps the workbench slot schema small. Each provider that wants extension points ships its own surface. |
| `list` shape | One-shot reactive collection, not paginated. | Sufficient until a single provider has 10k+ entities. When that breaks, providers can opt into a `searchEntities(query) → results` form alongside `list`. |
| What providers register | The *kind*, not enumerated Pages. | Mirrors how trait/event/command definers register types, not instances. The workbench projects the kind across whatever entities `list` returns. |
| Picker vs palette | Same `list` output drives both. | One source of truth, two presentations: filtered-by-kind in the dropdown, fuzzy-across-all in the palette. |

## Persistence: layered defaults

Workspace state splits into four layers, with two natural homes:

| Layer | What | Home | Scope key |
|---|---|---|---|
| 1. Chrome prefs | Chat rail width, palette hotkey, theme | `@vtt/identity` user record (extended) | `userId` |
| 2. Layout template | Preferred initial split shape, default-on-join Pages | `@vtt/identity` user record (extended) | `userId` |
| 3. Concrete tabs & tree | Tabs, split tree, active tab | `WorkspaceState` trait on a per-user sentinel entity in the World | `(worldId, userId)` |
| 4. Per-tab UI state | Scroll position, sub-tab inside a sheet | Same `WorkspaceState` trait | `(worldId, userId, tabId)` |

Layers 1 & 2 follow the user across worlds because they're aesthetic / templating — independent of which entities exist. Layers 3 & 4 are world-bound because they reference `entityId`s that only exist inside one world. Persisting them globally would break on every game switch.

### The per-user sentinel entity

The `Player` entity declared by `@vtt/identity` is *transient* (recreated per WS connection; never persisted). Workspace state is *durable*, so it cannot live on `Player`.

The Workbench plugin spawns and owns a separate **`WorkspaceOwner`** entity per user per world:

```
WorkspaceOwner entity (persistent)
├── OwnedBy { userId }                     // from @vtt/permissions
├── EntityVisibility { actors: [userId] }  // only the user's own connections
└── WorkspaceState {
      tree:    SplitNode | LeafNode,
      panes:   { [paneId]: { tabIds: [...]; activeTabId } },
      tabs:    { [tabId]: { pageKind, entityId, uiState } },
      lastInteractedAt: timestamp,
      schemaVersion: 1,
    }

SplitNode = { axis: 'row' | 'column'; children: NodeId[]; proportions: number[] }
LeafNode  = { paneId: PaneId }
```

The visibility resolver (`@vtt/permissions/EntityVisibility`) ensures only the owning user's connections receive their workspace. The GM never sees players' workspaces; players never see the GM's. Workspace privacy is enforced by the same primitive that gates secret notes — no new mechanism.

### Why in-World, not a separate aggregate

Workspace state is per-`(worldId, userId)`, which makes a separate `WorkspaceRepository` keyed the same way a defensible alternative. We're putting it in the World instead because:

- **Persistence is free** — snapshot + event-log machinery already handles it, including the `since: N` reconnection path once that lands.
- **Visibility is free** — `EntityVisibility` already partitions per-user data; reinventing for an external aggregate is duplicate work.
- **Live multi-device sync is free** — `WorkspaceStateChanged` broadcasts to the user's other connections automatically.
- **Event-log noise is bounded** — the events are marked `transient`, so they don't persist. Only the trait does.

The cost is some snapshot bloat for users who have logged in once and never returned, addressed by the GC system below. If snapshot size becomes a real problem, extracting workspace state to its own aggregate is a clean migration — the data shape is small and the visibility story carries over directly.

### Bootstrap on join

A system listens to `@vtt/identity/PlayerJoined`:

1. Look up `WorkspaceOwner` for `(worldId, userId)`. If present, done.
2. If absent, fetch the user's global template from `@vtt/identity` (layers 1 & 2).
3. Materialize an initial `WorkspaceState` from the template:
   - Apply layout template (default: one pane).
   - Resolve "default-on-join Pages" against the current world (e.g. *open the active Scene + the user's primary Character*). Skip any Pages that don't resolve.
4. Spawn the entity with `OwnedBy{userId}` + `EntityVisibility{actors:[userId]}` + the materialized `WorkspaceState`.

First-join in a fresh game thus opens a usable workspace immediately rather than a blank pane.

### Garbage collection

`WorkspaceOwner` entities accumulate forever otherwise — joining a one-shot pollutes the World indefinitely. A periodic system deletes any `WorkspaceOwner` whose `WorkspaceState.lastInteractedAt` is older than N days **and** whose user hasn't connected in the same window. Default 90 days; threshold deferred to operational experience.

## Failure modes

| Mode | Mitigation |
|---|---|
| **Stale entity reference** — a tab points at a deleted entity. | The pane renders an empty state with the same picker the tab header uses; the tab's `entityId` becomes `null` until the user picks a new target. |
| **Removed PageKind** — a plugin uninstalls or renames its provider. | Tabs carry `(pageKind, schemaVersion)`. Unknown kinds render the same empty state with a "this tab needs plugin X" banner. PageKind renames ship a migration in the renaming plugin's manifest. |
| **Tab tree corruption** — a bad merge or crashed mutation leaves the tree malformed. | `WorkspaceState` is Zod-validated at the trait boundary. On parse failure the bootstrap system replaces with a fresh state from template; lost work is bounded to tab arrangement. |
| **Workspace cruft** | GC system above. |
| **Schema drift across plugin versions** — palette-command shapes change. | Same versioning story as PageKind: command id is plugin-namespaced; entries that don't resolve are dropped silently. |

## Migration from `@vtt/shell-default`

| Step | Change |
|---|---|
| 1 | Land `@vtt/shell-workbench` alongside `@vtt/shell-default`. Boot picks one or the other. |
| 2 | Move existing widgets currently filling `HeaderSurface` / `SidebarSurface` to one of: (a) the chat rail (presence, dice tray) via `chat-rail-widgets`, (b) palette commands (`/r`, `/ping`), or (c) Pages where they're substantial enough to warrant a tab. |
| 3 | `@vtt/scene` adds a `PageProvider` for `Scenes` (one Page per scene, `render = SceneCanvasView`). `SceneToolbarSurface` becomes per-page contextual chrome. |
| 4 | `@vtt/comms` keeps `ChatStreamSurface`; the Workbench mounts it inside the right rail. No comms-side change. |
| 5 | A future `@vtt/character` plugin (when it lands) ships a `Characters` PageProvider out of the box. |
| 6 | Default server bundle swaps `@vtt/shell-default` for `@vtt/shell-workbench`. The old shell stays in tree as a reference exemplar but is no longer the default. |

## Non-goals

- **Floating windows.** No. The hard cap of 4 panes plus the palette is the design.
- **Per-character workspace state.** Layer 3+4 keys on `(worldId, userId)` — not `(worldId, userId, characterId)`. A user playing two PCs in the same campaign sees one workspace. Adding `characterId` to the key later is a backwards-compatible migration; we won't pay for it now. Trigger to revisit: a regular complaint that two-PC players want separate layouts.
- **Cross-device divergence.** Same `(worldId, userId)` key from any device gets the same workspace. The reactive collapse rules render it differently on phone vs. laptop, but the underlying tree is one. Trigger to revisit: desktop split that flattens uselessly on phone, with no good way for the user to maintain both.
- **Workspace presets / shareable layouts.** Out of scope for v0. "Save current as my new template" is a reasonable v0.x add once the basics ship.
- **Drag from the palette.** Mouse-drag from a palette result onto a pane to split. Cute, not needed for v0.

## Status entry (for `scaffold-mapping.md`)

Once shipped, scaffold-mapping gets a row in **Plugins shipped**:

```
| @vtt/shell-workbench | ✓ | Tabbed splittable workspace + chat rail + fuzzy
                            palette. Declares pages, palette-commands,
                            chat-rail-widgets slots. Persists per-user state
                            as WorkspaceState on a per-user sentinel
                            WorkspaceOwner entity, scoped via
                            EntityVisibility{actors:[userId]}. |
```

And a deletion of `@vtt/shell-default` from the same table once consumers have migrated.

## Known gaps (deferred deliberately, with the trigger that ends the deferral)

- **Optimistic prediction for workspace mutations** — same gap as the rest of the system (per `scaffold-mapping.md`). Workspace mutations are *especially* sensitive to wait — clicking a tab should feel instant. Trigger: end-to-end `OpenPage` round-trip exceeds ~50 ms on local dev.
- **Field-level visibility on `WorkspaceState`** — currently the entire `WorkspaceState` trait delivers as one unit, scoped per user. If a future feature wants partial sharing (e.g. "co-pilot mode" where a player can hand a single tab to the GM), field redaction lands the same time as it does for the rest of the system.
- **PageKind migration framework** — schemaVersion field is reserved on tabs; the actual migration registry isn't built yet. Trigger: the first PageKind rename in a shipped plugin.
- **Workspace presets** — see Non-goals. Trigger: more than one user asks for it.
