# Adventures

**Status:** v1 implemented. The skeleton (`@vtt/adventures` plugin, parse system, schema-driven autocomplete), the four block kinds (`item`, `character`, `monster`, `encounter`, `loot`), `StartEncounter` + `AwardLoot`, bundle build/import/closure, and the per-block update-diff service all ship and pass tests. Phase-0 catalog seed migration (TB monsters + NPCs eagerly seeded) ships. Deferred items (HTTP routes, asset bytes, Solid UI dialogs, conflict-subsystem wire-up) are listed in **Implementation status** at the end.

Originally proposed as one new plugin, `@vtt/adventures`, plus per-game-system fenced-block kinds contributed by the system plugin (Torchbearer first). Builds on `@vtt/notes`, `@vtt/assets`, the items + characters subsystems, and the existing TB conflict subsystem. **No substrate additions** beyond what notes already needed — every materialized entity is created directly (deterministic block-entity ids); bundle import is a server-side service.

Cross-refs: `design/notes.md` (the substrate this rides on), `design/items.md` (the catalog / copy-on-write / field-override pattern adventures reuse), `design/torchbearer-conflict.md` (what an encounter instantiates).

## The problem

A GM preparing a session writes notes anyway: location descriptions, NPC stat blocks, monster bestiaries, treasure parcels, the shape of the next encounter. Today those notes are inert prose. A GM running a published adventure types the same content into the app a second time, by hand, and again every time they re-run it for a different group.

We want one system that:

- Lets a GM **author** an adventure entirely in the app — typing fenced blocks into normal note pages — and have those blocks become real entities the rest of the world can reference and the GM can launch with one click.
- Lets a GM **import** a `.advt` bundle authored by someone else (or themselves, last campaign) and get the same materialized entities, with assets uploaded and references rewritten.
- Lets adventures **update upstream** so a published adventure can ship a v2 and subscribed worlds can merge — without losing in-progress fight state, GM tweaks, or character damage already taken.
- **Preserves real-time reactivity** end-to-end: edits to an NPC's stat block flow live into running encounters; mob copies are independent entities with their own HP.
- **Reuses the existing primitives** (notes, assets, items catalog seeding, character entities, conflicts) rather than introducing a parallel "adventure runtime."

This document is the design.

## Locked decisions

1. **Notes are the source of truth for authored content.** Adventure content is written as fenced blocks (`npc`, `monster`, `item`, `encounter`) on normal note pages. Every block is parsed eagerly on save and upserted into a canonical entity. The note text — not a separate "adventure document" — is the persistent shape.
2. **Parsing is eager, idempotent, and additive.** Saving a page parses its blocks and dispatches upsert commands; re-saving with no change emits no events. Deleting a block tombstones the link, never the entity (the entity may be referenced by a running conflict).
3. **Each block kind has a stable identity.** `(noteId, blockKey)` → a fixed entity id, allocated once on first parse and persisted on a `BlockEntityIndex` sentinel. Renaming the block's title doesn't reallocate; the title becomes a normal trait edit.
4. **Body format is YAML inside the fence, with two extensions** — wiki-links (`[[…]]`) and dice expressions (`2d6+1`) recognized inside string values. Each block kind ships a Zod schema; the parser is `yaml.parse → schema.parse → entity payload`. Editor support is one CodeMirror language extension over yaml-mode plus a kind-specific autocomplete provider over the schema.
5. **Autocomplete is schema-driven and pervasive.** Every block kind contributes its UX to the editor *for free* by virtue of registering a schema — no per-system completion code in the typical case. Key suggestions, enum value suggestions, wiki-link target suggestions, and inline validation errors all derive from the Zod schema (with branded subtypes for wiki-link slots and dice slots). A kind may add an optional `complete(path, ctx)` escape hatch for dynamic completion the schema can't express. **Without this, the system is unusable**: block kinds are the surface area each game system extends, and a GM at the table can't be expected to memorize the slot list for a TB armor or the disposition keys for a kill conflict.
6. **Wiki-link resolution goes through the existing kind registry.** Adventures don't invent new wiki-link kinds for content that already has one (`character`, `item`); they only register a new `encounter` kind for encounter templates. Quantification is grammar-level (`4× [[character:goblin scout]]`), not a separate kind.
7. **Encounter binding is hybrid by convention.** Singular references (`[[character:Skarra]]`) bind by reference — edits flow, conditions stick, death persists. Quantified references (`4× [[character:goblin scout]]`) spawn N fresh entities from a *template* (the entity authored by a `monster` block) at encounter-instantiation time. Mob copies use the same `ItemDerivedFrom`-style override machinery items use, so future template edits propagate to *future* spawns and existing copies stay stable.
8. **Bundles are a single zipped file** containing notes, assets, and a manifest. Import unpacks into the world's existing asset store and creates notes with provenance. Export is the reverse over a selected note tree.
9. **Update is per-block diff.** A bundle subscribed to a world (provenance recorded on each note via a stable `bundleId`) can be re-imported as v2; the GM gets a per-block diff (the smallest unit of merge is one fenced block, not a field within) and chooses keep-mine / take-theirs / merge per block. Surrounding prose between blocks gets a separate text-diff section. Field-level merge inside a block is v2.
10. **Bundles carry a stable `bundleId` UUID** in their manifest. `name` and `author` are display metadata; provenance and update detection key on `bundleId`. Re-importing the same `(bundleId, version)` is a detected no-op with a "force re-import" toggle for recovery scenarios.
11. **GameSystem compatibility is semver-respecting** via the manifest's `requires` field. Refuse on major mismatch, warn on minor.
12. **NPC/PC/template/copy distinction is by trait composition, not separate entity classes.** A PC is `Character` + `OwnedBy`; a named NPC is `Character` (no owner, present in `BlockEntityIndex`); a monster template is `Character` + `MonsterTemplate`; a mob copy is `Character` + `MonsterCopy{ templateId }`. Queries filter by trait presence; no `IsNpc` marker required.
13. **One seed pattern across all TB catalogs.** Today items use `definePlugin.seed` to spawn `TB_ITEM_TEMPLATES` as real entities at boot; monsters/NPCs/spells are *lazy* (the `TB_*_TEMPLATES` arrays are read by client pickers and entities only exist when a GM clicks "spawn"). Adventures requires every catalog to use the **eager seed** pattern uniformly — wiki-links need stable, pre-existing entity ids before any encounter can reference them. The lazy pickers shift from "browse a static array and spawn-on-click" to "browse seeded entities and fork-on-customize" (the same auto-fork-on-catalog-equip flow items already use for containers).

