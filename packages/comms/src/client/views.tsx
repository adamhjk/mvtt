import { defineView, clientOnly, type CommandInstance } from "@vtt/substrate";
import {
  Surface,
  useClient,
  useQuery,
  useTrait,
  type QueryRow,
} from "@vtt/substrate/client";
import { MainSurface } from "@vtt/shell-default/shared";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { createMemo, createSignal, Show } from "solid-js";
import { ChatMessage } from "../shared/traits.js";
import { SendMessage } from "../shared/commands.js";
import { ChatStreamSurface } from "../shared/surfaces.js";
import {
  ChatInputHandlerSlot,
  type ChatInputContext,
  type ChatInputHandler,
} from "../shared/slot.js";

/**
 * Composer fills the main surface (priority 1, below dice roller). Reads
 * the chat-input-handlers slot to handle slash commands; everything else
 * dispatches as a SendMessage. `/w <name> ...` is a built-in handler
 * provided by comms itself (no plugin contribution needed).
 */
export const ChatComposerView = defineView({
  name: "ChatComposer",
  surface: MainSurface,
  priority: 1,
  render: clientOnly(() => {
    const client = useClient();
    const [text, setText] = createSignal("");

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
      const ctx: ChatInputContext = {
        myUserId: cur.userId,
        myRole: cur.role,
        onlineByName: nameMap(players()),
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
        dispatched = SendMessage({ body: trimmed });
      }
      client.dispatch(dispatched);
      setText("");
    };

    return (
      <div class="flex flex-col gap-2">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-fg-muted">
          chat
        </h2>
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
 * Stream view fills the main surface (priority 2, above composer, below
 * dice roller). It wraps the per-entity ChatStreamSurface, which fans
 * out one row per message entity that the substrate's snapshot filter
 * has actually delivered to this client.
 */
export const ChatStreamView = defineView({
  name: "ChatStream",
  surface: MainSurface,
  priority: 2,
  render: clientOnly(() => (
    <div class="flex flex-col gap-2">
      <Surface name={ChatStreamSurface.name} />
    </div>
  )),
});

/**
 * Default per-message row. Other plugins can register their own views
 * against ChatStreamSurface with a tighter `requires` (e.g. requiring an
 * additional trait the message gained) and a higher priority to take
 * over rendering for those messages. The default just shows author + body.
 */
export const ChatMessageView = defineView({
  name: "ChatMessage",
  surface: ChatStreamSurface,
  requires: [ChatMessage],
  priority: 0,
  render: clientOnly(({ entityId }: { entityId: string }) => {
    const msg = useTrait(entityId, ChatMessage);
    return (
      <Show when={msg()}>
        <article class="rounded-(--radius-card) border border-border-muted bg-surface-elevated px-3 py-2 text-sm">
          <header class="flex items-baseline justify-between gap-2 text-xs">
            <span class="font-medium text-fg">{msg()!.authorName}</span>
            <Show when={msg()!.whisperTo && msg()!.whisperTo!.length > 1}>
              <span class="text-accent">whisper</span>
            </Show>
          </header>
          <p class="mt-1 whitespace-pre-wrap break-words text-fg-muted">{msg()!.body}</p>
        </article>
      </Show>
    );
  }),
});

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
  return SendMessage({ body, whisperTo: [userId] });
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
