import { defineTrait, z } from "@vtt/substrate";

/**
 * A player- or GM-managed character. v0 carries only a display name —
 * game-system plugins (D&D 5e, PbtA, FATE, etc.) project additional
 * state onto a character by registering their own traits and filling
 * the `CharacterSheetSectionsSlot`. With nothing projected, the sheet
 * is just an editable name.
 *
 * Ownership is carried by the standard `OwnedBy` trait spawned by the
 * recording system — owner-or-GM gates rename and removal.
 */
export const Character = defineTrait({
  name: "@vtt/characters/Character",
  schema: z.object({
    name: z.string().min(1).max(120),
  }),
});
