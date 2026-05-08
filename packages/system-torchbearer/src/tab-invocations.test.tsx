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

import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { type JSX } from "solid-js";
import {
  buildCharacterHarness,
  mountWithClient,
  type CharacterHarness,
} from "@vtt/characters/testing";
import { definePlugin } from "@vtt/substrate";
import {
  CharacterSheetActionsSlot,
  CharacterSheetIdentitySlot,
  CharacterSheetStatusSlot,
  CharacterSheetTabsSlot,
  CharacterSheetVitalsSlot,
} from "@vtt/characters/shared";
import { ChatTimelineContributorSlot } from "@vtt/comms/shared";
import {
  Formula,
  RequestRoll,
  RollActionsSlot,
  RolledBy,
  RollResult,
} from "@vtt/resolution/shared";
import { ItemDetailSectionsSlot } from "@vtt/items/shared";
import { LinkKindsSlot } from "@vtt/notes/shared";
import { PaletteCommandsSlot } from "@vtt/shell-workbench/shared";
import { WorkbenchChatRailSurface } from "@vtt/shell-workbench/shared";
import { systemTorchbearer } from "./manifest.js";
import {
  AcquireRelic,
  Identity,
  InvocationCatalogIndex,
  InvocationIdentity,
  InvocationPerformRollable,
  LoseRelic,
  TbInvocationPerforming,
  TbInvocationRelics,
} from "./shared/index.js";
import { OpenPendingRoll } from "@vtt/characters/shared";
import { TbInvocationsTabFill } from "./client/tab-invocations.js";

const sheetSlotsTestInfra = definePlugin({
  name: "@vtt/test-tab-invocations-slots",
  version: "0.0.0",
  slots: [
    CharacterSheetIdentitySlot,
    CharacterSheetVitalsSlot,
    CharacterSheetStatusSlot,
    CharacterSheetTabsSlot,
    CharacterSheetActionsSlot,
    ChatTimelineContributorSlot,
    RollActionsSlot,
    ItemDetailSectionsSlot,
    PaletteCommandsSlot,
    LinkKindsSlot,
  ],
  surfaces: [WorkbenchChatRailSurface],
  traits: [Formula, RollResult, RolledBy],
  commands: [RequestRoll],
});

function harness(): CharacterHarness & { _theurgeId: string; _shamanInvocId: string } {
  let theurgeId!: string;
  let shamanInvocId!: string;
  const out = buildCharacterHarness({
    plugins: [sheetSlotsTestInfra, systemTorchbearer],
    asGm: true,
    setupWorld: ({ world, characterId }) => {
      // Make the character a Theurge so the tab filters to theurge
      // tradition only.
      world.set(characterId, Identity, {
        name: "Ulrik",
        stock: "Human",
        class: "Theurge",
        level: 1,
        age: 30,
        home: "",
        raiment: "",
        parents: "",
        mentor: "",
        friend: "",
        enemy: "",
      });
      world.set(characterId, TbInvocationRelics, { invocationIds: [] });
      // Two catalog invocations — one theurge, one shaman — to verify
      // tradition-based filtering.
      theurgeId = world.spawn([
        InvocationIdentity({
          name: "Bone Knitter",
          circle: 1,
          traditions: ["theurge"],
          pageRef: { canonicalId: "tb/book/dungeoneers-handbook", page: 209 },
        }),
        TbInvocationPerforming({
          ritualKind: "fixed",
          fixedOb: 3,
          versusAgainst: null,
          invocationTime: { noRelic: 1, withRelic: 0 },
          duration: "One turn",
          immortalBurden: { noRelic: 2, withRelic: 1 },
          relicName: "A set of bone knitting needles",
          relicSlot: "worn/head or pack 1",
          sacramental: "",
        }),
      ]);
      shamanInvocId = world.spawn([
        InvocationIdentity({
          name: "Hound of the Hunt",
          circle: 1,
          traditions: ["shaman"],
          pageRef: { canonicalId: "tb/book/loremasters-manual", page: 42 },
        }),
        TbInvocationPerforming({
          ritualKind: "fixed",
          fixedOb: 3,
          versusAgainst: null,
          invocationTime: { noRelic: 1, withRelic: 0 },
          duration: "One turn",
          immortalBurden: { noRelic: 2, withRelic: 1 },
          relicName: "A hunting horn",
          relicSlot: "pack 1",
          sacramental: "",
        }),
      ]);
      // Catalog index sentinel so the picker resolves both as catalog
      // entries.
      world.spawn([
        InvocationCatalogIndex({
          pluginName: "@vtt/system-torchbearer",
          entries: {
            "tb/invocation/theurge/bone-knitter": theurgeId,
            "tb/invocation/shaman/hound-of-the-hunt": shamanInvocId,
          },
        }),
      ]);
    },
  });
  return Object.assign(out, { _theurgeId: theurgeId, _shamanInvocId: shamanInvocId });
}

