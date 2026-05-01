// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import {
  ChatInputHandlerSlot,
  type ChatInputContext,
  type ChatInputHandler,
} from "@vtt/comms/shared";
import { RequestRoll } from "./commands.js";

/**
 * Build a roll slash-handler with the given prefix. Lets us register
 * both `/r ` (short form) and `/roll ` (long form) as separate handlers
 * with identical behaviour, so users who keep typing the long form get
 * the same result as the short form. Both forward `speakingAsCharacterId`
 * and `gmOnly` from the composer so a slash-driven roll runs through
 * the same attribution + visibility path as a typed message.
 *
 * Composer dispatch matches on prefix in priority order; the two forms
 * sit at the same priority since they're mutually exclusive (a user
 * types one or the other).
 */
function rollHandler(prefix: string, describe: string): ChatInputHandler {
  return {
    prefix,
    describe,
    priority: 50,
    handle: (input: string, ctx: ChatInputContext) => {
      const rest = input.slice(prefix.length).trim();
      if (rest.length === 0) return null;
      return RequestRoll({
        notation: rest,
        visibility: ctx.gmOnly ? "gm-only" : "public",
        ...(ctx.speakingAsCharacterId
          ? { speakingAsCharacterId: ctx.speakingAsCharacterId }
          : {}),
      });
    },
  };
}

export const RollChatHandler = rollHandler(
  "/r ",
  "/r <notation> — roll dice (e.g. /r 1d20+5)",
);
export const RollChatHandlerLong = rollHandler(
  "/roll ",
  "/roll <notation> — alias for /r (e.g. /roll 1d20+5)",
);

/**
 * `fills` shape for the resolution plugin's manifest. Keyed by the slot's
 * qualified name so the substrate can validate against the slot schema
 * declared by comms.
 */
export const RollChatFills = {
  [ChatInputHandlerSlot.name]: [RollChatHandler, RollChatHandlerLong],
};
