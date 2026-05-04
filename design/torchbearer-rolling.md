# Torchbearer rolling subsystem

This is the design that backs `@vtt/system-torchbearer`'s six rollables
(Will, Health, Nature, Resources, Circles, Skill) and the chat / panel
flow around them. Goal: every TB roll can be inspected, tested, and
extended end-to-end, with auto-derived modifiers from the character
sheet and pluggable per-roll modifiers from anywhere in the world.

Rule references are to the printed page, per the `rules-lookup` skill
convention. `DH` = Dungeoneer's Handbook.

## What the rules say

DH p.20–24 ("Dice and Terms") and p.250–251 (the Adventure Phase
Procedures reference) define the modifier surface:

  * Pool starts at the relevant rating (ability, skill, or town
    ability). For a skill with rating 0, fall through to half the
    skill's BL ability rounded up (DH p.78).
  * **Bonus dice before the test** (DH p.251): Fresh, traits L1/L2,
    persona spend, channel Nature, help, aid from a wise, gear,
    supplies, level benefit, enchanted item, invocation, spell.
  * **Disadvantages before the test**: trait against yourself,
    Injured, Sick, etc.
  * **Post-roll bonus successes**: weapon, L3 trait, Might/Precedence
    differential.
  * **After-roll penalties**: backpack, dim light, penalty modifiers
    & factors, Exhausted/Hungry/Thirsty disposition penalties.
  * **Rerolls**: Luck (fate point on 6s), Wise (fate or persona),
    Faith on Will tests.

The subsystem is shaped to express all of these, but only the
auto-derived condition modifiers (Fresh, Injured, Sick) and player-
added ones are wired today. The rest land as additional providers
or auto-modifier rules, no signature changes.

## Architecture

```
TbRollSpec ───── written by every TB rollable's compute ─────┐
                                                              │
   Conditions ──┐                                             │
   Skill flags ─┼─ auto modifiers (rollable inputs)           │
   Item etc.   ─┘                                             ▼
                                                       RequestRoll
                                                          + meta
   PendingRoll panel ──── Contributions ───┐                 │
   ±D / ±s buttons       (manual TB mods)  │                 │
                                            ▼                ▼
                                          opts          RollResolved
                                                              │
                                                              ▼
                                                    Roll entity (Formula+RollResult+RolledBy)
                                                              │
                                                              ▼
                                                        TbRollRow chat card
                                                       (decodes Formula.meta)
```

### `meta` passthrough on the resolution layer

The substrate-side change is small: `RequestRoll`, `RollResolved`, and
`Formula` now carry an optional `meta?: unknown`. The resolution layer
never inspects it. The chat-timeline contributor in `@vtt/resolution`
filters out roll entities where `Formula.meta.system` is set — that
defers rendering to a per-system contributor.

This convention is the only contract between game-system rolls and the
generic chat output. A new game system claims its rolls by setting
`meta = { system: "<plugin-name>", spec: <whatever-it-needs> }` and
shipping its own chat-timeline contributor.

### `TbRollSpec` and `TbRollModifier`

`TbRollSpec` is the structured roll description every TB rollable
emits and the chat card consumes. It carries: kind (ability / town /
skill / skill-bl), source label + id, baseDice, final pool, flat
bonus successes, optional obstacle, every modifier (auto + manual,
applied + conditional), and a human caption.

`TbRollModifier` is the canonical modifier shape:

```ts
{
  id: "manual:42";        // unique within the spec
  kind: "dice" | "success";
  value: number;          // signed
  label: "Help (Tarn)";
  apply: "always" | "on-success" | "on-fail";
  source: "auto"|"manual"|"trait"|"wise"|"help"|"fate"|"persona"|
          "gear"|"spell"|"condition"|"level-benefit";
  providedBy?: "condition:injured" | "skill:fighter:taxed" | ...;
}
```

