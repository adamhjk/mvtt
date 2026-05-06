# Torchbearer Conflict (Reference Board)

This is the locked architectural plan for the Torchbearer 2e
**conflict** subsystem — kill, drive off, capture, convince, flee,
pursue, riddle. It covers the live-board UI ("the Reference Board"),
the rules catalog the UI is paid to surface, the entity / trait /
command / event model that drives it, and the resolution algorithm.

Rule references are to the printed page, per the `rules-lookup` skill
convention. `DH` = Dungeoneer's Handbook (e3); `SG` = Scholar's Guide
(e6). Page numbers are printed pages.

## What problem we're solving

At a physical Torchbearer table the players spread the Action Deck
cards in front of them: an **Attack** card, a **Defend** card, a
**Feint** card, a **Maneuver** card — each printed with its own rules
text *and* a strip showing how that action interacts with every other
action. The captain has a row of weapon cards. Conditions sit as a
loose pile of reminder cards to one side.

Those cards aren't decoration. They are a **rules-distribution
system**: every player has the rule they need at arm's reach without
opening a book. That is what makes a TB conflict playable. Any digital
UI that hides the rules behind tooltips or makes the captain "click
to learn what Defend does" loses the function the cards perform.

The Reference Board reproduces that function — and goes further by
*highlighting the rule that matters right now* — without imitating
the leather-and-wax aesthetic. It is editorial, dense, software-honest.

## Locked decisions

1. **Renderer is DOM, not Pixi.** The conflict UI is a typeset
   document with reactive sections. CSS Grid + native semantic
   markup. Animations are CSS transitions on chip background-color +
   number popups via `motion-one`. We share *icon assets* with the
   scene system (weapon glyphs render as `<img>` from the same
   `Assets` PNGs that paint scene tokens) but no `Application` is
   created. Rationale: the dense-typesetting aesthetic does not
   benefit from a canvas, jsdom can test the entire surface, screen
   readers and keyboard nav are free.
2. **Lives inside `@vtt/system-torchbearer`**, not its own plugin.
   New folder `packages/system-torchbearer/src/conflict/{shared,
   server,client}`. The mechanics (action matrix, weapon bonuses,
   disposition skills) are TB-specific; factoring them out would be
   premature.
3. **Every reference panel is always visible.** The action matrix,
   the equipped-weapons table, the conditions table, and the
   armor-status table all render below the round band — scroll, never
   click-to-reveal. Hover/focus on a chip in the round band
   highlights the matching cell or row.
4. **Captain's locked row is asymmetrically visible.** Face-up to
   teammates (the rules call for "the group strategizes" before the
   captain assigns — SG p.67), face-down to the GM until reveal. Same
   for the GM's row vs the players. Implemented by side-scoped event
   filtering, same pattern as private chat.
5. **Captain's pre-lock script is optimistic-local.** Slot fills are
   driven through `createOptimisticTrait` (per
   `design/optimistic-ui-state.md`) so the captain sees instant
   response while the substrate confirms over the wire.
6. **Resolution is server-authoritative.** Client never decides who
   won a slot. The server reads both sides' locked scripts at reveal
   time, runs the rules engine (a pure function over `TbConflict*`
   traits + `TbWeapon` + `TbArmor` + `TbCondition*`), and emits the
   `ActionResolved` event with full breakdown. Client renders.
7. **No legacy fallbacks.** Per CLAUDE.md, mvtt is pre-launch with no
   users — there is no migration concern. If a trait shape changes,
   change the trait.
8. **The action interaction matrix is a static.** It does not live in
   the world; it lives in the package as a `const TB_ACTION_MATRIX`.
   Same for action rule-text, weapon-special parsers, condition
   effects on disposition.

## UI — the Reference Board

```
┌─ KILL · Dread Crypt of Skogenby ─────────────── round 2 · reveal 1/3 ─────────────────┐
│  HEROES  ████████████░░░░░░  14/17                FOES  ██████░░░░░░░  9/12           │
├──────────────────────┬─────────────────────────────────────────┬────────────────────────┤
│  HEROES              │  ROUND 2                                │  FOES                  │
│                      │                                         │                        │
│  BEREN     ●●●○      │  captain  ┃ A ┃ ┃ ? ┃ ┃ ? ┃  LOCKED   │  SKEL A    ●●●●        │
│  Sword               │           Beren · Sword                 │  Sword                 │
│  ⚠ hungry-thirsty    │                                         │                        │
│  ──────────────────  │  ▶ ATTACK  versus  DEFEND               │  SKEL B    ●●●○        │
│  KAROLINA  ●●●●      │    Damages opponent's HP by margin of   │  Sword                 │
│  Bow                 │    success. Independent Ob 0 / 3.       │                        │
│  ──────────────────  │    Spend MoS on damage cap or trait     │  CAPTAIN   ●●●●●       │
│  GERALD    ●●●○      │    push. Bypasses leather: NO.          │  Sword                 │
│  Staff               │                                         │                        │
│  ──────────────────  │  roll   ⚔ 5d   vs   ⛨ 4d                │                        │
│  VARG      ●●○○      │  →     3s          1s                   │                        │
│  Hand axe            │  →     margin 2 · −2 to FOES            │                        │
│  ⚠ injured (−1D)     │                                         │                        │
│                      │  GM       ┃ D ┃ ┃ ? ┃ ┃ ? ┃  LOCKED    │                        │
│                      │           Captain · Sword               │                        │
├──────────────────────┴─────────────────────────────────────────┴────────────────────────┤
│  ACTIONS — INTERACTION MATRIX                                                            │
│                                                                                          │
│             vs ATTACK    vs DEFEND    vs FEINT     vs MANEUVER    summary                │
│  ATTACK     indep         VERSUS        indep         VERSUS         dmg = MoS           │
│  DEFEND     VERSUS        indep         — no act      VERSUS         heal = MoS+1, self  │
│  FEINT      — no test     indep ★       VERSUS        indep          dmg = MoS           │
│  MANEUVER   VERSUS        VERSUS        indep         indep          spend MoS on effects│
│                                                                                          │
│  ★ Feint vs Defend: defender does not test; feinter rolls indep Ob 0 against HP.        │
│  click any cell → full rule text                                                         │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  YOUR WEAPONS — BONUSES & SPECIALS                                                       │
│                  A      D      F      M     special                                      │
│  Sword           +1D†   —      —      —     † bonus picks one action, sticks all conflict│
│  Bow             —      —      —      +2D   versus Attack 1× / conflict; bypasses leather│
│  Staff           —      +1D    —      —     +1D hike/climb (out of conflict)             │
│  Hand axe        —      —      —      —     throw 1×: indep A → versus A, then disarmed │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  ARMOR — STATUS                                                                          │
│  Beren   leather    intact     1d6 4-6 absorb 1, 1×/fight, never destroyed by hit       │
│  Karolina leather   intact     ...                                                       │
│  Gerald  —          —                                                                    │
│  Varg    chain      intact     absorb 1, then 1d6 1-3 destroyed; mace bypasses          │
│                                  shield: +2D Defend, can absorb 1 then destroyed         │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  CONDITIONS IN PLAY                                                                      │
│  Beren ⚠ Hungry & Thirsty   −1s to disposition (counted once / team)                    │
│  Varg  ⚠ Injured            −1D to skills, Nature, Will, Health (not recovery)          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
   captain (you):  slot 2 →  ( A )  ( D )  ( F )  ( M )    who → Karolina ▾   wpn → Bow ▾
                                                                          [ confirm ]
```

