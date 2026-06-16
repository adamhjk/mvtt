# Torchbearer Conflict — Reference Board

The Torchbearer 2e **conflict** subsystem (kill, drive off, capture,
convince, flee, pursue, trick / riddle). This is the screen the GM
opens at the table while running a conflict. It is a **play aid**,
not a resolution engine — players roll dice on their own character
sheets; the screen surfaces the rules, tracks state, and orchestrates
secrecy + reveal.

Rule references are to the printed page. `DH` = Dungeoneer's
Handbook (e3); `SG` = Scholar's Guide (e6); `LM` = Loremaster's
Manual (e56). Page numbers are the printed-page numbers.

## Philosophy

**Facilitation, not automation.** The original design (preserved in
git history) tried to automate resolution end-to-end: dice rolling,
armor absorption, overflow distribution, HP / dispo bookkeeping,
maneuver-effect application, knock-out triggers. That collapsed
under its own weight and added friction — the GM kept needing to
override the engine. The current screen does none of that. It:

1. **Shows the rules** that matter right now (action interaction
   matrix, conflict-type skill table, weapons / armor at a glance).
2. **Tracks the script** with side-scoped secrecy (party-side picks
   are hidden from the GM until lock; enemy picks hidden from the
   party until lock; reveal flips slots one at a time).
3. **Tells each side what to roll** when a slot is revealed — V/I/—
   per the matrix, the right skill per the conflict type, the
   obstacle for independent tests. The captain rolls on their
   character sheet.
4. **Tracks HP and disposition** as numbers the GM types (with
   conveniences — see "Disposition allocation" below).

**No state machine.** There is no `phase` field. Anyone with the
right role can do anything at any time. Two sentinels are the only
read-only locks:

- `winner !== null` → a side's dispo hit zero; compromise UI surfaces.
- `endedAt !== null` → GM clicked "End conflict"; the conflict is
  archived and read-only.

## Sides + the Team trait

Two sides, named `"party"` and `"enemy"` everywhere — wire format,
trait values, UI labels. The party side is the player team; the
enemy side is the GM team. (Originally `"heroes"` / `"foes"`;
renamed pre-launch with no migration shim.)

The `Team` trait on `@vtt/characters` (the bounded context that
owns characters) carries the persistent allegiance:
`Team.kind: "party" | "enemy"`. A character's team determines which
side it joins by default when the GM declares a conflict and which
participants count for team-wide condition penalties (Hungry &
Thirsty, Exhausted) on disposition rolls.

The user **role** ("gm" / "player") is the substrate concept and is
unrelated to team allegiance. A GM can have player characters on
the party team; an enemy NPC can be controlled by anyone the GM
delegates to.

## Conflict types

A conflict is one of nine types. Each pins a **disposition skill**
(captain rolls this to compute starting dispo) and a **per-action
skill table** (which skill each action tests at reveal time). All
data is in `TB_CONFLICT_TYPES` and matches SG p.70 / LM p.106:

| Type            | Disposition roll  | Add to | Attack / Feint   | Defend / Maneuver | Armor? |
| --------------- | ----------------- | ------ | ---------------- | ----------------- | ------ |
| Kill            | Fighter           | Health | Fighter          | Health            | Yes    |
| Drive Off       | Fighter           | Health | Fighter          | Will              | Yes    |
| Capture         | Fighter or Hunter | Will   | Fighter / Hunter | Hunter / Fighter  | Yes    |
| Convince        | Persuader         | Will   | Persuader        | Manipulator       | No     |
| Convince Crowd  | Orator            | Will   | Orator           | Manipulator       | No     |
| Flee            | Scout or Rider    | Health | Scout or Rider   | Health            | No     |
| Pursue          | Scout or Rider    | Health | Scout or Rider   | Health            | No     |
| Trick or Riddle | Manipulator       | Will   | Manipulator      | Lore Master       | No     |
| Other           | (GM-defined)      | (GM)   | (GM)             | (GM)              | No     |

