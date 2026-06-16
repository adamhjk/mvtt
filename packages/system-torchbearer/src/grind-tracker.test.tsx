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
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { buildTestClient, mountWithClient } from "@vtt/substrate/client-testing";
import { definePlugin, type EntityId } from "@vtt/substrate";
import { Identity, Online } from "@vtt/identity/shared";
import { Name } from "@vtt/identity/shared";
import {
  GRIND_SENTINEL_ID,
  Grind,
  GrindExtremeSet,
  GrindTurnSet,
  LightWentOutNotice,
  SetGrindExtreme,
  SetGrindTurn,
} from "./shared/grind.js";
import { GrindTrackerStatusItem } from "./client/grind-tracker.js";
import { TbLightWentOutContributor } from "./client/chat-timeline.js";

afterEach(() => {
  cleanup();
});

const tbGrindUiPlugin = definePlugin({
  name: "@vtt/test-tb-grind-ui",
  version: "0",
  traits: [Grind, LightWentOutNotice, Identity, Name, Online],
  events: [GrindTurnSet, GrindExtremeSet],
  commands: [SetGrindTurn, SetGrindExtreme],
});

const TEST_CLIENT_ID = "test-client-1";

function setup(opts: { asGm: boolean }) {
  return buildTestClient({
    plugins: [tbGrindUiPlugin],
    clientId: TEST_CLIENT_ID,
    session: {
      userId: "u1",
      email: "u1@test.dev",
      name: opts.asGm ? "GM" : "Player",
      role: opts.asGm ? "gm" : "player",
    },
    setupWorld: ({ world }) => {
      world.spawnAt(GRIND_SENTINEL_ID, [Grind({ turn: 3 })]);
      world.spawn([
        Identity({
          userId: "u1",
          role: opts.asGm ? "gm" : "player",
        }),
        Name({ value: opts.asGm ? "GM" : "Player" }),
        Online({ clientId: TEST_CLIENT_ID, since: 0 }),
      ]);
    },
  });
}

describe("GrindTrackerView", () => {
  it("renders for a GM", () => {
    const h = setup({ asGm: true });
    mountWithClient(h, () => GrindTrackerStatusItem.render() as never);
    expect(screen.getByTestId("grind-tracker")).toBeInTheDocument();
    expect((screen.getByTestId("grind-input") as HTMLInputElement).value).toBe("3");
  });

  it("does NOT render for a non-GM", () => {
    const h = setup({ asGm: false });
    mountWithClient(h, () => GrindTrackerStatusItem.render() as never);
    expect(screen.queryByTestId("grind-tracker")).toBeNull();
  });

  it("clicking + dispatches SetGrindTurn(to=current+1)", async () => {
    const h = setup({ asGm: true });
    mountWithClient(h, () => GrindTrackerStatusItem.render() as never);
    fireEvent.click(screen.getByTestId("grind-advance"));
    await waitFor(() => {
      expect(h.dispatched.some((d) => d.type === SetGrindTurn.name)).toBe(true);
    });
    const ev = h.dispatched.find((d) => d.type === SetGrindTurn.name)!;
    expect((ev.payload as { to: number }).to).toBe(4);
  });

  it("clicking − dispatches SetGrindTurn(to=current-1)", async () => {
    const h = setup({ asGm: true });
    mountWithClient(h, () => GrindTrackerStatusItem.render() as never);
    fireEvent.click(screen.getByTestId("grind-rewind"));
    await waitFor(() => {
      expect(h.dispatched.some((d) => d.type === SetGrindTurn.name)).toBe(true);
    });
    const ev = h.dispatched.find((d) => d.type === SetGrindTurn.name)!;
    expect((ev.payload as { to: number }).to).toBe(2);
  });

  it("rewind is disabled at turn 0", () => {
    const h = buildTestClient({
      plugins: [tbGrindUiPlugin],
      clientId: TEST_CLIENT_ID,
      session: {
        userId: "u1",
        email: "u1@test.dev",
        name: "GM",
        role: "gm",
      },
      setupWorld: ({ world }) => {
        world.spawnAt(GRIND_SENTINEL_ID, [Grind({ turn: 0 })]);
        world.spawn([
          Identity({ userId: "u1", role: "gm" }),
          Name({ value: "GM" }),
          Online({ clientId: TEST_CLIENT_ID, since: 0 }),
        ]);
      },
    });
    mountWithClient(h, () => GrindTrackerStatusItem.render() as never);
    expect((screen.getByTestId("grind-rewind") as HTMLButtonElement).disabled).toBe(true);
  });

  it("checking the extreme box dispatches SetGrindExtreme(true)", async () => {
    const h = setup({ asGm: true });
    mountWithClient(h, () => GrindTrackerStatusItem.render() as never);
    const box = screen.getByTestId("grind-extreme") as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => {
      expect(h.dispatched.some((d) => d.type === SetGrindExtreme.name)).toBe(true);
    });
    const ev = h.dispatched.find((d) => d.type === SetGrindExtreme.name)!;
    expect((ev.payload as { extreme: boolean }).extreme).toBe(true);
  });

  it("typing into the input + Enter dispatches SetGrindTurn(to=N)", async () => {
    const h = setup({ asGm: true });
    mountWithClient(h, () => GrindTrackerStatusItem.render() as never);
    const input = screen.getByTestId("grind-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "12" } });
    fireEvent.change(input, { target: { value: "12" } });
    await waitFor(() => {
      expect(h.dispatched.some((d) => d.type === SetGrindTurn.name)).toBe(true);
    });
    const ev = h.dispatched.find((d) => d.type === SetGrindTurn.name)!;
    expect((ev.payload as { to: number }).to).toBe(12);
  });
});

describe("Light burnout chat card", () => {
  it("renders one row per LightWentOutNotice with the {character}'s {item} goes out body", () => {
    const h = buildTestClient({
      plugins: [tbGrindUiPlugin],
      session: {
        userId: "u1",
        email: "u1@test.dev",
        name: "GM",
        role: "gm",
      },
      setupWorld: ({ world }) => {
        const n1 = world.spawn([
          LightWentOutNotice({
            holderId: "char-bryn" as EntityId,
            holderName: "Bryn",
            itemId: "item-torch" as EntityId,
            itemName: "Torch",
            turn: 4,
            sentAt: 1_700_000_000,
          }),
        ]);
        void n1;
      },
    });
    mountWithClient(h, () => {
      const accessor = TbLightWentOutContributor.useEntries();
      const entries = (accessor as () => Array<{ render: () => unknown }>)();
      return entries.map((e) => e.render()) as unknown as Element;
    });
    expect(screen.getByText(/Bryn's Torch goes out/)).toBeInTheDocument();
  });
});
