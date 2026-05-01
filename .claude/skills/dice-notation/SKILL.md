---
name: dice-notation
description: Use this skill to write or fix a dice formula string for the `@dice-roller/rpg-dice-roller` parser. Trigger whenever a user describes any tabletop RPG roll, mechanic, attack, save, check, damage, pool, or resolution and wants the single-string expression back — whether they say "notation", "formula", "dice string", "the roll for X", name the library, or just describe the mechanic. Trigger for any system: D&D, Pathfinder, FATE/Fudge, Storyteller/WoD/Vampire, Shadowrun, Cypher, Year Zero, Savage Worlds, PbtA, Burning Wheel, homebrew. Trigger for any dice idiom: advantage/disadvantage, exploding/compound/penetrating dice, drop/keep, pools with target successes and botches, rerolls, clamps, crit/fumble, roll groups, arithmetic on rolls. Also trigger when wiring a rolled trait, component, server call, or schema field whose value is such a formula. Do NOT trigger for the library's JS API (DiceRoll/DiceRoller classes), probability analysis, result storage/UI, or rules-lookup questions that don't end in a formula.
---

# Dice notation reference

This skill covers the **string DSL** consumed by `@dice-roller/rpg-dice-roller`'s parser — i.e. what you put inside `roller.roll("…")`. The library API is out of scope; the parser already wraps it. Your job when this skill triggers is to translate a game-mechanics description ("roll d20, +5, advantage, crit on 19+, treat 1 as auto-fail") into a single notation string.

---

## Mental model

A notation is an arithmetic expression whose atoms are **dice expressions**, **roll groups**, and **numbers**. A dice expression is `<qty>d<sides><modifiers...><description?>`. Modifiers attach to the die or to the group. Math operators (+ − * / % ^ **) and math functions (`abs`, `floor`, `pow(...)`, `max(...)`, `min(...)`, etc.) compose the atoms.

```
notation     ::= expression
expression   ::= factor (op factor)*
factor       ::= dice | rollgroup | number | "(" expression ")" | mathfn(expression[, expression])
dice         ::= [qty] "d" sides [modifier...]   (qty default 1, qty 1..999)
sides        ::= integer | "%" | "F" | "F.1" | "F.2" | "(" arith ")"
rollgroup    ::= "{" expression ("," expression)* "}" [modifier...]
op           ::= "+" | "-" | "*" | "/" | "%" | "^" | "**"
```

