// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, cleanup, render } from "@solidjs/testing-library";
import { buildTestClient } from "@vtt/substrate/client-testing";
import { ClientProvider } from "@vtt/substrate/client";
import { definePlugin, defineView, clientOnly } from "@vtt/substrate";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { shellWorkbench } from "./manifest.js";
import {
  ChatRailWidgetsSlot,
  type ChatRailWidget,
} from "./shared/slots.js";
import { WorkbenchChatRailSurface } from "./shared/surfaces.js";
import { ChatRail } from "./client/ChatRail.js";

beforeEach(() => cleanup());

describe("shell-workbench ChatRail", () => {
  it("renders an aside element regardless of whether widgets are registered", () => {
    // With identity loaded, PlayerListView already fills the chat rail
    // surface — so the rail isn't empty even without explicit test
    // contributions. The structural guarantee is just "the aside
    // element renders so other fills have a host."
    const h = buildTestClient({
      plugins: [identity, permissions, shellWorkbench],
    });
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <ChatRail />
      </ClientProvider>
    ));
    expect(container.querySelector("aside")).not.toBeNull();
  });

  it("renders chat-rail-widgets slot fills", () => {
    const widget: ChatRailWidget = {
      id: "@test/chat-rail/widget-a" as ChatRailWidget["id"],
      priority: 10,
      render: () => <span data-testid="widget-a">WIDGET-A</span>,
    };
    const widgetsPlugin = definePlugin({
      name: "@vtt/test-chat-widgets",
      version: "0.0.0",
      fills: { [ChatRailWidgetsSlot.name]: [widget] },
    });
    const h = buildTestClient({
      plugins: [identity, permissions, shellWorkbench, widgetsPlugin],
    });
    render(() => (
      <ClientProvider value={h.client}>
        <ChatRail />
      </ClientProvider>
    ));
    expect(screen.getByTestId("widget-a")).toBeInTheDocument();
    expect(screen.getByText("WIDGET-A")).toBeInTheDocument();
  });

  it("renders views registered against WorkbenchChatRailSurface", () => {
    const view = defineView({
      name: "TestRailView",
      surface: WorkbenchChatRailSurface,
      priority: 5,
      render: clientOnly(() => <span data-testid="rail-view">RAIL-VIEW</span>),
    });
    const viewPlugin = definePlugin({
      name: "@vtt/test-chat-rail-view",
      version: "0.0.0",
      views: [view],
    });
    const h = buildTestClient({
      plugins: [identity, permissions, shellWorkbench, viewPlugin],
    });
    render(() => (
      <ClientProvider value={h.client}>
        <ChatRail />
      </ClientProvider>
    ));
    expect(screen.getByTestId("rail-view")).toBeInTheDocument();
  });

  it("priority-sorts widgets within the rail", () => {
    const low: ChatRailWidget = {
      id: "@test/chat-rail/low" as ChatRailWidget["id"],
      priority: 1,
      render: () => <span data-testid="w">LOW</span>,
    };
    const high: ChatRailWidget = {
      id: "@test/chat-rail/high" as ChatRailWidget["id"],
      priority: 100,
      render: () => <span data-testid="w">HIGH</span>,
    };
    const widgetsPlugin = definePlugin({
      name: "@vtt/test-chat-widgets-pri",
      version: "0.0.0",
      fills: { [ChatRailWidgetsSlot.name]: [low, high] },
    });
    const h = buildTestClient({
      plugins: [identity, permissions, shellWorkbench, widgetsPlugin],
    });
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <ChatRail />
      </ClientProvider>
    ));
    const widgets = Array.from(container.querySelectorAll('[data-testid="w"]')).map(
      (n) => n.textContent,
    );
    // Higher priority renders first (top of column).
    expect(widgets).toEqual(["HIGH", "LOW"]);
  });
});
