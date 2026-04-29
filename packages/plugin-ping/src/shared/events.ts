import { defineEvent, EntityId, z } from "@vtt/substrate";

export const PingReceived = defineEvent({
  name: "@vtt/ping/PingReceived",
  schema: z.object({
    pongId: EntityId,
    message: z.string(),
    pingedAt: z.number(),
    pongedAt: z.number(),
  }),
});
