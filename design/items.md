# Items + inventory

A two-layer plugin design for "things characters carry," landing first
for Torchbearer 2e but factored so other game systems can reuse the
generic half. This document is the locked architectural plan; consult
it before touching any of the moving parts.

## Locked decisions

1. **Items are real entities, no exceptions.** Catalog data
   (`TB_ITEM_TEMPLATES` in TS/Zod) is _seed input_, not a parallel
   runtime form. At world boot, the plugin spawns one entity per
   template. After that, the world has only entities; the catalog
   table is consulted only for re-seed and merge.
2. **Items are shared by reference.** Two characters wielding "Sword"
   both have `TbCarries` entries pointing at the same `swordEntityId`.
   `useTrait(swordId, ItemIdentity)` returns the same identity for
   everyone. There is no template/entity divergence in the read path.
3. **Customize = copy-on-write.** `CustomizeItem(holderId, entryIndex)`
   allocates a new entity, clones every trait from the source, and
   swaps the holder's entry to the new id. The new entity is just
   another entity — same code paths, no special-case.
4. **Per-character state lives on the carrying entity's entry**
   (`damaged` / `dropped` / `lit` / `turnsRemaining` / `quantity` /
   `lost`). Item entities themselves are stateless w.r.t. who holds
   them. Only intrinsic facts (name, slot options, weapon stats) live
   on the entity.
5. **Templated items track origin and merge upstream changes** via an
   `ItemDerivedFrom` trait. The GM's local edits win; everything else
   picks up template updates on re-seed.
6. **Containers auto-fork on catalog-equip.** Containers carry contents
   on their own `TbCarries` trait, so they can't be shared across
   characters. The first time a character equips a container catalog
   entity, the equip command transparently runs the fork. A Sword can
   be referenced by five characters; a Backpack can't — that asymmetry
   is enforced at command-validation time, not encoded in two
   different entity kinds. Picking up an already-forked container off
   the floor does _not_ fork; it transfers as-is, contents intact.

## Plugin split

Two plugins:

```
@vtt/items                       (generic, slot-vocab-agnostic)
  - ItemIdentity, ItemEconomics, ItemDerivedFrom traits
  - CreateItem / CustomizeItem / EditItemField / DestroyItem commands
  - The merge engine that re-seed runs against an entity
  - Seed-hook integration with the substrate's plugin lifecycle

@vtt/system-torchbearer/items    (TB-specific layer; lives inside the system plugin)
  - TbItemSlotOptions, TbWeapon, TbArmor, TbSupply, TbContainer,
    TbSkillBonuses, TbItemSpecialRules traits
  - TbBodySlot enum; TbCarries trait on holder entities
  - EquipItem / MoveItem / SetEntryState / DropItem / PickUpItem
  - Placement validator with capacity math + auto-fork-on-catalog-equip
  - TB_ITEM_TEMPLATES catalog (TS/Zod, generated from Foundry YAMLs)
  - seed() implementation
```

## Trait surface

### Generic (`@vtt/items`)

```ts
ItemIdentity      { name, description, img }
ItemEconomics     { cost?, value?: { dice, negotiated } }
ItemDerivedFrom   { templateId: string;
                    pluginName: string;
                    overrides: string[];      // field paths the GM has locally edited
                    deprecated?: true;        // template removed upstream
                  }
```

### TB-specific (`@vtt/system-torchbearer/items`)

```ts
TbItemSlotOptions   { options: Partial<Record<TbBodySlot, number>> }
TbWeapon            { wield, conflictBonuses }
TbArmor             { armorType, absorbs }
TbSupply            { supplyType, turnsRemaining?, lit?, nameSingular }
TbContainer         { containerType, containerSlots }
TbSkillBonuses      { entries: { skill, value, condition? }[] }
TbItemSpecialRules  { text }

TbBodySlot = "head" | "neck" | "torso" | "belt" | "feet"
           | "handR" | "handL" | "pocket"
           // composed: container:<itemId> for slots inside a container

TbCarries (on a holder — character, scene-cell, or container item) {
  entries: Array<{
    slot: TbBodySlot | `container:${EntityId}`;
    slotIndex: number;
    slotsConsumed: number;
    itemId: EntityId;
    quantity: number;
    state?: { damaged?: boolean; dropped?: boolean; lit?: boolean;
              turnsRemaining?: number; lost?: boolean };
  }>;
}
```