`actionSkill[action]` is always a `readonly string[]`: length 1 for
fixed skills, length 2 for choose-one (Capture's Attack/Defend,
Flee/Pursue's Attack/Feint). The UI joins multi-element entries
with " or " (`actionSkillLabel`).

The DispositionBox surfaces a one-line prompt under the readout —
e.g. "Roll Fighter and add to Health for disposition" — derived by
`dispoRollLabel(typeDef)`. `Other` returns `null`.

## Action interaction matrix (SG p.70)

The single most consulted rule at the table. Encoded in
`TB_ACTION_MATRIX` verbatim from the book — three values, one per
cell:

|              | Attack | Defend | Feint | Maneuver |
| ------------ | ------ | ------ | ----- | -------- |
| **Attack**   | I      | V      | I     | V        |
| **Defend**   | V      | I      | —     | V        |
| **Feint**    | —      | I      | V     | I        |
| **Maneuver** | V      | V      | I     | I        |

`V` = versus test (single shared roll, MoS to winner). `I` =
independent test (your obstacle: 0 for Attack/Feint/Maneuver, 3
for Defend). `—` = your action does not roll; opponent does.

**The matrix is asymmetric.** `[defend][feint] = "—"` but
`[feint][defend] = "I"`. Each side **reads its own row**: party
reads `[partyAction][enemyAction]`, enemy reads `[enemyAction][partyAction]`.
That's the SG p.70 rule "find your action on the left and your
opponent's action along the top row."

The shared helper is `testForAction(myAction, opponentAction):
"versus" | "independent" | "noTest"`. The chat-row rendering and the
per-slot reveal panels both call into it.

The four asymmetric Feint cases (each row independently):

- Defend(party) vs Feint(enemy) → party `noTest`, enemy `independent`
- Feint(party) vs Defend(enemy) → party `independent`, enemy `noTest`
- Attack(party) vs Feint(enemy) → party `independent`, enemy `noTest`
- Feint(party) vs Attack(enemy) → party `noTest`, enemy `independent`

These four cases drive a comprehensive 16-cell parameterised test
in `conflict.test.ts` plus a per-side jsdom test in
`ResolutionRow.test.tsx`.

## Data model

Four traits, no helper traits:

```ts
TbConflict; // sentinel — one per active conflict
TbConflictParticipant; // one per PC / NPC in the conflict
TbConflictWeapon; // per-character weapon binding for this conflict
TbConflictScript; // one per side — three slots, locked flag
```

### TbConflict

The conflict sentinel. **Publicly readable** (no `Permissions`
companion → default everyone-read). Holds:

- `type`, `locationLabel`, `captainCharacterId`, `gmUserId`
- `round` (1+), `revealIndex` (0–3 — number of slots revealed in
  the current round)
- `partyLocked`, `enemyLocked` — public mirror of each side's
  `TbConflictScript.locked`. Players can read these even though
  they can't read the opposing script.
- `revealedSlots: [RevealedSlotEntry|null, …, …]` — public mirror
  of revealed slot contents. Each entry carries both sides'
  action/performer/weapon. Mirroring onto the conflict (which is
  publicly readable) is what lets non-side viewers see reveals; the
  script entities themselves stay permission-restricted.
- `dispoParty: { current, max }`, `dispoEnemy: { current, max }`
- `winner: "party" | "enemy" | "tied" | null` — flips when a side's
  dispo hits 0
- `endedAt: number | null` — wall-clock ms when the GM called
  `EndConflict`. The only true read-only sentinel.

There is **no** `phase` field. Earlier iterations had a 10-state
machine; it was deleted entirely after the team agreed it was
state-machine cosplay over what is really "the GM types numbers
into a screen".

### TbConflictParticipant

One row per character in the conflict. `{ conflictId, side,
characterId, hp, hpMax, knockedOut }`. Conflict-local state only;
the character's name, conditions, weapons inventory, etc. are read
**live** from the bound `characterId` so renames / condition flips
propagate automatically.

`hp` is the play-time current; `hpMax` is the allocated amount for
this conflict (the dispo distribution). `knockedOut` is a derived
flag the server sets whenever `hp === 0` (or `hp > 0` from 0 = un-KO).

### TbConflictWeapon

One row per `(conflict, character)` who has equipped a weapon for
this fight. `{ weaponItemId, chosenAction }`. `chosenAction` is the
sticky pick for weapons whose bonus binds to one action of the
captain's choice (Sword's "+1D one action, sticks all conflict" —
DH p.159). The first time the captain rolls with a sword in this
conflict, this field locks; subsequent rounds can't re-pick.

### TbConflictScript

Per-side script. **Permission-restricted**: party side readable +
writable by party participants' owners and the GM; enemy side by
the GM only. Carries `{ side, locked, slots: [s0, s1, s2] }`.