Conditional modifiers (`apply: "on-success"`/`"on-fail"`) are recorded
in the spec but **not** folded into pool / notation. The chat card
applies them post-roll once it knows whether the test passed.

### Three modifier sources

1. **Auto from traits** — `autoModifiersFromConditions` and
   skill-`taxed` flags. Computed every time the rollable runs.
   Deterministic; the player can't toggle them without mutating the
   underlying trait. Town-ability rolls deliberately skip the
   condition modifiers (DH p.250 Adventure-Phase only).

2. **Manual contributions** — the pending-roll panel's TB contributor
   (`TbPendingRollContributor`) renders ±D / ±s quick buttons, a
   heroic on/off toggle, and a labelled-modifier form. Each click
   emits a `Contribution`: `tb-modifier` (kind/value/apply payload
   matching `TbRollModifier`) or `tb-heroic` (`{enabled: boolean}`,
   last-wins). The rollable's compute decodes them via
   `modifiersFromContributions` and `heroicFromContributions`.

   The default panel ships **only** the system-aware contributors —
   the generic ±N "Add modifier" UI was removed because the TB
   contributor (and any future system contributor) covers the
   modifier surface with system-correct semantics. Panels also show
   a structured headline: `<Character> is rolling <source>` where
   `source` comes from the rollable's spec (`spec.source`) and
   falls back to the rollable name's last segment for systems that
   don't supply one.

3. **(Stub) Ambient providers** — `TbRollModifierProvidersSlot` is
   declared but not consumed yet. Fills carry a `providerId`,
   eligibility filter, and the modifier they offer. The plan is for
   the panel to enumerate matching providers and render togglable
   chips; the panel never imports a provider's internals.

### Why not bake everything into rpg-dice-roller notation?

We tried. TB's "count successes (≥4)" plus "add flat successes" plus
"reroll on Faith if you fail" doesn't compose cleanly in any single
notation string. The simpler structure: notation is `Nd6`, the spec
carries pool + modifiers + obstacle, the chat card computes
successes from the per-die outcomes. Every TB-specific rule layered
on later is data on the spec, not a notation modifier.

### Notation: `Nd6>=T+B`

The notation encodes the rules-as-written formula directly: pool
of d6 with a target-success modifier. Default target is 4 (a die
showing 4–6 is a success); heroic flips it to 3 (3–6). Always-
applied success modifiers fold in as arithmetic on the success
count — `4d6>=4+1` means "roll four d6, count successes ≥4, add 1".

This means `RollResult.total` for a TB roll IS the success count
after always-applied bonuses. The chat row still computes raw
successes from per-die outcomes (so it can show the breakdown);
conditional modifiers (`apply: "on-success"`/`"on-fail"`) stay
out of notation since they need win/lose state to know whether
to fire.

Pool 0 is auto-fail per DH p.20. The notation collapses to a bare
numeric constant (`0` with no bonus, otherwise the bonus value
with its sign) — the chat row's resolution short-circuits anyway,
but the wire format stays parseable. `RollResult.total = 0` when
the player couldn't make the test.

### Heroic mode

Per-roll **heroic** flag drops the success target from 4+ to 3+.
Sourced from three places, in priority order:

  1. `opts.heroic` — explicit per-roll override (`true`/`false`).
  2. `tb-heroic` panel contribution — last-wins toggle posted to
     the pending-roll panel.
  3. The character's `Heroic` trait — lists abilities, town
     abilities, and skill ids the character has elevated to
     heroic. Matched against the roll's `sourceId`.

`opts.heroic === false` is a meaningful "force standard" — it
overrides a heroic-tagged trait. `undefined` defers to the panel
toggle and then to the trait. Never stacks: heroic is binary.

The `Heroic` trait shape (`{abilities, townAbilities, skills}`)
is intentionally generic — any future mechanic that wants to
elevate a particular ability/skill writes via `SetField` instead
of inventing per-source plumbing. Today no system writes it; the
infrastructure is in place.

## Extension recipes

