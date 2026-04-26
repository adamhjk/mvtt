import { defineSlot, type CommandInstance, z } from "@vtt/substrate";

/**
 * Per-fill schema for the `chat-input-handlers` slot. Plugins fill this
 * to teach the chat composer about new slash commands. When the user
 * presses Enter, the composer walks the registered handlers in priority
 * order; the first one whose `prefix` matches the start of the input is
 * invoked. If `handle` returns a CommandInstance, the composer dispatches
 * that instead of `SendMessage`. Returning null means "I matched the
 * prefix but the rest didn't parse" — the composer falls through to the
 * next handler (or to SendMessage as default).
 *
 * Runtime validation here is deliberately permissive on `handle` (it's a
 * function reference; Zod can't usefully validate a function shape). The
 * type below is the load-bearing constraint at the call site.
 */
const ChatInputHandlerSchema = z.object({
  prefix: z.string().min(1),
  describe: z.string(),
  priority: z.number().optional(),
  // function values aren't structurally validated; we trust plugins
  handle: z.any(),
});

export interface ChatInputContext {
  readonly myUserId: string;
  readonly myRole: string;
  /**
   * Map of "display name" → "userId" for currently-online players.
   * Slash commands like `/w Aragorn ...` use this to resolve a name to
   * the userId that the whisper visibility builder needs.
   */
  readonly onlineByName: ReadonlyMap<string, string>;
}

export type ChatInputHandler = {
  prefix: string;
  describe: string;
  priority?: number;
  handle: (text: string, ctx: ChatInputContext) => CommandInstance | null;
};

/**
 * The slot itself. Comms declares it; resolution (and any future plugin
 * that wants to hook the chat input) fills it.
 */
export const ChatInputHandlerSlot = defineSlot({
  name: "@vtt/comms/chat-input-handlers",
  schema: ChatInputHandlerSchema,
  description: "Slash-command parsers for the chat composer.",
});