### Layout

A single page, three regions, no modals.

- **Top stripe**: conflict type, location, round counter, reveal
  pointer, two giant disposition bars (heroes + foes). The bars are
  the scoreboard — largest type on screen.
- **Middle three columns**: heroes left, the **Round** column
  centre, foes right. Heroes/foes columns are static rosters. The
  Round column is the only dynamic surface during a round —
  captain's row, GM's row, and the *active resolution panel* between
  them which shows the current slot's rule text + dice + delta.
- **Below the fold**: the four reference panels — interaction
  matrix, weapons, armor, conditions. Persistent. Scroll, don't
  click.
- **Captain input strip** pinned to bottom for the captain (or GM
  input strip for the GM). Slot index, four action chips, performer
  dropdown, weapon dropdown, confirm.

### Aesthetic

- **Type pairing**: a serif with display character for headers (Ogg
  / Tiempos Headline / GT Sectra), GT America for body, JetBrains
  Mono / Berkeley Mono for numbers and dice. Headers in **small
  caps**, letter-spaced. Section dividers as thin horizontal rules,
  not boxes.
- **Color**: paper `#FAF7F2`, ink `#1A1815`, hero accent oxblood
  `#7A1E1E`, foe accent burnt-gold `#8C6210`. Action chip colors —
  used only at reveal — are A red `#B83227`, D blue `#225D9B`, F
  purple `#6E3FA1`, M green `#2F8A4A`. Face-down chips are
  ink-on-paper outlined squares with `?`.
- **Density**: matrix and weapon tables set in 13-14pt mono with 1.4
  line height so a player across the room can read them. Headers
  11pt small caps. Body rule text 14pt serif. **Decoration budget =
  0.** No drop shadows, no gradients, no ornament; serif headers and
  mono numbers carry the visual interest.

### Interaction model

#### Captain, scripting

1. Slot 1 is auto-focused. Captain hits `1` / `2` / `3` / `4` to
   pick A/D/F/M (or clicks the chip), tabs to performer dropdown,
   tabs to weapon dropdown, hits Enter to confirm. The Round column
   shows "what would happen" for the most-likely opposing action
   (the highest-prior-probability matchup, which is just the GM's
   most-frequent prior pick — defaults to a flat distribution).
