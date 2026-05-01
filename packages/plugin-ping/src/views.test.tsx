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

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { type CommandInstance } from "@vtt/substrate";
import {
  buildTestClient,
  mountWithClient,
} from "@vtt/substrate/client-testing";
import { shellDefault } from "@vtt/shell-default";
import { ping } from "./manifest.js";
import { Ping } from "./shared/commands.js";
import { Pong } from "./shared/traits.js";
import { PingButtonView, PongLogView } from "./client/views.js";

beforeEach(() => cleanup());

function harness() {
  // Load shellDefault alongside ping so the views' surfaces (Main /
  // Sidebar) are declared at registry validate time. Production loads
  // both as well — testing in isolation defeats the point.
  return buildTestClient({
    plugins: [shellDefault, ping],
  });
}

describe("plugin-ping views", () => {
  describe("PingButtonView", () => {
    it("renders a Send Ping button", () => {
      const h = harness();
      mountWithClient(h, () => PingButtonView.render({}) as never);
      expect(screen.getByRole("button", { name: /send ping/i })).toBeInTheDocument();
    });

    it("dispatches a Ping command on click and increments the counter label", () => {
      const h = harness();
      mountWithClient(h, () => PingButtonView.render({}) as never);
      const button = screen.getByRole("button", { name: /send ping/i });
      fireEvent.click(button);
      expect(h.dispatched).toHaveLength(1);
      const cmd = h.dispatched[0]!;
      expect(cmd.type).toBe(Ping.name);
      expect((cmd.payload as { message: string }).message).toBe("ping #1");
      // Visible counter updates
      expect(button.textContent).toContain("(1)");
      // Second click bumps both
      fireEvent.click(button);
      expect(h.dispatched).toHaveLength(2);
      expect((h.dispatched[1]!.payload as { message: string }).message).toBe("ping #2");
      expect(button.textContent).toContain("(2)");
    });
  });

  describe("PongLogView", () => {
    it("renders the empty-state when no Pong entities exist", () => {
      const h = harness();
      mountWithClient(h, () => PongLogView.render({}) as never);
      expect(screen.getByText(/no pongs yet/i)).toBeInTheDocument();
    });

    it("lists Pong entities and shows their roundtrip ms", async () => {
      const h = harness();
      // Spawn two Pong entities directly into the world; useQuery picks them up.
      h.world.spawn([Pong({ message: "first", pingedAt: 100, pongedAt: 175 })]);
      h.world.spawn([Pong({ message: "second", pingedAt: 200, pongedAt: 250 })]);
      mountWithClient(h, () => PongLogView.render({}) as never);
      // findByText: PongLogView reactively re-renders when Pong entities change.
      expect(await screen.findByText("first")).toBeInTheDocument();
      expect(await screen.findByText("second")).toBeInTheDocument();
      expect(screen.getByText("75ms")).toBeInTheDocument();
      expect(screen.getByText("50ms")).toBeInTheDocument();
    });
  });

  describe("end-to-end: click → dispatch → trait write → log re-renders", () => {
    it("clicking Send Ping eventually shows a row in the Pong log", async () => {
      const h = harness();
      mountWithClient(h, () => (
        <div>
          {PingButtonView.render({}) as never}
          {PongLogView.render({}) as never}
        </div>
      ));
      // Initially empty
      expect(screen.getByText(/no pongs yet/i)).toBeInTheDocument();
      // Click → Ping dispatched → server-side PongRecordingSystem spawns Pong
      fireEvent.click(screen.getByRole("button", { name: /send ping/i }));
      // Wait for the ack roundtrip + reactive update
      const code = await screen.findByText("ping #1");
      expect(code).toBeInTheDocument();
    });

    it("dispatched command is the Ping schema-validated instance", () => {
      const h = harness();
      mountWithClient(h, () => PingButtonView.render({}) as never);
      fireEvent.click(screen.getByRole("button", { name: /send ping/i }));
      const cmd = h.dispatched[0] as CommandInstance;
      expect(cmd.type).toBe(Ping.name);
      const payload = cmd.payload as { message: string; issuedAt: number };
      expect(typeof payload.issuedAt).toBe("number");
      expect(payload.message).toMatch(/^ping #\d+$/);
    });
  });
});
