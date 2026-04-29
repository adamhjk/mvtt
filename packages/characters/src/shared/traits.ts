import { defineTrait, z } from "@vtt/substrate";

/**
 * A player- or GM-managed character. v0 carries the display name and
 * an optional `playerUserId` — the userId of the player currently
 * playing this character. Game-system plugins (D&D 5e, PbtA, FATE,
 * etc.) project additional state onto a character by registering
 * their own traits and filling the `CharacterSheetSectionsSlot`. With
 * nothing projected, the sheet is just an editable name + assignment.
 *
 * `playerUserId` is the field the chat composer reads to populate its
 * "speak as" dropdown: a player sees every Character whose
 * `playerUserId` is their own userId, plus their plain self.
 *
 * Ownership (who can rename/remove/reassign) is carried by the
 * standard `OwnedBy` trait spawned by the recording system — owner-or-GM
 * gates editing.
 */
export const Character = defineTrait({
  name: "@vtt/characters/Character",
  schema: z.object({
    name: z.string().min(1).max(120),
    /**
     * userId of the player currently playing this character. Distinct
     * from `OwnedBy.userId` (the editor): a GM may own a character but
     * assign it to a player. Empty/undefined means "unassigned" — the
     * character exists but no player speaks as it yet.
     */
    playerUserId: z.string().min(1).optional(),
  }),
});

/**
 * Per-character uploaded token portrait. Lazily attached: the trait
 * only exists once the character has been given a token image; absent
 * means "no image yet" (the scene's character placement falls back to
 * the default creature icon).
 *
 * `imageUrl` must be a path under
 * `/plugin-data/<worldId>/@vtt/characters/characters/<characterId>/`
 * — same shape as scene backgrounds and pdf-book documents. The upload
 * endpoint stamps a `?v=<bytes>` cache-bust suffix so the browser
 * re-fetches when the GM replaces the file. Server-side validation in
 * SetCharacterTokenImage enforces the prefix to keep the trait
 * pointing at this plugin's own storage.
 *
 * `null` is allowed so a previously-set image can be cleared without
 * needing a separate "remove trait" API in the substrate.
 */
export const CharacterToken = defineTrait({
  name: "@vtt/characters/CharacterToken",
  schema: z.object({
    imageUrl: z.string().nullable(),
  }),
});
