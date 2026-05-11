---
name: set-design
description: Write set design — Courtney Campbell's room-keying technique from the Hack & Slash blog — directly into a note page. Use this skill whenever the user wants to key a dungeon room, scene, adventure location, encounter area, NPC interaction, or any other place where players might walk in and look around. Emits a ```setdesign fenced block; the notes plugin renders it as a structured tree with bold visible elements, italic stats, arrow connectors, and wiki-link chips for characters/scenes/assets. Trigger when the user says "set design", "set dress", "key this room", "set up this scene", mentions Hack & Slash or Courtney Campbell, or asks for a scannable at-the-table reference for an adventure location.
---

# Set Design

A way to key adventure locations so they're scannable at the table. Each room is a tree of nouns connected by arrows. Bold marks what players see immediately. Everything else branches off those visible elements through arrows and indentation. No prose, no sentences — just things and their relationships.

Originated by Courtney Campbell, "series (set design)" on hackslashmaster.blogspot.com.

## The Core Mental Model

From the blog: "What I'm actually doing when I'm keying a room this way is thinking of how the players are walking into the room. What can they immediately see? What is going on nearby? What is most obvious? What must I mention at a bare minimum to maintain their agency?"

This is the entire method. Walk into the room in your mind. The bold items are what hits you first. Then each of those things breaks down — what's it made of? What's on/in/behind it? What happens when you touch it? Each answer is another arrow in the tree.

## The Block

Set design is a fenced markdown code block tagged `setdesign`:

````
```setdesign
Old Library 7)
---
**Bookshelves** N+E walls -> sagging, collapsed
**Oak Desk** SW -> drawers dumped
  -> locked drawer -> DC 15 Thieves' / DC 18 Str
    -> scroll case -> spell scroll (detect magic)
      -> note (Elvish): "Vault key with captain."

Giant Rats (3) -> behind collapsed N shelves
  (_HP 7, 6, 5_)
  -> attack if shelves disturbed
  -> collars -> crude -> wizard experiment
```
````

Rules:
- **Header**: the first non-blank line followed by a `---` separator becomes the title. Omit both to start straight into the tree.
- **Indentation**: spaces nest. Each child is more indented than its parent. Tabs count as two spaces.
- **Internal arrows**: `->` (rendered as `→`) inside a line chains nouns: `Bookshelves -> sagging -> collapsed` becomes three segments joined by arrows.
- **Leading arrows**: `->` or `|->` at the start of a line are decorative — indentation alone decides parenting. Use them when authoring to mirror the connector visually.
- **Inline markdown**: `**bold**`, `*italic*`, `_italic_`, `` `code` ``, and `[[wikilinks]]` all work — each line is parsed as markdown.
- **Wiki-links**: `[[character:Marta]]`, `[[scene:Old Library]]`, `![[asset:e42]]` all resolve to live chips/embeds inside the block. Backlinks see them too.
- **Blank lines**: separate sibling subtrees with extra vertical spacing in the render. No effect on tree structure.

See `references/format.md` for the full grammar reference and `references/examples.md` for worked rooms.

## How to Write It

### 1. Walk Into the Room

Read whatever source you have (prose, notes, a published module page). Picture entering. What hits you first — physically, visually? Those are bold.

### 2. Decompose, Don't Summarize

You are not summarizing. You are **breaking things down into their parts**. Each element decomposes into what it's made of, what it contains, what it leads to.

Don't compress "five human male bodies, two bandits and three adventurers" into "5 bodies (2 bandits, 3 adventurers)". Break it DOWN:

````
```setdesign
**5 Bodies** -> Human -> Male
  -> Bandit (2) -> ratty wolf skin cloak
  -> Cleric -> broken Sol Symbol
  -> Fighter -> Ruined Leather
  -> Thief -> Murky Red Bandana
```
````

The arrows trace how you'd actually examine these bodies — first you see bodies, then you notice they're human men, then you start distinguishing individuals and what they're wearing.

### 3. Build the Tree

Lead with the header (room name + number) on its own line, separator `---`, then the bold visible elements as top-level lines. Each visible element's investigation chain becomes nested children.

### 4. Wire Up Wiki-Links

Whenever you mention a thing that has (or should have) its own note/character/scene/asset, write it as a wiki-link. Examples:

- `**[[character:Marta Deepwell]]** (Protective/Suspicious)` — pulls the live character record
- `S door -> [[scene:Old Library]]` — exit linking another room
- `![[asset:e42]]` — embeds a map image inline

If the target doesn't exist yet, write `[[Marta Deepwell]]` anyway — the chip will render as "unresolved" and become a one-click create action.

### 5. Verify

Every number, stat, treasure value, and mechanical detail from your source must appear somewhere in the tree. No information lost — just restructured.

## System Agnosticism

Preserve whatever stat conventions the source uses. Don't convert between systems.

- D&D 5e: `(_AC 16, HP 19, Bite +5/1-4_)` 
- Torchbearer: `(_Nature 6, Might 4, Disposition 10_)`
- OSE / B/X: `(_AC 16, HD 3, HP 19, Bite +5/1-4/1-6 auto, ML 9, XP 141_)`

Stats go in italic parens on their own line right under the creature's bold line, or inline if very short.

## Output Shape

When the user asks for set design for a room, scene, or location, emit a complete fenced `setdesign` block ready to paste. Multiple rooms: one fenced block per room, separated by blank lines, with an optional `## Room Name` markdown heading above each.

If the user pastes prose and asks for set design, return only the block(s). No surrounding explanation. They're going to paste it.

## How It Renders

In read mode, the block becomes a structured tree — header at the top, then a nested list where every node is one line, segments separated by `→`, bold/italic preserved, wiki-links shown as clickable chips. Arrows you wrote as `->` are rendered as `→`. Blank lines in the source give the next sibling extra vertical breathing room.

The CodeMirror editor's `[[` autocomplete fires inside the fence; Enter preserves the previous line's indentation, and adds one extra indent step when the line ends with `->`.