2. As slots fill, the chip face-up in the captain's row turns the
   action color but with a *dotted* border (= "tentative,
   visible only to your side"). Teammates see this dotted-color
   chip; the GM sees a plain face-down `?`.
3. When all three slots are filled, the input strip collapses to a
   single `LOCK ROUND` button. On lock, the dotted border becomes
   solid; the chip is *committed* but still hidden from the GM.

#### GM, scripting

Same UI on the foe side. GM also has a small "weapon swap" affordance
on each foe roster row (drag to assign a weapon for next round).

#### Reveal cascade

When both sides have locked, the server emits
`SlotRevealed { conflictId, slotIndex: 0, heroAction, foeAction }`.
The client:

1. Flips both teams' slot-0 chips to their action color, solid
   border.
2. Looks up the matrix cell `(heroAction, foeAction)`. Fills the
   resolution panel with the rule-text snippet for that matchup.
3. Server runs the rules engine, allocates dice, emits
   `ActionRolled` (per side) and `ActionResolved` (consolidated).
4. Client animates the resolved values: dice numbers slide in,
   margin-of-success delta flies as a number to the affected
   disposition bar, HP pips on the affected character(s) animate.
5. The slot stays in its resolved-color, solid-border state. Slot 1
   reveal begins.
6. After all three reveal, round counter ticks, scripts reset, weapon
   reassignments are committed, captain input strip un-collapses.

#### Round breadcrumbs

A small strip above the captain's row shows R1, R2… as the conflict
proceeds. Click R1 to scrub the matrix/weapon highlights and
resolution panel back to that round's state — read-only. Active round
is the current round.

#### Status events

Knock-out (HP→0), disarm (Maneuver MoS 3 effect), and
condition-acquisition all render as inline pills on the affected
roster row, with the relevant rule text expanding inline on click.

### Keyboard

- `1` `2` `3` `4` — pick A/D/F/M for the focused slot.
- `Tab` / `Shift+Tab` — move between slot, performer, weapon, confirm.
- `Enter` — confirm focused slot.
- `Esc` — un-fill focused slot.
- `L` — lock round when all three slots are filled.
- `?` — toggle the rules-context panel into "full text" mode.

## Rules catalog

What the UI must surface, faithfully and completely. The engine
implements all of it.

### Conflict types

A conflict is one of the following types. The type chooses the
**disposition skill** (which skill the captain rolls to generate the
team's starting disposition pool) and the **action skill table**
(which skill each action tests). All citations SG p.63 and SG p.70-71.

| Type             | Roll for disposition       | + Add to rating | Attack / Feint    | Defend / Maneuver  |
|------------------|----------------------------|-----------------|-------------------|--------------------|
| Capture          | Fighter or Hunter          | Will            | Fighter / Hunter  | Hunter / Fighter   |
| Convince         | Persuader                  | Will            | Persuader         | Manipulator        |
| Convince Crowd   | Orator                     | Will            | Orator            | Manipulator        |
| Drive Off        | Fighter                    | Health          | Fighter           | Will               |
| Flee or Pursue   | Scout or Rider             | Health          | Scout or Rider    | Health             |
| Kill             | Fighter                    | Health          | Fighter           | Health             |
| Trick or Riddle  | Manipulator                | Will            | Manipulator       | Lore Master        |
| Other            | (GM choice)                | (GM choice)     | as Attack         | as Defend          |

(Convince's per-action skills are a slight gloss: Attack/Defend both
test Persuader, Feint/Maneuver both test Manipulator. See SG p.70.)

The exact mapping is encoded as `TB_CONFLICT_TYPES`:

```ts
type ConflictType =
  | "capture" | "convince" | "convinceCrowd" | "driveOff"
  | "flee" | "pursue" | "kill" | "trick" | "other";

interface ConflictTypeDef {
  id: ConflictType;
  label: string;
  dispoSkill: SkillId | { oneOf: SkillId[] };  // captain rolls one of these
  dispoAddTo: "Will" | "Health";
  actionSkill: { attack: SkillId; defend: SkillId; feint: SkillId; maneuver: SkillId };
}
```

### Action interaction matrix (SG p.70)

```
              vs ATTACK   vs DEFEND   vs FEINT     vs MANEUVER
  ATTACK         I            V            I            V
  DEFEND         V            I            —            V
  FEINT          —            I            V            I
  MANEUVER       V            V            I            I
```

`I` = independent test (both sides roll separately, both can succeed
or fail). `V` = versus test (one shared roll, MoS goes to the
winner). `—` = "do not roll for your action." Specifically:

- **Defend vs Feint** (`row Defend, col Feint = —`): the defender
  does not test. The feinter rolls *independent Ob 0* against HP
  (SG p.68 — "Feint vs Defend").
- **Feint vs Attack** (`row Feint, col Attack = —`): the feinter
  does not test. The attacker rolls *independent Ob 0* against HP.

The matrix is **symmetric in form, asymmetric in rules**: when an
`I/—` cell is read both ways, only one side rolls. The engine
canonicalises the matchup by reading both rows and cross-checking.

### Action rules (SG p.67-69)

Each action card carries this text. The Reference Board renders the
text from `TB_ACTION_RULES`.

**ATTACK** — *"An Attack is an attempt to end this conflict in a
decisive move."*
- Reduces opponent's HP by margin of success.
- Versus: vs Defend, vs Maneuver.
- Independent: vs Attack, vs Feint. **Independent Ob: 0**.

**DEFEND** — *"The Defend action protects and strengthens your
position."*
- Blocks Attacks and Maneuvers; also restores HP via Regroup.
- Versus: vs Attack, vs Maneuver.
- Independent: vs Defend. **Independent Ob: 3**.
- vs Feint: defender does not test (defender forfeits).
- **Regroup (heal)**:
  - In a versus test, MoS is the heal pool.
  - In an independent Defend, heal pool = `1 + MoS`.
  - Heal *self first* up to starting HP. Surplus may go to a
    teammate, **whole at a time**, until exhausted. Knocked-out
    teammates re-enter on the first restored HP. *No partial heals
    across teammates.* (SG p.68)

**FEINT** — *"The Feint action represents a deceptive attack."*
- Reduces opponent's HP by margin of success.
- vs Defend: defender forfeits, feinter rolls independent Ob 0.
- vs Attack: feinter forfeits, attacker rolls independent Ob 0.
- vs Feint: versus, MoS to winner.
- vs Maneuver: feinter rolls independent Ob 0 against HP; maneuver
  tests as normal at its independent Ob.
- **Independent Ob: 0**.

**MANEUVER** — *"used to gain an advantage over your opponent."*
- Versus: vs Attack, vs Defend.
- Independent: vs Feint, vs Maneuver. **Independent Ob: 0**.
- **Effects** — spend MoS on one or more of:
  - **MoS 1 — Impede**: −1D to opponent's *next* action's test. If
    the next action interaction has no test, the impede is wasted.
  - **MoS 2 — Gain Position**: +2D to *your team's* next action's
    test. If the next interaction has no test, the bonus is wasted.
  - **MoS 3 — Disarm**: remove one weapon / piece of gear from
    opponent for the rest of the conflict. *Or* spend MoS 3 as
    Impede + Gain Position.
  - **MoS 4 — Rearm**: you or a teammate may grab a dropped weapon
    or equip mid-round. *Or* spend MoS 4 as Impede+Disarm /
    Impede+GainPosition (discarding 1).
  - You may spend each effect type **only once per action**.

### Weapon table (DH p.156-159)

The catalog is already encoded as `TbWeapon` traits (with
`conflictBonuses.{attack,defend,feint,maneuver}`) on item entities;
the design here is the **rules engine + UI surfacing**.

| Weapon       | A     | D     | F     | M     | Special                                                        |
|--------------|-------|-------|-------|-------|----------------------------------------------------------------|
| Battle axe   | +1s   | −1D   | —     | —     |                                                                |
| Bow          | —     | —     | —     | +2D   | Versus Attack 1×/conflict. Bypasses leather. Not in HtH.       |
| Crossbow     | +1s   | —     | —     | +1D   | +1D to A vs Defend. Bypasses leather. Not in HtH.              |
| Dagger       | —     | —     | —     | —     | Maneuver MoS counts as disarm vs spear-type / missile weapons. |
| Flail        | +1s   | −1s   | +1D   | −1s   |                                                                |
| Great sword  | —     | —     | —     | +1D   | Prevents opponent from receiving help to A or D vs you.        |
| Halberd      | +1D   | —     | −1D   | +1D   |                                                                |
| Hand axe     | —     | —     | —     | —     | Throw 1×/fight: indep → versus (not vs bow/xbow/sling). Disarm.|
| Mace         | —     | —     | —     | —     | Bypasses chain. Increases plate damage chance.                 |
| Polearm      | *     | +1D*  | *     | *     | +1D vs swords, maces, axes (stacks with the +1D Defend).       |
| Shield       | —     | +2D   | —     | —     | Absorb 1 damage 1× then destroyed. Adds to weariness.          |
| Sling        | —     | —     | —     | +2D   | Bonus does not count vs bows or crossbows.                     |
| Spear        | —     | †     | —     | +1D   | †+1D Defend in narrow corridors. Throwable. Bypasses leather.  |
| Staff        | —     | +1D   | —     | —     | (Out of conflict: +1D hiking / climbing.)                      |
| Sword        | +1D†  | +1D†  | +1D†  | +1D†  | †Bonus picks ONE action; sticks for rest of conflict.          |
| Warhammer    | +1D   | −1D   | —     | —     | Bypasses chain. Increases plate damage chance.                 |

**Weapon-bonus type**: per `TbWeapon.conflictBonuses[action].type`, a
bonus is `dice` (+ND), `success` (+Ns post-roll), or `rerolls`. The
rules engine fans these out into `TbRollModifier` entries during
disposition / per-slot rolls.

**Choose-on-the-fly bonus** (sword's "+1D one action"; some convince
weapons): the rules engine carries a `TbConflictWeaponChoice` trait
per `(conflictId, characterId, weaponId)` recording which action
the bonus is bound to. Set when the captain first picks an action
that uses this weapon; sticky for the rest of the conflict.

### Armor (DH p.150-151)

Armor benefits **kill, capture, drive off only** (DH p.150).

| Armor     | Absorb | After-absorb roll                              | Bypassed by                       |
|-----------|--------|------------------------------------------------|-----------------------------------|
| Leather   | 1      | 1d6: 4-6 absorb / 1-3 no absorb. *Once per fight, never destroyed.* | Spears, bolts, arrows |
| Chain     | 1      | After absorbing: 1d6 1-3 → damaged & useless. 4-6 intact.  | Mace, warhammer (auto-absorb but check damage roll) |
| Plate     | 1      | After absorbing: 1d6 1-2 → damaged. 3-6 intact. *Vs mace/warhammer:* 1-3 damaged, 4-6 intact. | (Nothing bypasses; only damaged faster) |
| Helmet    | 1      | Once used, lost / damaged / destroyed at GM discretion. |  |
| Shield    | 1      | After absorbing: destroyed.                    |  |

Armor rules in conflict:
- Absorbs only when the wearer is the **lead** of an action that
  takes damage (DH p.150).
- Cannot absorb after damaged.
- *Overflow damage* into teammates is **not absorbed by armor** (SG
  p.65).

The engine keeps an `TbConflictArmorState` per `(conflictId,
characterId)`: `intact | absorbed-this-fight | damaged | destroyed`.

### Conditions in conflict (SG p.46-51, p.63-64)

Pre-existing conditions on a participant affect either the
disposition roll, individual action tests, or both.

| Condition         | Effect on disposition roll | Effect on tests in conflict             |
|-------------------|----------------------------|------------------------------------------|
| Fresh             | (no penalty; +1D all tests is the buff) | +1D all skill / ability tests (not Resources/Circles) |
| Hungry & Thirsty  | −1s to dispo, **once / team**, regardless of how many | (none direct in conflict) |
| Angry             | (no direct dispo penalty) | No beneficial traits or wises. -1s precision/social if applicable. |
| Afraid            | (no direct dispo penalty) | No help, no Beginner's Luck. Nature still substitutable. |
| Exhausted         | −1s to dispo, **once / team**, stacks with H&T | Instinct not free |
| Injured           | −1D to dispo roll          | −1D to skills / Nature / Will / Health (not recovery) |
| Sick              | −1D to dispo roll (`injured + sick = −2D`) | −1D to skills / Nature / Will / Health (not recovery); no advancement |
| Dead              | (cannot participate)       | (cannot participate)                     |

Mid-conflict, conditions can be applied at compromise time (SG p.76).
The engine applies these only at conflict-end, never mid-round.

Additional dispo-roll modifiers (SG p.63-64):
- Backpack worn by captain in kill/capture/driveOff: −1s.
- Captain in dim light or darkness: −1s in all conflicts except
  riddling (and only flee/riddle is allowed in darkness).
- Minimum starting disposition is 1.

### Help (SG p.71)

- Helper grants +1D to that action's roll (one die per helper).
- Helper must possess the action's skill (or Nature descriptor, or
  GM-approved alternative).
- One can help even without an assigned action.
- One *cannot* help if knocked out.
- Help is logged as a `TbConflictHelp { slotIndex, helperCharacterId,
  source: "skill" | "nature" | "wise" }` per slot.
- Great Sword's special suppresses help from the *opponent* on
  Attack/Defend. Encoded as a flag on the slot resolution.

### Compromise (SG p.74-75)

After a conflict ends, the loser claims a compromise based on how
much disposition they took off the winner:

| Winner ends with                     | Compromise level | Suggested results                                              |
|--------------------------------------|------------------|----------------------------------------------------------------|
| > 1/2 starting disposition           | Minor            | Loser gets a small piece of their goal; condition imposed.    |
| ~1/2 starting disposition            | Half             | Halfway-to-goal for one side, *or* a new twist.                |
| Few points left                      | Major            | Loser nearly thwarted the winner; major twist; painful.        |

For kill conflicts specifically (SG p.77):
- Lose without compromise → all team killed.
- Minor → all but 1-2 killed.
- Conditions Afraid / Angry / Exhausted may be applied as minor;
  Injured as half; two of {Afraid, Angry, Exhausted, Injured} as
  major; death as any.

The engine emits `ConflictEnded { winner, loserDispoStart,
loserDispoEnd, suggestedCompromiseLevel }` and a UI panel walks the
group through the negotiation; conditions and their target characters
become an `ApplyCompromise` command. The compromise itself is
*negotiated*, not computed.

## Data model

### Sentinel: TbConflict

The conflict itself is an entity in the world.

```ts
const TbConflict = defineTrait({
  name: "@vtt/system-torchbearer/TbConflict",
  schema: z.object({
    type: z.enum([
      "kill","driveOff","capture","convince","convinceCrowd",
      "flee","pursue","trick","other",
    ]),
    locationLabel: z.string().max(120).default(""),
    captainCharacterId: EntityId,
    gmUserId: z.string(),
    phase: z.enum([
      "declared","weapons","disposition","hp","scripting",
      "reveal","awaitingDamageDistribution","betweenRounds",
      "compromise","ended",
    ]),
    round: z.number().int().min(1).default(1),
    revealIndex: z.number().int().min(0).max(2).default(0),
    dispoHero: z.object({ current: z.number().int(), max: z.number().int() }),
    dispoFoe:  z.object({ current: z.number().int(), max: z.number().int() }),
    winner: z.enum(["heroes","foes","tied"]).nullable().default(null),
  }),
});
```

### Per-participant: TbConflictParticipant

```ts
const TbConflictParticipant = defineTrait({
  name: "@vtt/system-torchbearer/TbConflictParticipant",
  schema: z.object({
    conflictId: EntityId,
    side: z.enum(["heroes","foes"]),
    characterId: EntityId,         // Character entity OR NPC entity
    hp: z.number().int().min(0),
    hpMax: z.number().int().min(0),
    knockedOut: z.boolean().default(false),
  }),
});
```

One per PC and per NPC. Spawned by `DeclareConflict` /
`AssignHp` commands.

### Weapon binding: TbConflictWeapon

```ts
const TbConflictWeapon = defineTrait({
  name: "@vtt/system-torchbearer/TbConflictWeapon",
  schema: z.object({
    conflictId: EntityId,
    characterId: EntityId,
    weaponItemId: EntityId,        // ref into the items catalog
    chosenAction: z.enum(["attack","defend","feint","maneuver"]).nullable(),
  }),
});
```

`chosenAction` is only set when the weapon's "+1D to one action of
your choice" rule fires (Sword; many convince weapons). Sticky for
the rest of the conflict once set, per the rule.

`ChooseWeapon` mutates this between rounds; the field is reassignable
*between rounds only*, not mid-round (DH p.156, "between rounds").

### Armor state: TbConflictArmorState

```ts
const TbConflictArmorState = defineTrait({
  name: "@vtt/system-torchbearer/TbConflictArmorState",
  schema: z.object({
    conflictId: EntityId,
    characterId: EntityId,
    armorItemId: EntityId.nullable(),
    helmetItemId: EntityId.nullable(),
    shieldItemId: EntityId.nullable(),
    armorState:  z.enum(["intact","leatherUsedThisFight","damaged","destroyed"]).default("intact"),
    helmetState: z.enum(["intact","destroyed"]).default("intact"),
    shieldState: z.enum(["intact","destroyed"]).default("intact"),
  }),
});
```

(Leather is the only armor with a "used-this-fight" intermediate
state, hence the dedicated enum value.)

### The Script: TbConflictScript

This is the heart of the secrecy model. **Server-side only** until
each slot's reveal command fires.

```ts
const TbConflictScript = defineTrait({
  name: "@vtt/system-torchbearer/TbConflictScript",
  schema: z.object({
    conflictId: EntityId,
    side: z.enum(["heroes","foes"]),
    locked: z.boolean().default(false),
    slots: z.tuple([
      ScriptSlotSchema, ScriptSlotSchema, ScriptSlotSchema,
    ]),
  }),
});

const ScriptSlotSchema = z.union([
  z.object({ status: z.literal("empty") }),
  z.object({
    status: z.literal("filled"),
    action: z.enum(["attack","defend","feint","maneuver"]),
    performerId: EntityId,
    weaponItemId: EntityId,
  }),
  z.object({ status: z.literal("revealed"), action: ..., performerId: ..., weaponItemId: ..., resolution: ResolutionSchema }),
]);
```

**Wire scoping**: a `TbConflictScript` for `side="heroes"` is
broadcast to the **hero side's** clients (and the GM only after lock
+ reveal of a given slot). Same pattern as private chat — the
substrate's per-recipient event filter masks unrevealed slots as
`{ status: "filled" }` (no `action`/`performer`/`weapon`) for
out-of-side recipients. After lock, the GM still does not see
contents until each slot is revealed; only on `RevealNextSlot` does
the slot's contents become visible to the GM (and to spectators).

