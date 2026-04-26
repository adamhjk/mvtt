import { defineEvent, z } from "@vtt/substrate";

export const MessageSent = defineEvent({
  name: "@vtt/comms/MessageSent",
  schema: z.object({
    authorUserId: z.string().min(1),
    authorName: z.string().min(1),
    body: z.string().min(1).max(2000),
    sentAt: z.number(),
    whisperTo: z.array(z.string()).optional(),
  }),
});
