import { For, type JSX } from "solid-js";
import { Surface } from "@vtt/substrate/client";
import { useChatRailWidgets } from "./use-providers.js";
import { WorkbenchChatRailSurface } from "../shared/surfaces.js";

/**
 * The persistent right rail. Pure-stack layout: every view registered
 * against `WorkbenchChatRailSurface` renders here, sorted by priority
 * desc (substrate's stacked-surface contract). A small set of plugin-
 * supplied widgets contributed to the `chat-rail-widgets` slot stack
 * above the surface for cases where a fully-fledged View is overkill.
 *
 * Convention for sub-views to play nice in this column:
 *   - PlayerListView etc. — natural height, sit at the top
 *   - chat stream         — flex-1 + min-h-0 to absorb remaining space
 *   - chat composer       — natural height at the bottom
 *
 * The rail is a flex column; the children's own flex/sizing decides the
 * split. `overflow-y-auto` is the safety net for short viewports — when
 * the natural-height items (player list + roll tray + composer) plus
 * the chat stream's min height combined exceed the rail height, the
 * rail itself scrolls. When the rail has plenty of room, the chat
 * stream's internal scroll is what activates. The workbench owns no
 * comms-specific knowledge here.
 */
export function ChatRail(): JSX.Element {
  const widgets = useChatRailWidgets();
  return (
    <aside
      class="flex min-h-0 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-surface-sunken px-3 py-3"
      style={{ width: "var(--workbench-rail)" }}
    >
      <For each={widgets()}>
        {(w) => <div class="shrink-0">{w.render() as unknown as JSX.Element}</div>}
      </For>
      <Surface name={WorkbenchChatRailSurface.name} />
    </aside>
  );
}