function mount(h: CharacterHarness): void {
  mountWithClient(h, () =>
    TbInvocationsTabFill.render({ characterId: h.characterId }) as JSX.Element,
  );
}

describe("Invocations tab", () => {
  beforeEach(() => {
    cleanup();
    // Wipe sticky-tradition state between tests so each one starts
    // with the filter cleared (otherwise the "shows tradition pills"
    // test inherits the value the prior test wrote).
    try {
      if (typeof localStorage !== "undefined") localStorage.clear();
    } catch {
      // jsdom storage missing — fine, the helpers handle it.
    }
  });

  it("renders the three sections — burden / available / held", () => {
    const h = harness();
    mount(h);
    expect(screen.getByText("Immortal Burden")).toBeInTheDocument();
    expect(screen.getByText("Available Invocations")).toBeInTheDocument();
    expect(screen.getByText("Held Relics")).toBeInTheDocument();
  });

  it("shows only invocations from the character's class tradition", () => {
    const h = harness();
    mount(h);
    // Theurge → Bone Knitter visible, shaman entry hidden.
    expect(screen.getByText("Bone Knitter")).toBeInTheDocument();
    expect(screen.queryByText("Hound of the Hunt")).not.toBeInTheDocument();
  });

  it("Perform button dispatches OpenPendingRoll with the invocation rollable", () => {
    const h = harness() as ReturnType<typeof harness>;
    mount(h);
    const before = h.dispatched.length;
    fireEvent.click(screen.getByTestId(`perform-invocation-${h._theurgeId}`));
    expect(h.dispatched.length).toBeGreaterThan(before);
    const last = h.dispatched[h.dispatched.length - 1]!;
    expect(last.type).toBe(OpenPendingRoll.name);
    const payload = last.payload as {
      rollableName: string;
      opts: { invocationId: string };
    };
    expect(payload.rollableName).toBe(InvocationPerformRollable.name);
    expect(payload.opts.invocationId).toBe(h._theurgeId);
  });

  it("Acquire relic toggle dispatches AcquireRelic, then LoseRelic on second click", async () => {
    const h = harness() as ReturnType<typeof harness>;
    mount(h);
    fireEvent.click(screen.getByTestId(`toggle-relic-${h._theurgeId}`));
    const acquired = h.dispatched.find((d) => d.type === AcquireRelic.name);
    expect(acquired).toBeDefined();
    expect(
      (acquired!.payload as { invocationId: string }).invocationId,
    ).toBe(h._theurgeId);
    // The harness's command pipeline applies the dispatch on the
    // microtask queue — wait for the held-relics section to render
    // (both lists' "Drop relic" labels appear once the trait write
    // applies) before clicking the toggle a second time.
    await screen.findByTestId(`held-relic-${h._theurgeId}`);
    fireEvent.click(screen.getByTestId(`toggle-relic-${h._theurgeId}`));
    const lost = h.dispatched.find((d) => d.type === LoseRelic.name);
    expect(lost).toBeDefined();
  });

  it("renders relics in the Held Relics section once acquired", async () => {
    const h = harness() as ReturnType<typeof harness>;
    mount(h);
    fireEvent.click(screen.getByTestId(`toggle-relic-${h._theurgeId}`));
    // After the dispatch lands on the microtask queue, the
    // held-relics list renders an entry with the same invocation id.
    expect(
      await screen.findByTestId(`held-relic-${h._theurgeId}`),
    ).toBeInTheDocument();
  });

  it("fuzzy-searches the available list by name", async () => {
    const h = harness() as ReturnType<typeof harness>;
    // Add a second theurge invocation so the search has something to
    // narrow against.
    const secondId = h.world.spawn([
      InvocationIdentity({
        name: "Inspiring Aura",
        circle: 1,
        traditions: ["theurge"],
        pageRef: { canonicalId: "tb/book/dungeoneers-handbook", page: 211 },
      }),
      TbInvocationPerforming({
        ritualKind: "fixed",
        fixedOb: 3,
        versusAgainst: null,
        invocationTime: { noRelic: 1, withRelic: 0 },
        duration: "One turn",
        immortalBurden: { noRelic: 2, withRelic: 1 },
        relicName: "Mantle embroidered with the Lady of Valor",
        relicSlot: "worn/head",
        sacramental: "",
      }),
    ]);
    // Drop the new entry into the catalog index so it's resolvable.
    const indexRow = h.world
      .query([InvocationCatalogIndex])
      .find(() => true)!;
    h.world.set(indexRow.id, InvocationCatalogIndex, {
      pluginName: "@vtt/system-torchbearer",
      entries: {
        ...(indexRow.values.InvocationCatalogIndex as {
          entries: Record<string, string>;
        }).entries,
        "tb/invocation/theurge/inspiring-aura": secondId,
      },
    });
    mount(h);
    expect(screen.getByText("Bone Knitter")).toBeInTheDocument();
    expect(screen.getByText("Inspiring Aura")).toBeInTheDocument();

    fireEvent.input(screen.getByTestId("invocations-search"), {
      target: { value: "knit" },
    });
    expect(screen.getByText("Bone Knitter")).toBeInTheDocument();
    expect(screen.queryByText("Inspiring Aura")).not.toBeInTheDocument();
  });

  it("hides tradition pills when the character class spans only one tradition", () => {
    const h = harness();
    mount(h);
    // Theurge is single-tradition → pills suppressed.
    expect(screen.queryByTestId("invocations-tradition-all")).toBeNull();
    expect(
      screen.queryByTestId("invocations-tradition-theurge"),
    ).toBeNull();
  });

  it("shows tradition pills when multiple traditions are allowed (no class set)", () => {
    const h = harness() as ReturnType<typeof harness>;
    // Re-set the character's class to empty so all traditions become
    // allowed — the pill row should render with one button per
    // tradition.
    h.world.set(h.characterId, Identity, {
      name: "Ulrik",
      stock: "Human",
      class: "",
      level: 1,
      age: 30,
      home: "",
      raiment: "",
      parents: "",
      mentor: "",
      friend: "",
      enemy: "",
    });
    mount(h);
    expect(screen.getByTestId("invocations-tradition-all")).toBeInTheDocument();
    expect(
      screen.getByTestId("invocations-tradition-theurge"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("invocations-tradition-shaman"),
    ).toBeInTheDocument();

    // Both invocations visible by default.
    expect(screen.getByText("Bone Knitter")).toBeInTheDocument();
    expect(screen.getByText("Hound of the Hunt")).toBeInTheDocument();

    // Clicking the shaman pill narrows to just shaman invocations.
    fireEvent.click(screen.getByTestId("invocations-tradition-shaman"));
    expect(screen.queryByText("Bone Knitter")).not.toBeInTheDocument();
    expect(screen.getByText("Hound of the Hunt")).toBeInTheDocument();

    // Clicking "All" restores the full list.
    fireEvent.click(screen.getByTestId("invocations-tradition-all"));
    expect(screen.getByText("Bone Knitter")).toBeInTheDocument();
    expect(screen.getByText("Hound of the Hunt")).toBeInTheDocument();
  });

  it("persists the tradition filter across mounts (per character)", () => {
    const h = harness() as ReturnType<typeof harness>;
    // Empty class so the pill row is visible.
    h.world.set(h.characterId, Identity, {
      name: "Ulrik",
      stock: "Human",
      class: "",
      level: 1,
      age: 30,
      home: "",
      raiment: "",
      parents: "",
      mentor: "",
      friend: "",
      enemy: "",
    });
    mount(h);
    fireEvent.click(screen.getByTestId("invocations-tradition-shaman"));
    // Sanity: shaman pill is now active and the list is filtered.
    expect(screen.queryByText("Bone Knitter")).not.toBeInTheDocument();
    expect(screen.getByText("Hound of the Hunt")).toBeInTheDocument();

    // Re-mount the same character — the filter should remain on
    // shaman because the choice is sticky per character id.
    cleanup();
    mount(h);
    expect(screen.queryByText("Bone Knitter")).not.toBeInTheDocument();
    expect(screen.getByText("Hound of the Hunt")).toBeInTheDocument();
  });
});
