# Torchbearer arcane spellcasting

Spells, spell books, scrolls, and the memory palace as first-class
entities sharing the items pattern. Lands as a refit of the existing
`Spells` trait and `tab-arcane.tsx`. This document is the locked
architectural plan; consult it before touching any of the moving parts.

## Locked decisions

1. **Spells are real entities, shared by reference** — exactly like
   items. The catalog (`TB_SPELL_TEMPLATES`) is *seed input*, not a
   parallel runtime form. At world boot, the plugin spawns one entity
   per template. Two characters who know "Wayfinder's Friend" both
   have library/spell-book entries pointing at the same `spellId`.
2. **Memory Palace and Library are per-character traits** on the
   Character entity (`TbMemoryPalace`, `TbLibrary`). Not items.
3. **Spell Books and Scrolls are real items in inventory** with TB
   traits `TbSpellBook` and `TbScroll`. They flow through the existing
   `TbCarries` plumbing — pickup, drop, equip, transfer, steal — for
   free.
4. **Catalog spells carry "data needed to play" only** — name, circle,
   school, casting kind/Ob/time/duration, materials/focus item refs,
   scribe Ob, learn Ob, page reference. The full effect prose stays
   in the rulebook; sheet renders a `<BookCitation>` chip that opens
   the PDF, identical to the monster citation model.
5. **Customize = copy-on-write.** `CustomizeSpell(spellId)` allocates
   a new entity, clones every trait, and rewires the player's
   library/book/palace entries to the new id (same pattern as
   `CustomizeItem`).
6. **Homebrew spells** get a `TbSpellHomebrewProse { effect, casting }`
   trait so a GM can write the prose inline. Canon spells leave it
   absent and rely entirely on the page reference.
7. **Catalog spans DH (circles 1–3) and LMM (circles 4–5).** Each
   spell entity's `pageRef.canonicalId` selects which canonical book.
8. **Post-roll consequences are roll-card buttons, never auto.**
   Casting opens an Arcanist roll. The chat card carries the commit
   button (`[Consume from palace]` / `[Burn folio]` / `[Burn scroll]`).
   Same pattern as `AdvancementLogged` / `TraitUsageLogged`. A marker
   trait `SpellCastConsumed` on the Roll entity gates the button so
   it can only be clicked once.
9. **Casting from palace, spell book, and scroll all flow through the
   same `CastSpell` command** parameterised by `source`. The Arcanist
   roll is identical (RAW p.93, p.95) — only the post-roll button text
   and the consume command differ.
10. **Fuzzy search picker** for "add spell from catalog" / "memorize"
    / "learn from book" — never long dropdowns. Mirrors the existing
    `bestiary-picker.tsx` subsequence-fuzzy approach.

## Plugin scope

All in `@vtt/system-torchbearer`. The catalog and traits are
TB-namespaced — there's no `@vtt/spells` generic plugin (yet). If a
second magical system (Burning Wheel? D&D?) ever needs spells, the
shape generalises naturally; for now, optimise for one game.

## Trait surface

### On the catalog spell entity

```ts
SpellIdentity {
  name: string,
  circle: 1 | 2 | 3 | 4 | 5,
  school: string,                 // "Necromancy", "Divination", …
  pageRef: { canonicalId, page } | null,
}

TbSpellCasting {
  kind: "fixed" | "factors" | "versus",
  fixedOb: number | null,         // when kind === "fixed"
  versusSkill: string | null,     // when kind === "versus" (skill/ability id)
  castingTime: "free" | "action" | "one-turn" | "multi-turn",
  duration: string,               // free text, e.g. "Until next camp"
  materials: string,              // free text, "" when none
  focus: string,                  // free text, "" when none
}

TbSpellLearning {
  scribeOb: number,               // Scholar Ob
  learnOb: number,                // Lore Master Ob
}

TbSpellHomebrewProse {            // optional, only on homebrew spells
  effect: string,
  casting: string,
}

SpellDerivedFrom {                // catalog provenance, parallels ItemDerivedFrom
  templateId: string,
  pluginName: string,
  overrides: string[],
  deprecated?: true,
}
```

