import { ChatInputHandlerSlot, type ChatInputHandler } from "@vtt/comms/shared";
import { RequestRoll } from "./commands.js";

/**
 * Slash-command handler for `/r <notation> [reason]`. Lets users dispatch
 * a roll directly from the chat composer without leaving the input.
 * Filed under the comms plugin's `chat-input-handlers` slot — the chat
 * composer walks the slot's fills, finds this entry by its `/r ` prefix,
 * and dispatches RequestRoll instead of SendMessage when it matches.
 */
export const RollChatHandler = {
  prefix: "/r ",
  describe: "/r <notation> — roll dice (e.g. /r 1d20+5)",
  priority: 50,
  handle: (input: string) => {
    const rest = input.slice(3).trim();
    if (rest.length === 0) return null;
    return RequestRoll({ notation: rest, visibility: "public" });
  },
} satisfies ChatInputHandler;

/**
 * `fills` shape for the resolution plugin's manifest. Keyed by the slot's
 * qualified name so the substrate can validate against the slot schema
 * declared by comms.
 */
export const RollChatFills = {
  [ChatInputHandlerSlot.name]: [RollChatHandler],
};
