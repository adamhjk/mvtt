// mvtt, an RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of mvtt.
//
// mvtt is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// mvtt is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with mvtt.  If not, see <https://www.gnu.org/licenses/>.

import { defineSystem, type Visibility } from "@vtt/substrate";
import {
  actors,
  everyone,
  gmOnly,
  Permissions,
} from "@vtt/permissions/shared";
import { Character } from "@vtt/characters/shared";
import { ChatMessage } from "../shared/traits.js";
import { MessageSent } from "../shared/events.js";

/**
 * Universal mirror system: runs on the server and on every recipient
 * client (the broadcast filter ensures only allowed clients see whisper
 * MessageSent events). Spawns one entity per message, carrying the
 * ChatMessage trait + a Permissions trait whose `read` mirrors the
 * event's effective visibility so the per-recipient snapshot filter
 * keeps the message out of late-joiner snapshots when it's a whisper.
 * `write` is GM-only — messages are immutable once sent; only GMs
 * could ever moderate (future).
 *
 * When the message was sent with `speakingAsCharacterId`, the system
 * resolves the current Character name and overrides `authorName` with
 * it — so the trait stored on every replica says "Tarn" rather than
 * the raw account display name. Falling back to the event's authorName
 * keeps the message readable if the character has been despawned by
 * the time a late-joiner replays the snapshot.
 */
export const MessageRecordingSystem = defineSystem({
  name: "MessageRecording",
  on: MessageSent,
  reads: [Character],
  writes: [ChatMessage, Permissions],
  run: ({ event, world }) => {
    // Whisper visibility wins over `gm-only` (whispers are strictly
    // narrower); that mirrors the rule SendMessage.apply applies to the
    // event-level visibility.
    const read: Visibility =
      event.whisperTo && event.whisperTo.length > 0
        ? actors(event.whisperTo)
        : event.visibility === "gm-only"
          ? gmOnly()
          : everyone();
    let authorName = event.authorName;
    if (event.speakingAsCharacterId && world.has(event.speakingAsCharacterId)) {
      const got = world.get(event.speakingAsCharacterId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      if (got) authorName = got.Character.name;
    }
    world.spawnAt(event.messageId, [
      ChatMessage({
        authorUserId: event.authorUserId,
        authorName,
        body: event.body,
        sentAt: event.sentAt,
        whisperTo: event.whisperTo,
        speakingAsCharacterId: event.speakingAsCharacterId,
        visibility: event.visibility,
      }),
      Permissions({ read, write: gmOnly() }),
    ]);
    return [];
  },
});