### Per-slot resolution: ResolutionSchema

The output of the rules engine for one slot. Captured into the
script slot at `revealed` status; also emitted as the
`SlotResolved` event payload.

```ts
const ResolutionSchema = z.object({
  matchup: z.object({
    heroAction: ActionEnum, foeAction: ActionEnum,
    type: z.enum(["independent","versus","heroNoTest","foeNoTest"]),
  }),
  hero: TestResultSchema.nullable(),
  foe:  TestResultSchema.nullable(),
  effects: z.array(EffectSchema),
});

const TestResultSchema = z.object({
  poolBefore: z.number().int(),     // raw skill rating
  modifiersBefore: z.array(...),    // weapon, condition, gear, help, ...
  modifiersAfter: z.array(...),     // backpack, dim-light, focus, etc.
  obstacle: z.number().int().nullable(),
  successes: z.number().int(),
  margin: z.number().int(),         // signed; +ve = pass, -ve = fail
  diceRoll: z.array(z.number().int()),  // raw dice for replay
});

const EffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("damage"), targetSide: SideEnum, amount: z.number().int(), absorbedBy: z.array(...).default([]) }),
  z.object({ kind: z.literal("heal"),   targetSide: SideEnum, allocations: z.array(z.object({ characterId: EntityId, amount: z.number().int() })) }),
  z.object({ kind: z.literal("impede"),       targetSide: SideEnum }),
  z.object({ kind: z.literal("gainPosition"), targetSide: SideEnum }),
  z.object({ kind: z.literal("disarm"),       targetCharacterId: EntityId, weaponItemId: EntityId }),
  z.object({ kind: z.literal("rearm"),        actorId: EntityId, weaponItemId: EntityId }),
  z.object({ kind: z.literal("knockOut"),     characterId: EntityId }),
  z.object({ kind: z.literal("rejoin"),       characterId: EntityId }),
]);
```

