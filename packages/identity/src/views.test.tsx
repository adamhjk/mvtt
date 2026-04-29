import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, cleanup } from "@solidjs/testing-library";
import {
  buildTestClient,
  mountWithClient,
} from "@vtt/substrate/client-testing";
import { definePlugin, defineSurface, z } from "@vtt/substrate";
import { Identity, Name, Online } from "./shared/traits.js";
import { identity } from "./manifest.js";
import { PlayerListView, UserMenuView } from "./client/views.js";

beforeEach(() => cleanup());

// identity's view declarations target shell-workbench surfaces by name
// only (no value import — shell-workbench depends on identity, can't go
// the other way). For the test we synthesize a tiny stub plugin that
// declares those surfaces so the registry validates.
const workbenchSurfacesStub = definePlugin({
  name: "@vtt/test-workbench-surfaces",
  version: "0.0.0",
  surfaces: [
    defineSurface({
      name: "@vtt/shell-workbench/header",
      kind: "stacked",
      context: z.object({}),
    }),
    defineSurface({
      name: "@vtt/shell-workbench/chat-rail",
      kind: "stacked",
      context: z.object({}),
    }),
  ],
});

const ME_CLIENT = "client-me";

function harness(opts?: { extraPlayers?: boolean }) {
  return buildTestClient({
    plugins: [workbenchSurfacesStub, identity],
    clientId: ME_CLIENT,
    setupWorld: ({ world }) => {
      world.spawn([
        Identity({ userId: "me", role: "gm" }),
        Name({ value: "Me" }),
        Online({ clientId: ME_CLIENT, since: Date.now() }),
      ]);
      if (opts?.extraPlayers) {
        world.spawn([
          Identity({ userId: "alice", role: "player" }),
          Name({ value: "Alice" }),
          Online({ clientId: "c-alice", since: Date.now() }),
        ]);
        world.spawn([
          Identity({ userId: "bob", role: "player" }),
          Name({ value: "Bob" }),
          Online({ clientId: "c-bob", since: Date.now() }),
        ]);
      }
    },
  });
}

describe("identity PlayerListView", () => {
  it("renders the connected player names with role badges", () => {
    const h = harness({ extraPlayers: true });
    mountWithClient(h, () => PlayerListView.render({}) as never);
    expect(screen.getByText("Me")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("gm")).toBeInTheDocument();
  });

  it("groups multiple connections from the same userId into one row", () => {
    const h = harness();
    // Spawn a second connection for "me" — same userId, different clientId.
    h.world.spawn([
      Identity({ userId: "me", role: "gm" }),
      Name({ value: "Me" }),
      Online({ clientId: "c-me-2", since: Date.now() }),
    ]);
    mountWithClient(h, () => PlayerListView.render({}) as never);
    // "Me" appears once (grouped); the tab counter shows · 2 tabs.
    const meItems = screen.getAllByText("Me");
    expect(meItems).toHaveLength(1);
    expect(screen.getByText(/2 tabs/)).toBeInTheDocument();
  });

  it("shows the empty state when no one is connected", () => {
    const h = buildTestClient({
      plugins: [workbenchSurfacesStub, identity],
    });
    mountWithClient(h, () => PlayerListView.render({}) as never);
    expect(screen.getByText(/no one connected/i)).toBeInTheDocument();
  });
});

describe("identity UserMenuView", () => {
  it("shows 'signed in as <name>' for the current connection", () => {
    const h = harness();
    mountWithClient(h, () => UserMenuView.render({}) as never);
    expect(screen.getByText(/signed in as/i)).toBeInTheDocument();
    expect(screen.getByText("Me")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log out/i })).toBeInTheDocument();
  });

  it("falls back to 'connecting…' when no Online entity matches the clientId yet", () => {
    const h = buildTestClient({
      plugins: [workbenchSurfacesStub, identity],
      clientId: "stranger",
    });
    mountWithClient(h, () => UserMenuView.render({}) as never);
    expect(screen.getByText(/connecting…/i)).toBeInTheDocument();
  });
});
