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

import { type JSX } from "solid-js";
import { Surface } from "@vtt/substrate/client";
import {
  definePageProvider,
  WorkbenchChatRailSurface,
} from "@vtt/shell-workbench/shared";
import { ChatMessage } from "../shared/traits.js";

/**
 * The workbench page kind for chat. With the right-hand chat rail
 * retired, "table talk" is a first-class tab like every other surface —
 * the user opens it from the tab picker / palette and it reclaims the
 * full pane width.
 */
export const CHAT_PAGE_KIND = "@vtt/comms/chat";

/**
 * Chat as a page. Reuses the exact same `WorkbenchChatRailSurface` the
 * rail mounted — `ChatStreamView` + `ChatComposerView` (and any player
 * list / widget filled against it) render here unchanged — so there's
 * one chat implementation shared by the desktop tab and the mobile
 * chat mode. The flex column lets the stream's own `flex-1` absorb the
 * height while the composer sits at the bottom.
 */
function ChatPage(): JSX.Element {
  return (
    <div
      class="flex h-full min-h-0 flex-col gap-3 p-4"
      data-testid="chat-page"
    >
      <Surface name={WorkbenchChatRailSurface.name} />
    </div>
  );
}

/**
 * Singleton page — chat has no per-entity rows, so `list` is empty and
 * the kind is opened by name. `reads: [ChatMessage]` keeps the tab label
 * reactive to the same trait the stream renders.
 */
export const ChatPageProvider = definePageProvider({
  kind: CHAT_PAGE_KIND,
  icon: "chat",
  label: "Chat",
  reads: [ChatMessage],
  list: () => [],
  defaultEntity: () => null,
  render: () => <ChatPage />,
  priority: 50,
});