### Help on a slot: TbConflictHelp

```ts
const TbConflictHelp = defineTrait({
  name: "@vtt/system-torchbearer/TbConflictHelp",
  schema: z.object({
    conflictId: EntityId,
    side: z.enum(["heroes","foes"]),
    slotIndex: z.number().int().min(0).max(2),
    entries: z.array(z.object({
      helperCharacterId: EntityId,
      source: z.enum(["skill","nature","wise"]),
    })),
  }),
});
```

`AddHelp` / `RemoveHelp` mutate this. Help is committed at the
moment of `LockScript` for that side; mid-round changes are not
allowed (rules don't re-roll mid-slot).

### Carry-over modifiers: TbConflictModifier

For Maneuver impede / gain-position effects that bind to the *next*
slot, plus Focus level-benefit and Sword's chosen-action bonus.

```ts
const TbConflictModifier = defineTrait({
  name: "@vtt/system-torchbearer/TbConflictModifier",
  schema: z.object({
    conflictId: EntityId,
    side: z.enum(["heroes","foes"]),
    appliesAtSlotIndex: z.number().int().min(0).max(2).nullable(), // null = sticky for conflict
    appliesToActions: z.array(ActionEnum),                          // empty = all
    polarity: z.enum(["bonus","penalty"]),
    type: z.enum(["dice","success","obStep"]),
    value: z.number().int(),
    source: z.string(),                                             // "maneuver-impede", "weapon:sword", "level:focus", ...
  }),
});
```

### Commands (client → server)

| Command                        | Payload                                                                                          | Validation                                                                |
|--------------------------------|--------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------|
| `DeclareConflict`              | `{ type, location, gmUserId, heroParticipantIds, foeParticipantIds }`                            | GM only. Location optional. Participants must exist & not in another live conflict. |
| `ElectCaptain`                 | `{ conflictId, captainCharacterId }`                                                              | Hero side may elect among themselves.                                     |
| `ChooseWeapon`                 | `{ conflictId, characterId, weaponItemId }`                                                       | Phase ∈ {weapons, betweenRounds}. Weapon must be in carrier's inventory.  |
| `RollDisposition`              | `{ conflictId, side }`                                                                            | Phase = disposition. Captain (heroes) or GM (foes).                       |
| `AssignHp`                     | `{ conflictId, side, allocations: [{ characterId, hp }] }`                                        | Phase = hp. Sum = side's `dispoMax`. Each ≥ 1 if assigned.                |
| `SetScriptSlot`                | `{ conflictId, side, slotIndex, action, performerId, weaponItemId }`                              | Phase = scripting. Captain on hero side, GM on foe side. Optimistic-OK.   |
| `ClearScriptSlot`              | `{ conflictId, side, slotIndex }`                                                                 | As above.                                                                 |
| `AddHelp` / `RemoveHelp`       | `{ conflictId, side, slotIndex, helperCharacterId, source }`                                      | Phase = scripting. Helper not knocked out, has applicable skill.          |
| `LockScript`                   | `{ conflictId, side }`                                                                            | All three slots filled. Captain (heroes) or GM (foes).                    |
| `RevealNextSlot`               | `{ conflictId }`                                                                                  | Both sides locked. Phase = reveal. GM-only.                               |
| `DistributeOverflowDamage`     | `{ conflictId, side, allocations: [{ characterId, amount }] }`                                    | Phase = awaitingDamageDistribution, side matches the side taking damage. Allocator is hero captain (heroes) or GM (foes). Sum equals pending overflow amount; no allocation to knocked-out targets. |
| `ApplyCompromise`              | `{ conflictId, conditions: [{ characterId, conditionId }], description }`                         | Phase = compromise. GM authoritative.                                     |
| `EndConflict`                  | `{ conflictId }`                                                                                  | Phase = compromise (or short-circuit by GM). Cleans up sentinels.         |

### Events (server → client)

Each command emits the analogous past-tense event. Some carry extra
server-allocated fields:

- `ConflictDeclared` includes the allocated `conflictId` plus all
  `participantId`s the server allocated for `TbConflictParticipant`
  entities.
- `DispositionRolled` includes the `RollResolved` analogue (dice +
  modifiers) so the chat row reuses the existing rolling pipeline.
- `ScriptSlotSet` is filtered: out-of-side recipients see only
  `{ slotIndex, status: "filled" }` (status ticker, no contents).
- `ScriptLocked` is broadcast in full.
- `SlotRevealed` is broadcast in full and carries the
  `ResolutionSchema` payload.
- `OverflowDamagePending { conflictId, side, leadCharacterId, totalDamage, overflowAmount }`
  emits when a damage effect produces overflow. Phase transitions to
  `awaitingDamageDistribution` and the reveal cascade pauses until
  `OverflowDamageDistributed` is emitted in response to a
  `DistributeOverflowDamage` command from the captain (heroes) or GM
  (foes). Both events are public — every recipient sees them — so
  the table can watch the captain hand-walk the damage.
- `ConflictEnded` carries `{ winner, suggestedCompromiseLevel }`.

### Side-scoping

Two filters apply to the hero side's wire output (and analogously
foe side):

