# Dice notation recipes by RPG system

Worked examples translating common game mechanics into rpg-dice-roller notation. Each entry shows what the mechanic looks like at the table, then the notation, then any caveats.

The DSL has no variables, so anywhere a recipe writes `+MOD` or `+PROF` you'll substitute the number before handing the string to the parser. Plug in `+3` for a +3 modifier, etc.

## Table of contents

- [D&D 5e](#dd-5e)
- [D&D 3.5 / Pathfinder 1e / OSR](#dd-35--pathfinder-1e--osr)
- [Pathfinder 2e](#pathfinder-2e)
- [FATE / Fudge](#fate--fudge)
- [World of Darkness / Storyteller / Storypath](#world-of-darkness--storyteller--storypath)
- [Shadowrun](#shadowrun)
- [Burning Wheel / Mouse Guard / Torchbearer](#burning-wheel--mouse-guard--torchbearer)
- [Savage Worlds](#savage-worlds)
- [Cypher System](#cypher-system)
- [Year Zero Engine](#year-zero-engine)
- [Powered by the Apocalypse / Forged in the Dark](#powered-by-the-apocalypse--forged-in-the-dark)
- [Call of Cthulhu / BRP percentile](#call-of-cthulhu--brp-percentile)
- [GUMSHOE](#gumshoe)
- [Genesys / Star Wars FFG narrative dice](#genesys--star-wars-ffg-narrative-dice)
- [Generic helpers](#generic-helpers)

---

## D&D 5e

### Attack rolls
```
d20+MOD                    # straight roll
2d20kh1+MOD                # advantage
2d20kl1+MOD                # disadvantage
3d20kh1+MOD                # "elven accuracy" / triple advantage
```
Crit detection is cosmetic (`cs>=19`). Game effects (extra damage dice on a crit) must be handled by the consuming code — pre-compose two notations: a normal damage roll and a "crit" damage roll.

### Saving throws and ability checks
Same shape as attacks. For "halfling lucky" (reroll a 1 once on the d20):
```
d20ro=1+MOD                # rerolls a single rolled 1, keeps the new value
2d20kh1ro=1+MOD            # halfling with advantage
```

### Damage
```
2d6+3                      # longsword + STR
1d8+1d6+5                  # weapon + sneak attack + DEX
8d6                        # fireball
8d6/2                      # fireball, save for half (you'll round however the system needs)
floor(8d6/2)               # fireball half damage rounded down
```

### Crit damage
On a crit, 5e doubles the dice (not the modifier):
```
4d6+3                      # 2d6+3 doubled, mod added once
```

### Great Weapon Fighting (reroll 1s and 2s once on weapon damage)
```
2d6ro<=2+3                 # reroll any 1 or 2 once, keep the new value
```

### Sharpshooter / Power Attack toggles
Just arithmetic:
```
d20+MOD-5                  # -5 to hit
2d6+3+10                   # +10 damage
```

### Healing
```
2d4+2                      # cure wounds at 1st level
```

### Death saves
Pure d20, success on ≥10. The success/failure tracking is bookkeeping, not notation:
```
d20                        # render and inspect ≥10
d20>=10                    # 1 if pass, 0 if fail
```

### Rolling stats
```
4d6dl1                     # standard array roll
{4d6dl1, 4d6dl1, 4d6dl1, 4d6dl1, 4d6dl1, 4d6dl1}   # all six in one go (totals shown per stat)
3d6                        # old-school straight
{4d6dl1, 4d6dl1}kh1        # roll twice, keep the higher set total (proxy for "best of two")
```

### Inspiration / Bardic Inspiration die added
Add one die mid-roll:
```
d20+MOD+1d6                # bardic inspiration on attack
d20+MOD+1d8                # at higher level
```

### Lucky feat (d20 reroll)
Same as halfling but unconditional re-roll-once on any value the player chooses — you can't express "player chooses" in notation, so reroll-once must be triggered by what the *system* does. For "reroll any natural 1 once":
```
d20ro=1+MOD
```

---

## D&D 3.5 / Pathfinder 1e / OSR

### Confirming a crit
3.5/PF1 uses two attack rolls — that's two separate notations, not one:
```
d20+ATK                    # threat roll (compare to threat range)
d20+ATK                    # confirmation roll (re-roll vs AC)
```

### Stacking sneak attack dice
```
1d8+5+5d6                  # rapier + STR + 5d6 sneak attack
```

### Save-or-die (no notation help, just the save)
```
d20+SAVE                   # compare ≥DC out of band
```

### B/X / OD&D 3d6 in order
```
{3d6, 3d6, 3d6, 3d6, 3d6, 3d6}    # six stats, in order
```

### Old-school exploding damage (some house rules)
```
1d8!                       # 8 explodes on a max
1d10!!                     # damage where chain compounds into single value
```

---

## Pathfinder 2e

PF2e adds the *degree of success* — crit success / success / failure / crit failure based on margin from DC. The notation just produces the d20+mod; the four-tier comparison is application logic.
```
d20+MOD                    # the d20 check; consumer compares to DC ±10
d20cs=20cf=1+MOD           # with cosmetic flags for natural 20/1 (which shift degree by one)
```

For "Hero Point reroll":
```
d20ro<MOD+MOD              # not really expressible; do two separate rolls and pick higher in code
```

---

## FATE / Fudge

Four Fudge dice summed:
```
4dF                        # the canonical FATE roll, range −4..+4
4dF+SKILL                  # add the skill ladder bonus
```

Rare "thinner" Fudge dice (1+, 1−, 4 blanks):
```
4dF.1+SKILL
```

For Fudge with bonus dice (some hacks):
```
{4dF, 1dF}kh4              # roll 5, drop the worst — a "lucky" Fate variant
```

---

## World of Darkness / Storyteller / Storypath

Classic dice-pool: roll N d10, count successes ≥7 (or ≥8 for nWoD).
```
6d10>=7                    # oWoD pool of 6, success on 7+
6d10>=8                    # nWoD/CoD pool of 6, success on 8+
```

Botches (1s subtract):
```
6d10>=8f=1                 # successes minus number of 1s
```

10s explode (10-again, 9-again, 8-again):
```
6d10!>=8                   # explode on max (10 only); same compare for success would also work
6d10!>=9>=8                # 9-again: explode on 9 or 10, count successes ≥8
6d10!>=8>=8                # 8-again: every success rerolls (rare, very swingy)
```

Storypath enhanced successes (count 10s twice):
```
6d10>=8                    # base successes; "10s count twice" is consumer-side
```

Or, since each 10 turns into +2 (one for the success, one bonus), use a roll group with two compare points — actually not directly expressible cleanly; better to roll twice and combine in code.

---

## Shadowrun

Pool of d6, count ≥5 as hits. 1s are botches; if half or more of pool rolls 1, it's a glitch (system-side, not notation).
```
8d6>=5                     # 8-die test, hits = count ≥5
8d6>=5f=1                  # net hits − ones (raw), if you want naive negative count
```

Edge ("rule of 6"): rerolls/explodes 6s.
```
8d6!>=5                    # exploding 6s, count successes ≥5 (with edge)
8d6!=6>=5                  # explicit; same effect
```

"Push the limit" (all dice explode):
```
8d6!>=5
```

Reroll all failures once (Edge "Second Chance"):
```
8d6ro<5>=5                 # reroll <5 once, then count ≥5
```

---

## Burning Wheel / Mouse Guard / Torchbearer

Pool of d6, count ≥4 as successes. Open-ended-on-6 is rule-dependent (Mouse Guard yes, BW no by default).
```
5d6>=4                     # 5-die pool vs Ob, count ≥4
5d6!>=6>=4                 # with explosion on 6 (Mouse Guard "Wise" or Torchbearer)
5d6!>=5>=4                 # rare: open-ended on 5+ (some BW Artha effects)
```

Forks (extra dice from a related skill) is just adding to the pool. Tap Nature etc. similarly are arithmetic on the pool size.

Helping dice / FoRKs:
```
(BASE+HELP+FORKS)d6>=4     # substitute the integer; the parser doesn't do variables
```

---

## Savage Worlds

Trait roll: a trait die + a Wild die (d6 for player wild cards), pick the higher; aces (rolling max) explode.
```
{d8!, d6!}kh1              # d8 trait + d6 wild, both ace, take the higher
{d10!, d6!}kh1+2           # +2 modifier
{d4!, d6!}kh1              # weak trait still benefits from wild die
```

Damage roll (no wild die typically):
```
2d6!+1                     # damage 2d6, aces, +1
```

Raises (every 4 over the target = a raise) is consumer-side math.

---

## Cypher System

A single d20 vs a difficulty (target number = 3×difficulty). Crit on 19 (minor effect) and 20 (major effect) are flagged:
```
d20+EASE-DIFF              # apply training/effort/skill as +/- modifiers
d20cs>=19                  # cosmetic flag for minor/major effect
```

Cypher doesn't normally explode or pool, so the notation stays simple.

---

## Year Zero Engine

(Mutant Year Zero, Forbidden Lands, Alien, etc.) Pools of d6, count 6s as successes. Different colours = different banes/boons; the parser doesn't model colour, so you roll separate pools and combine in code.

```
5d6=6                      # base pool: count 6s as successes
5d6=6f=1                   # with banes (1s) subtracting — rules vary
```

"Push the roll" (reroll non-1, non-6 dice once) is awkward; closest single-shot:
```
5d6ro<6                    # reroll anything less than 6 once... but this also rerolls 1s
```

Year Zero's "1s stay" rule means you really want two pools: one to push, one fixed. Better handled by code: roll once, then re-roll the 2..5 only.

---

## Powered by the Apocalypse / Forged in the Dark

PbtA: 2d6+stat. Hit on 7+, full hit on 10+.
```
2d6+STAT                   # raw move roll; consumer compares to 6-/7-9/10+
```

Forged in the Dark (Blades): pool of d6, take highest. 6 = full success, 4-5 = partial, 1-3 = miss. Two 6s = critical.
```
3d6kh1                     # 3-die action roll, take highest
0d6                        # NOT VALID — a "0-dice" roll in BitD is "roll 2, take lowest"
{2d6kl1}                   # zero-dice roll: roll 2d6 and keep the lower
```

Resistance rolls and similar follow the same shape with different pools.

---

## Call of Cthulhu / BRP percentile

Pure d100 / d% under skill:
```
d%                         # roll, compare ≤ skill
d%<=SKILL                  # 1 if success, 0 if fail (target-style usage)
```

Bonus / Penalty dice (CoC 7e): roll two `d10`s for the tens, take the better/worse. This isn't directly a `d%` mechanic — model as two rolls:
```
{1d10, 1d10}kl1            # bonus die: tens digit is the *lower* of two rolls (closer to 0)
{1d10, 1d10}kh1            # penalty die: tens digit is the *higher* (worse)
```
Then add the units d10 separately. Often easier to treat as two whole d% rolls and pick:
```
{d%, d%}kl1                # bonus die approximation
{d%, d%}kh1                # penalty die approximation
```

---

## GUMSHOE

Investigative spends are flat. General checks: d6+spend ≥ Difficulty.
```
d6+SPEND                   # general test; compare ≥Diff externally
```

---

## Genesys / Star Wars FFG narrative dice

The custom Genesys dice (boost/setback/ability/proficiency/difficulty/challenge) are **not** representable in this DSL — symbols (success/advantage/triumph/despair) aren't numeric. Either use a separate dedicated roller, or fall back to a numeric proxy:
```
3d6>=4-2d6>=4              # "ability minus difficulty" as numeric proxy — loses symbol semantics
```
For Genesys you usually want a separate symbol-aware roller; document this limit explicitly to the user when they ask.

---

## Generic helpers

### "Best of N"
```
{<formula>, <formula>, ..., <formula>}kh1     # roll N times, keep the highest *total*
```

### "Worst of N"
```
{<formula>, ..., <formula>}kl1
```

### "Roll N pools, count how many beat threshold"
```
{<pool1>, <pool2>, <pool3>}>=THRESHOLD
```

### Average / "take 10" alternatives
The DSL has no "take 10" or "average" because both are deterministic. Just compute:
```
10+MOD                     # take-10
((1+SIDES)/2)*QTY+MOD      # average of NdS+MOD (precompute the constant)
```

### Min / Max of two formulas
```
max(2d6+3, d12+3)          # better of two damage formulas
min(2d20kh1+5, 25)         # cap at 25
```

### Halving and doubling rounded
```
floor(damage/2)            # half rounded down (most "save for half" mechanics)
ceil(damage/2)             # half rounded up
2*damage                   # crit / vulnerability
```

### Threshold check
```
d20+MOD>=DC                # 1 if pass, 0 if fail
{d20+MOD}>=DC              # same, but explicit single-sub-roll group form
```

### Reroll-and-keep-the-better (one-shot)
The DSL's `r` / `ro` *replace* the value (no choice). To take the better of original-and-reroll, you must split:
```
{1d20+MOD, 1d20+MOD}kh1    # truly "best of two rolls"
```
This is what you actually want in most cases the player describes as "advantage" or "lucky reroll".
