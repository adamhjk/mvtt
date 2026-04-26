import { defineCommand, ok, z } from "@vtt/substrate";
import { PingReceived } from "./events.js";

export const Ping = defineCommand({
  name: "@vtt/ping/Ping",
  schema: z.object({
    message: z.string().min(1).max(280),
    issuedAt: z.number(),
  }),
  validate: () => ok(),
  apply: ({ cmd }) => [
    PingReceived({
      message: cmd.message,
      pingedAt: cmd.issuedAt,
      pongedAt: Date.now(),
    }),
  ],
});