1. **`TbConflictScript` reads** for `side="heroes"`: the hero side's
   userIds (every participant whose `OwnedBy.userId` matches a hero
   participant's owner, plus the GM if the slot is in a `revealed`
   sub-status). The GM never sees `filled` slot contents until
   `RevealNextSlot` for that index.
2. **`SetScriptSlot` event payload**: scrubbed to `{ slotIndex,
   status: "filled" }` for non-hero recipients. The GM sees the
   *fact* of locking but not the contents.

Implementation: piggyback on the existing per-recipient event filter
(used by private rolls) — register a filter for the
`@vtt/system-torchbearer/...` event names that consults
`TbConflict.captainCharacterId` and `TbConflictParticipant.side` to
compute the recipient set.

## The resolution algorithm

Pure function over locked scripts + traits. Lives in
`packages/system-torchbearer/src/conflict/server/resolve.ts`.

```ts
function resolveSlot(
  world: World,
  conflictId: EntityId,
  slotIndex: number,
  rng: Rng,
): Resolution
```

Steps:

1. **Look up matchup type** in `TB_ACTION_MATRIX[heroAction][foeAction]`.
   Yields one of `independent | versus | heroNoTest | foeNoTest`.
2. **Build each side's pool**, in order (matches `TbRollSpec`):
   - Base ability/skill rating from
     `TB_CONFLICT_TYPES[type].actionSkill[action]` looked up on the
     performer character. If rating is 0, fall to Beginner's Luck
     (half ability rounded up — DH p.59).
   - Apply weapon bonus: `TbWeapon.conflictBonuses[action]`.
     Includes the sword's chosen-action bonus via
     `TbConflictWeapon.chosenAction`.
   - Apply Help: count entries in `TbConflictHelp` for this
     `(side, slotIndex)`. +1D each.
   - Apply level benefits: Focus (+1s to chosen action type),
     Duelist (sword-reassign already covered by `chosenAction`),
     War Captain (double hero bonus +2s on Attack), etc. — read
     from a `TbCharacterLevelBenefits` trait if present.
   - Apply carried-over modifiers: `TbConflictModifier` rows for
     this `(side, slotIndex)` or sticky-for-conflict.
   - Apply condition penalties: Injured (−1D), Sick (−1D, stacks).
   - Apply factors: backpack (−1s, dispo only), dim light (−1s,
     dispo only — already applied at dispo roll), Angry skill list
     (−1s if action's skill is on the angry list, GM call).
3. **Set the obstacle** for this matchup:
   - Versus: no obstacle, MoS = winner's successes − loser's
     successes.
   - Independent: per-action Ob (Attack 0, Feint 0, Maneuver 0,
     Defend 3).
   - "No-test" cases: only the rolling side's pool is built.
4. **Roll**, compute successes (≥4 on each die — DH p.20).
5. **Compute effects**:
   - **Damage** (Attack winner of versus, Attack independent passer,
     Feint independent or versus winner, Feint vs Defend or vs
     Maneuver passer): `dmg = MoS` (versus) or `dmg = successes − Ob`
     (independent). Apply *lead character's* `TbConflictArmorState`
     absorption per the armor pipeline; bypassing weapons skip
     leather/chain as listed. Pre-overflow damage lands on the lead
     character, reducing HP by up to its current value. If HP would
     drop below 0, the remainder is **overflow** and is *not*
     absorbed by armor (SG p.65). The engine writes the lead's HP
     immediately, then if overflow > 0 emits
     `OverflowDamagePending` and transitions phase to
     `awaitingDamageDistribution`. **No auto-distribution**: the
     captain (heroes) or GM (foes) receives the pending amount and
     dispatches `DistributeOverflowDamage` with hand-allocated
     amounts to non-knocked-out teammates. The cascade resumes only
     after `OverflowDamageDistributed` fires.
   - **Heal** (Defend versus winner, Defend independent passer):
     versus → MoS pool; independent → `1 + MoS` pool. Allocate
     self-first whole, then teammate-by-teammate whole, never
     partial across teammates.
   - **Maneuver MoS effects**: read MoS, distribute among Impede /
     GainPosition / Disarm / Rearm per the player's choice
     (`SetManeuverEffects` command at reveal time, gated to the
     winner). For impede/gainPosition, write a
     `TbConflictModifier` with `appliesAtSlotIndex = slotIndex+1`.
     If `slotIndex+1 > 2`, the rule says effects are wasted (SG p.69).
6. **Knock-out / re-enter**: any participant whose HP drops to 0
   gets `knockedOut = true`. Any whose HP rises from 0 to ≥1 gets
   `knockedOut = false` (Regroup).
7. **Damage to disposition**: damage that lands on a participant
   reduces both that participant's HP and the side's
   `dispoCurrent`. Heals that *raise HP from 0* count as restoring
   1 to dispoCurrent (per "knocked out re-entered" rule). Heals to
   already-living participants do not raise dispoCurrent (only HP).
   *N.B. — reread SG p.65 here; this is the subtle bookkeeping that
   trips groups up at the table.*
8. **Win check**: if a side's dispoCurrent is 0 *and* the other
   side's is positive, that other side wins. Phase →
   `compromise`. If both sides hit 0 on the same slot, phase →
   `compromise` with `winner = "tied"`.

## UI contract — what reads what

| Component                    | Subscribes to                                                          | Renders                                                          |
|------------------------------|------------------------------------------------------------------------|------------------------------------------------------------------|
| `<TopStripe>`                | `TbConflict`                                                           | Type, location, round, reveal pointer, dispo bars                |
| `<RosterColumn side>`        | `TbConflictParticipant[]` filtered by side; per-character `TbWeapon`, `TbCondition*` | Name, HP pips, equipped weapon name, condition tags     |
| `<RoundBand>`                | `TbConflict`, both `TbConflictScript`s, `TbConflictHelp` for current slot | Captain row, GM row, resolution panel                       |
| `<ResolutionPanel>`          | Active slot's `Resolution` (from script's `revealed` status)           | Action names, rule text, dice, MoS, effects                      |
| `<ActionMatrix>`             | (static `TB_ACTION_MATRIX`, `TB_ACTION_RULES`) + active matchup        | 4×4 table; pulses active cell                                    |
| `<WeaponPanel side>`         | per-character `TbWeapon` for active side                               | A/D/F/M table + special text                                     |
| `<ArmorPanel>`               | `TbConflictArmorState[]` for both sides                                | Per-character armor + state                                      |
| `<ConditionsPanel>`          | per-character `TbCondition*`                                            | List of active conditions and rule text                          |
| `<CaptainInputStrip>`        | `TbConflictScript` for hero side (own writes via optimistic trait)     | Slot index, action chips, performer/weapon dropdowns, lock       |
| `<GmInputStrip>`             | `TbConflictScript` for foe side                                        | Same                                                             |
| `<RoundBreadcrumbs>`         | `TbConflict.round` history (re-emitted as `RoundResolved` events)      | Click to scrub                                                   |
| `<DamageDistributor>`        | `TbConflict.phase`, latest `OverflowDamagePending`, hit-side roster    | Pop-in on the side taking damage; lists participants with HP, lets captain/GM type or click to allocate the pending amount, blocks resume until summed and confirmed |

