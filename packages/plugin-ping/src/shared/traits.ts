import { defineTrait, z } from "@vtt/substrate";

export const Pong = defineTrait({
  name: "@vtt/ping/Pong",
  schema: z.object({
    message: z.string(),
    pingedAt: z.number(),
    pongedAt: z.number(),
  }),
});
