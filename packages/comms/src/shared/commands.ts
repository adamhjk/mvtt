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

import {
  defineCommand,
  EntityId,
  fail,
  ok,
  withVisibility,
  z,
} from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { actors, everyone, gmOnly, requireWrite } from "@vtt/permissions/shared";
import { Character } from "@vtt/characters/shared";
import { MessageSent } from "./events.js";

/**
 * Send a chat message — public by default, or a whisper if `whisperTo` is
 * a non-empty list of userIds. The substrate's per-recipient broadcast
 * filter only delivers a whisper to the listed userIds plus the sender
 * (we always include the sender so they see their own message in the
 * stream).
 *
 * `speakingAsCharacterId` lets the player attribute the message to one of
 * their characters. Validated server-side: the entity must carry the
 * `Character` trait and either be played by the sender (`Character.playerUserId === auth.userId`)
 * or the sender must be a GM. Resolved to the character's name by the
 * MessageRecordingSystem so `apply` doesn't read the world.
 */
export const SendMessage = defineCommand({
  name: "@vtt/comms/SendMessage",
  schema: z.object({
    body: z.string().min(1).max(2000),
    whisperTo: z.array(z.string()).optional(),
    speakingAsCharacterId: EntityId.optional(),
    /**
     * Audience for the message. `gm-only` is the chat-rail equivalent of
     * a GM-only roll: only sessions whose role is `gm` see it, both at
     * live broadcast and on snapshot replay. Whispers (`whisperTo`)
     * compose with `gm-only` such that whispers always win — sending a
     * whisper while gm-only is checked still goes only to the named
     * recipients (whisper visibility is strictly narrower).
     */
    visibility: z.enum(["public", "gm-only"]).default("public"),
  }),
  validate: (ctx) => {
    const auth = requireSession(ctx);
    if (!auth) return fail("not authenticated");
    if (ctx.cmd.visibility === "gm-only" && auth.role !== "gm") {
      return fail("only a GM can send a GM-only message");
    }
    const speakerId = ctx.cmd.speakingAsCharacterId;
    if (speakerId !== undefined) {
      if (!ctx.world.has(speakerId)) {
        return fail(`character ${speakerId} does not exist`);
      }
      const got = ctx.world.get(speakerId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      if (!got) {
        return fail(`entity ${speakerId} is not a character`);
      }
      const editor = requireWrite(ctx, speakerId);
      if (!editor.ok) return editor;
    }
    return ok();
  },
  apply: ({ cmd, session, world }) => {
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
    // Whisper visibility is always strictly narrower than role-based
    // gm-only — a whisper to a player wins.
    const visibility = recipients
      ? actors(recipients)
      : cmd.visibility === "gm-only"
        ? gmOnly()
        : everyone();

    return [
      withVisibility(
        MessageSent({
          messageId: world.allocateId(),
          authorUserId: auth.userId,
          authorName: auth.name,
          body: cmd.body,
          sentAt,
          whisperTo: recipients ?? undefined,
          speakingAsCharacterId: cmd.speakingAsCharacterId,
          visibility: cmd.visibility,
        }),
        visibility,
      ),
    ];
  },
});
