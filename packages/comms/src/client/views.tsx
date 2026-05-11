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

import { defineView, clientOnly, type CommandInstance } from "@vtt/substrate";
import {
  useClient,
  useQuery,
  useTrait,
  type QueryRow,
} from "@vtt/substrate/client";
import { WorkbenchChatRailSurface } from "@vtt/shell-workbench/shared";
import { Identity, Name, Online } from "@vtt/identity/shared";
import {
  activeSpeakerId,
  setActiveSpeakerId,
  useEffectiveSpeakerId,
  useSpeakAsOptions,
} from "@vtt/characters/client";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
  type Accessor,
} from "solid-js";
import { ChatMessage } from "../shared/traits.js";
import { SendMessage } from "../shared/commands.js";
import {
  ChatInputHandlerSlot,
  ChatTimelineContributorSlot,
  type ChatInputContext,
  type ChatInputHandler,
  type ChatTimelineContributor,
  type ChatTimelineEntry,
} from "../shared/slot.js";

/**
 * Composer fills the chat rail's bottom slot (priority 1). Reads the
 * `chat-input-handlers` slot to handle slash commands; everything else
 * dispatches as a SendMessage. `/w <name> ...` is a built-in handler
 * provided by comms itself (no plugin contribution needed).
 *
 * GMs see a "GM only" checkbox that scopes both regular messages and
 * slash-handler-driven commands (notably `/r` rolls) to GM sessions.
 * For non-GMs the box is absent and `gmOnly` in the slash context is
 * always false.
 */
export const ChatComposerView = defineView({
  name: "ChatComposer",
  surface: WorkbenchChatRailSurface,
  priority: 1,
  render: clientOnly(() => {
    const client = useClient();
    const [text, setText] = createSignal("");
    const [gmOnly, setGmOnly] = createSignal(false);

    // Resolve current user via the connection's clientId — same pattern as
    // the dice roller's GM-only check. Always read all signals up front so
    // the memo tracks them.
    const players = useQuery([Identity, Name, Online]);
    const me = createMemo(() => {
      const list = players();
      const cid = client.clientId();
      if (!cid) return null;
      const found = list.find(
        (p) => (p.values.Online as { clientId: string }).clientId === cid,
      );
      if (!found) return null;
      const id = found.values.Identity as { userId: string; role: string };
      return { userId: id.userId, role: id.role };
    });
    const isGm = createMemo(() => me()?.role === "gm");

    const speakAsOptions = useSpeakAsOptions();
    const speakerId = useEffectiveSpeakerId();

    const handlers = createMemo<ChatInputHandler[]>(() => {
      const fills = client.registry.fillsForSlot(
        ChatInputHandlerSlot,
      ) as ChatInputHandler[];
      const builtin: ChatInputHandler = {
        prefix: "/w ",
        describe: "/w <name> <message> — whisper to a player",
        priority: 100,
        handle: (input, ctx) => parseWhisper(input, ctx),
      };
      return [builtin, ...fills].sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
      );
    });

    const send = () => {
      const trimmed = text().trim();
      if (trimmed.length === 0) return;
      const cur = me();
      if (!cur) return;
      const sid = speakerId();
      const gm = isGm() && gmOnly();
      const ctx: ChatInputContext = {
        myUserId: cur.userId,
        myRole: cur.role,
        onlineByName: nameMap(players()),
        speakingAsCharacterId: sid,
        gmOnly: gm,
      };
      let dispatched: CommandInstance | null = null;
      for (const h of handlers()) {
        if (!trimmed.startsWith(h.prefix)) continue;
        const cmd = h.handle(trimmed, ctx);
        if (cmd) {
          dispatched = cmd;
          break;
        }
      }
      if (!dispatched) {
        dispatched = SendMessage({
          body: trimmed,
          visibility: gm ? "gm-only" : "public",
          ...(sid ? { speakingAsCharacterId: sid } : {}),
        });
      }
      client.dispatch(dispatched);
      setText("");
    };

    return (
      <div class="flex flex-col gap-2">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-fg-muted">
          chat
        </h2>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.65rem] text-fg-subtle">
          <Show when={speakAsOptions().length > 1}>
            <label class="flex items-center gap-1.5">
              <span class="font-display uppercase tracking-[0.16em]">
                speak as
              </span>
              <select
                value={activeSpeakerId() ?? ""}
                onChange={(e) =>
                  setActiveSpeakerId(
                    e.currentTarget.value === ""
                      ? null
                      : e.currentTarget.value,
                  )
                }
                class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              >
                <For each={speakAsOptions()}>
                  {(o) => (
                    <option value={o.characterId ?? ""}>{o.label}</option>
                  )}
                </For>
              </select>
            </label>
          </Show>
          <Show when={isGm()}>
            <label class="flex cursor-pointer items-center gap-1.5 select-none">
              <input
                type="checkbox"
                checked={gmOnly()}
                onChange={(e) => setGmOnly(e.currentTarget.checked)}
                class="h-3.5 w-3.5 cursor-pointer rounded-(--radius-control) border-border accent-accent"
              />
              <span class="font-display uppercase tracking-[0.16em]">
                gm only
              </span>
            </label>
          </Show>
        </div>
        <form
          class="flex gap-2"
          autocomplete="off"
          data-form-type="other"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            type="text"
            name="chat-body"
            value={text()}
            onInput={(e) => setText(e.currentTarget.value)}
            placeholder="say something… (/r 1d20, /w Aragorn …)"
            autocomplete="off"
            spellcheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            class="flex-1 rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            class="rounded-(--radius-control) bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover transition"
          >
            Send
          </button>
        </form>
      </div>
    );
  }),
});