The optimistic trait wraps `TbConflictScript` for own-side writes
(`SetScriptSlot` / `ClearScriptSlot`); see
`design/optimistic-ui-state.md`. A new `<CaptainScriptOptimistic>`
provider holds the pre-confirmed slot state and merges with the
authoritative trait for display.

## Tests (mandatory)

### Unit (node project)

- **Action interaction matrix** — parameterised across all 16 cells
  of `(heroAction, foeAction)`, asserting matchup type and pool
  build:
  ```ts
  for (const ha of ACTIONS) for (const fa of ACTIONS) {
    test(`${ha} vs ${fa}`, () => { ... assert TB_ACTION_MATRIX[ha][fa] ... });
  }
  ```
- **Per-action resolve**: for every matchup type, given canned dice
  + canned modifier set, assert `Resolution` byte-for-byte.
- **Maneuver MoS effects**: each `MoS = 1..4` produces the right
  `Effect` set, with the rule that you can't repeat an effect type.
- **Armor pipeline**: leather absorb roll (4-6 absorbs),
  chain-after-absorb damage roll, plate vs mace, helmet
  one-and-done, shield destroyed-on-absorb, overflow-not-absorbed.
- **Condition penalties on dispo**: H&T −1s, Exhausted −1s
  (stacks-once), Injured −1D, Sick −1D, both Injured+Sick = −2D,
  Backpack −1s, dim light −1s, minimum starting dispo of 1.
- **Disposition tables**: every conflict type maps to the right
  skill / addto / per-action skills.
- **Per-action rule text** is non-empty for all four actions.
- **Sword chosen-action stickiness**: first roll with a sword sets
  `TbConflictWeapon.chosenAction`; subsequent rounds cannot reassign
  unless the character has Duelist (level 4 warrior).
- **Knocked-out cannot help**, cannot perform, cannot be performer
  in a `SetScriptSlot`.
- **Overflow damage halts the cascade**: when an Attack/Feint
  produces overflow, the engine emits `OverflowDamagePending`,
  transitions phase to `awaitingDamageDistribution`, and the next
  `RevealNextSlot` is rejected until `OverflowDamageDistributed`
  fires. Allocation rejects if the sum doesn't equal the pending
  amount, if any allocation targets a knocked-out participant, or
  if the dispatcher is not the side's captain/GM.
- **Win check**: dispo=0 / dispo>0 → win; both 0 same slot → tied.

Every command (`SetScriptSlot`, `LockScript`, `RevealNextSlot`,
etc.) gets given/when/then tests for validate (rejected paths) and
apply (events emitted).

### Wire smoke (`packages/server/src/conflict.smoke.test.ts`)

One smoke test that:
1. Boots the server with two clients (hero captain + GM) and a
   spectator.
2. `DeclareConflict` → `RollDisposition` (both sides) → `AssignHp`.
3. Both sides `SetScriptSlot` x3, `LockScript` each.
4. Asserts the spectator and the *opposing* userId received
   `ScriptSlotSet` events scrubbed to `{ status: "filled" }` with no
   action/performer/weapon. The own-side recipient sees full
   contents.
5. `RevealNextSlot` x3.
6. Asserts all recipients see the full `SlotRevealed` payloads.
7. Drives one side's dispo to 0 and asserts `ConflictEnded`.

This is *one* smoke. Behavior is unit-tested.

### Component (jsdom, `*.test.tsx`)

- `<RoundBand>`: harness with both scripts, asserts captain sees
  own filled chips face-up but GM-recipient harness sees
  face-down `?`.
- `<CaptainInputStrip>`: pressing `1`/`2`/`3`/`4` fills the action
  chip; selecting performer + weapon then `Enter` dispatches
  `SetScriptSlot`.
- `<ActionMatrix>`: hovering a chip in the round band highlights
  the matrix cell; clicking a cell expands rule text.
- `<WeaponPanel>`: pulses the active weapon's row during reveal.
- Reveal cascade: timed CSS transitions, asserted via
  `transition-end` events; resolution panel content matches
  the `Resolution` payload.
- Locked-row asymmetry: a hero teammate sees the captain's filled
  chips face-up; the GM-recipient harness sees the count but not
  contents.

Cross-plugin: `<RosterColumn>` reads `TbCondition*` from the
characters plugin, `TbWeapon` from the items plugin — each gets a
small `buildTestClient({ plugins: [characters, items, torchbearer] })`
test asserting the contract holds.

## File layout

