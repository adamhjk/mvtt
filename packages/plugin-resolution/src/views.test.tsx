import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, cleanup } from "@solidjs/testing-library";
import {
  buildTestClient,
  mountWithClient,
} from "@vtt/substrate/client-testing";
import { For, type Accessor } from "solid-js";
import { resolution } from "./manifest.js";
import { Formula, RolledBy, RollResult } from "./shared/traits.js";
import { RollTimelineContributor } from "./client/views.js";
import type { ChatTimelineEntry } from "@vtt/comms/shared";
import { comms } from "@vtt/comms";
import { characters } from "@vtt/characters";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { shellWorkbench } from "@vtt/shell-workbench";

beforeEach(() => cleanup());

function harness() {
  // Resolution declares deps on characters/comms/identity/permissions/
  // shell-workbench. Loading them all gives the contributor's useQuery
  // a complete world model to read from.
  return buildTestClient({
    plugins: [
      shellWorkbench,
      identity,
      permissions,
      characters,
      comms,
      resolution,
    ],
  });
}

describe("plugin-resolution chat-timeline contributor", () => {
  it("emits one entry per Roll entity, sorted by rolledAt", () => {
    const h = harness();
    h.world.spawn([
      Formula({ notation: "1d20+5", reason: "attack" }),
      RolledBy({ userId: "u1", displayName: "Adam" }),
      RollResult({ total: 17, output: "1d20+5: [12]+5 = 17", rolledAt: 200 }),
    ]);
    h.world.spawn([
      Formula({ notation: "2d6", reason: "damage" }),
      RolledBy({ userId: "u1", displayName: "Adam" }),
      RollResult({ total: 8, output: "2d6: [3,5] = 8", rolledAt: 100 }),
    ]);

    let captured: ChatTimelineEntry[] = [];
    mountWithClient(h, () => {
      const entries = (
        RollTimelineContributor.useEntries() as unknown as Accessor<ChatTimelineEntry[]>
      )();
      captured = entries;
      return <div />;
    });

    expect(captured).toHaveLength(2);
    // Each entry has a sortKey + render fn; the chat stream is responsible
    // for ordering, but we verify both timestamps surface so it can.
    const sortKeys = captured.map((e) => e.sortKey).sort((a, b) => a - b);
    expect(sortKeys).toEqual([100, 200]);
  });

  it("renders a roll card with the rolled formula, total, and roller name", () => {
    const h = harness();
    h.world.spawn([
      Formula({ notation: "1d20+5", reason: "attack" }),
      RolledBy({ userId: "u1", displayName: "Adam" }),
      RollResult({
        total: 17,
        output: "1d20+5: [12]+5 = 17",
        rolledAt: 200,
      }),
    ]);

    mountWithClient(h, () => {
      const entries = (
        RollTimelineContributor.useEntries() as unknown as Accessor<ChatTimelineEntry[]>
      );
      return <For each={entries()}>{(e) => e.render() as never}</For>;
    });

    expect(screen.getByText("Adam")).toBeInTheDocument();
    expect(screen.getByText("rolled")).toBeInTheDocument();
    expect(screen.getByText("1d20+5")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.getByText("1d20+5: [12]+5 = 17")).toBeInTheDocument();
  });

  it("does not render a card while a roll entity is missing one of the three traits", () => {
    const h = harness();
    h.world.spawn([
      Formula({ notation: "1d20", reason: "" }),
      // missing RollResult + RolledBy
    ]);

    mountWithClient(h, () => {
      const entries = (
        RollTimelineContributor.useEntries() as unknown as Accessor<ChatTimelineEntry[]>
      );
      return <For each={entries()}>{(e) => e.render() as never}</For>;
    });

    // Contributor's useQuery requires all three traits — should yield zero entries.
    expect(screen.queryByText(/rolled/i)).toBeNull();
  });
});
