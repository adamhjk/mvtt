import {
  defineSlot,
  type EntityId,
  type QualifiedName,
  QualifiedNameSchema,
  z,
} from "@vtt/substrate";

/**
 * Per-render arguments handed to a CharacterSheetSection's `render`. The
 * `characterId` is the entity this sheet is bound to — passed in so a
 * section doesn't have to re-resolve it from elsewhere.
 */
export interface CharacterSheetSectionRenderArgs {
  readonly characterId: EntityId;
}

/**
 * One section of the character sheet. Game-system plugins fill this slot
 * to project their own sheet content (HP, attributes, skills, moves,
 * aspects, …) onto a character. The default characters plugin renders
 * the editable name above whatever sections fill the slot — with
 * nothing filled, the sheet is just the name.
 *
 * Same permissive-on-functions pattern as `@vtt/scene/overlay-tabs`:
 * Zod can't usefully validate render functions; the type below is the
 * load-bearing constraint at the fill site.
 */
export type CharacterSheetSection = {
  /**
   * Plugin-namespaced id, e.g. `@vtt/dnd5e/sheet/attributes`. Used as a
   * stable key when sections re-render.
   */
  id: QualifiedName;
  label: string;
  /** Higher priority sorts toward the top. Defaults to 0. */
  priority?: number;
  render: (args: CharacterSheetSectionRenderArgs) => unknown;
};

const CharacterSheetSectionSchema = z.object({
  id: QualifiedNameSchema,
  label: z.string().min(1),
  priority: z.number().optional(),
  render: z.any(),
});

export const CharacterSheetSectionsSlot = defineSlot({
  name: "@vtt/characters/sheet-sections",
  schema: CharacterSheetSectionSchema,
  description:
    "Sections that stack inside the character sheet, below the name. Game-system plugins fill this to project their sheet content onto a character.",
});
