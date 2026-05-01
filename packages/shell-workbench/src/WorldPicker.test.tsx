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
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, render } from "@solidjs/testing-library";
import { buildTestClient } from "@vtt/substrate/client-testing";
import { ClientProvider } from "@vtt/substrate/client";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { shellWorkbench } from "./manifest.js";
import { WorldPicker } from "./client/WorldPicker.js";

beforeEach(() => cleanup());

interface WorldSummary {
  id: string;
  name: string;
  gameSystemPlugin: string;
  ownerUserId: string;
  createdAt: number;
  isOwner: boolean;
}

function harness(opts?: { worldId?: string; worlds?: WorldSummary[] }) {
  // Override the global fetch shim with one that returns our test
  // payloads; world-list lookup happens in createResource on mount.
  const worlds = opts?.worlds ?? [];
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/worlds")) {
      return new Response(JSON.stringify({ worlds }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/api/game-systems")) {
      return new Response(JSON.stringify({ gameSystems: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input);
  });
  return buildTestClient({
    plugins: [identity, permissions, shellWorkbench],
    worldId: opts?.worldId ?? "test-world",
  });
}

const sampleWorld = (id: string, name: string, isOwner = false): WorldSummary => ({
  id,
  name,
  gameSystemPlugin: "@vtt/system-simple",
  ownerUserId: "u",
  createdAt: 0,
  isOwner,
});

describe("shell-workbench WorldPicker", () => {
  it("renders 'no world' when client.worldId() doesn't match any loaded world", () => {
    const h = harness({ worldId: "ghost-world", worlds: [] });
    render(() => (
      <ClientProvider value={h.client}>
        <WorldPicker />
      </ClientProvider>
    ));
    expect(screen.getByText(/no world/i)).toBeInTheDocument();
  });

  it("renders the current world's name in the trigger button when it matches", async () => {
    const h = harness({
      worldId: "world-a",
      worlds: [sampleWorld("world-a", "Alpha"), sampleWorld("world-b", "Beta")],
    });
    render(() => (
      <ClientProvider value={h.client}>
        <WorldPicker />
      </ClientProvider>
    ));
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
  });

  it("opens a dropdown listing every available world on click", async () => {
    const h = harness({
      worldId: "world-a",
      worlds: [
        sampleWorld("world-a", "Alpha"),
        sampleWorld("world-b", "Beta"),
        sampleWorld("world-c", "Gamma"),
      ],
    });
    render(() => (
      <ClientProvider value={h.client}>
        <WorldPicker />
      </ClientProvider>
    ));
    // Open the dropdown.
    const trigger = await screen.findByRole("button", { name: /Alpha/ });
    fireEvent.click(trigger);
    // All three worlds appear in the dropdown.
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("includes the create-new-world entry in the dropdown", async () => {
    const h = harness({
      worldId: "world-a",
      worlds: [sampleWorld("world-a", "Alpha")],
    });
    render(() => (
      <ClientProvider value={h.client}>
        <WorldPicker />
      </ClientProvider>
    ));
    const trigger = await screen.findByRole("button", { name: /Alpha/ });
    fireEvent.click(trigger);
    expect(screen.getByText(/create new world/i)).toBeInTheDocument();
  });

  it("shows owner-only Members + Archive + Delete actions when the current world is owned", async () => {
    const h = harness({
      worldId: "world-a",
      worlds: [sampleWorld("world-a", "Alpha", true)],
    });
    render(() => (
      <ClientProvider value={h.client}>
        <WorldPicker />
      </ClientProvider>
    ));
    const trigger = await screen.findByRole("button", { name: /Alpha/ });
    fireEvent.click(trigger);
    expect(screen.getByText(/^Members…$/)).toBeInTheDocument();
    expect(screen.getByText(/^Archive this world$/)).toBeInTheDocument();
    expect(screen.getByText(/^Delete this world…$/)).toBeInTheDocument();
  });

  it("hides owner actions when the current world is not owned by this user", async () => {
    const h = harness({
      worldId: "world-a",
      worlds: [sampleWorld("world-a", "Alpha", false)],
    });
    render(() => (
      <ClientProvider value={h.client}>
        <WorldPicker />
      </ClientProvider>
    ));
    const trigger = await screen.findByRole("button", { name: /Alpha/ });
    fireEvent.click(trigger);
    expect(screen.queryByText(/^Members…$/)).toBeNull();
    expect(screen.queryByText(/^Archive this world$/)).toBeNull();
  });
});
