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
import { screen, cleanup, render, fireEvent } from "@solidjs/testing-library";
import { buildTestClient } from "@vtt/substrate/client-testing";
import { ClientProvider, useQuery } from "@vtt/substrate/client";
import { createMemo, type Accessor } from "solid-js";
import { definePlugin, defineTrait, z } from "@vtt/substrate";
import { actors, Permissions } from "@vtt/permissions/shared";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { shellWorkbench } from "./manifest.js";
import {
  NotificationsSlot,
  type NotificationEntry,
  type NotificationFeed,
} from "./shared/slots.js";
import {
  DismissNotification,
  NotificationDismissals,
  notificationDismissalsId,
} from "./shared/notifications-dismiss.js";
import { NotificationsOverlay } from "./client/NotificationsOverlay.js";

beforeEach(() => cleanup());

const ME = "me";

// A toy notification entity so the feed is a live world projection, like
// the real light-burnout / grind-toll feeds.
const Alert = defineTrait({
  name: "@test/notif/Alert",
  schema: z.object({ body: z.string(), at: z.number() }),
});

const alertFeed: NotificationFeed = {
  kind: "@test/notif/alerts",
  useEntries: () => {
    const rows = useQuery([Alert]);
    const acc: Accessor<NotificationEntry[]> = createMemo(() =>
      rows().map((r) => {
        const a = r.values.Alert as { body: string; at: number };
        return {
          id: r.id,
          sortKey: a.at,
          render: () => <div data-testid={`alert-${r.id}`}>{a.body}</div>,
        };
      }),
    );
    return acc as unknown as () => NotificationEntry[];
  },
};

function harness(seed?: (world: import("@vtt/substrate").World) => void) {
  const notifPlugin = definePlugin({
    name: "@vtt/test-notif",
    version: "0.0.0",
    traits: [Alert],
    fills: { [NotificationsSlot.name]: [alertFeed] },
  });
  return buildTestClient({
    plugins: [identity, permissions, shellWorkbench, notifPlugin],
    session: { userId: ME, email: "me@test.dev", name: "Me", role: "gm" },
    setupWorld: ({ world }) => seed?.(world),
  });
}

describe("shell-workbench NotificationsOverlay", () => {
  it("renders nothing when there are no notifications", () => {
    const h = harness();
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <NotificationsOverlay />
      </ClientProvider>
    ));
    expect(
      container.querySelector("[data-testid='notifications-overlay']"),
    ).toBeNull();
  });

  it("projects a notification feed's cards into the overlay", () => {
    const h = harness((world) => {
      world.spawn([Alert({ body: "A torch goes out", at: 1 })]);
    });
    render(() => (
      <ClientProvider value={h.client}>
        <NotificationsOverlay />
      </ClientProvider>
    ));
    expect(screen.getByTestId("notifications-overlay")).toBeInTheDocument();
    expect(screen.getByText("A torch goes out")).toBeInTheDocument();
  });

  it("dismisses a card per-player and dispatches DismissNotification", async () => {
    let id = "";
    const h = harness((world) => {
      id = world.spawn([Alert({ body: "dismiss me", at: 1 })]);
    });
    render(() => (
      <ClientProvider value={h.client}>
        <NotificationsOverlay />
      </ClientProvider>
    ));
    expect(screen.getByText("dismiss me")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`notification-dismiss-${id}`));
    // Hidden from view immediately…
    expect(screen.queryByText("dismiss me")).toBeNull();
    // …and the per-user dismiss command went out (the backing entity is
    // NOT despawned — other players keep their copy).
    expect(
      h.dispatched.some((c) => c.type === DismissNotification.name),
    ).toBe(true);
    expect(h.world.has(id as never)).toBe(true);
  });

  it("filters out cards already in the user's persisted dismissals", () => {
    let id = "";
    const h = harness((world) => {
      id = world.spawn([Alert({ body: "previously dismissed", at: 1 })]);
      world.spawnAt(notificationDismissalsId(ME), [
        NotificationDismissals({ userId: ME, ids: [id] }),
        Permissions({ read: actors([ME]), write: actors([ME]) }),
      ]);
    });
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <NotificationsOverlay />
      </ClientProvider>
    ));
    // The dismissal persisted on the user's record → never shown on reload.
    expect(screen.queryByText("previously dismissed")).toBeNull();
    expect(
      container.querySelector("[data-testid='notifications-overlay']"),
    ).toBeNull();
  });

  it("orders newest-first by sortKey", () => {
    const h = harness((world) => {
      world.spawn([Alert({ body: "older", at: 1 })]);
      world.spawn([Alert({ body: "newer", at: 99 })]);
    });
    render(() => (
      <ClientProvider value={h.client}>
        <NotificationsOverlay />
      </ClientProvider>
    ));
    const overlay = screen.getByTestId("notifications-overlay");
    const text = overlay.textContent ?? "";
    expect(text.indexOf("newer")).toBeLessThan(text.indexOf("older"));
  });
});