## Plugin layout

```
@vtt/adventures                     (universal infra tier, like notes/assets)
  shared/
    AdventureProvenance trait     // on every note created from a bundle
    BlockEntityIndex sentinel     // (noteId, blockKey) → entityId
    EncounterTemplate trait       // attached to entities authored by `encounter` blocks
    MonsterTemplate trait         // marker on entities authored by `monster` blocks
    UpsertBlockEntity command     // emitted by the parse system
    TombstoneBlockEntity command  // emitted when a block disappears
    StartEncounter command        // user-facing; spawns a live conflict from a template
  server/
    BlockParseSystem              // reacts to PageBodySet; runs per-kind parsers; diffs against
                                  //   the previous parse; dispatches Upsert / Tombstone
    BundleImportService           // POST /api/worlds/<id>/adventures/import (multipart)
    BundleExportService           // GET  /api/worlds/<id>/adventures/export?notes=…
    UpdateDiffService             // compares a re-uploaded bundle against existing provenance
  client/
    yaml-block-language.ts        // CodeMirror language ext for fenced YAML blocks
    block-autocomplete.ts         // kind-aware key + value completion
    block-renderers/              // npc / monster / item / encounter rendered widgets
    AdventureImportDialog.tsx     // upload bundle, see preview, confirm
    AdventureUpdateDialog.tsx     // per-note diff, pick keep/theirs/merge
  manifest.ts

@vtt/system-torchbearer            (game-system plugin contributes block kinds)
  shared/blocks/
    npc.ts        // schema + entity-projection: Character + TB traits + Belief/Goal/Instinct
    monster.ts    // schema + entity-projection: Character + TbMonster + MonsterTemplate marker
    item.ts       // schema + entity-projection: Item + TB item subtype traits
    encounter.ts  // schema + entity-projection: EncounterTemplate
  manifest.ts: registerBlockKind("npc", npcKind), …
```

`@vtt/adventures` declares `dependsOn: ["@vtt/substrate", "@vtt/notes", "@vtt/assets", "@vtt/permissions"]`. It's universal infrastructure — every world gets it. It owns *no* game-system content; block kinds are contributed by system plugins via a `defineBlockKind` registry, exactly mirroring `defineLinkKind`.

## The block-kind registry

```ts
defineBlockKind({
  name: "npc",                                          // fence info string
  schema: NpcSchema,                                    // Zod schema — also drives autocomplete + inline validation
  project: (parsed, ctx) => EntityProjection,           // parsed → traits to write
  display: (entity, world) => string,                   // for renderers + index
  render: (entityId) => JSX.Element,                    // rendered widget in note
  actions?: BlockAction[],                              // buttons attached to the rendered block
  snippet?: () => string,                               // CodeMirror snippet for empty-fence expansion
  complete?: (path, ctx) => Suggestion[],               // optional — escape hatch for dynamic completion
})
```

The kind def is intentionally small. The schema is doing most of the work — it's the source for parsing, validation, *and* autocomplete. A system plugin author writing a new block kind ships a schema, a projection function, and a renderer; everything else falls out.

### Renderer reuse across surfaces

The `render(entityId)` function is the **single canonical widget** for the entity, reused everywhere it surfaces:

| Surface                                              | Form         |
|------------------------------------------------------|--------------|
| Live preview under the YAML while authoring          | Full widget  |
| Read-mode of the source note                         | Full widget  |
| `![[character:Greta]]` embed in another note         | Full widget  |
| `[[character:Greta]]` peek popover (click the chip)  | Full widget  |
| `[[character:Greta]]` chip itself (inline pill)      | Small chip — name + icon, from the link kind's `display(ref)` |

`actions` follow the widget. `Start encounter` shows up on the encounter block in its source note **and** in the peek when the encounter is wiki-linked from a session-prep note **and** in the embedded form. Permission gating is per-action (GM-only actions hidden from players).

To make this work without each link kind reinventing the lookup, the adventures plugin exports a small helper:

```ts
renderBlockEntityWidget(entityId, world): JSX.Element | null
  // returns the widget if the entity has BlockEntityIndex provenance, else null
```

Existing link kinds (`character`, `item`, `spell`) wire it into their `embed` and `activate.peek` paths:

```ts
embed: (ref) => renderBlockEntityWidget(ref.entityId, world) ?? defaultEmbed(ref),
activate: (ref) => ({
  type: "peek",
  render: () => renderBlockEntityWidget(ref.entityId, world) ?? defaultPeek(ref),
}),
```

System-seeded entities (no block provenance) fall back to the link kind's default renderer; block-authored entities get the rich widget for free. One line of wiring per link kind.

`EntityProjection` is what the parse system upserts:

```ts
type EntityProjection = {
  traits: Array<[TraitDef<unknown>, unknown]>;          // authored fields
  spawnIfMissing?: Array<TraitDef<unknown>>;            // initial-only (e.g. starting HP)
};
```

The split matters: **authored fields** are re-written on every save (the block is the source). **`spawnIfMissing`** runs once at first creation and never again — used for runtime defaults (full HP, no conditions) that the entity then accumulates state into.

`actions` are surfaced by the renderer as buttons under the block. The encounter kind contributes `Start encounter`; a loot block (future) would contribute `Award loot`.

## Autocomplete

Autocomplete is the load-bearing usability concern. Every game system extends the syntax surface, every block kind adds keys an author has to know, and a GM at the table won't memorize the slot list for TB armor or the disposition keys for a kill conflict. The whole system stands or falls on whether `Ctrl+Space` reliably shows the right list.

The design rule: **schema is the source.** A kind author writing a new block kind ships a Zod schema; the editor extension reads `schema._def` and produces completions. No per-kind UI code in the typical case.

### Schema-derived completion

The CodeMirror autocomplete provider, given the cursor position inside a fenced block, walks the schema to the cursor's path and emits suggestions:

| Cursor position                    | Schema node              | Suggestions                                                   |
|------------------------------------|--------------------------|---------------------------------------------------------------|
| Beginning of a line (key slot)     | `z.object`               | All keys not yet used at this level, with `?` marker on optional, `*` on required. Description from `.describe()` shown as detail. |
| After a `: ` for an enum field     | `z.enum` / `z.literal`   | All literal values, sorted, descriptions inline.              |
| After a `: ` for a wikilink slot   | branded `wikiLink<kind>` | Live entity completions filtered by visibility (same source as the notes plugin's `[[…]]` autocomplete). |
| After a `: ` for a dice slot       | branded `dice`           | Static suggestions (`1d6`, `2d6+1`, …) plus inline lint of partial expressions. |
| Inside a list element              | `z.array`                | Recurse into the element schema at depth+1.                   |
| Inside a discriminated union       | `z.discriminatedUnion`   | First completion is the discriminator field itself; once set, narrows to that variant's keys. |

The `wikiLink<kind>` and `dice` brands are top-level helper functions exported from `@vtt/adventures` (not Zod prototype extensions — those bind us to a Zod version). Each wraps `z.string()` and stashes a marker in the schema's `_def.description` (or a sibling metadata key) that the autocomplete reader recognizes. Authoring looks normal:

```ts
const ItemRef = wikiLink("item");
const DamageRoll = dice();

const NpcSchema = z.object({
  name:    z.string(),
  carries: z.array(z.union([
    ItemRef,
    z.object({ qty: z.number(), item: ItemRef }),
  ])),
  attack:  DamageRoll.optional(),
});
```

### Inline validation

The same schema runs continuously against the in-progress YAML (debounced ~150ms) and surfaces `ZodError.issues` as CodeMirror diagnostics — squigglies on the offending range with the message inline. The author sees "expected one of `kill | capture | drive_off | flee | scripted | journey`" the moment they type `type: kil`, not when they save.

### Wiki-link completion inside YAML strings

Wiki-links work the same inside fenced YAML as they do in prose markdown — typing `[[` opens the same autocomplete the notes editor uses, scoped by the current key's expected `wikiLink` kind when known. Without a schema hint the popover shows all kinds and the author can prefix-filter (`@gr…` → characters; `:lon…` → items via the registered sigils).

### Snippet expansion

Each kind exports a `snippet()` returning a CodeMirror snippet (with `${1:placeholder}` tab stops) that the editor offers as the *first* completion when the cursor is inside an empty fence with that kind's info string. Authoring a new monster:

```
```monster <cursor here, type Ctrl+Space>
```

→ snippet expands to:

```
```monster ${1:name}
might: ${2:1}
nature:
  rating: ${3:1}
  descriptors: [${4:descriptor}]
disposition:
  kill:      ${5:5}
  capture:   ${6:4}
  drive_off: ${7:3}
  flee:      ${8:2}
weapons: ${9:[]}
notes: |
  ${0}
```

Snippets live as a method on the kind def (rather than a separate `snippets/` folder per system), so they're co-located with the schema they fill. They turn the empty-block experience from "what fields exist?" into a fill-in-the-blank.

### Escape hatch

The optional `complete(path, ctx)` callback fires for paths the schema can't fully describe — e.g. completing skill names when the system supports custom skills, or completing condition names from a runtime registry. Returns a `Suggestion[]`; the autocomplete provider merges it with schema-derived completions for the same path.

### Fenced-info-string completion

When the cursor is on the opening fence line (` ```|` ), the autocomplete shows all registered block kinds with their one-line `description`. This is the entry point — a new GM doesn't need to know what kinds exist to discover them.

### Scoping the picker — avoiding the flood

Once monster/spell/NPC catalogs are seeded eagerly, every world boots with hundreds of `MonsterTemplate` entities. A naive autocomplete that lists *all* matching entities on every empty `[[character:` would dump the whole catalog into the GM's face. The fix is simple: **don't pre-populate the dropdown — require at least one character of query before showing catalog matches.**

Empty-query (`[[character:` with cursor right after the colon) shows a tiny strip — maybe the last 3–5 entities the GM referenced or spawned in this world — plus a hint to type. Once the query has ≥ 1 character, fuzzy-search runs over all visible entities, with two ranking boosts: matches authored on the current page or in the current adventure float to the top, and recently-used matches rank above never-used. No flood, because no list appears until the GM expresses intent.

For the **conflict UI's mid-fight "Add participant" picker**, same rule: a search box with a small "recent" strip pinned on top, no big list by default. Optional tag chips (`humanoid`, `undead`, `boss`, …) for browse-style filtering when the GM doesn't have a name in mind; tags live as a `MonsterTags{ tags: string[] }` trait written by the seed step from the existing `TB_MONSTER_TEMPLATES[i].tags` data.

The principle: **the catalog is searchable, not browsable by default.** A GM who knows what they want types it; a GM who's browsing opens the dedicated monsters page.

## Fenced-block grammars (TB)

### `character` — named NPC

```character Greta the Smith
stock: Human
class: Warrior
level: 3
will: 4
health: 5
nature:
  rating: 4
  descriptors: [Demanding, Forging, Boasting]

skills:
  fighter: 4
  laborer: 3
  smith: 5
  scout: 2

traits:
  - { name: Stubborn,        level: 1 }
  - { name: Hammer-handed,   level: 1 }

wises: [Forge-wise, Roads-wise]

carries:
  - [[item:hammer]]
  - [[item:chain shirt]]
  - 2× [[item:traveling ration]]

belief:   A weapon should be tested in a real fight, not a sparring ring.
goal:     Reach Bywater before the merchants close their doors.
instinct: Always check the weight of an unfamiliar weapon.

notes: |
  Sells weapons at fair prices but won't haggle.
  Owes a favor to [[character:Marrow the Tanner]].
```

Projects to a `Character` entity with `Identity{name, stock, class, level}`, `TbWill`, `TbHealth`, `TbNature`, `TbSkills`, `TbTraits`, `TbWises`, `TbBeliefs{ belief, goal, instinct }`, and `TbCarries` populated from the carries list (each line resolves through the items wiki-link to an existing item entity, copying the standard catalog → equip flow).

`spawnIfMissing` writes `TbConditions{}` empty — once the entity exists, conditions accumulate from play and re-saving the block doesn't reset them.

### `monster` — template for mob spawns

```monster goblin scout
might: 2
nature:
  rating: 3
  descriptors: [Lurking, Stabbing, Stealing]

disposition:
  kill:      5
  capture:   4
  drive_off: 3
  flee:      2

weapons: [[item:curved knife]], [[item:short bow]]
armor:   [[item:leather hauberk]]

instinct: Run when outnumbered.
treasure: 1d6 coppers; 1-in-6 carries [[item:goblin charm]]
notes: |
  Squads of 3-6 typical. Cowardly alone.
```

Projects to a `Character` entity (so it can be wiki-linked the same way) with the **`MonsterTemplate` marker trait**. The marker is what tells `StartEncounter` "spawn copies from this; don't bind by reference." Boss/named monsters that should be unique (`[[character:Skarra Wormtongue]]`) use the `character` block kind, not `monster`.

A `monster` block can override or extend everything `character` does (full skills, will/health for named threats); the schema is a superset with `might` + `disposition` required.

### `item` — catalog item

```item longsword
type: weapon
slot: hand
weight: 1
weapon:
  attack:  +1D
  defend:  +1D
  feint:   +1D
  length:  long

tags: [martial, common]
description: A standard double-edged blade. Reliable.
```

Projects to an `Item` entity with `ItemIdentity`, `TbItemSlotOptions`, `TbWeapon` (or `TbArmor`/`TbSupply`/`TbContainer` per `type`), and `ItemDerivedFrom{ pluginName: "@vtt/adventures", templateId: <noteId>:<blockKey> }` so subsequent updates flow through the same merge engine the items doc already specifies.

This is the bridge to existing infra: an authored item is **structurally identical** to a system-seeded item. The adventures plugin's `BlockParseSystem` uses the items plugin's `CreateItem` / `EditItemField` commands; nothing is bypassed.

### `encounter` — recipe

```encounter ambush at the bywater bridge
type: kill                              # conflict type — see TbConflictType enum
location: [[note:Bywater Bridge]]
sides:
  pcs:
    - any present
  enemies:
    - [[character:Skarra Wormtongue]]   # bound by reference
    - 4× [[character:goblin scout]]     # template — spawn 4 copies

trigger: PCs attempt to cross the bridge after dusk.
read_aloud: |
  As you reach the midpoint of the bridge, three torches flare to life
  on the far bank. A shape uncoils from the railing — too long, too smooth.

opening_actions:
  - actor: [[character:Skarra Wormtongue]]
    action: Maneuver
    note: Casts [[spell:charm]] on the most heavily armored PC.
  - actor: goblin scout                  # un-disambiguated — applies to all copies
    action: Attack
    round: 3

treasure: [[item:serpent ring]], 47 silver, [[item:map fragment east]]
```

Projects to an `EncounterTemplate` entity with `EncounterTemplate{ type, locationRef, sides, openingActions, treasure, readAloud, trigger }`. The renderer's primary action is `Start encounter`, which dispatches `StartEncounter(templateId)` (see the next section).

`opening_actions` is GM-only by default (the schema marks the field as `secrecy: gm`); the renderer hides it from non-GM viewers. Same posture as TB conflict secrecy.

### `loot` — treasure parcel

```loot bywater bridge spoils
items:
  - [[item:serpent ring]]
  - [[item:map fragment east]]
  - 3× [[item:traveling ration]]
cash:
  silver: 47
  copper: 14
notes: |
  Found in Skarra's pack after the fight.
```

Projects to a `LootParcel` template entity carrying `LootParcel{ items, cash, notes }`. Actions:

- **Place in scene** (the primary flow GMs reach for after a fight) → dispatches `PlaceLootInScene(parcelId, sceneId, x, y)`. Each item in the parcel is *forked* into a fresh entity (clone of the catalog item's authored traits, with a fresh `ItemPosition` at the chosen point) so players can grab them via the existing `PickUpItem` flow. The catalog source isn't touched (catalog items are shared by reference; giving them a Position would put every wielder of the same Sword "on the floor"). Provenance carries through: each placement's `ItemDerivedFrom.templateId` points back to the catalog item the source was derived from, preserving the upstream-merge story end-to-end.
- **Award to character** → secondary flow for the "this loot is found and immediately handed to player X" case. Dispatches `AwardLoot(parcelId, holderId)` which appends entries to the holder's `TbCarries` in `loose:N` slots; the player can then equip via the existing inventory UI.

Cash is recorded in both events' payloads. v1 doesn't credit a "coin pile" trait — TB has no canonical "loose coins on the floor" entity yet — but the event is durable so a future iteration can mint a `TbCashPile` entity at the same `(sceneId, x, y)`.

Random tables are deliberately out for v1 — non-deterministic rolls in `apply` break replay. If wanted later, model as a separate `RollLoot` command that emits `LootRolled` with deterministic resolved ids, then `AwardLoot(rolledLootId)` stays pure.

### Existing kinds that don't need adventures involvement

- `setdesign` (already exists) — used for keying locations. An adventure note for a location is a normal page that opens with a `setdesign` block.
- Other future kinds (handouts, journal entries, random treasure tables) plug into the same registry.

## Materialization model

The parse system reacts to `PageBodySet` (already emitted by the notes plugin):

```
on PageBodySet(pageId, body):
  blocks      = scanFencedBlocks(body)                            // [{ kind, info, body, key }]
  prevIndex   = world.get(BLOCK_ENTITY_INDEX_ID, BlockEntityIndex)
  prevForPage = prevIndex.entries.filter(e => e.pageId === pageId)

  for each block in blocks:
    kindDef     = registry.lookup(block.kind)
    if !kindDef: continue                                         // unknown kind — leave as raw fence
    parsed      = kindDef.schema.parse(yaml.parse(block.body))    // throws → render as error chip
    projection  = kindDef.project(parsed, { world })

    existing = prevForPage.find(e => e.blockKey === block.key)
    if existing:
      dispatch UpsertBlockEntity {
        entityId: existing.entityId,
        traits: projection.traits,                                // re-write authored fields
      }
    else:
      entityId = world.allocateId()
      dispatch UpsertBlockEntity {
        entityId,
        spawn: true,
        traits: [...projection.spawnIfMissing, ...projection.traits],
      }
      // index update emitted as a separate event from the system

  for each prev not seen in blocks:
    dispatch TombstoneBlockEntity { entityId: prev.entityId, reason: "block-removed" }
```

`blockKey` is a stable identifier derived from the fence info string (`Greta the Smith` → `npc:greta-the-smith`). If the user renames the info string, that's an intentional rebinding — the old entity tombstones, a new one is allocated. (We could add a `# id: <stable>` line for users who want to rename freely; not v1.)

`UpsertBlockEntity` is a thin generic command — its `validate` is permissions-only, its `apply` either spawns at the supplied id or no-ops on existence (and emits `BlockEntityUpserted` with the trait diff). The mirror system applies trait writes the same way every other system does.

`TombstoneBlockEntity` writes a `Tombstoned{ reason, since }` trait on the entity — it doesn't despawn. Renderers that consume the entity (a running conflict, an inventory entry) keep working. The notes UI shows tombstoned-but-referenced entities in an "orphan" list under each adventure so the GM can promote, restore, or hard-delete them.

### Why eager (not lazy)

A lazy "parse on render" model has one fatal property: the entity's id changes every render unless we maintain an index — and the moment we maintain that index, we've reinvented eager parsing with worse semantics. Eager parsing makes the entity permanent, lets wiki-links resolve to a stable id, lets a running conflict hold the binding past the next note save, and matches how every other materialization in the world works (commands → events → entities).

### Why idempotent

A trait write that doesn't change the trait emits no event (substrate already deduplicates via deep equality on `world.set`). Re-saving a note that hasn't changed any block is a no-op end-to-end. This is what makes the bundle import / re-import flow tractable: the import service materializes notes, the parse system runs once per note, every block converges to its target state, and re-running the import the next day with no upstream changes is silent.

### Update timing — when does the entity actually change?

Two clocks, by design:

- **The editor's preview** (the rendered widget below or around the YAML) re-parses on every keystroke, debounced ~150ms — same cadence as the inline schema diagnostics. The author always sees their change instantly in their own view.
- **The world's entity** updates on **durable save only** (`PageBodySet`), not on `PageBodyDraft`. Per the notes plugin's two-tier save, that means up to ~30s lag during sustained typing and instant commit on `EndEdit`. Other players, running encounters, and character-sheet pages see the new value at the next checkpoint.

Keystroke-driven entity upserts would bloat the event log on every long edit session for no real benefit. For the rare case where the GM needs propagation faster than the autosave checkpoint (tweaking an NPC's stats mid-fight), two affordances cover it:

1. **Done** — committing the edit triggers an immediate `PageBodySet`; propagation is sub-second.
2. **Save now** — a per-block button in the rendered widget's action bar (alongside `Start encounter`, `Award loot`, etc.) forces a checkpoint without leaving edit mode. One extra event, immediate propagation, no flow disruption.

The author always knows: "what I see in this editor is current; what everyone else sees is current as of the last checkpoint." That maps to how every collaborative document tool works and matches the prose-edit experience already in place.

## Wiki-link resolution

Existing kinds (`character`, `note`, `item`, `scene`, `asset`) cover almost everything. Adventures registers one new kind via `defineLinkKind`:

```
[[encounter:ambush at the bywater bridge]]
```

`autocomplete` queries entities with `EncounterTemplate`. `display` returns the template's name. `activate` peeks the recipe (sides, read-aloud) and offers a `Start encounter` button identical to the one on the rendered fenced block. `target` returns the template entity.

For mob references inside encounter blocks, the grammar extension is one production:

```
participant := quantifier? wikiLink
quantifier  := number "×"
```

The encounter schema validates: `quantifier > 0` requires the link to resolve to an entity carrying `MonsterTemplate`; absent quantifier permits either. The parser surfaces a clear error if a `4× [[character:Skarra]]` slips through.

## Encounter instantiation

```ts
StartEncounter {
  templateId: EntityId
  sceneId?:   EntityId         // where the conflict takes place
}

  validate:
    - requester is GM
    - templateId carries EncounterTemplate
    - all referenced participants exist OR are creatable from a template

  apply:
    - allocate conflictId        = world.allocateId()
    - for each participant:
        if singular reference  → use the referenced entityId verbatim
        if Nx template ref     → for i in 1..N:
                                    copyId = world.allocateId()
                                    emit MonsterCopySpawned {
                                      copyId,
                                      templateId,
                                      ordinal: i,
                                    }
                                    use copyId
    - emit ConflictDeclared {
        conflictId,
        sceneId,
        type: template.type,
        sides: resolvedSides,                     // with copy ids inlined
        openingActions: template.openingActions,  // remain GM-only by trait visibility
      }
```

The mob-copy spawn writes:
- `Identity{ name: template.name + ` #${i}`, … }` — distinguishable in the conflict UI.
- All TB character traits projected from the template (full clone — same trait values).
- `ItemDerivedFrom{ pluginName: "@vtt/adventures", templateId: template.id, overrides: [] }`.
- `MonsterCopy{ templateId, ordinal }` — marker for "this is a per-fight instance, not a library entity."

A subsequent edit to the template's note (changing might, swapping a weapon) flows into **future** `StartEncounter` calls but **not** existing in-flight copies. That's the correct default (you don't want to silently buff or nerf a goblin mid-swing). A `RebaseMonsterCopies(templateId)` admin action can be added later if it ever matters; the field-override machinery already supports the diff.

When the conflict ends and the GM despawns the cleanup (or the next "Start encounter" replaces them), mob copies despawn. The named NPC entities they fought alongside persist exactly as they were — including any conditions taken or HP lost, since those write back to the canonical entity.

### Why hybrid binding

Direct binding alone fails the mob case (one entity can't hold four different damage states). Shadow-copy alone fails the recurring-villain case (mid-campaign edits to Skarra don't propagate; conditions pile up on a per-fight ghost that vanishes when the conflict ends). The split mirrors how published adventures actually read — the named villain is a *character* (referenced), the goblin block is a *stat block* (instantiated). The grammar makes the GM's intent explicit at the encounter authoring site.

## Bundle format

`.advt.zip` (binary zip; UTF-8 throughout):

```
manifest.json
notes/
  <pageTreePath>/<page-title>.md          # one file per NotePage; tree mirrors the in-app hierarchy
assets/
  <sha256>/<originalName>                 # content-addressed
```

`manifest.json`:

```json
{
  "name":          "The Bywater Trouble",
  "version":       "1.2.0",
  "summary":       "A four-session intro adventure for new TB groups.",
  "author":        "…",
  "gameSystem":    "@vtt/system-torchbearer",
  "requires":      ["@vtt/system-torchbearer@^2"],
  "notes":         [{ "path": "notes/locations/bywater-bridge.md", "title": "Bywater Bridge", "ordinal": 0 }, …],
  "assets":        [{ "sha256": "…", "name": "bywater-bridge.webp", "mime": "image/webp", "bytes": 412300 }, …],
  "exportedAt":    "2026-04-12T18:34:00Z"
}
```

Asset references inside note bodies use the existing wiki-link form (`![[asset:bywater-bridge.webp]]`). On import the service rewrites the body so each asset reference becomes `![[asset:<liveAssetId>]]` after the asset is uploaded into the world's store.

## Import flow

```
POST /api/worlds/<worldId>/adventures/import
  multipart: file=<…>.advt.zip

server:
  1. Unzip into a temp dir.
  2. Validate manifest.json against the schema; reject if gameSystem mismatch.
  3. For each asset: upload through the existing assets pipeline (sha256 dedup against
     the world's existing assets; reuse the live id if already present).
  4. For each note (in manifest order):
       allocate noteId
       allocate pageId per page in the file
       rewrite asset references in body text
       dispatch CreateNote / AddPage / SetPageBody
       set AdventureProvenance{ bundleName, bundleVersion, bundlePath, originalSha256 }
         on the new note
  5. PageBodyParseSystem runs on each SetPageBody; BlockParseSystem materializes block entities.
  6. Return summary { notesCreated, pagesCreated, entitiesCreated, assetsUploaded }.
```

The whole thing is a single durable batch — if validation fails midway, the partial events have already committed, but the GM gets a clear summary and can delete what landed. v1 tolerates partial imports; transactional import lands later if needed.

`AdventureProvenance` carries enough information that `UpdateDiffService` can later compare an uploaded v2 against the world's current state.

## Update flow

```
POST /api/worlds/<worldId>/adventures/check-update
  multipart: file=<…>.advt.zip   # newer version of an already-imported bundle

server:
  1. Validate, unzip.
  2. For each note in the new bundle:
       findCorrespondingNote(world, bundleName, originalPath)
       if not found       → "new" — GM can opt to import
       if found:
         compute diff(currentBody, newBody)
         classify:
           unchanged                       → ignored
           current matches old bundle      → "fast-forward" — auto-update on confirm
           current diverges from old       → "conflict" — present per-block diff
                                              with keep-mine / take-theirs / merge

  3. Return diff summary; GM picks per-note action in AdventureUpdateDialog.
  4. GM submits selections → server applies the chosen changes via SetPageBody.
  5. Re-parse cascades naturally; entity field-overrides ensure GM tweaks survive.
```

The "current matches old bundle" check needs the bundle's old version available — either we keep the previously-imported bundle on the server (cheap), or we rely on note `bodyRev` history (already capped at 20). v1 keeps the most recent imported bundle per `(world, bundleName)`.

For *entities* (items, NPCs the GM has tweaked locally), the field-override merge in `design/items.md` already covers what we need: GM-edited fields stick, untouched fields take upstream. The `ItemDerivedFrom`/equivalent trait on each block-materialized entity points back to `(bundleName, blockKey)` so the merge engine knows which template version to compare against.

## Export flow

The bundle must be self-contained — an importer on a different world has no access to the source world's entities, so every entity an exported note refers to must either (a) ship in the bundle, or (b) be guaranteed to exist on any compatible target (i.e., it's part of the system plugin's seed catalog). Export computes the **reference closure** before zipping.

```
POST /api/worlds/<worldId>/adventures/export
  { selectedNoteIds: [...], name, version, bundleId? }

server:
  1. Walk selectedNoteIds and their pages.
  2. Collect references:
       a. Asset references in note bodies (![[asset:…]]) and inside YAML strings.
       b. Wiki-link references in fenced-block bodies (and in prose, optional).
  3. Resolve closure:
       for each referenced entity (item, character, monster template, spell, …):
         lookup BlockEntityIndex provenance:
           in selected notes                                  → already included; skip
           in unselected note                                  → mark "auxiliary include candidate"
           no block provenance:
             system-seeded with no GM overrides                → "system reference"; safe to leave as
                                                                 wiki-link; target world's seed provides
             system-seeded with GM overrides                   → "overridden seed"; offer to capture
                                                                 the override (synthesize a block carrying
                                                                 just the overrides — uses the same
                                                                 ItemDerivedFrom merge engine on import)
             not in seed (manually created via UI)             → "uncoverable"; offer to capture
  4. Return preview { selected, auxiliary, uncoverable } to client.
  5. GM confirms which auxiliary notes to include and how to handle uncoverables:
        skip                → reference will resolve to nothing on import (broken chip)
        capture             → server synthesizes a fenced block from the entity's
                              traits and writes it into a `notes/captured/` folder
                              before zipping
        cancel              → abort export
  6. Server bundles the final note set + all referenced assets + a manifest with
     `bundleId` (allocated if not provided) and emits the .advt.zip stream.
```

The closure runs recursively — a goblin scout's `monster` block may reference `[[item:curved knife]]`; if curved knife is part of the system seed catalog, fine; if it's a GM-customized item, it joins the closure.

System-seeded entities (items, monsters, spells) are detected by the **same `ItemDerivedFrom`-style trait** the items doc already specifies: `originPlugin === "@vtt/system-torchbearer"` with empty `overrides`. Because the system plugin loads on *both* worlds (export source and import target are both running TB), the seeded entity is guaranteed to exist on the target — the wiki-link resolves naturally on import without any bundled definition.

This is what makes the system plugin's monster/spell/item catalogs load-bearing: the more creatures, items, and spells the system ships in its seed catalog, the smaller and more reusable adventure bundles become. An adventure built entirely from the TB starter catalogs ships zero `monster`/`item`/`spell` blocks — the bundle is just locations, encounters, and a few unique NPCs/villains. (Today the items catalog is real; the monster and spell catalogs aren't shipped yet — see "Substrate work" below.)

Asset references are walked through *both* prose markdown and YAML string values (a `character` block can carry `portrait: ![[asset:greta.webp]]`, etc.).

A "Publish adventure" button in the notes UI (visible to GM owners of the selected note tree) invokes this. The first version of "publish" is just downloading the zip; distribution / marketplace is out of scope for v1.

## Permissions

- **Authoring blocks** requires edit on the page (existing notes permission).
- **Materialized entities** inherit visibility from the page they were authored on by default. A `monster` block on a GM-only page produces a GM-only entity. The GM can override per-entity later.
- **`StartEncounter`** is GM-only.
- **Bundle import / export** is GM-only; mounted under the existing world admin routes.
- **Asset visibility** is whatever the asset upload pipeline assigns — usually scoped to the world; visibility on the asset entity flows through the existing assets resolver.

## Substrate work

Almost none. The plugin is built on existing primitives:

- `defineBlockKind` is a new registry function but lives entirely inside `@vtt/adventures` — same pattern as `defineLinkKind` in notes.
- `UpsertBlockEntity` and `TombstoneBlockEntity` are normal commands.
- The bundle import/export endpoints are new routes mounted by the plugin's server module, using existing world auth + the existing asset pipeline.
- One small notes-side hook needed: `PageBodyParseSystem` already parses the body for headings + links; it should also expose the *list of fenced blocks with their kind/info/body/range* to other systems. A small refactor — emit an internal `PageBlocksParsed` event AND write a derived `PageBlocks{ blocks: [{kind, key, range}] }` trait on the page so renderers, the orphan-list view, and the autocomplete provider can query without re-parsing.

### Required precondition work in `@vtt/system-torchbearer`

Adventures **requires** the lazy catalogs (monsters, NPCs, spells) to be promoted to the eager seed pattern items already uses. This is precondition work, not adjacent — wiki-links into encounter blocks won't function until the catalog entries are real entities.

The data and types already exist:

- `TB_MONSTER_TEMPLATES` (`packages/system-torchbearer/src/data/tb-monsters.generated.ts`)
- `TB_NPC_TEMPLATES` (`tb-npcs.generated.ts`)
- `TB_SPELL_TEMPLATES` (`tb-spells.generated.ts`)
- `TB_ARCANE_ITEM_TEMPLATES`, `TB_INVOCATIONS`, `TB_CONFLICT_RESOURCE_TEMPLATES` — same review needed for each

What changes:

1. Each catalog gets a `TbXCatalogIndex` sentinel entity (mirroring `TbItemCatalogIndex`).
2. The plugin's `seed()` step (today wired only to items in `manifest.ts:634`) is extended to walk every catalog: spawn each entry as a real entity with the appropriate marker (`MonsterTemplate`, etc.) and `ItemDerivedFrom{ originPlugin: "@vtt/system-torchbearer", templateId, overrides: [] }` provenance.
3. Pickers (`monsters-page.tsx`, `spawn-monster-palette.ts`, `npc-picker.tsx`, `npcs-page.tsx`, etc.) shift from `TB_*_TEMPLATES.find(...)` to `world.where(MonsterTemplate)` (or equivalent). Selection no longer "spawns from a template" — it either references the seeded entity directly (for things like wiki-links) or runs the existing copy-on-fork flow (for "spawn a customized instance").
4. **Migration of existing data.** Per CLAUDE.md backwards-compat rules, in-prod worlds may already contain entities spawned via the old lazy flow. The simplest forward-only treatment: leave them as-is (they become "manual" entities with no upstream-merge link), and let new spawns use the seeded templates. A heavier migration that re-keys old spawns to point at the new templates can land later if it matters; v1 is the lighter path.

This work is one focused refactor in `@vtt/system-torchbearer` and lands as **phase 0** of the adventures rollout (before phase 1).

## Phased delivery

1. **`@vtt/adventures` skeleton + `defineBlockKind` + schema-driven autocomplete** — registry; generic `UpsertBlockEntity` / `TombstoneBlockEntity` / `BlockParseSystem`; `BlockEntityIndex` sentinel; error-chip rendering for unknown kinds; the CodeMirror YAML extension that reads a kind's Zod schema and emits keys, enum values, wiki-link slots, dice slots, snippets, and inline validation. The autocomplete is part of the skeleton, not a later polish pass — every subsequent block kind onboards through it. Tests for the parse-diff loop and for autocomplete over a stub schema (covering each schema-node case in the table above).
2. **TB `item` block** — schema (with `wikiLink` brands for catalog cross-refs), projection, integration with the existing items pipeline (`CreateItem` + `EditItemField`). Round-trip test: author block → entity exists → wiki-link resolves → edit block → field change propagates → autocomplete shows TB slot enum.
3. **TB `character` and `monster` blocks** — full schemas, projection to TB character traits, `MonsterTemplate` marker. Tests for each field, the `spawnIfMissing` semantics, and the snippet expansion.
4. **`encounter` block + `StartEncounter`** — schema, the new `encounter` wiki-link kind, the hybrid-binding spawn logic, the GM-only opening-actions field. End-to-end test: start encounter → conflict spawned → mob copies created → edit template → re-start → new copies reflect changes, old copies don't. Autocomplete test: typing inside `sides.enemies` lists templates first.
5. **`loot` block + `AwardLoot` / drop-in-scene** — schema, projection to `LootParcel`, the two action handlers wired through existing `PickUpItem` / `DropItem` flows. Test: award to character → items in `TbCarries`, cash in `TbResources`.
6. **Bundle import/export with reference closure** — `.advt.zip` format, `BundleImportService`, `BundleExportService`, the closure resolver (system-seeded vs auxiliary-include vs uncoverable classification), the per-entity capture-block synthesizer, `AdventureProvenance` trait, the import + export dialogs. Smokes round-trip a bundle through the wire including a system-seeded reference, a GM-overridden seed, and a captured manual entity.
7. **Update / merge UI** — `UpdateDiffService`, the diff dialog, the per-block merge (block as the unit). Tests for the three diff classes (new / fast-forward / conflict) at the block level.

## Anti-patterns to avoid

- A note-format that isn't markdown. The whole value of authoring-as-notes is that the canonical representation is plain text editable everywhere; structured editors that hide YAML behind a form are a rabbit hole.
- A separate "adventure document" that lives outside the notes plugin. There must be exactly one source of truth — the note text.
- Materializing entities on render. The id must be stable across renders, sessions, and conflicts that hold a binding.
- Auto-deleting an entity when its block disappears. The entity may be referenced from a running conflict, an inventory, a spell, a journal entry — tombstone, never delete.
- Snapshotting NPC stats into encounter participant entries at instantiate time. Named NPCs are bound by id; the conflict reads through to the live entity. Mob copies are explicit forks, not snapshots — once spawned, they're their own entities and `world.get(copyId, …)` is the source of truth for *that copy*.
- A `monster` entity that's a different kind from a `character`. Both are `Character` entities with TB traits; the difference is one marker trait (`MonsterTemplate`) and the schema's required fields. Same wiki-link kind, same renderers, same edit flow.
- Inventing new wiki-link kinds for things that already have one. `[[npc:Greta]]` is wrong — use `[[character:Greta]]`. New kinds (`encounter`) appear only when there's no existing kind.
- A bundle format that hides asset bytes outside the zip (URL refs to a CDN). The bundle must be a single self-contained file the GM can email a friend.
- A block kind that ships without a complete schema. The schema is the source for parsing, validation, *and* autocomplete; an incomplete schema produces an unusable block kind no matter how good the renderer is. Mark optional fields `.optional()`, give every enum a real `.describe()`, brand wiki-link slots with the right kind — that's the contract.
- Hand-written autocomplete logic per block kind. The point of `defineBlockKind` is that 95% of completion falls out of the schema; reach for the `complete()` escape hatch only when the schema genuinely can't express the suggestion source (runtime-registered skills, computed-from-world enums).

## Implementation status (v1.5 — fully end-to-end usable)

Everything landed below has tests + green `pnpm test` (1907 passing) + clean `pnpm -r typecheck`.

**Substrate / catalog (Phase 0):**
- TB monster / NPC catalog seed migration. `MonsterTemplate` / `NpcTemplate` markers, `MonsterCatalogIndex` / `NpcCatalogIndex` sentinels, `MonsterCopy` for per-encounter spawns, `tbSeed` (renamed from `tbItemsSeed`) wires every catalog.
- Backwards-compat preserved: existing GM-spawned monsters keep working as "manual" entities.

**Adventures plugin core (Phases 1–5):**
- `@vtt/adventures` with `defineBlockKind`, `BlockKindsSlot`, `BlockEntityIndex`, `Tombstoned`, `BlockParseSystem`, `PageBlocksMirrorSystem`.
- **Deterministic block-entity ids** (`block:<pageId>:<blockKey>`) — works across server + every client without `world.allocateId` coordination.
- Schema-driven `computeBlockCompletions` covers info-string / key / enum / wiki-link brand / dice brand / kind escape hatch.
- Five block kinds (`item`, `character`, `monster`, `encounter`, `loot`); `spawnIfMissing` preserves runtime state across re-saves for both characters AND monsters.
- `StartEncounter` with hybrid binding (singular = bind by id, quantified = spawn N copies from template); auto-emits `ConflictDeclared` to feed the existing TB conflict subsystem (with party auto-resolution from `Team{kind:"party"}` characters and conflict-type alias mapping).
- `AwardLoot` and `PlaceLootInScene` — the latter forks each catalog item into a fresh entity with `ItemPosition`, players grab via existing `PickUpItem`.
- **Stable `# id: <stable>` annotation** — overrides info-string slugification so renames don't rebind.

**End-to-end UI integration (Tier 1):**
- `MarkdownPostRenderSlot` + `EditorCompletionSourcesSlot` added to `@vtt/notes` as generic plugin extension points.
- `mountBlockWidgets` (adventures fill) walks `<pre><code class="language-X">` after each markdown render, replaces with a Solid widget showing kind + display name + permission-gated action buttons. `dispatch` + `session` plumbed through `MarkdownView` props → post-render context → action callback.
- `yamlBlockCompletionFactory` (adventures fill) wires `computeBlockCompletions` into the notes editor's CodeMirror autocomplete, with YAML-path detection for cursor-aware suggestions.
- Loot widget gets a `Place on ground` GM-only action button that finds the active scene and dispatches.

**Bundle distribution (Tier 2):**
- `bundleToZip` / `zipToBundle` using `fflate` — real `.advt.zip` packaging with `manifest.json` + `notes/<bundlePath>` + `assets/<sha>/<name>` layout.
- HTTP routes (`@vtt/adventures/routes` entry — split from server/index to keep node-only types out of cross-package compile chains): `POST /adventures/{import, export, check-update}` with GM gating and 50MB body cap. **Mounted in `packages/server/src/main.ts`'s `httpHandler` via `maybeHandleAdventureRoute`** — the routes are live on the running server.
- Asset bundling: `buildBundle.loadAssetBytes` + `importBundle.saveAssetBytes` hooks walk `[[asset:…]]` refs, transport bytes content-addressed by sha256, rewrite refs from old→new ids on import (via `descriptor.sourceEntityId`). The HTTP routes accept matching `loadAssetBytes` / `saveAssetBytes` props and main.ts wires them to the new `loadAssetBytesFromDisk` / `saveAssetFromBytes` helpers extracted from `@vtt/assets/server` — **so embedded image bytes round-trip end-to-end through the actual `.advt.zip` HTTP path**, not just through the pure functions.

**Update / merge UI + advanced flows (Tier 3):**
- `AdventureUpdateDialog` Solid component renders per-note diff with per-row action picker + sensible defaults (`fast-forward → take-theirs`, `conflict → keep-mine`, `new → import-new`).
- **Per-block merge** via `{ action: "merge", blockChoices: { blockKey: "take-theirs" | "keep-mine" } }` — `mergeBlockBodies` walks the existing markdown body and replaces or keeps each fenced block per the GM's choices.
- **Capture-block synthesis** for export uncoverables: `buildBundle({ captureUncoverables: true, kindIndex })` runs `computeReferenceClosure`, synthesizes fenced `character` / `item` blocks for manually-created entities (no block provenance), drops them into `notes/captured.md` so the import target can resolve the references.

**Still deferred (truly out of scope):**
- **Random loot tables** — explicitly deferred per design (would break `apply` determinism).
- **Per-block diff UI in the dialog** — the data shape supports it; v1 dialog only exposes note-level resolution. The merge action is wired and tested at the service layer.