`TbCarries` lives on **any holder entity** — characters, scene cells
(if/when we model scene-floor as an entity), and container items
themselves (so the contents of a Backpack live on the Backpack).

## Command surface

### Generic

```
CreateItem(traits)                    → ItemCreated
CustomizeItem(holderId, entryIndex)   → ItemForked
EditItemField(itemId, path, value)    → ItemFieldChanged
                                        (also adds path to ItemDerivedFrom.overrides)
DestroyItem(itemId)                   → ItemDestroyed
```

### TB

```
EquipItem(holderId, itemId, slot, slotIndex)
  → ItemForked? + ItemEquipped
    apply:
      - if itemId is a catalog template entity AND has TbContainer →
          allocate new id, emit ItemForked(srcId → newId), use newId
      - emit ItemEquipped(holderId, finalItemId, slot, slotIndex)

MoveItem(holderId, fromIndex, toSlot, toIndex)
  → ItemMoved

SetEntryState(holderId, entryIndex, partial)
  → EntryStateChanged

DropItem(holderId, entryIndex, where: { sceneId, x, y })
  → ItemDropped
    apply:
      - remove entry from holder.TbCarries
      - set Position on itemId

PickUpItem(holderId, itemId, slot, slotIndex)
  → ItemPickedUp
    apply:
      - clear Position
      - add entry to holder.TbCarries (capacity-validated)
      - NOTE: no auto-fork. Forking only happens on catalog-equip.
```

### TB capacity rules (TB2 p.83–84)

- head: 1 worn slot
- neck: 1 worn slot
- handR / handL: 1 worn + 1 carried each (modeled as separate slots)
- torso: 3 slots
- belt: 3 slots
- feet: 1 slot
- pocket: descriptive text for now

Containers expand capacity:

- Backpack/satchel on torso adds an internal slot vocabulary
  (`container:<id>`) with `containerSlots` capacity.
- Sacks held in hand work the same way; the item entity is the
  capacity owner.

## Catalog → entity seeding

- **Catalog data** ships as `TB_ITEM_TEMPLATES: TbItemTemplate[]` in
  `system-torchbearer/src/data/tb-items.ts`. Hand-curated TS,
  generated initially by a one-shot `tools/import-tb-items` script
  from the Foundry YAML and then evolved on our side. Icons come from
  the existing free-icon set in the repo.

- **Seeding** happens on world boot through a new
  `seed: ({ world, registry }) => void` hook on `definePlugin` (small
  substrate addition; runs once per world, after cold-boot replay,
  before any client is allowed to attach). Idempotent on re-boot
  because the catalog index makes existence detectable.

- A **`TbItemCatalogIndex` sentinel entity** holds
  `Record<templateId, entityId>` so re-seed can find existing entities.
  The substrate doesn't need to know about it; it's a regular entity
  with a regular trait.

- **Re-seed flow** every boot:
  - For each `TB_ITEM_TEMPLATES[i]`:
    - Not in index → spawn entity, register in index.
    - In index → run merge (next section).
  - For each entry in the index whose templateId is gone from
    `TB_ITEM_TEMPLATES` → mark `ItemDerivedFrom.deprecated = true`.
    Never delete (someone may be holding it).

- **Forked items** (made via `CustomizeItem`) carry an
  `ItemDerivedFrom` trait but are skipped by re-seed — they're owned
  by the world, not the plugin. Distinguish via the absence of an
  index entry pointing at them.

## Field-override merge

On re-seed of an existing templated entity, for each field path the
template covers:

- If `path ∈ ItemDerivedFrom.overrides` → keep entity's value.
- Else → write the template's current value.