/**
 * The unified chat timeline — fills the middle of the workbench chat
 * rail. Priority 50 sits below PlayerListView (100) and above
 * ChatComposerView (1), so the stack reads players → stream → composer
 * top-to-bottom.
 *
 * Renders chat messages plus every entry produced by a
 * `ChatTimelineContributor` (rolls, system events, …) interleaved by
 * `sortKey` (typically a unix-millis timestamp). Each contributor's
 * `useEntries` runs once on mount; subsequent updates flow through
 * Solid's reactive graph.
 *
 * Scroll behaviour:
 * - Newest row is at the bottom of the viewport (`flex-col` with
 *   chronological order). Older rows are above; the user scrolls up to
 *   read history.
 * - On a fresh entry we re-snap to the bottom *only* when the user was
 *   already pinned there. If they've scrolled up to read history we
 *   leave them put.
 * - Scrollbars hidden across browsers via Tailwind v4 arbitrary
 *   variants (no global CSS).
 */
export const ChatStreamView = defineView({
  name: "ChatStream",
  surface: WorkbenchChatRailSurface,
  priority: 50,
  render: clientOnly(() => {
    const client = useClient();
    const messages = useQuery([ChatMessage]);

    // Snapshot the contributors once. Slot fills are immutable after
    // registry validation, so a one-time read is sufficient and keeps
    // the number of `useEntries` invocations stable across renders
    // (Solid hooks must run a stable count per component lifetime).
    const contributors = client.registry.fillsForSlot(
      ChatTimelineContributorSlot,
    ) as ChatTimelineContributor[];
    const contributorAccessors: Accessor<ChatTimelineEntry[]>[] =
      contributors.map(
        (c) => c.useEntries() as Accessor<ChatTimelineEntry[]>,
      );

    const entries = createMemo<ChatTimelineEntry[]>(() => {
      const out: ChatTimelineEntry[] = messages().map((row) => {
        const m = row.values.ChatMessage as { sentAt: number };
        return {
          id: row.id,
          sortKey: m.sentAt,
          render: () => <MessageRow entityId={row.id} />,
        };
      });
      for (const acc of contributorAccessors) {
        for (const e of acc()) out.push(e);
      }
      out.sort((a, b) => a.sortKey - b.sortKey);
      return out;
    });

    let viewportEl: HTMLDivElement | undefined;
    // True when the user is within `BOTTOM_THRESHOLD` of the bottom of
    // the viewport. New entries auto-scroll the viewport to the bottom
    // *only* when this flag is true; if the user has scrolled up to
    // read history we leave their position alone. The threshold gives
    // a few-px buffer so a row's mount/measure doesn't accidentally
    // unpin the viewer mid-frame.
    const BOTTOM_THRESHOLD = 16;
    const [pinned, setPinned] = createSignal(true);

    const distanceFromBottom = (el: HTMLDivElement): number =>
      el.scrollHeight - el.clientHeight - el.scrollTop;

    const onScroll = () => {
      if (!viewportEl) return;
      setPinned(distanceFromBottom(viewportEl) <= BOTTOM_THRESHOLD);
    };

    // After every entry-change re-snap to the bottom if the user was
    // already pinned. Defer with rAF so the freshly-mounted row's
    // height is in the layout when we measure scrollHeight.
    createEffect(() => {
      // Track entries() so the effect re-runs on changes.
      void entries();
      if (!viewportEl) return;
      if (!pinned()) return;
      const el = viewportEl;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    });

    onMount(() => {
      if (viewportEl) viewportEl.scrollTop = viewportEl.scrollHeight;
    });

    return (
      <div
        ref={viewportEl}
        onScroll={onScroll}
        data-testid="chat-stream-viewport"
        class="flex min-h-[12rem] flex-1 flex-col gap-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <For each={entries()}>{(e) => <>{e.render() as unknown}</>}</For>
      </div>
    );
  }),
});