```
packages/system-torchbearer/src/conflict/
  shared/
    actions.ts          # ActionEnum + TB_ACTION_MATRIX + TB_ACTION_RULES (statics)
    conflict-types.ts   # TB_CONFLICT_TYPES (statics)
    traits.ts           # TbConflict, TbConflictParticipant, TbConflictWeapon,
                        # TbConflictArmorState, TbConflictScript, TbConflictHelp,
                        # TbConflictModifier
    commands.ts         # DeclareConflict, RollDisposition, ..., EndConflict
    events.ts           # past-tense pairs
    resolution.ts       # ResolutionSchema, EffectSchema, TestResultSchema
    rules-text.ts       # TB_ACTION_RULES, TB_WEAPON_SPECIALS, TB_ARMOR_RULES,
                        # TB_CONDITION_RULES (display strings)
  server/
    resolve.ts          # resolveSlot pure function (uses the rules engine)
    armor.ts            # armor absorption pipeline
    helpers.ts          # pool building, modifier composition
    handlers.ts         # command apply functions
    systems.ts          # event → world mutations
    side-filter.ts      # per-recipient event filter for script secrecy
  client/
    ConflictPage.tsx    # route entry; sentinel-bound view
    TopStripe.tsx
    RosterColumn.tsx
    RoundBand.tsx
    ResolutionPanel.tsx
    ActionMatrix.tsx
    WeaponPanel.tsx
    ArmorPanel.tsx
    ConditionsPanel.tsx
    CaptainInputStrip.tsx
    GmInputStrip.tsx
    RoundBreadcrumbs.tsx
    optimistic.ts       # createOptimisticTrait wrapper for own-side script
    keybinds.ts
    styles.css          # tokens, type pairings, action chip colors
  manifest.ts            # additional registrations folded into main TB manifest
```

The TB plugin manifest grows two entries: a new sentinel kind
("conflict") with `ConflictPage` as its primary view, and the new
trait/command/event registrations. No new top-level plugin.

## Resolved decisions

These were earlier open questions; recorded here so the rationale is
preserved and not re-litigated.

1. **Damage distribution is captain-manual, no auto-allocation.**
   The lead character takes pre-overflow damage automatically
   (their armor applies), but any overflow halts the reveal
   cascade. The hit side's captain (heroes) or GM (foes) receives
   the pending amount and hand-walks each point of damage to a
   teammate via `DistributeOverflowDamage`. Rationale: at the table
   the captain wants this control on knockout-threshold rounds —
   the moment when the wrong default is most painful — and a
   one-time-per-conflict round-robin auto-default never feels
   right. Locked in the resolution algorithm and command table
   above.
2. **Conflicts pin characters, not players.** Once
   `DeclareConflict` lists a character as a participant, that
   character remains in the conflict regardless of whether the
   owning player is connected. A player disconnecting and
   reconnecting picks up via event replay; their character did not
   leave. The captain role is bound to a character id (not a user
   id), so the captain's character stays even if the player
   disconnects. *If the captain's character is knocked out*, the
   hero side may `ElectCaptain` to a new character. *If the
   captain's player disconnects but their character is still
   conscious*, the table waits for them, or any hero may
   `ElectCaptain` to take over (with table consensus); validate
   accepts re-election as long as the elector is on the same side.

## Deferred

Worth doing, not for v1. Each lands when the named adjacent system
arrives.

- **NPC scripting templates**: GMs may want to pre-script all foe
  rounds in advance. Defer until we have enough complex GM-side
  encounters for this to feel painful — easy to add as a
  `TbConflictNpcScriptTemplate` later.
- **Convince-conflict spend mechanics** (SG p.235-237): convince
  weapons that grant "+1D to one action of your choice" reuse the
  existing `TbConflictWeapon.chosenAction` field; the catalog rows
  ship when the convince-weapons catalog lands.
- **Boss monsters / Might differential** (SG p.62): the Order of
  Might and Precedence gives flat post-roll modifiers; encode as a
  `TbMightModifier` post-roll source when the bestiary plugin
  arrives.
- **Spell / invocation effects on disposition** (e.g. Wizard's Ægis
  +2s Defend, Balefire +3s Attack): the spells plugin will register
  itself as a roll-modifier provider through the existing
  `TbConflictModifier` shape; no engine changes needed here.
- **Armor inventory write-back**: chain/plate that gets damaged
  mid-conflict needs to flag its item entity's `TbItemDamaged`
  trait at `EndConflict` apply. Add `ApplyConflictArmorDamage` when
  the broader item-condition system lands.

## Implementation milestones

Each milestone leaves the system shippable.

### M1 — Static rules + read-only board

- `TB_ACTION_MATRIX`, `TB_ACTION_RULES`, `TB_CONFLICT_TYPES`,
  `TB_WEAPON_SPECIALS`, `TB_ARMOR_RULES`, `TB_CONDITION_RULES` as
  pure data.
- Component tests for `<ActionMatrix>`, `<WeaponPanel>`,
  `<ArmorPanel>`, `<ConditionsPanel>` rendering against canned
  fixtures (no live world).
- Aesthetic baseline: typography, color tokens, action chip colors.

### M2 — Sentinel + scripting (no resolution)

- `TbConflict`, `TbConflictParticipant`, `TbConflictWeapon`,
  `TbConflictScript`, `TbConflictHelp` traits.
- `DeclareConflict`, `RollDisposition`, `AssignHp`, `ChooseWeapon`,
  `SetScriptSlot`, `LockScript` commands.
- `<TopStripe>`, `<RosterColumn>`, `<RoundBand>`,
  `<CaptainInputStrip>`, `<GmInputStrip>` wired to the world.
- Side-scoped event filter live; wire smoke green.

### M3 — Resolution engine

- `resolveSlot` pure function and its 16-cell test matrix.
- Armor pipeline.
- Maneuver effects.
- `RevealNextSlot` command + reveal cascade in the UI.
- Condition penalties.
- `<ResolutionPanel>` populated.

### M4 — Round flow + breadcrumbs + compromise

- Between-rounds weapon reassignment + sword-bonus stickiness.
- Round breadcrumbs scrubbing.
- `EndConflict` + `ApplyCompromise` flow.
- Compromise UI panel walking the table through the negotiation.

### M5 — Polish

- Help affordances surfaced inline on the captain's input strip.
- Optimistic-trait wiring for snappy slot fills.
- Damage-allocation override pop on knockout-threshold damage.
- Keyboard help overlay (`?` shortcut).
- Asset cache audit: every weapon icon used here is the same
  `Assets.cache` key as the inventory tab and the scene token.

## Anti-patterns to refuse

- Any view subscribing to `SlotRevealed` events instead of
  `TbConflictScript` trait signals (exception: chat-style
  log-emitters elsewhere may listen to events; not in this UI).
- Any client computing damage / MoS / who-won-the-versus. Server
  authority absolute.
- Any path that lets a non-captain player call `SetScriptSlot` for
  the hero side, or a non-GM call it for the foe side. Validate
  hard.
- Any path that lets the GM read an unrevealed hero slot's
  `action`/`performer`/`weapon` (or vice versa). The wire filter is
  the only place this rule is enforced; do not duplicate the filter
  client-side, that creates an attack surface where a malicious
  client could lie to itself.
- Any "predict the action" UI logic that reaches into the opponent's
  `TbConflictScript`. The Round column's "what would happen"
  preview is hover-only on *your own* chip and runs against a
  uniform prior.
- Any trait that mutates in-place. Atomic `world.set` only.
- Any system dispatching commands. Systems emit events.
- Any "card flip" 3D animation. Chips just change color and label.
- Skeuomorphic textures — parchment, wax, brass — anywhere.
