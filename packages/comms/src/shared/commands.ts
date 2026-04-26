import { defineCommand, fail, ok, withVisibility, z } from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { actors, everyone } from "@vtt/permissions/shared";
import { MessageSent } from "./events.js";

/**
 * Send a chat message — public by default, or a whisper if `whisperTo` is
 * a non-empty list of userIds. The substrate's per-recipient broadcast
 * filter only delivers a whisper to the listed userIds plus the sender
 * (we always include the sender so they see their own message in the
 * stream).
 */
export const SendMessage = defineCommand({
  name: "@vtt/comms/SendMessage",
  schema: z.object({
    body: z.string().min(1).max(2000),
    whisperTo: z.array(z.string()).optional(),
  }),
  validate: ({ session }) => {
    if (!requireSession({ session })) return fail("not authenticated");
    return ok();
  },
  apply: ({ cmd, session }) => {
    const auth = requireSession({ session });
    if (!auth) {
      // validate already rejected this; defensive
      throw new Error("SendMessage.apply called without a valid session");
    }

    const sentAt = Date.now();
    const recipients =
      cmd.whisperTo && cmd.whisperTo.length > 0
        ? Array.from(new Set([auth.userId, ...cmd.whisperTo]))
        : null;
    const visibility = recipients ? actors(recipients) : everyone();

    return [
      withVisibility(
        MessageSent({
          authorUserId: auth.userId,
          authorName: auth.name,
          body: cmd.body,
          sentAt,
          whisperTo: recipients ?? undefined,
        }),
        visibility,
      ),
    ];
  },
});