### Per-character traits (replace the current `Spells` trait)

```ts
TbLibrary {
  spellIds: EntityId[],
  // RAW edge: loner libraries live at a hidden location on the
  // campaign map (DH p.92). Free text for the location until scenes
  // grow real markers.
  location: "home" | "loner",
  lonerLocation: string,          // free text when location === "loner"
}

TbMemoryPalace {
  capacity: number,               // total slots; class/level driven
  memorized: [{
    spellId: EntityId,
    slotsConsumed: number,        // = spell.circle at memorize time
    cast: boolean,                // already cast this memorize cycle
  }]
}
```

### On a spell-book item entity

```ts
TbSpellBook {
  folios: number,                 // canon = 5
  contents: EntityId[],           // spellIds; sum of circles ≤ folios
}
```

### On a scroll item entity

```ts
TbScroll {
  spellId: EntityId | null,       // null = blank scroll
  consumed: boolean,
}
```

### Sentinel index

```ts
SpellCatalogIndex {
  pluginName: string,
  entries: Record<string, EntityId>,   // templateId → entity id
}
```

## Commands

All TB-namespaced; owner-or-GM gated by `requireWrite(characterId)`
(or the holder of the spell book / scroll, where applicable). Pattern
matches existing items commands.

| Command | Notes |
|---|---|
| `LearnSpellFromSource(spellId, source)` | Routes to a Lore Master roll request (Ob = `learnOb`); on the `[Add to library/book]` button on the resolved card, dispatches `AddSpellToLibrary` or `AddSpellToBook`. |
| `AddSpellToLibrary(characterId, spellId)` | Direct add, no roll. GM-only convenience for chargen and homebrew. |
| `AddSpellToBook(bookId, spellId)` | Validator: spell.circle ≤ free folios. |
| `RemoveSpellFromLibrary(characterId, spellId)` | Cleanup. |
| `RemoveSpellFromBook(bookId, spellId)` | Cleanup; recovers folios. |
| `ScribeSpellToBook(characterId, spellId, bookId)` | RAW p.92: personal business in town, no test, just folio math. Validator: spell in player's library. |
| `RequestScribeScroll(characterId, spellId)` | Opens a Scholar roll request (Ob = `scribeOb`); the resolved card's button runs `BurnPalaceForScroll` + `SpawnScroll`. |
| `MemorizeSpells(characterId, picks)` | Opens a Lore Master roll request (Ob = sum of circles + already-memorized count). The card's button runs `FillMemoryPalace`. |
| `FillMemoryPalace(rollId, picks)` | Post-roll button commit. Marks roll `MemorizationCommitted`. |
| `CastSpell(characterId, spellId, source)` | `source: { kind: "palace" } \| { kind: "spellbook"; bookId } \| { kind: "scroll"; scrollId }`. Opens an Arcanist roll request whose meta carries the spell context; the chat row's post-roll buttons consume from the right place. |
| `ConsumePalaceSpell(rollId)` | Post-roll commit. Sets palace entry `cast: true`. |
| `BurnSpellbookSpell(rollId)` | Post-roll commit. Removes spell from book.contents (recovers folios). |
| `BurnScroll(rollId)` | Post-roll commit. Despawns the scroll item entity. |
| `EmptyMemoryPalaceRoll(characterId)` | Opens a Will roll request (Ob = sum of memorized circles). Free, no turn cost (DH p.91). |
| `CommitMemoryPalaceDischarge(rollId)` | Post-roll commit. Empties palace. |
| `IncreaseMemoryPalaceCapacity(characterId, by)` | GM-only. Triggered by class level benefits. |
| `CustomizeSpell(spellId)` | Fork-on-edit. Same pattern as `CustomizeItem`. |
| `EditSpellField(spellId, path, value)` | GM edit on a forked spell; tracks `SpellDerivedFrom.overrides`. |
| `CreateBlankSpell(name, circle)` | Homebrew. Spawns a fresh spell entity with empty stat block + `TbSpellHomebrewProse`. |

