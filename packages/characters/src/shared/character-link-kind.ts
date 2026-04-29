import { type EntityId, type World } from "@vtt/substrate";
import { defineLinkKind, type LinkSuggestion } from "@vtt/notes/shared";
import { Character } from "./traits.js";
import {
  CharacterCreated,
  CharacterRenamed,
  CharacterRemoved,
} from "./events.js";

interface CharacterRef {
  readonly characterId: EntityId;
}

/**
 * Character link kind. Sigil `@` so chat-style mentions like
 * `[[@Krell]]` work everywhere wiki-links are parsed (chat composer,
 * note bodies, scene descriptions, …).
 *
 * Resolution: a typed body is treated as either an entity id (`e\d+`)
 * or a character name (case-insensitive exact match). Display reads
 * `Character.name` reactively, so renames propagate to every chip.
 *
 * Click semantics: peek by default (the shell's link-renderer mounts a
 * popover with a small character card); cmd-click navigates to the
 * Characters tab targeting this entity.
 */
export const characterLinkKind = defineLinkKind<CharacterRef>({
  name: "character",
  sigil: "@",
  parse: (body, _anchor, world) => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return null;
    if (/^e\d+$/.test(trimmed) && world.has(trimmed as EntityId)) {
      const got = world.get(trimmed as EntityId, [Character]);
      if (got) return { characterId: trimmed as EntityId };
    }
    const needle = trimmed.toLowerCase();
    for (const row of world.query([Character])) {
      const v = row.values.Character as { name: string };
      if (v.name.toLowerCase() === needle) {
        return { characterId: row.id };
      }
    }
    return null;
  },
  display: (ref, world) => {
    const got = world.get(ref.characterId, [Character]) as
      | { Character: { name: string } }
      | undefined;
    return got?.Character.name ?? "(missing character)";
  },
  target: (ref) => ({ entityId: ref.characterId }),
  activate: (ref, ctx) => {
    if (ctx.modifiers.meta) {
      return {
        type: "navigate",
        pageKind: "@vtt/characters/characters",
        entityId: ref.characterId,
      };
    }
    return { type: "peek", render: () => null };
  },
  autocomplete: (query, world) => {
    const needle = query.trim().toLowerCase();
    const out: LinkSuggestion[] = [];
    for (const row of world.query([Character])) {
      const v = row.values.Character as { name: string };
      if (needle.length > 0 && !v.name.toLowerCase().includes(needle)) continue;
      out.push({
        kind: "character",
        body: row.id,
        display: v.name,
        badge: "Character",
      });
    }
    return out;
  },
  indexEvents: [
    CharacterCreated.name,
    CharacterRenamed.name,
    CharacterRemoved.name,
  ],
});
