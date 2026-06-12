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

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, cleanup } from "@solidjs/testing-library";
import {
  buildTestClient,
  mountWithClient,
} from "@vtt/substrate/client-testing";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { characters } from "@vtt/characters";
import { shellWorkbench } from "@vtt/shell-workbench";
import { notes } from "@vtt/notes";
import { comms } from "../manifest.js";
import { ChatPageProvider, CHAT_PAGE_KIND } from "./ChatPage.js";

beforeEach(() => cleanup());

const ME = "test-me";
const ME_CLIENT = "client-me";

function harness() {
  return buildTestClient({
    plugins: [shellWorkbench, notes, identity, permissions, characters, comms],
    clientId: ME_CLIENT,
    session: { userId: ME, email: "me@test.dev", name: "Me", role: "player" },
    setupWorld: ({ world }) => {
      world.spawn([
        Identity({ userId: ME, role: "player" }),
        Name({ value: "Me" }),
        Online({ clientId: ME_CLIENT, since: 0 }),
      ]);
    },
  });
}

describe("comms ChatPageProvider", () => {
  it("is a plugin-namespaced singleton page", () => {
    expect(ChatPageProvider.kind).toBe(CHAT_PAGE_KIND);
    expect(ChatPageProvider.label).toBe("Chat");
    // Singleton — no per-entity rows.
    expect(
      ChatPageProvider.list({
        world: harness().world,
        registry: harness().client.registry,
        userId: ME,
        role: "player",
      }),
    ).toEqual([]);
  });

  it("mounts the chat surface (composer + stream) as a page", () => {
    const h = harness();
    mountWithClient(
      h,
      () => ChatPageProvider.render({ tabId: "t1", entityId: null }) as never,
    );
    expect(screen.getByTestId("chat-page")).toBeInTheDocument();
    // The chat composer (a WorkbenchChatRailSurface view) renders inside
    // the page — chat now lives in a tab, not the retired right rail.
    expect(screen.getByPlaceholderText(/say something/i)).toBeInTheDocument();
    expect(screen.getByTestId("chat-stream-viewport")).toBeInTheDocument();
  });
});
