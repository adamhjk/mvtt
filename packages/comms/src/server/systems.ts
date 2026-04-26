import { defineSystem, type Visibility } from "@vtt/substrate";
import { EntityVisibility, actors, everyone } from "@vtt/permissions/shared";
import { ChatMessage } from "../shared/traits.js";
import { MessageSent } from "../shared/events.js";

/**
 * Universal mirror system: runs on the server and on every recipient
 * client (the broadcast filter ensures only allowed clients see whisper
 * MessageSent events). Spawns one entity per message, carrying the
 * ChatMessage trait + an EntityVisibility trait that mirrors the event's
 * visibility so the per-recipient snapshot filter keeps the message out
 * of late-joiner snapshots when it's a whisper.
 */
export const MessageRecordingSystem = defineSystem({
  name: "MessageRecording",
  on: MessageSent,
  reads: [],
  writes: [ChatMessage, EntityVisibility],
  run: ({ event, world }) => {
    const visibility: Visibility =
      event.whisperTo && event.whisperTo.length > 0
        ? actors(event.whisperTo)
        : everyone();
    world.spawn([
      ChatMessage({
        authorUserId: event.authorUserId,
        authorName: event.authorName,
        body: event.body,
        sentAt: event.sentAt,
        whisperTo: event.whisperTo,
      }),
      EntityVisibility({ visibility }),
    ]);
    return [];
  },
});