Each slot is `empty | filled | revealed`. `filled` and `revealed`
have the same payload (`action`, `performerCharacterId`,
`weaponItemId`); the difference is wire visibility.

A `tb-disposition` filter on `ScriptSlotSet` events scrubs `filled`
slot contents to `empty` when broadcasting to out-of-side recipients —
the opposing side sees a mute "they've filled three slots" without
the contents.

## Commands → events → systems

### Lifecycle

| Command         | Validate                           | Event            | System action                                                                  |
| --------------- | ---------------------------------- | ---------------- | ------------------------------------------------------------------------------ |
| DeclareConflict | GM only; captain exists            | ConflictDeclared | Spawn the conflict + two scripts (with side-scoped Permissions) + participants |
| ElectCaptain    | GM or party participant; not ended | CaptainElected   | Update `captainCharacterId`                                                    |
| EndConflict     | GM only                            | ConflictEnded    | Set `winner` (defaults to whatever's already there, or "tied") + `endedAt`     |

### Disposition + HP

| Command            | Validate              | Event              | System action                                                                                       |
| ------------------ | --------------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| RollDisposition    | (no phase gate)       | DispositionRolled  | Compute `successes - condition penalties + addToBase`, clamp ≥ 1, write `dispo{Side}.{current,max}` |
| SetTeamDisposition | GM only               | TeamDispositionSet | Write `dispo{Side}.{current,max}` directly                                                          |
| AssignHp           | sum equals dispo max  | HpAssigned         | Set each participant's `hp = hpMax = allocation`                                                    |
| SetParticipantHp   | GM only; `hp ≤ hpMax` | ParticipantHpSet   | Set the row's `hp/hpMax`; `knockedOut = (hp === 0)`                                                 |

The DispositionBox UI uses the direct-edit commands almost
exclusively; `RollDisposition` exists primarily for the rolling
pipeline integration (see "Pending-roll integration" below).

### Weapons

| Command      | Validate        | Event                | System action                                                                         |
| ------------ | --------------- | -------------------- | ------------------------------------------------------------------------------------- |
| ChooseWeapon | (no phase gate) | ConflictWeaponChosen | Upsert `TbConflictWeapon` for the (conflict, character). `chosenAction` stays sticky. |

### Script

| Command         | Validate                                      | Event             | System action                                                                                                                           |
| --------------- | --------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| SetScriptSlot   | side captain or GM; performer on side, not KO | ScriptSlotSet     | Flip slot to `filled` with action/performer/weapon                                                                                      |
| ClearScriptSlot | side captain or GM                            | ScriptSlotCleared | Flip slot back to `empty`                                                                                                               |
| LockScript      | side captain or GM; all 3 slots filled        | ScriptLocked      | Set `script.locked = true`; mirror to `conflict.{side}Locked = true`                                                                    |
| UnlockScript    | side captain or GM                            | ScriptUnlocked    | Set `script.locked = false`; mirror to `conflict.{side}Locked = false`                                                                  |
| RevealNextSlot  | GM only; both sides locked; `revealIndex < 3` | SlotRevealed      | Flip both sides' slot at `revealIndex` from `filled` → `revealed`; mirror payloads onto `conflict.revealedSlots[i]`; bump `revealIndex` |
| AdvanceRound    | GM only                                       | RoundAdvanced     | Clear both scripts (slots → empty, locked → false), reset `revealIndex` to 0, clear `revealedSlots`, clear lock mirrors, bump `round`   |

### Compromise

| Command         | Validate | Event             | System action                                                                                            |
| --------------- | -------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| ApplyCompromise | GM only  | CompromiseApplied | (descriptive — conditions land on characters via downstream commands; the system today is a no-op trace) |

### Side-scoped event filtering

The substrate's per-recipient event filter scrubs script-related
events for out-of-side recipients:

- `ScriptSlotSet` / `ScriptSlotCleared` for `side="party"` →
  visibility = party userIds + GM only. Other clients never see
  the event. Their local mirror sees the side as if no slot was
  filled (the lock indicator surfaces via the public `partyLocked`
  flag on the conflict).
- Same for `side="enemy"` → GM only.
- `ScriptLocked` and `ScriptUnlocked` are **public** — non-side
  recipients update their `conflict.{side}Locked` mirror and learn
  "they've locked" without learning what they picked.
- `SlotRevealed` is **public** — broadcast to everyone. The mirror
  flips slot statuses on both script traits and writes the public
  `conflict.revealedSlots[i]` so non-side viewers can read the
  revealed pair.

## UI layout

A single page, top-down sections:

```
┌── TopStripe ───────────────────────────────────────────────────────────────┐
│ KILL · Dread Crypt · round 2 · 1/3 revealed              [End conflict]    │
├──────────────────────────────────────┬─────────────────────────────────────┤
│ PARTY                                │ ENEMY                               │
│  Disposition                         │  Disposition                        │
│   ┌── bar ──────────────┐ 14 / 17    │   ┌── bar ──────────┐ 9 / 12        │
│   Cur [14] Max [17]                  │   Cur [9]  Max [12]                 │
│   "Roll Fighter and add to Health"   │   "Roll Fighter and add to Health"  │
│   allocated 14 / 17 HP               │   allocated 9 / 12 HP               │
│                                      │                                     │
│  Beren    [−] 4 [+] / [4]   Sword▾   │  Skel A   [−] 3 [+] / [3]  Sword▾   │
│  Karolina [−] 3 [+] / [3]   Bow▾     │  Skel B   [−] 3 [+] / [3]  Sword▾   │
│  Gerald   [−] 4 [+] / [4]   Staff▾   │  Captain  [−] 3 [+] / [3]  Mace▾    │
│  Varg     [−] 3 [+] / [3]   Hand axe▾│                                     │
│                                      │                                     │
│  Script                              │  Script                             │
│  ┌──┬─────────────────────────────┐  │  ┌──┬───────────────────────────┐   │
│  │1 │ A D F M  Beren ▾            │  │  │1 │ A D F M  Skel A         ▾ │   │
│  │2 │ A D F M  Karolina ▾         │  │  │2 │ A D F M  Captain        ▾ │   │
│  │3 │ A D F M  Gerald ▾           │  │  │3 │ A D F M  Skel B         ▾ │   │
│  └──┴─────────────────────────────┘  │  └──┴───────────────────────────┘   │
│       [ Lock script ]                │       [ Lock script ]               │
├──────────────────────────────────────┴─────────────────────────────────────┤
│ ROUND 2 — reveal 1/3                              [ Reveal action 2 → ]    │
│                                                                            │
│  ┌── Slot 1 ──── ATTACK vs DEFEND ─────────── Versus test ────────┐        │
│  │ ┌──── PARTY · Beren ──────┬──── ENEMY · Skel A ─────────────┐  │        │
│  │ │ V  roll Fighter         │ V  roll Health                  │  │        │
│  │ │ versus your opponent's  │ versus your opponent's pool —   │  │        │
│  │ │ pool — winner's MoS     │ winner's MoS counts             │  │        │
│  │ │ counts                  │                                 │  │        │
│  │ └─────────────────────────┴─────────────────────────────────┘  │        │
│  └────────────────────────────────────────────────────────────────┘        │
│                                                                            │
│  ┌── Slot 2 ──── FEINT vs DEFEND ─── Enemy forfeits ──[Reveal action 2 →]┐ │
│  │ Defender forfeits and does not test. Feinter rolls Ob 0 vs HP.        │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌── Slot 3 ──── awaiting earlier action ────────────────────────────────┐ │
│  └───────────────────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────────────────┤
│  ACTION INTERACTION TABLE                                       SG p.70   │
│            Attack    Defend    Feint   Maneuver                            │
│  Attack       I        V         I        V                                │
│  Defend       V        I         —        V                                │
│  Feint        —        I         V        I                                │
│  Maneuver     V        V         I        I                                │
│  Find your action on the left and your opponent's action along the top.   │
│  I — independent · V — versus · — — do not roll                           │
├────────────────────────────────────────────────────────────────────────────┤
│  PARTY WEAPONS — Bonuses & Specials                                        │
│  PARTY ARMOR — Equipped                                                    │
│  ENEMY WEAPONS — Bonuses & Specials                                        │
│  ENEMY ARMOR — Equipped                                                    │
│  ▸ Armor rules (DH p.150-151)                                              │
├────────────────────────────────────────────────────────────────────────────┤
│  CONDITIONS IN PLAY                                                        │
└────────────────────────────────────────────────────────────────────────────┘
```

### Disposition box

- Two compact inputs: **Cur** and **Max**. When `Max` is changed and
  current was 0, current snaps up to match (the captain just rolled
  dispo, scoreboard starts full). Otherwise current is preserved
  (clamped down if max shrinks).
- One-line prompt under the readout: "Roll {skill} and add to
  {ability} for disposition", derived from the conflict type.
- Bar colour reflects compromise tier (SG p.75):
  - `current === max` → **green** (no compromise)
  - `> 50%` → **yellow** (minor)
  - `> 25%` → **orange** (half)
  - `≤ 25%` → **red** (major, or 0 / defeated)
  - Both party and enemy bars use the same scheme. The `data-compromise`
    attribute on the bar wrapper is `"full" | "minor" | "half" | "major" | "none"` for any test or styling hook.
- Allocation ticker: sum of party HPs vs side max, green when matched
  / amber when not.
- Engagement warning: italic prompt when any participant has `hpMax < 1`
  ("X participant(s) need at least 1 HP to engage" — SG p.63
  "minimum starting disposition is 1").

### Participant row (one line)

```
Name [ko]    [−] cur [+] / [max]   weapon ▾
```

- Name flexes left, with KO badge.
- HP stepper: `−`/`+` adjust **current** only (clamped to `[0, hpMax]`).
  Damage clicks `−`; Defend regroup clicks `+`. Each click also
  dispatches `SetTeamDisposition` with the matching delta — per
  SG p.65, damage and Defend regroup move side dispo by the same
  amount. The dispo bar tracks live.
- Max: a small editable text field. Typing a new max sets `hpMax`;
  if current was at the previous max (undamaged), current also
  follows so allocation feels like a single number. Once damage
  lands, max is independent.
- Weapon dropdown: every weapon the character carries (hand, pack,
  belt — not just hand-slotted). Clicking dispatches `ChooseWeapon`.
- Visual: undamaged HP `text-fg`; damaged-alive `text-fg-muted`;
  zero `text-danger`; max field `border-warning text-warning` when
  `< 1`.

### Script section (per side)

Three rows, one per slot. Each row: `[slot #] [A] [D] [F] [M] [performer ▾]`.

- Clicking a chip OR changing the performer dropdown auto-dispatches
  `SetScriptSlot` — no per-row confirm.
- Single Lock toggle at the bottom. When all three slots are filled,
  it's enabled; clicking sends `LockScript`. Once locked it relabels
  to "Unlock script" and dispatches `UnlockScript`.
- Captain (party side) sees own filled chips face-up; teammates see
  same; the GM sees `?` until reveal. Symmetric for enemy / GM.

### Reveal cascade

Once both sides are locked (`partyLocked && enemyLocked`), three
slot cards render. Each card is one of:

- **revealed** — both sides' slot is revealed. Body shows X vs Y
  matchup chip + per-side panels with `V`/`I`/`—` symbol, "roll
  {Skill}" or "do not roll", and the obstacle for independent tests.
  A small header chip says "Versus test" / "Independent test" /
  "Party forfeits" / "Enemy forfeits" depending on the matchup.
- **next** — pending the reveal click. GM sees a `Reveal action N →`
  button; players see "waiting for the GM to reveal…".
- **pending** — slot index > revealIndex. Dimmed; awaits earlier
  reveal.

After all three slots resolve (`revealIndex === 3`), the round
header's button changes to `Advance to round N+1 →`. Manual; no
auto-advance. The GM clicks once the table has finished
applying damage / heal / etc. on character sheets.

### Per-side facilitation prompt — testForAction in detail

Each side independently looks up its own row of `TB_ACTION_MATRIX`:

```ts
function testForSide(side, partyAction, enemyAction): MatchupCell {
  // Per SG p.70: "find your action on the left, opponent's along the top"
  const myAction = side === "party" ? partyAction : enemyAction;
  const oppAction = side === "party" ? enemyAction : partyAction;
  return testForAction(myAction, oppAction);
}
```

The `SideColumn` UI calls `testForAction(myAction, oppAction)`
directly — no party/enemy reordering, no chance of the lookup
flipping. The corresponding skill is read from
`TB_CONFLICT_TYPES[conflict.type].actionSkill[myAction]`; the
obstacle from `TB_ACTION_INDEP_OB[myAction]` (Defend = 3, others = 0).

## Roll-disposition flow

Two paths land at the same place:

### 1. Manual entry

The GM types the captain's rolled total directly into the dispo
**Max** field. Current auto-snaps to match. This is the fast path
when the table just wants to get on with it.

### 2. Pending-roll panel "switch to disposition"

Any TB skill / ability / nature roll has a `switch to disposition`
toggle in the pending-roll panel. When toggled on, the panel adds:

- A team-penalty modifier (Hungry & Thirsty −1s, Exhausted −1s)
  computed across every party-tagged character.
- A **Will / Health** picker — required, since the dice pool is the
  skill rating but the _additive base_ is the captain's Will or
  Health rating. Skipping the pick leaves an italic warning ("pick
  Will or Health — required for the dispo math") and the chat row
  falls back to `baseDice` (correct for Will / Health rollables
  themselves; wrong for any skill).

The pending-roll spec carries `dispoBase` (the resolved Will/Health
rating) and `dispoAddTo` ("will" | "health") so the chat row's
`dispositionValue` formula is:

```
dispositionValue = max(1, dispoBase + rawSuccesses + always)
```

Per SG p.47 floor of 1.

The chat row then displays the rolled total prominently as the
disposition number; the GM types it into the dispo Max input and
the conflict scoreboard fills in.

(There is no automatic write-back from a disposition-mode roll to
the conflict's dispo trait. That deliberate gap is to keep
"facilitation, not automation" honest — the GM signs off on the
number that lands.)

## File layout

```
packages/system-torchbearer/src/conflict/
  shared/
    actions.ts          ConflictActionEnum, TB_ACTION_MATRIX (V/I/—),
                        TB_ACTION_INDEP_OB, TB_ACTION_RULES,
                        TB_MANEUVER_*, testForAction
    conflict-types.ts   TB_CONFLICT_TYPES (9 types), DispoSkillSpec,
                        skillLabel, actionSkillLabel, dispoRollLabel
    sides.ts            ConflictSideEnum (party | enemy), otherSide
    resolution.ts       ScriptSlot schema (empty / filled / revealed)
    traits.ts           TbConflict, TbConflictParticipant,
                        TbConflictWeapon, TbConflictScript
    commands.ts         16 commands (lifecycle / dispo / weapon /
                        script / reveal / round / compromise / end)
    events.ts           14 events (one per command + the public mirrors)
    rules-text.ts       TB_ARMOR_RULES, TB_CONDITION_RULES,
                        TB_MATCHUP_NOTES, TB_COMPROMISE_LEVELS,
                        TB_DISPO_FACTOR_REMINDERS
  server/
    systems.ts          Mirror systems for every event (~15 systems)
  client/
    ConflictPage.tsx    Hub (declare form) + Board entry
    TopStripe.tsx       Type / location / round + reveal counter
    TeamColumn.tsx      DispositionBox + ParticipantRow + ScriptInline
                        (per side; left = party, right = enemy)
    ScriptInline.tsx    3 slot rows + Lock/Unlock toggle
    ResolutionRow.tsx   Reveal cascade (3 slot cards + advance-round
                        button)
    ActionMatrix.tsx    SG p.70 table, hover-row/col dimming, click
                        row label to expand rule text
    WeaponPanel.tsx     Per-side weapon table (table-fixed layout,
                        compact special column)
    ArmorPanel.tsx      Combined wrapper + exported ArmorSidePanel +
                        ArmorRulesLegend (used directly by ConflictPage
                        to interleave with weapons)
    ConditionsPanel.tsx Per-character active conditions
    CompromisePanel.tsx Surfaces when winner !== null && endedAt === null
    hooks.ts            useConflict, useScript, useParticipants,
                        useWeaponBindings, useEquippedArmor,
                        useCharacterName
    styles.ts           ACTION_COLORS / LABELS / LETTERS
```

The TB plugin manifest registers all four traits, every command +
event, and every system in this directory.

## Tests

### Unit (node)

- `conflict.test.ts` — pure-data tests for `TB_ACTION_MATRIX`,
  `TB_CONFLICT_TYPES`, `dispoRollLabel`. The matrix is asserted
  cell-by-cell against a `BOOK` constant (16 cases × 2 — direct +
  via `testForAction`). Each conflict type's prompt is asserted by
  string match.
- `commands.test.ts` — given/when/then for every command. Covers
  the Will/Health distinction in `RollDisposition`, the side-scoped
  visibility on `SetScriptSlot`, the reveal cascade, the
  participant HP / dispo plumbing.
- `visibility.test.ts` — out-of-side recipients can't see filled
  slot contents but can see the `partyLocked`/`enemyLocked` mirror.

### jsdom (component)

- `ResolutionRow.test.tsx` — load-bearing. Mounts the reveal
  cascade for all four asymmetric Feint matchups + symmetric
  matchups + per-conflict-type skill mapping + matchup header chip.
  Each side's column is asserted independently via `data-testid="test-symbol"`'s
  `data-kind` attribute. Catches "the enemy column shows the party's
  row's value" bugs (the bug class that motivated the testForAction
  refactor).
- `RoundBand.test.tsx` — legacy script-row component; covers
  face-down vs face-up chip rendering and the matrix table render.
- `lp-repro.test.tsx` — TeamColumn rendering with party-on-enemy-team
  characters (regression test).

### Wire smoke

There's no dedicated `conflict.smoke.test.ts` today — the visibility
test exercises the per-recipient filter logic at the trait level.
Worth adding when the wire format changes.

## Locked decisions (the simplifications)

These are calls we explicitly made and don't intend to relitigate:

1. **No phase state machine.** The original design had 10 phases
   (`declared → weapons → disposition → hp → scripting → reveal →
awaitingDamageDistribution → betweenRounds → compromise → ended`)
   and validated transitions on every command. Deleted entirely.
   Two sentinels (`winner`, `endedAt`) carry the only meaningful
   coarse states.

2. **No automatic resolution.** No dice rolling, no margin-of-success
   computation, no armor absorption pipeline, no maneuver-effect
   application, no overflow distribution, no auto-knock-out. Players
   roll on character sheets; the GM types numbers in.

3. **No conflict-local help / armor-state / modifier traits.** The
   original `TbConflictHelp`, `TbConflictArmorState`, and
   `TbConflictModifier` traits — required by the resolution engine
   — are gone. Help is tracked on character sheets; armor state is
   tracked on character sheets; cross-slot modifiers (impede,
   gain-position) are tracked verbally at the table.

4. **Public mirror on the conflict trait.** `partyLocked`,
   `enemyLocked`, `revealedSlots[3]` live on the publicly-readable
   `TbConflict` so non-side viewers can see lock + reveal state
   without read access to the opposing script entity.

5. **Sides are `party` / `enemy`.** Pre-launch rename from
   `heroes` / `foes`. No compat shim, no migration code.

6. **Damage / heal HP stepper auto-syncs side dispo** per SG p.65.
   The one piece of automation we kept because it removes
   double-clicks from the natural play flow without changing any
   rules.

## Anti-patterns to refuse

From the original design doc and reaffirmed:

- Reintroducing a phase state machine in any form. If a piece of
  state seems to need gating, it probably needs a `winner` /
  `endedAt` check or nothing at all.
- Computing damage, MoS, or who-won-the-versus on either side. The
  table does that.
- Allowing a non-captain player to script the party side or anyone
  but the GM to script the enemy side. Validate hard.
- Letting the GM read an unrevealed party slot's contents (or
  vice versa) before reveal. The wire filter is the only place
  that's enforced; do not duplicate it client-side.
