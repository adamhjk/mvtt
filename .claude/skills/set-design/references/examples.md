# Set Design Examples

A range of rooms and locations keyed in set design form. Use these as references for shape — what's bold, how things branch, where stats and wiki-links sit, when to use blank-line separation.

---

## 1. Dungeon Room with Hidden Door and Hazard

A library that's been picked over. Notice that the rats and the secret door are **not** bold — both need a check or a disturbance to reveal.

````
```setdesign
Old Library 7)
---
**Bookshelves** N+E walls -> sagging, collapsed
**Rotting Paper** -> floor, mold smell
**Light Shaft** -> narrow S window -> dust motes
**Oak Desk** SW -> drawers dumped
  -> locked drawer -> DC 15 Thieves' / DC 18 Str
    -> scroll case -> spell scroll (detect magic)
      -> note (Elvish): "Vault key with captain. Don't trust priest."

Giant Rats (3) -> behind collapsed N shelves
  (_HP 7, 6, 5_)
  -> attack if shelves disturbed, otherwise hidden
  -> collars -> crude -> wizard experiment
    -> runes -> DC 13 Arcana -> tracking enchantment

E bookshelf -> scratch marks on floor -> DC 14 Perception
  -> swings open -> DC 10 Str -> [[scene:Room 12]]

Ruined books -> DC 12 Investigation -> 3 intact volumes (25gp ea.)
```
````

The desk decomposes into drawer → lock → scroll case → contents. The secret door branches off the E bookshelf element. The exit is a `scene:` wiki-link so clicking it jumps to that room's note.

---

## 2. Social Location with NPC Block

An inn with one talkative innkeeper. Marta's attitude lives in parens after her name; her knowledge decomposes as arrow chains — each piece of information is one arrow.

````
```setdesign
Crossed Swords Inn 3)
---
**Timber-Frame** -> two-story, village center
**Sign** -> crossed longswords, creaking
**Common Room** -> fireplace E wall -> six oak tables
  -> smoke, roasting meat
**Villagers** (2d4) -> eating, drinking

**[[character:Marta Deepwell]]** (Protective/Suspicious -> warm w/ honesty + coin)
  Stout, 50s, red hair, flour apron
  -> Room -> 5sp/night (4 rooms, 2 beds ea.)
  -> Meal + drink -> 2sp
  -> Mill on river -> strange noises at night, past week
  -> Farmer Aldric -> missing 3 days, fields untended
  -> Baron's soldiers -> headed N, 2 days ago, worried
  -> [[character:Sage]] -> herbalist, woods E of town
  |-> **[[character:Brok]]** -> retired soldier, here evenings

**[[character:Brok]]** (evenings)
  -> mill guide -> 1gp/day -> won't enter mill
  -> "something wrong about that place"

Behind bar -> strongbox -> locked DC 20 -> 45gp, 120sp
  |-> crossbow -> loaded, under bar (Marta's)
```
````

Marta refers players to Brok, so Brok branches off her (with `|->`) and also gets his own top-level block — both reach the same `[[character:Brok]]` record. "Behind bar" is not bold; patrons don't see it.

---

## 3. Hazardous Environment

A flooded crypt where the danger isn't the monsters — it's the water and the pit they conceal.

````
```setdesign
Flooded Crypt 12)
---
**Steps** -> descend 10ft -> murky water -> 3ft deep -> cold, green scum
**Ceiling** -> low, 7ft -> dripping
**Water** -> zero visibility
**Sarcophagi** (6) -> two rows of three -> tops above waterline
  -> lids -> carved armored warriors -> sealed, lead
  -> DC 20 Str (DC 14 ea. if two)
  -> E row, 3rd -> Sir Aldred -> **Dawnbringer**
    (_+1 longsword, light 20ft bright/40ft dim_)
  -> other five -> bones, corroded junk

Pit -> center, between rows -> 5ft deep -> DC 12 Perception
  -> fall in -> water over head
    -> heavy armor -> DC 10 Athletics/round -> drowning
  -> bottom -> skeleton -> **cloak of elvenkind**

**Bronze Door** S -> corroded, swollen shut -> DC 16 Str -> [[scene:Room 14]]
```
````

The pit is not bold — concealed by water. It decomposes into detection → consequences → reward at the bottom.

---

## 4. Minimal Room

Sometimes a room is one table, a weapon rack, and a door.

````
```setdesign
Guardroom 5)
---
**Table** -> two chairs -> half-eaten meal (guards left in hurry)
**Weapon Rack** -> 3 spears, shortbow, 12 arrows
N -> [[scene:Room 6]]
```
````

Three lines. That's all it needs.

---

## 5. With an Embedded Map

A vault chamber with the battle map embedded inline. The asset embed renders the image right at the top.

````
```setdesign
Vault Chamber)
---
![[asset:vault-chamber-map]]
**Chamber** -> 30ft x 30ft
**Pillars** (4) -> corners
**Vault Door** N -> DC 25 Thieves' / AC 20, HP 60
**Stone Guardians** (2) -> flank door
  (_HD 5_)
  -> activate if anyone steps onto central runed circle
```
````

The map gives spatial context. Everything else proceeds normally.

---

## 6. Outdoor Encounter

Same technique, no walls. The "where you arrive from" line at the top stands in for the room boundary.

````
```setdesign
Crossroads Shrine)
---
**Stone Cairn** -> waist-high -> carved S-rune (Sol, dawn)
  -> offerings -> stale bread, copper coins (12 cp), wilted flowers
  -> base -> loose stone -> DC 12 Investigation -> small purse (4 sp, bone die)
**Oak** -> wind-twisted -> N of cairn
  -> ravens (3) -> watch silently -> leave if approached firmly

Beggar -> sits beneath the oak
  (_Frail, blind, claims to be a pilgrim_)
  -> asks alms -> 1 cp pleases, 1 sp delights
  -> blessing -> "Travel where the road forks east, and don't drink from the well"
  -> truth -> well IS poisoned -> [[scene:Hollow Well]]

Paths -> N (to [[scene:Mill]]) / E (forks at well) / S (back to [[scene:Village]])
```
````

The beggar's blessing is information disguised as flavor — the next arrow lets the GM see what's actually true. Path summary at the bottom doubles as exit listing.
