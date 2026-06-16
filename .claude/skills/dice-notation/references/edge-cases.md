# Dice notation edge cases and parser quirks

This file collects the silent-failure cases, the syntactic ambiguities, and the things the DSL **can't** express. Read it when:

- A notation parses but produces unexpected results.
- A notation that "should work" throws a SyntaxError.
- You're trying to express a mechanic that resists the standard modifier set.

The condensed PEG grammar is in SKILL.md ("Reference grammar"). When in doubt, look there.

---

## Parser quirks

### `!=` after a die is parsed as `!! =` (compound), not "explode on not-equal"

```
2d6!=4    # parses as: explode-and-COMPOUND on rolls EQUAL to 4
2d6!<>4   # CORRECT: explode (non-compound) on rolls NOT EQUAL to 4
2d6!!<>4  # explode AND compound on rolls not equal to 4
```

The PEG rule is `"!" compound:"!"? penetrate:"p"? comparePoint:ComparePoint?`. The `=` after the `!` matches as `compound`'s second `!` only if it's another `!`; but the `=` in `!=` collides with how the compare-point grammar handles operators. In practice the parser greedily takes the `!=` as part of the compare operator in confusing ways. **Just always use `<>` for "not equal" inside any modifier compare-point that follows `!`, `r`, `u`, etc.** It's unambiguous.

Affected: `!`, `!!`, `!p`, `!!p`, `r`, `ro`, `u`, `uo`. For target success/failure (`>=8`, `f<3`), `!=` is fine since there's no leading `!`.

### `f<cp>` (failure target) syntax positions

Failure targets are _only_ valid as a suffix after a success target. Both of these throw `SyntaxError`:

```
4d7f!=2          # no preceding success target
2d6f<=3>4        # failure before success
```

Correct form: `<success cp> f<failure cp>` adjacent.

```
4d7>=4f!=2       # successes ≥4, failures ≠2
4d7>=4f<>2       # equivalent (preferred)
```

### Repeating the same modifier silently keeps only the last

```
42d2!=6!!>4!p<5    # only the last explode-modifier (penetrating, on <5) survives
4d6r=1r=6          # only `r=6` survives
2d20kh1kh2         # only `kh2` survives
```

The parser **does not error**. If you actually need "reroll on 1 and on 6", you can't express it as two separate `r` modifiers — combine the cps:

```
4d6r<=1            # one cp covering 1
4d6r<=2            # 1 and 2
```

For arbitrary disjunctions ("reroll 1 or 6") the DSL has no `or`. Workarounds: roll then compute in code, or use a clamp/choice that approximates.

### Order in notation does not match order in evaluation

`6d10>=8!>=9` and `6d10!>=9>=8` produce identical results because modifiers run in **fixed order by type**, not by notation. If you need a different order (e.g. drop low first, _then_ reroll), the DSL can't do it in one expression — split into a roll group or two operations.

### Keep + Drop together

Both are evaluated against the full pool, in fixed order keep(6) → drop(7). When both target the "high" or "low" end, results are surprising:

```
3d10k1dh1
# Step 1: k1 keeps the highest 1, marking the other 2 as dropped.
# Step 2: dh1 drops the highest 1 — i.e. the only remaining one.
# Result: every die is dropped, total = 0.
```

If you mean "drop highest 1, then keep highest of the rest", you can't express it directly. Use a roll group or perform two rolls.

### `min<n>` is a clamp, not a reroll filter

`4d6min3` turns any 1 or 2 into a 3 (skewing the distribution heavily towards 3). It is **not** equivalent to `4d6r<3`. The clamp is useful for "minimum damage" mechanics ("damage cannot be less than 3"), not for "reroll low values". Likewise `max<n>` clamps high.

### `cs` and `cf` don't change totals

They are _cosmetic flags only_ (`**` and `__` in rendered output). They do not double damage, add successes, or alter the sum. To actually crit a damage roll, write a separate notation that rolls extra dice and trigger it in code based on the `cs` flag (or a `>=` check on the d20).

### Sorting is display-only

`s`, `sa`, `sd` reorder the displayed roll array but do not change which dice are kept/dropped or affect the total.

### Iteration cap is 1000

Explode, compound, penetrate, reroll, and unique each cap at 1000 iterations _per starting die_. A `d2!` will stop after 1000 chained 2s (vanishingly unlikely). Unique on `5d3u` is mathematically impossible (only 3 unique values across 5 dice) and will burn the iteration budget without producing distinct values.