A pragmatic v1 simplification: the Lore Master / Scholar roll
integration for **learn / scribe / memorize / discharge** can land in a
follow-up. The first cut implements the **direct add / direct
memorize / direct fill / direct discharge** commands and lights up the
roll-routed variants when the rolling subsystem affordances are
audited. **`CastSpell` ships fully roll-routed in v1** since that's the
core gameplay surface.

## Catalog seeding

```
packages/system-torchbearer/src/data/
  spell-catalog-types.ts          ← interface TbSpellTemplate
  tb-spells.generated.ts          ← TB_SPELL_TEMPLATES (hand-curated for v1)
  seed.ts                         ← extends to seed spells alongside items
```

`seed.ts` runs `runCatalogMerge` against `TB_SPELL_TEMPLATES` exactly
like items, populating `SpellCatalogIndex` and emitting one entity per
template. Per-template trait bag emits `SpellIdentity` +
`TbSpellCasting` + `TbSpellLearning` + `SpellDerivedFrom`.

For v1, hand-curate ~10 spells across both books and all three casting
kinds:

- **Aetherial Premonition** — DH p.97 — circle 1, Divination, factors, focus: silver bell
- **Wayfinder's Friend** — DH p.184 — circle 1, Divination, fixed Ob 2
- **Wyrd Lights** — DH p.196 — circle 1, Conjuration, fixed Ob 2
- **Supernal Vision** — DH p.195 — circle 1, Divination, fixed Ob 2
- **Somnific Trance** — DH p.197 — circle 2, Enchantment, factors
- **Lightning Step** — DH p.205 — circle 2, Transmutation, fixed Ob 3
- **Sign of Abrogation** — DH p.205 — circle 3, Abjuration, fixed (1+target circle)
- **Wizard's Aegis** — DH p.198 — circle 3, Abjuration, fixed Ob 3
- **Wizard's Bane** — DH p.199 — circle 3, Necromancy, versus
- **Banishment** — LMM (circle 4 placeholder, fixed) — for at-least-one LMM entry

A future generator script walks both `e420` and `e422` corpora,
extracting full stat blocks via the chunk text. Out of scope for v1.

## UI

```
packages/system-torchbearer/src/client/
  tab-arcane.tsx                  ← redesigned; existing file replaced
  spell-picker.tsx                ← fuzzy single/multi-select picker
  memory-palace-strip.tsx         ← slot strip visualization
  memorize-dialog.tsx             ← multi-pick + Lore Master Ob preview
  spell-card.tsx                  ← shared spell row (name/circle/school/citation/actions)
  spell-cast-actions.tsx          ← post-roll button section
```

Each "where is the spell" location renders the same `<SpellCard>`,
parameterised by which action buttons make sense:

- **Palace (memorized)** → `[Cast from palace]` (and `[Scribe scroll]` if in town)
- **Spell book contents** → `[Cast from book]` `[Memorize]` `[Scribe scroll]` `[Copy → library]`
- **Scroll** → `[Cast from scroll]` `[Copy → library]` `[Copy → spell book ▾]`
- **Library** → `[Memorize via book]` `[Copy → spell book ▾]`

The Memorize dialog is a typeahead over spell-book contents with a
running slot total and live Lore Master Ob preview.

## Inventory integration

Two new item kinds in `TbItemTemplate.kind`:

```ts
| { type: "spellbook"; folios: number }
| { type: "scroll"; spellTemplateId: string | null }
```

