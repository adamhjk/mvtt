import { defineEvent, EntityId, z } from "@vtt/substrate";
import { RoleSchema } from "@vtt/auth";

/**
 * A user has come online. Emitted by the identity plugin's system in
 * response to a substrate ConnectionOpened. Transient — reflects connection
 * state, not durable game history.
 */
export const PlayerJoined = defineEvent({
  name: "@vtt/identity/PlayerJoined",
  schema: z.object({
    playerId: EntityId,
    userId: z.string(),
    name: z.string(),
    role: RoleSchema,
    clientId: z.string(),
  }),
  transient: true,
});

export const PlayerLeft = defineEvent({
  name: "@vtt/identity/PlayerLeft",
  schema: z.object({
    playerId: EntityId,
    userId: z.string(),
    clientId: z.string(),
  }),
  transient: true,
});
