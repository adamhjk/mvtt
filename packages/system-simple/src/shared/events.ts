import { defineEvent, EntityId, z } from "@vtt/substrate";

/**
 * Emitted when the MaxHp derivation recomputes a new value. Other
 * systems can react (e.g., a hypothetical "you gained max HP" feed)
 * by listening for this event.
 */
export const MaxHpChanged = defineEvent({
  name: "@vtt/system-simple/MaxHpChanged",
  schema: z.object({
    entityId: EntityId,
    value: z.number().int(),
  }),
});