The core thing to internalise: **modifier execution order is fixed by modifier type, not by notation order.** `4d6!d1` and `4d6d1!` evaluate identically; both explode first, then drop. See [Execution order](#execution-order) — getting this wrong is the most common source of bugs.

---

## Dice (the atoms)

| Notation | Meaning |
|---|---|
| `d6`, `1d6` | one six-sided die (qty defaults to 1) |
| `4d10` | four ten-sided dice, summed |
| `2d%` | two percentile dice (= `2d100`) |
| `dF`, `dF.2` | one Fudge/Fate die: equal thirds of −1, 0, +1 |
| `4dF.1` | four "rare" Fudge dice: 4 blanks, 1 plus, 1 minus on each |
| `(4*6)d6` | qty is an arithmetic expression (parsed as integer) |
| `3d(2*6)` | sides is an arithmetic expression |
| `(5^2*4)d(7%4)` | both qty and sides as expressions |

Constraints:
- `qty` is 1..999. `0d10`, `1000d6`, `-1d20` all error.
- `qty` and `sides` inside `(...)` accept only numbers and arithmetic, **not** nested dice (e.g. `(2d6)d10` is invalid — use a roll group or precompute).
- `dF` defaults to `dF.2`. Use `dF.1` only when the system specifies it.

---

## Modifiers

Every modifier attaches to the die expression (or to a `{...}` group) and runs after the dice are rolled. Multiple modifiers can stack on one die. Repeating the same modifier type **silently keeps only the last one** (`d6r=2r=3` keeps `r=3`).

### Compare points

A *compare point* is `<op><number>`. Most modifiers take an optional one; if omitted, each modifier has a sensible default (see table).

| Operator | Meaning |
|---|---|
| `=` | equal to |
| `!=` | not equal to (avoid with `!` — see pitfalls) |
| `<>` | not equal to (preferred when next to `!`) |
| `<` | less than |
| `>` | greater than |
| `<=` | less than or equal |
| `>=` | greater than or equal |

### Modifier table

Listed in execution order. The "Default cp" column is what's used when you omit the compare point. The "Notation order" doesn't matter — you can write them in any sequence after the die.

| # | Modifier | Notation | Default cp | What it does |
|---|---|---|---|---|
| 1 | Min clamp | `min<n>` | (required) | Any roll < n becomes n |
| 2 | Max clamp | `max<n>` | (required) | Any roll > n becomes n |
| 3 | Explode | `!`, `!<cp>` | `=max` | On match, roll again and **add**; can chain (capped at 1000) |
| 3 | Compound | `!!`, `!!<cp>` | `=max` | Same as explode but the chained results collapse into one number |
| 3 | Penetrate | `!p`, `!!p`, with cp | `=max` | Like explode/compound, but each subsequent roll is reduced by 1 |
| 4 | Reroll | `r`, `r<cp>` | `=min` | On match, **replace** the value (chain up to 1000) |
| 4 | Reroll once | `ro`, `ro<cp>` | `=min` | Reroll at most once even if it matches again |
| 5 | Unique | `u`, `u<cp>` | none (all dupes) | Reroll any duplicates in the pool until distinct (cp narrows which dupes get rerolled) |
| 5 | Unique once | `uo`, `uo<cp>` | none | Reroll each duplicate at most once |
| 6 | Keep | `k<n>`, `kh<n>`, `kl<n>` | high | Mark all but the kept dice as dropped (`k` = `kh`) |
| 7 | Drop | `d<n>`, `dl<n>`, `dh<n>` | low | Drop the matching dice (`d` = `dl`) |
| 8 | Target success | `<cp>` | (cp required) | Each die becomes 1 (success) / 0 (neither) and total = success count |
| 8 | Target failure | `f<cp>` | (cp required, **must follow** target success) | Failures count as −1; net = successes − failures |
| 9 | Critical success | `cs`, `cs<cp>` | `=max` | Cosmetic flag (`**` in output); does not change the total |
| 10 | Critical failure | `cf`, `cf<cp>` | `=min` | Cosmetic flag (`__` in output); does not change the total |
| 11 | Sort | `s`, `sa`, `sd` | — | Sort displayed rolls ascending (`s`/`sa`) or descending (`sd`) |

Quick examples:

```
d20+5                               attack roll, +5 to hit
d20cs>=19cf=1                       crit on 19–20, fumble on 1 (cosmetic flags)
4d6dl1                              standard ability score (drop lowest of 4d6)
2d20kh1+5                           D&D 5e advantage on attack, +5
2d20kl1+5                           D&D 5e disadvantage on attack, +5
8d6!                                exploding 8d6 (each 6 chains)
8d6!!                               same but the chains compound into single results
6d10>=8                             World of Darkness pool: count successes ≥8
6d10>=8f=1                          ...with botches on 1 subtracting from successes
4d6r<3                              reroll any die under 3 (chain up to 1000)
4d6ro<3                             reroll each under-3 at most once
{4d6, 4d6, 4d6}                     three independent rolls, totals summed
{4d6dl1, 4d6dl1}k1                  best of two ability-score rolls
```

---

## Roll groups `{ ... }`

A roll group is one or more sub-expressions in braces, optionally followed by group modifiers. Group modifiers behave **differently** depending on whether the group has one sub-roll or many.

```
{4d10}              identical to 4d10
{4d10+5}            identical to 4d10+5
{4d6, 2d10, d4}     three sub-rolls; total is the sum of all three sub-totals
```

### Group modifiers

| Group shape | `k<n>` / `d<n>` keeps/drops… | `>=N` / `<N` etc. counts… | `s` sorts… |
|---|---|---|---|
| Single sub-roll `{4d10}k2` | individual dice within the sub-roll | each die against the cp (acts on dice) | dice ascending |
| Multi sub-roll `{a, b, c}k2` | whole sub-rolls by total | each sub-roll's total against the cp | sub-rolls by total (and dice within each) |

Useful examples:

```
{4d6dl1, 4d6dl1, 4d6dl1, 4d6dl1, 4d6dl1, 4d6dl1}      six ability scores, each "drop lowest of 4d6"
{2d20, 2d20}kh1                                       roll twice, keep the higher *pair*'s total
{4d6+5, 3d8+2, d10+1}>=15                             count how many sub-totals ≥15 (success counting at the formula level)
{2d10, 3d6, d20+5}sd                                  sort sub-rolls by total descending
```

Failure target on a group still must immediately follow success target:

```
{4d6+2d8, 3d20+3, 5d10+1}>40f<30      net successes minus failures across three formulas
```

---

## Math

### Operators

| Op | Meaning | Notes |
|---|---|---|
| `+` `-` | add / subtract | unary `-` allowed: `1d20+-5`, `1d20--6` (yes, double minus parses) |
| `*` `/` | multiply / divide | |
| `%` | modulo | `5d6%2d20` is "5d6 mod 2d20-total" |
| `^`, `**` | exponent | `**` is normalised to `^` |
| `(...)` | grouping | precedence override |

Standard precedence: `^` > `* / %` > `+ -`. Use parens when in doubt: `(1d6+2)*3` differs from `1d6+2*3`.

### Functions

One-argument: `abs`, `ceil`, `cos`, `exp`, `floor`, `log`, `round`, `sign`, `sin`, `sqrt`, `tan`.
Two-argument: `pow(a, b)`, `max(a, b)`, `min(a, b)`.

```
floor(d6/2)                  half a d6 rounded down
ceil((1d4+1)/2)              half-level proficiency
round(4d10/3)                round-half-away-from-zero (note: differs from JS Math.round on negatives)
max(2d6, d12)                better of 2d6 or d12
pow(d6, 2)                   square of a d6
```

`max`/`min` as **functions** (followed by `(`) are different from `max<n>`/`min<n>` as **modifiers** (no paren). The parser disambiguates by what follows.

---

## Comments / descriptions

Attach descriptive text to a dice expression or group. Anything inside a comment is **not parsed**.

```
4d6 # fire damage
4d6 // fire damage
4d6 [fire damage]
4d6 /* fire damage */
{4d6, 2d10, d4} // fire, frost, falling
```

Block comments (`[…]`, `/* … */`) can span multiple lines. Use these for trait/spell descriptions stored alongside the formula.

---

## Execution order

Modifiers run in this fixed order regardless of how you wrote them:

1. `min<n>`
2. `max<n>`
3. `!` / `!!` / `!p` / `!!p`
4. `r` / `ro`
5. `u` / `uo`
6. `k`
7. `d`
8. target success `<cp>`, then optional `f<cp>` (failure must follow success in *notation* too)
9. `cs`
10. `cf`
11. `s` / `sa` / `sd`

Why this matters: when you compose modifiers you must reason about the order, not the spelling.

```
6d10!>=9>=8           # explode 9s/10s, THEN count successes ≥8 across the resulting bigger pool
4d6r<3kh3             # reroll <3 first (now 4 dice all ≥3), then keep highest 3
4d6kh3r<3             # IDENTICAL to above — order in the string doesn't matter
8d6!cs>=10            # exploding 8d6, mark any single-die value ≥10 as "crit" cosmetically
```

If you actually want a different order (e.g. "drop lowest THEN reroll any remaining 1") you cannot express it as a single dice expression — break it into a roll group or two separate rolls, or rephrase the mechanic to fit the fixed order.

---

## Common pitfalls

These are the silent-failure cases. Read them — they bite.

### `!=` next to `!` becomes compound

`2d6!=4` is parsed as **explode-and-compound** (`!!`) on `=4`, not "explode on not-equal-4". The parser greedily consumes the second `!`. **Always use `<>` for "not equal" when adjacent to an explode/penetrate modifier.**

```
2d6!<>4         # correct: explode on values ≠ 4
2d6!!<>4        # compound on values ≠ 4
2d6!=4          # WRONG (means !! =4); use <>
```

### Failure target must follow success target

`f<cp>` is only valid immediately after `<cp>` (success target). It throws a parse error otherwise.

```
6d10>=8f=1      # OK: successes on ≥8, botches on 1
6d10f=1>=8      # SyntaxError
6d10f=1         # SyntaxError (no preceding success target)
```

### Target success after a compare-point modifier needs care

You can mix target success with explode/reroll/etc., but the parser disambiguates by reading left-to-right. The first `<cp>` after a `!`/`r`/`u` belongs to that modifier; the second `<cp>` becomes the target. The two notations below are equivalent because **modifier order is fixed**:

```
6d10>=8!>=9     # explode on ≥9 AND count successes ≥8
6d10!>=9>=8     # same — order in notation is irrelevant
```

If you write `6d10!>=8` it is exploding on ≥8, with **no** target success modifier. To add one, append a second compare point: `6d10!>=8>=8`.

### Repeating a modifier silently keeps only the last

`42d2!=6!!>4!p<5` produces only one explode modifier — the penetrating `<5` one. The parser does not error. If you mean to combine multiple compare points, you cannot — use a single cp with a richer comparison or restructure the mechanic.

### Keep + Drop together can wipe the pool

Both run on the full pool, in fixed order keep(6) → drop(7). `3d10k1dh1` first marks the lowest 2 as dropped via `k1`, then drops the highest of the remaining — every die is dropped. If you want "drop highest then keep highest of the rest", you need a roll group.

### `r` / `ro` / `!` on `dF.1` and similar

Exploding/rerolling requires `min !== max`. Trying to explode `d1` or rerolling on a degenerate die throws `DieActionValueError`. `dF.1` works because its values span −1..+1.

### Parens around qty/sides only accept numbers + arithmetic

`(2*3)d(d6)` is not legal — sides cannot itself be a dice expression inside `(...)`. Either precompute or use a roll group.

### `min<n>` / `max<n>` clamp, they don't filter

`4d6min3` turns any 1 or 2 into a 3 (skewing the distribution). This is **not** "reroll values < 3". If you want a reroll, use `r<3`.

### Sorting affects display, not totals

`s` / `sa` / `sd` only reorder the result array. `4d6kh3sa` keeps the top 3 and shows them small-to-large; the kept dice (and the total) are unchanged.

### `cs` and `cf` are cosmetic

They do **not** change the total or trigger crit damage. They just flag rolls in the output (`**` for crit, `__` for fumble). For mechanical effects you have to handle the flag in code that consumes the result.

---

## Composing complex notations: a recipe

When you're translating a mechanic, work in this order:

1. **Pick the die.** `d20`, pool of `d6`, `d%`, `dF`, etc.
2. **Pick the qty.** Either fixed (`4d6`) or computed (`(STR+PROF)d6` — which you'll have to substitute as a number before passing to the parser; the DSL has no variables).
3. **Decide if you need a group `{...}`.** Yes, if you're rolling several distinct sub-formulas, want a per-formula success count, or want to keep/drop whole sub-rolls.
4. **Apply per-die mechanics in execution order:**
   - clamps (`min`/`max`) before anything else
   - explosions / rerolls / uniques
   - keep/drop
5. **Apply pool-level mechanics:** target success, failure, criticals.
6. **Add display sugar:** sort, comments.
7. **Add the flat math** (`+5`, `*2`, `floor(.../2)`).
8. **Sanity check the pitfalls** above — especially `!=` near `!`, and whether keep+drop wipes the pool.

When you finish, mentally execute it: rolls happen → min → max → explode → reroll → unique → keep → drop → target → cs → cf → sort → arithmetic. If the resulting flow doesn't match the mechanic, the notation is wrong even if it parses.

---

## Going deeper

When the mechanic doesn't trivially fit the cheat sheet:

- **`references/recipes.md`** — worked examples for D&D 5e, Pathfinder, FATE/Fudge, Storyteller / World of Darkness, Shadowrun, Burning Wheel, Savage Worlds (Aces!), Cypher, Year Zero, PbtA, GUMSHOE, and others. Read this when the user names a system or describes a mechanic that's clearly system-specific.
- **`references/edge-cases.md`** — the parser quirks, ambiguity resolutions, and "what notation can't express" — read this when something seems like it should parse but doesn't, or when you need to push the DSL to its limit.

### Reference grammar (PEG, condensed)

For when you need to verify a syntactic corner without leaving this file:

```
Main         = Expression
Expression   = Factor (_ Operator _ Factor)*
Factor       = MathFunction / Dice / FloatNumber / "(" _ Expression _ ")" / RollGroup

RollGroup    = "{" _ Expression ("," _ Expression)* _ "}" Modifier* Description?
Dice         = (StandardDie / PercentileDie / FudgeDie) Modifier* Description?
StandardDie  = IntegerOrExpression? "d" IntegerOrExpression
PercentileDie= IntegerOrExpression? "d%"
FudgeDie     = IntegerOrExpression? "dF" ("." [12])?

Modifier     = ExplodeModifier / TargetModifier / DropModifier / KeepModifier
             / ReRollModifier / UniqueModifier / CriticalSuccessModifier
             / CriticalFailureModifier / SortingModifier / MaxModifier / MinModifier
ExplodeModifier      = "!" "!"? "p"? ComparePoint?
TargetModifier       = ComparePoint FailComparePoint?       // failure must follow success
FailComparePoint     = "f" ComparePoint
DropModifier         = "d" [lh]? IntegerNumber              // default end = l
KeepModifier         = "k" [lh]? IntegerNumber              // default end = h
MaxModifier          = "max" FloatNumber
MinModifier          = "min" FloatNumber
ReRollModifier       = "r" "o"? ComparePoint?
UniqueModifier       = "u" "o"? ComparePoint?
CriticalSuccessModifier = "cs" ComparePoint?
CriticalFailureModifier = "cf" ComparePoint?
SortingModifier      = "s" ("a" / "d")?

ComparePoint   = CompareOperator FloatNumber
CompareOperator= "!=" / "<=" / ">=" / "=" / "<>" / ">" / "<"

IntegerOrExpression = IntegerNumber
                    / "(" _ FloatNumber (_ Operator _ FloatNumber)+ _ ")"   // dice not allowed inside
MathFunction = ("abs"/"ceil"/"cos"/"exp"/"floor"/"log"/"round"/"sign"/"sin"/"sqrt"/"tan") "(" _ Expression _ ")"
             / ("pow"/"max"/"min") "(" _ Expression _ "," _ Expression _ ")"

Operator     = "**" → "^" / "*" / "^" / "%" / "/" / "+" / "-"
FloatNumber  = "-"? Number ("." Number)?
IntegerNumber= [1-9] [0-9]*                                 // qty/sides cannot start with 0
Number       = [0-9]+

Description  = "[" [^\]]* "]"           // multi-line block
             / "/*" ... "*/"             // multi-line block
             / ("//" / "#") ... <eol>    // single-line
```

Whitespace is mostly free between tokens. Modifier execution order is fixed by type, not by where the modifier appears in the source; see [Execution order](#execution-order).

---

## Output annotations (FYI)

When a result is rendered (with `output` / `toString`), individual rolls are decorated with these flags. Knowing them helps you *read* example outputs in docs and tests:

| Flag | Meaning |
|---|---|
| `!` | exploded (this die triggered an explode) |
| `!!` | compounded (one of the chain compressed into one number) |
| `!p` | penetrated |
| `r` | rerolled |
| `ro` | rerolled-once |
| `u` / `uo` | re-rolled for uniqueness |
| `d` | dropped (not counted in total) |
| `^` | clamped up by `min` |
| `v` | clamped down by `max` |
| `*` | matched success target |
| `_` | matched failure target |
| `**` | matched critical success (`cs`) |
| `__` | matched critical failure (`cf`) |

E.g. `4d6dl1: [3d, 5, 4, 6] = 15` means a 3 was dropped, total 15.