### Adding a new auto-modifier (e.g. backpack penalty)

Edit `autoModifiersFromConditions` (or write a sibling helper that
reads a different trait and returns `TbRollModifier[]`). Tag the
`source` with the closest matching enum and set `providedBy` to a
stable id like `"gear:backpack"`. The compute already concatenates
auto-modifiers ahead of player contributions.

### Adding a new manual contribution form

Two paths:

  * **Inside the TB contributor** — add a quick button or form to
    `TbPendingRollContributor`. Use `props.contribute({...})` with a
    `TbRollModifier` payload.

  * **As a standalone contributor** — register a new fill into
    `PendingRollContributorsSlot` with its own `rollablePrefix`. The
    pending-roll panel stacks contributors vertically.

### Adding a thing-in-the-game that provides a modifier

Fill `TbRollModifierProvidersSlot` from the providing plugin. The
shape is `{providerId, eligibility?, modifier}`. The slot is declared
but not consumed yet — adding a fill today is a no-op until the panel
starts iterating fills. Adding test coverage for the fill is still
worthwhile so the schema doesn't drift.

### Adding a reroll mechanic (Faith, Wise, Luck)

These don't fit the additive modifier shape. Two options:

  1. Pre-roll: the panel offers a "spend Faith" button that, on
     click, sets a flag in the spec (`rerollOnes: true`). The
     rollable's compute reads the flag; the chat row knows to
     render the rerolled outcome.

  2. Post-roll: emit a follow-up event that mutates the existing
     Roll entity (re-rolling specific dice). This keeps the original
     dice visible alongside the re-rolled ones.

Either way, the modifier list still narrates *why* the reroll
happened — add a `kind: "reroll"` modifier with `apply: "on-fail"`
or similar so the chat card can show "Faith reroll fired".

## Open questions / next steps

  * **Help with another character** — needs a peer-list UI like
    system-simple's `HelpWithCharacterContributor`. Different
    contributor, same panel, same modifier shape.
  * **Versus tests** — kind already in the schema; computing the
    pass/fail comparison against an opposed pool is on the chat
    card, not the spec.
  * **Tax untaxed Nature on a failed Beginner's Luck** — needs a
    follow-up command emitted by a system reacting to the right
    `RollResolved` (BL-skill, failed). Modifier shape unchanged.
  * **Conflict disposition penalties** (Exhausted, Hungry/Thirsty)
    — those are conflict-rules-only and don't apply to test pools;
    they'll surface in a conflict subsystem with its own modifier
    flow.

## File map

```
packages/plugin-resolution/src/shared/
  commands.ts          # RequestRoll.meta passthrough
  events.ts            # RollResolved.meta passthrough
  traits.ts            # Formula.meta + RollResult.dice

packages/plugin-resolution/src/server/
  systems.ts           # RollRecordingSystem writes Formula.meta + RollResult.dice

packages/plugin-resolution/src/client/
  views.tsx            # Generic RollRow filters out system-claimed rolls

packages/system-torchbearer/src/shared/
  roll-spec.ts         # TbRollModifier + TbRollSpec + folding helpers
  roll-modifiers.ts    # autoModifiersFromConditions, modifiersFromContributions, formatModifier
  roll-providers.ts    # TbRollModifierProvidersSlot (stub)
  rollables.ts         # 6 rollables refactored to spec + meta

packages/system-torchbearer/src/client/
  pending-roll-contributor.tsx  # ±D, ±s, labelled modifier UI for the panel
  tb-roll-row.tsx               # TB-flavoured chat card
  chat-timeline.tsx             # Adds TbRollChatTimelineContributor

packages/system-torchbearer/src/manifest.ts
  # Slot declaration + chat / pending-roll fills

packages/system-torchbearer/src/torchbearer.test.ts
  # Schema tests, helper tests, rollable + contribution tests
packages/system-torchbearer/src/sheet-shape.test.tsx
  # jsdom: contributor button → contribution; chat row decode + render
```