Catalog seed: a couple of empty spell book templates ("Empty Spell
Book", "Reinforced Spell Book") and one scroll-of-X per starting-cohort
spell, keyed `tb/scroll/<spellTemplateIdSuffix>`. The seed function
gets two new `kind` branches in `templateToTraitBag` that emit
`TbSpellBook` / `TbScroll` traits alongside the standard
`ItemIdentity` + `TbItemSlotOptions`.

A `tb/scroll/*` item resolves its `spellId` lazily at seed time by
walking `SpellCatalogIndex` after spells are seeded — so the seed
order is **spells first, items second**. That's a one-line ordering
change in `tbItemsSeed`.

The Inventory tab's per-item detail-section slot gets two new fills:

- **`TbSpellBookSection`** — list of contents with a `[Cast from book]`
  button per row, plus folio usage strip.
- **`TbScrollSection`** — single-spell summary with a `[Cast from
  scroll]` button.

## Casting flow (the load-bearing path)

1. Player clicks `[Cast]` on a spell row in the Arcane tab (or
   the inventory detail section). Client dispatches
   `CastSpell(spellId, source)`.
2. `CastSpell.apply` allocates a roll id and emits a
   `SpellCastRequested` event carrying the meta (spellId, source,
   characterId, materials/focus item refs).
3. Server-side `SpellCastRequestSystem` reads the event and fans out
   the same `RequestRoll` payload an Arcanist skill roll would, with
   `meta.spellCast = { spellId, source, materialsItemId?, focusItemId? }`
   merged into the existing `TbRollMeta`. Pre-roll obstacle resolves
   from `TbSpellCasting`: fixed ⇒ `fixedOb`; factors ⇒ leave blank for
   the GM/player; versus ⇒ open the versus pairing UI.
4. `TbPendingRollContributor` reads the meta and surfaces material/
   focus toggles in the pending-roll panel as `tb-spell-material` /
   `tb-spell-focus` contributions (+1D each, materials marked
   `consume-on-success`).
5. Player rolls. `RollResolved` lands.
6. `TbRollActionsFill` sees `meta.spellCast` and renders the right
   commit button (`[Consume from palace]` / `[Burn folio]` / `[Burn
   scroll]`). The button dispatches `ConsumePalaceSpell` /
   `BurnSpellbookSpell` / `BurnScroll`. Click is gated by
   `SpellCastConsumed` marker on the Roll entity.
7. Materials, if used, consume via the same row's `[Spend materials]`
   button (or auto-paired with the consume button — to be decided
   in implementation).

## Anti-patterns

- Copying spell prose into the catalog. Page reference only.
- Auto-applying a palace consume on `RollResolved`. Always a button.
- Casting from a spell book / scroll without going through the same
  Arcanist roll request. (RAW p.95: "the same rolls and casting time
  as casting from memory".)
- Storing a spell's circle on a per-character entry as a snapshot.
  The character's `TbMemoryPalace.memorized[*].slotsConsumed` is the
  one acceptable snapshot — it's frozen at memorize time so a mid-
  campaign rules-tweak to a spell's circle doesn't retroactively rewrite
  what's in the palace.
- Long dropdown spell pickers. Always a fuzzy typeahead.
- Mutating the catalog spell entity in place when the GM wants to
  tweak one — fork via `CustomizeSpell`.

## v1 scope

Done:
- All traits, events, commands listed above.
- Hand-curated catalog of 10 spells.
- Two new item kinds (spellbook, scroll) + catalog seed.
- Tab-arcane UI: memory palace strip, books section, scrolls section,
  library section, fuzzy picker, memorize dialog.
- Cast flow integrated with TB rolling subsystem; post-roll buttons
  via `TbRollActionsFill`.
- Inventory item-detail-section fills for spell books and scrolls.
- Tests: given/when/then for commands, jsdom for tab-arcane, one wire
  smoke for the cast round-trip.

Deferred to v2:
- Auto-generator that walks `e420`/`e422` and produces the full
  catalog of ~80 spells.
- Lore Master roll integration for memorize / learn / discharge
  (initial implementation skips the roll and runs the state
  transition directly; a follow-up wires roll-routed variants).
- Loner library scene markers.
- Spell prep templates (rituals, multi-caster).