/**
 * Default per-message row used by the unified timeline. Renders author +
 * body with optional "whisper" / "gm only" badges. Plugins that need
 * a richer message kind should fill `ChatTimelineContributorSlot`
 * instead of overriding this row.
 */
function MessageRow(props: { entityId: string }) {
  const msg = useTrait(props.entityId, ChatMessage);
  return (
    <Show when={msg()}>
      <article class="rounded-(--radius-card) border border-border-muted bg-surface-elevated px-3 py-2 text-sm">
        <header class="flex items-baseline justify-between gap-2 text-xs">
          <span class="font-medium text-fg">{msg()!.authorName}</span>
          <span class="flex items-center gap-2 text-[0.6rem] uppercase tracking-[0.16em]">
            <Show when={msg()!.whisperTo && msg()!.whisperTo!.length > 1}>
              <span class="text-accent">whisper</span>
            </Show>
            <Show when={msg()!.visibility === "gm-only"}>
              <span class="text-accent">gm only</span>
            </Show>
          </span>
        </header>
        <p class="mt-1 whitespace-pre-wrap break-words text-fg-muted">{msg()!.body}</p>
      </article>
    </Show>
  );
}

// — local helpers ————————————————————————————————————————————

function parseWhisper(input: string, ctx: ChatInputContext) {
  // Strip "/w " prefix, then split off the recipient name (one word).
  const rest = input.slice(3).trimStart();
  const space = rest.indexOf(" ");
  if (space < 0) return null;
  const name = rest.slice(0, space).trim();
  const body = rest.slice(space + 1).trim();
  if (name.length === 0 || body.length === 0) return null;
  const userId = ctx.onlineByName.get(name);
  if (!userId) return null;
  return SendMessage({
    body,
    whisperTo: [userId],
    ...(ctx.speakingAsCharacterId
      ? { speakingAsCharacterId: ctx.speakingAsCharacterId }
      : {}),
  });
}

function nameMap(rows: QueryRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    const id = r.values.Identity as { userId: string };
    const nm = r.values.Name as { value: string };
    out.set(nm.value, id.userId);
  }
  return out;
}

