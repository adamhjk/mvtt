// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { defineEvent, EntityId, z } from "@vtt/substrate";

export const MessageSent = defineEvent({
  name: "@vtt/comms/MessageSent",
  schema: z.object({
    messageId: EntityId,
    authorUserId: z.string().min(1),
    authorName: z.string().min(1),
    body: z.string().min(1).max(2000),
    sentAt: z.number(),
    whisperTo: z.array(z.string()).optional(),
    /**
     * Optional Character entity the sender is speaking as. The
     * MessageRecordingSystem resolves the character's current name and
     * uses it as the recorded `authorName` on the spawned ChatMessage.
     */
    speakingAsCharacterId: EntityId.optional(),
    /**
     * Visibility chosen at send time. `gm-only` rides the same role-based
     * filter that gm-only rolls use; renderers can also use it to badge
     * the message in chat.
     */
    visibility: z.enum(["public", "gm-only"]).default("public"),
  }),
});
