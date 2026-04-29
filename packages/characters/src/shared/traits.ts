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