- Reading `phase` anywhere in the code or tests. The field does
  not exist.
- Mutating a trait in place. Atomic `world.set` only.
- A system dispatching commands. Systems emit events.

## Deferred

Worth doing later, not now:

- **NPC scripting templates.** A "preset enemy script" the GM can
  apply per round — easy add when complex GM-side encounters become
  painful to script live.
- **Roll-to-dispo write-back.** Have the chat row offer a "send to
  dispo" button on a `dispositionMode` roll that dispatches
  `RollDisposition` directly. Would skip the GM's manual type-in
  step. Valuable but not urgent.
- **Conflict.smoke.test.ts.** End-to-end wire test that boots the
  server with two clients + a spectator, declares + locks + reveals,
  and asserts script visibility filtering.
- **Reveal-cascade animation.** CSS transitions on chip flip.
  Today the cards just appear/change.
- **Round breadcrumbs.** Click R1 to scrub the matrix highlights /
  resolution panel back to that round's revealed state. Would need
  per-round revealed-slot history (today only the current round's
  slots are tracked publicly).
- **Spell / weapon-special handlers** that _want_ automation
  (specific weapon bonuses surfacing as roll modifiers). Best
  introduced as opt-in helpers from the rolling subsystem rather
  than a return to engine-driven resolution.
