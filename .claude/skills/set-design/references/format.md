# Set Design Format Reference

A set design block is a fenced markdown code block tagged `setdesign`. Everything below describes the grammar inside the fence.

````
```setdesign
{optional title}
---
{tree lines}
```
````

## Header

Optional. The first non-blank line followed by a `---` separator becomes the rendered header (bold caption above the tree).

````
```setdesign
Crossed Swords Inn 3)
---
**Common Room** -> fireplace E wall -> six oak tables
```
````

If there's no `---` separator, the first line is treated as a normal tree line (no header is rendered).

## The Arrow `->`

The arrow is the fundamental building block. `X -> Y` means "looking at/into/behind X, you find Y." Source `->` renders as `→`. It covers all relationships — containment, discovery, consequence, decomposition:

- **Containment**: `**Chest** -> 500gp, potion`
- **Decomposition**: `**Bodies** -> Human -> Male -> Bandit (2)`
- **Discovery**: `Floor -> loose flagstone -> iron key`
- **Consequence**: `**Stairway** -> Triggers Magic Mouth -> "Welcome!" (audio only)`
- **Investigation**: `Dolmen -> Ob 3 Lore Master -> passage grave, ancient chieftain`

Arrows can chain on a single line: `**Pool** -> Mineral Formation -> Skeleton -> Hand -> Key`. The renderer emits a `→` glyph between segments.

## Branching `|->`

When one thing leads to multiple independent paths, you can either:

1. **Indent** each child as its own line:

   ````
   **Portcullis** -> wooden
     -> blocks tunnel
     -> can pass under
   ````

2. **Mark visually** with a `|->` prefix:

   ````
   **Portcullis** -> wooden -> blocks tunnel
     |-> can pass under
     |-> 2 Toad-Man Sentries approach
   ````

Both are equivalent — the parser strips the `|->`/`->` leading prefix and uses indentation alone to attach children. Choose whichever reads more clearly for the situation.

## Bold `**text**`

Bold marks what players perceive the moment they enter. These are the top-level entries the GM describes first. Everything else is discovered through interaction.

Bold items are short noun phrases — the thing itself, plus one or two immediate qualities:
- `**Ornate Columns** -> Damaged`
- `**5 Bodies** -> Human -> Male`
- `**Tiled Floor** -> Elaborate coloured mosaic, Broken Tiles`
- `**Stream** -> Cold, Fast, N to S, 7'-5' wide, 3'-5' deep`

If something requires a check to notice, it is NOT bold.

## Italic / Stats `*text*` or `_text_`

Stats and reaction modifiers go in italic parens on their own indented line, or inline:

````
**Wooden Cask** -> Giant Tick!
  (_AC 16, HD 3, HP 19, Bite +5/1-4/1-6 auto, ML 9, XP 141_)
````

Torchbearer: `(_Nature 6, Might 4, Disposition 10_)`. Free-form: anything in italic.

## Wiki-Links `[[…]]`

Wiki-links inside a set design block work exactly like in prose. The backlinks index also sees them, so the location's note shows up as a "linked from" entry on the character/scene/asset record.

- `**[[character:Marta Deepwell]]** (Protective/Suspicious)` — clickable chip resolving to the character
- `S door -> [[scene:Old Library]]` — exit pointing to another scene/room note
- `![[asset:e42]]` — embeds the asset (image map, etc.) inline in the rendered block
- `[[Goblin Cave]]` — implicit `note:` kind; resolves to the matching note title

The editor's `[[` autocomplete fires inside the fence just like in prose.

## NPC / Creature Blocks

Name in bold at the top. Behavior/attitude in parens. Then what they offer, want, know — as arrow chains, not labeled categories:

````
**Gundren Rockseeker** (Excited/Secretive/Friendly)
  -> **Job** -> haul provisions, immediate
  -> **Brothers** -> Tharden and Nundro
  -> **"something big"** -> won't tell
  -> **10gp/day** -> persuade DC 15 -> 30gp/day
  -> **Leaving early** -> horseback
    -> **Sildar Hallwinter** -> warrior escort
````

Reaction modifiers go right after the name/attitude line if applicable.

## Indentation

Indentation shows the tree structure. Sub-items indent under their parent. Deeper = more nested = more investigation required to find.

Two spaces per level is the convention. Tabs work too (one tab = two spaces for indent counting).

```
**6 Alcoves** -> Broken Statues -> Minor Pleasure Goddesses (Knowledge to ID)
  -> Holding Writing Tablet (Calliope, Epic Poetry)
  -> Lyre (Terpsichore, Dance)
  -> Comic mask (Thalia, Comedy)
  -> Tragic mask (Melpomene, Tragedy)
```

Top-level = what you see first. Each indent level = one more step of interaction.

## Treasure

Treasure items get broken down like everything else. Material, value, weight, and special properties are all arrow-chained:

```
**Ornate Iron Armchair** -> Dwarven, decorative cobalt inlay (900gp) 65lbs. + Bulky
**Blanket** (60gp) Chiffon, covering -> **ottoman**, Hollow slate (200gp) 35lbs.
  -> **Gem**, Kunzite (202gp)
  -> Human sized **Iron mail** (Chain +1, weightless)
  -> Fleece **Pouch** (Pouch of Accessibility)
```

## Connections and Exits

Exits are just more arrows, typically at the bottom or inline:

```
**Stairway** -> Triggers Magic Mouth -> "Welcome!" (audio only)
```

```
Down -> [[scene:Area 2]]
N passage -> [[scene:Area 5]]
S alcoves (4) -> [[scene:Area 6]] / [[scene:Area 7]] / [[scene:Area 8]] / [[scene:Area 9]]
```

## Blank Lines

Blank lines separate sibling subtrees. The next sibling renders with extra vertical spacing — useful for the visual gap between major elements of a room:

````
**Bookshelves** N+E walls -> sagging, collapsed
**Rotting Paper** -> floor, mold smell

Giant Rats (3) -> behind collapsed N shelves
  (_HP 7, 6, 5_)
  -> attack if shelves disturbed
````

Blank lines have no effect on tree structure — they're purely visual.

## What NOT to Do

- No prose sentences. No "This room was once a library." Decompose nouns.
- No category labels (Trigger:, Effect:, Knows:). The tree structure shows relationships.
- No redundant information. If it's on the map, don't repeat it unless mechanically relevant.
- No abbreviating when you should be decomposing. Don't compress "five human male bodies, two bandits and three adventurers" into "5 bodies (2 bandits, 3 adventurers)". Break it DOWN: `**5 Bodies** -> Human -> Male -> Bandit (2) -> ...`.
- No raw HTML. The renderer compiles markdown safely; raw HTML is stripped.
