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

import { defineSlot, type CommandInstance, z } from "@vtt/substrate";

/**
 * One row in the chat timeline. Contributors return these via their
 * `useEntries` accessor; the chat stream merges every contributor's
 * entries with the chat-message entries, sorts by `sortKey` (a
 * unix-millis timestamp by convention), and renders them top-to-bottom.
 */
export interface ChatTimelineEntry {
  /**
   * Stable id for `<For>` keying — usually the entity id but contributors
   * are free to use a synthetic id (e.g. for inline ephemeral entries).
   */
  readonly id: string;
  /**
   * Sort key. Convention: unix millis from the same clock the chat
   * messages use so live + historical entries interleave correctly.
   */
  readonly sortKey: number;
  /** Returns the JSX for this row. Called once per render of the row. */
  readonly render: () => unknown;
}

/**
 * Per-fill schema for the `chat-timeline-contributors` slot. Each
 * contributor reactively produces a list of timeline entries that the
 * chat stream interleaves with chat messages by `sortKey`.
 *
 * `useEntries` is invoked **once** during the chat stream's render —
 * the same function-call constraint Solid imposes on hook-style
 * helpers — and must return an `Accessor<ChatTimelineEntry[]>`. The
 * chat stream tracks the accessor reactively. Implementations
 * typically wrap `useQuery` + `createMemo`.
 *
 * The runtime schema treats `useEntries` as opaque (Zod can't validate
 * a function shape); the type below is the load-bearing constraint at
 * the call site.
 */
const ChatTimelineContributorSchema = z.object({
  kind: z.string().min(1),
  // function values aren't structurally validated; we trust plugins
  useEntries: z.any(),
});

export interface ChatTimelineContributor {
  /** Unique identifier — used as a render key and for debugging. */
  readonly kind: string;
  /**
   * Solid hook: called inside the chat stream component. Must return an
   * `Accessor<ChatTimelineEntry[]>` (plain `() => ChatTimelineEntry[]`
   * or the result of `createMemo`). The return type is left loose here
   * to avoid leaking a `solid-js` import from `shared/`; the chat
   * stream casts at the consumption site.
   */
  readonly useEntries: () => () => ChatTimelineEntry[];
}

export const ChatTimelineContributorSlot = defineSlot({
  name: "@vtt/comms/chat-timeline-contributors",
  schema: ChatTimelineContributorSchema,
  description:
    "Plugin-supplied timeline entries (rolls, system events, …) interleaved with chat messages by sortKey.",
});

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
  /**
   * Currently-selected character entity to speak as, or `null` for
   * "speak as the player." Slash-command handlers should forward this
   * onto whatever command they emit (e.g. `/r` → RequestRoll, `/w` →
   * SendMessage) so attribution is consistent across input types.
   */
  readonly speakingAsCharacterId: string | null;
  /**
   * Whether the GM-only checkbox is checked. Always `false` for non-GM
   * users (the chat composer hides the checkbox). Slash handlers pass
   * this through to whatever command they emit so e.g. `/r` runs as
   * `gm-only` when the box is checked.
   */
  readonly gmOnly: boolean;
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