The GM "locks" a field by editing it (`EditItemField` adds the path to
`overrides`). There's also explicit `RevertItemField(itemId, path)` for
"drop my override, take the template again" and
`LockItemField(itemId, path)` for "lock this even though I haven't
changed it yet." That gives the GM full control without history.

This is the same model as Notion-style template-block overrides: local
edits stick, upstream changes flow into untouched fields.

Schema-shape changes (adding/removing fields on the trait) still need
a manual migration; that's normal.

## Drop / pickup with contents

Containers' contents live on the container entity itself, so dropping
a container with stuff in it Just Works:

```
Character A.TbCarries: [{ slot:"torso", slotIndex:0, itemId:bk-12 }]
bk-12.TbCarries:       [{ slot:"container:bk-12", slotIndex:0, itemId:ar-7 }]
ar-7: ItemIdentity{name:"Arrows"}, TbSupply{...}

DropItem(A, 0, sceneAt(10,4)):
  Character A.TbCarries: []
  bk-12: + Position{ sceneId, x:10, y:4 }
  bk-12.TbCarries: unchanged          ← contents stay with the container
  ar-7: unchanged                      ← no Position; reachable only via bk-12

PickUpItem(B, bk-12, "torso", 1):
  Character B.TbCarries: [{ slot:"torso", slotIndex:1, itemId:bk-12 }]
  bk-12: -Position
  bk-12.TbCarries: unchanged
```

Scene-floor query is `world.where(Position, p => p.sceneId === scene.id)`.
"Open container" reads the container's `TbCarries` (same view component
as character inventory, just a different rooted id). Sub-containers are
free — pouch inside backpack on floor: each level has its own
`TbCarries`.

The Foundry-data fields `dropped` / `lost` (per-character "in a fight,
fell from your grip" or "container is gone") are different from
physical-drop. Those live as flags on the holder's `TbCarries` entry
(via `SetEntryState`), not as Position.

## Substrate work

Small, well-scoped additions:

1. **`seed` hook on `definePlugin`** — invoked once per world, after
   cold-boot replay, before any connection is attached. Runs each
   plugin's spawning + merge. Synchronous; uses `world.spawn` and
   trait setters directly (NOT through the command pipeline, since
   the world is not yet "live" and we don't want to write events to
   the log for catalog seeds — they're deterministic and would just
   bloat the event tail).

2. _(optional)_ A `world.findOrSpawn(probe, traits)` helper if it
   tightens the seeding code. Nice-to-have, not required.

## Phased delivery

1. **`@vtt/items` skeleton** — generic traits, generic commands, merge
   engine, substrate `seed` hook. Tests + smoke for the customize
   round-trip.
2. **TB items** — TB subtype traits, body-slot enum, `TbCarries`,
   placement validator with capacity math, `EquipItem`/`MoveItem`/
   `SetEntryState`/`DropItem`/`PickUpItem` (with auto-fork). Tests.
3. **Catalog import + seeding** — `tools/import-tb-items` script,
   generated `tb-items.ts`, `seed` implementation on the TB plugin,
   idempotency tests, merge tests.
4. **Inventory tab rewrite** — drop the obsolete `Inventory` trait,
   wire `TbCarries` view with picker for catalog browse, drag-or-button
   move, customize button, edit/revert per field. Tests + manual
   browser pass.
5. **Roll-modifier provider** — surface `TbSkillBonuses` and
   `TbWeapon.conflictBonuses` from carried items into
   `TbRollModifierProvidersSlot`. Tests.

## Anti-patterns to avoid

- An item entity that knows who holds it. (LocatedIn was rejected; use
  the holder's `TbCarries` entry.)
- A "template ref vs entity ref" union in inventory entries. Items are
  always real entities.
- Per-instance state on the item entity for shared catalog items.
  (Damage / dropped / lit / quantity stay on the holder's entry.)
- Mutating an item entity directly from a system reading
  `world.set(...)` on every keystroke. Always go through
  `EditItemField` so override tracking stays correct.
- A catalog of _separate item types_ (`TbWeapon` extends nothing,
  etc.). Item subtypes are traits on a generic item entity. A weapon
  is "an entity with `ItemIdentity` and `TbWeapon`."
