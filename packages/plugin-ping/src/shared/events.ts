import { defineEvent, z } from "@vtt/substrate";

export const PingReceived = defineEvent({
  name: "@vtt/ping/PingReceived",
  schema: z.object({
    message: z.string(),
    pingedAt: z.number(),
    pongedAt: z.number(),
  }),
});