### `min === max` dice can't explode/reroll

A degenerate die where `min === max` (e.g., `d1`, or hypothetically `dF` with a custom range collapsed to a single value) throws `DieActionValueError` if you try to explode, reroll, or unique it. Standard `dF.1` is fine because its values still span −1..+1.

### `qty` 0 or > 999 errors

```
0d10        # error (qty must be ≥1)
1000d6      # error (qty must be ≤999)
-1d20       # error
```

### `qty` and `sides` cannot start with `0`

```
05d10       # SyntaxError
d05         # SyntaxError
```

The grammar's `IntegerNumber` rule is `[1-9] [0-9]*`. So `10`, `100`, `999` are fine; `0`, `01`, `001` are not (use `(0)d10` if you somehow needed a literal 0 — but qty 0 would error anyway).

### `(...)` for qty/sides only allows numbers and arithmetic — no nested dice

```
(2*3)d6     # OK: qty = 6
3d(2^2)     # OK: sides = 4
(2d6)d10    # SyntaxError: dice expressions not allowed inside qty parens
3d(d6)      # SyntaxError
```

The grammar restricts `IntegerOrExpression` to `IntegerNumber / "(" FloatNumber (Operator FloatNumber)+ ")"`. If you want a dice value as the qty, roll separately and substitute the integer.

---

## Things the DSL cannot express

These mechanics need either a roll group, multiple separate rolls, or consumer-side code. Knowing what's impossible up front saves time.

### Variables / character stats inline

The DSL is purely literal — no `$STR`, no `@var`, nothing. **Substitute** the integer before passing the string to the parser.

### "Reroll up to N times" (where N is not 1 or unlimited)

`r` is unlimited (capped at 1000); `ro` is exactly once. There's no syntax for "reroll up to twice" — code it.

### "Choose" / "if-then" branches

The DSL has no conditionals. "If the d20 is a 20, roll an extra d8" is two rolls + a branch in your code.

### Symbol dice (Genesys, narrative dice)

The dice values must be numeric. Genesys-style proficiency/ability/setback dice with success/advantage/triumph/despair _symbols_ aren't representable. Use a separate dedicated roller for those.

### Distinct re-roll values per die

`r=1` rerolls _every_ die that shows 1. There's no way to say "reroll only the second die in the pool". The DSL is pool-uniform.

### Disjunctive compare points ("X or Y" but not contiguous)

Can't say `r=1 OR =6`. You can say `r<=1` (only 1) or `r>=5` (5 and 6). For non-contiguous disjunctions, run the roll then handle in code.

### "Roll, look at result, then choose pool size" / dynamic pools

Pool size must be a literal/arithmetic at parse time, not a function of an earlier roll.

### "Keep N, then take the average" or other reductions

Total is a sum (or success count for target modifiers). You can `floor(.../N)` for averages but that's just division of the total.

### Different modifiers per die in a single die expression

`4d6` applies the same modifiers to all 4 dice. You can't say "the first d6 explodes, the others don't". Roll groups give you per-sub-roll control:

```
{1d6!, 1d6, 1d6, 1d6}
```

### "Take the second-highest"

`kh1` is the highest, `kl1` is the lowest. The DSL has no median or k-th selection. Use a roll group with a sort and process the result in code, or roll multiple times.

---

## Comments don't parse — and that includes "useful" things you might want inside

```
4d6 [+2 from feat]
```

Looks like it should pull `+2` into the math. It does **not** — everything inside `[…]`, `/* */`, `//`, `#` is treated as a literal description. To add the +2 mathematically, put it outside:

```
4d6+2 [from feat]
```

This is occasionally a footgun when you've seen the `[...]` syntax used for "metadata" elsewhere.

---

## Distinguishing function `max(...)`/`min(...)` from modifier `max<n>`/`min<n>`

The parser uses the next character to decide.

```
4d6max3        # max modifier: clamp roll values ≤ 3
max(4d6, 3)    # max function: take the larger of 4d6 and 3
```

If you write `4d6max(3)` the parser will see `max` as a modifier expecting a number after it and will fail (or match in a confusing way). Don't put parentheses immediately after a die. To use the function on a die total, wrap explicitly:

```
max(4d6, 3)
```

---

## The wire-format escape hatch

If you can't express a mechanic in one notation, the cleanest pattern is:

1. Compose a _minimal_ notation per atomic step.
2. Roll each.
3. Combine the totals/values in code.

This is faster to reason about and easier to test than torturing the DSL with roll groups for things they weren't meant to model.
