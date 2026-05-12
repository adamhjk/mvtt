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
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { definePlugin } from "@vtt/substrate";
import {
  buildCharacterHarness,
  mountWithClient,
} from "@vtt/characters/testing";
import {
  CharacterSheetActionsSlot,
  CharacterSheetIdentitySlot,
  CharacterSheetStatusSlot,
  CharacterSheetTabsSlot,
  CharacterSheetVitalsSlot,
} from "@vtt/characters/shared";
import { ChatTimelineContributorSlot } from "@vtt/comms/shared";
import { ItemDetailSectionsSlot } from "@vtt/items/shared";
import { LinkKindsSlot } from "@vtt/notes/shared";
import { BlockKindsSlot } from "@vtt/adventures/shared";
import {
  PaletteCommandsSlot,
  WorkbenchChatRailSurface,
} from "@vtt/shell-workbench/shared";
import { TB_SPAWN_NPC_PALETTE_COMMANDS } from "./client/spawn-npc-palette.js";
import { Character, Team } from "@vtt/characters/shared";
import {
  CreateBlankNpc,
  CreateNpcFromCatalog,
  TbNpc,
} from "./shared/index.js";
import {
  Formula,
  RequestRoll,
  RolledBy,
  RollActionsSlot,
  RollResult,
} from "@vtt/resolution/shared";
import { systemTorchbearer } from "./manifest.js";
import { NpcsPageProvider } from "./client/npcs-page.js";

/**
 * Slot/surface infra so the TB plugin's chat/sheet fills register
 * cleanly. Mirrors the bestiary-page test setup.
 */
const sheetSlotsTestInfra = definePlugin({
  name: "@vtt/test-npcs-page-slots",
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
    BlockKindsSlot,
  ],
  surfaces: [WorkbenchChatRailSurface],
  traits: [Formula, RollResult, RolledBy],
  commands: [RequestRoll],
});

beforeEach(() => cleanup());

function harness() {
  return buildCharacterHarness({
    plugins: [sheetSlotsTestInfra, systemTorchbearer],
    asGm: true,
    characterName: "Test PC",
  });
}

const TAB_ID = "tab-npcs";

describe("NpcsPageProvider — catalog picker (fuzzy search)", () => {
  it("renders the catalog rack with every TB NPC template visible by default", () => {
    const h = harness();
    mountWithClient(
      h,
      () => NpcsPageProvider.render({ tabId: TAB_ID, entityId: null }) as never,
    );
    const opts = screen.getByTestId("npc-template-options");
    expect(
      opts.querySelector(
        '[data-testid="npc-template-option-tb/npc/alchemist"]',
      ),
    ).not.toBeNull();
    expect(
      opts.querySelector('[data-testid="npc-template-option-tb/npc/bandit"]'),
    ).not.toBeNull();
    expect(
      opts.querySelector(
        '[data-testid="npc-template-option-tb/npc/beronin-bandit-chief"]',
      ),
    ).not.toBeNull();
  });

  it("typing into the search filters the rack via subsequence fuzzy match", () => {
    const h = harness();
    mountWithClient(
      h,
      () => NpcsPageProvider.render({ tabId: TAB_ID, entityId: null }) as never,
    );
    const search = screen.getByTestId(
      "npc-template-search",
    ) as HTMLInputElement;
    fireEvent.input(search, { target: { value: "bndt" } });
    const opts = screen.getByTestId("npc-template-options");
    // "bndt" is a subsequence of "Bandit" (and "Bandit Chief, Dwarf"
    // role text); not of "Alchemist".
    expect(
      opts.querySelector('[data-testid="npc-template-option-tb/npc/bandit"]'),
    ).not.toBeNull();
    expect(
      opts.querySelector(
        '[data-testid="npc-template-option-tb/npc/alchemist"]',
      ),
    ).toBeNull();
  });

  it("clicking a row selects it — the spawn button label updates to the picked NPC", () => {
    const h = harness();
    mountWithClient(
      h,
      () => NpcsPageProvider.render({ tabId: TAB_ID, entityId: null }) as never,
    );
    const banditRow = screen.getByTestId(
      "npc-template-option-tb/npc/bandit",
    );
    fireEvent.click(banditRow);
    const spawnBtn = screen.getByTestId("npc-spawn-submit");
    expect(spawnBtn.textContent).toContain("Bandit");
  });

  it("clicking Spawn dispatches CreateNpcFromCatalog with the selected template id", () => {
    const h = harness();
    mountWithClient(
      h,
      () => NpcsPageProvider.render({ tabId: TAB_ID, entityId: null }) as never,
    );
    fireEvent.click(
      screen.getByTestId("npc-template-option-tb/npc/alchemist"),
    );
    fireEvent.click(screen.getByTestId("npc-spawn-submit"));
    const dispatched = h.dispatched.find(
      (d) => d.type === CreateNpcFromCatalog.name,
    );
    expect(dispatched).toBeTruthy();
    expect(dispatched!.payload).toMatchObject({
      templateId: "tb/npc/alchemist",
    });
  });

  it("each rendered row carries a clickable BookCitation chip for the printed page", () => {
    const h = harness();
    mountWithClient(
      h,
      () => NpcsPageProvider.render({ tabId: TAB_ID, entityId: null }) as never,
    );
    // The BookCitation renders as either a <button> (when the canonical
    // book is bound to a Book entity) or a <span> with the same data-*
    // attributes (when no PDF is bound). Either way the rendered text
    // and the data-canonical-* attributes are observable.
    const banditRow = screen.getByTestId("npc-template-option-tb/npc/bandit");
    const citation = banditRow.querySelector(
      '[data-canonical-id="tb/book/scholars-guide"]',
    );
    expect(citation).not.toBeNull();
    expect(citation?.getAttribute("data-canonical-page")).toBe("202");
    expect(citation?.textContent).toBe("SG p.202");
  });

  it("an empty filter falls back to the inline empty-state, leaving the spawn button disabled", () => {
    const h = harness();
    mountWithClient(
      h,
      () => NpcsPageProvider.render({ tabId: TAB_ID, entityId: null }) as never,
    );
    const search = screen.getByTestId(
      "npc-template-search",
    ) as HTMLInputElement;
    fireEvent.input(search, { target: { value: "qzx" } });
    expect(screen.getByTestId("npc-template-empty")).toBeInTheDocument();
    const spawnBtn = screen.getByTestId(
      "npc-spawn-submit",
    ) as HTMLButtonElement;
    expect(spawnBtn).toBeDisabled();
  });

  it("the homebrew affordance dispatches CreateBlankNpc with the typed name", () => {
    const h = harness();
    mountWithClient(
      h,
      () => NpcsPageProvider.render({ tabId: TAB_ID, entityId: null }) as never,
    );
    const blankInput = screen.getByTestId(
      "npc-blank-name-input",
    ) as HTMLInputElement;
    fireEvent.input(blankInput, { target: { value: "Old Bran" } });
    fireEvent.click(screen.getByTestId("npc-blank-submit"));
    const dispatched = h.dispatched.find(
      (d) => d.type === CreateBlankNpc.name,
    );
    expect(dispatched).toBeTruthy();
    expect(dispatched!.payload).toMatchObject({ name: "Old Bran" });
  });
});

describe("NpcsPageProvider — existing-NPCs hub list", () => {
  it("after spawning an NPC, the hub renders a row with the printed page citation", async () => {
    const h = harness();
    mountWithClient(
      h,
      () => NpcsPageProvider.render({ tabId: TAB_ID, entityId: null }) as never,
    );
    // Click into the catalog picker, pick Alchemist, spawn.
    fireEvent.click(
      screen.getByTestId("npc-template-option-tb/npc/alchemist"),
    );
    fireEvent.click(screen.getByTestId("npc-spawn-submit"));

    // Allow microtasks to drain so the universal-mirror NpcSpawning
    // system runs and the hub's reactive query picks up the new NPC.
    await new Promise((r) => setTimeout(r, 10));

    const npc = h.world.query([Character, TbNpc])[0];
    expect(npc).toBeTruthy();
    const row = screen.queryByTestId(`npc-row-${npc!.id}`);
    expect(row).not.toBeNull();
    // The row carries a BookCitation linking to SG p.201.
    const citation = row!.querySelector(
      '[data-canonical-id="tb/book/scholars-guide"]',
    );
    expect(citation).not.toBeNull();
    expect(citation?.getAttribute("data-canonical-page")).toBe("201");
  });
});

describe("Spawn-NPC palette commands", () => {
  it("registers one PaletteCommand per TB NPC template", () => {
    // Catalog has the SG denizens chapter (~40 entries) plus Beronin.
    expect(TB_SPAWN_NPC_PALETTE_COMMANDS.length).toBeGreaterThanOrEqual(40);
    const labels = TB_SPAWN_NPC_PALETTE_COMMANDS.map((c) => c.label);
    expect(labels).toContain("Spawn Alchemist");
    expect(labels).toContain("Spawn Bandit");
    expect(labels).toContain("Spawn Beronin");
  });

  it("each verb's hint cites the source book and printed page", () => {
    const alchemist = TB_SPAWN_NPC_PALETTE_COMMANDS.find(
      (c) => c.label === "Spawn Alchemist",
    );
    expect(alchemist!.hint).toBe("NPC · SG p.201");
  });

  it("verbs are hidden from non-GM sessions via visibleTo", () => {
    const h = harness();
    const verb = TB_SPAWN_NPC_PALETTE_COMMANDS[0]!;
    expect(
      verb.visibleTo!({ userId: "u", role: "gm", client: h.client }),
    ).toBe(true);
    expect(
      verb.visibleTo!({ userId: "u", role: "player", client: h.client }),
    ).toBe(false);
  });

  it("running a spawn verb dispatches CreateNpcFromCatalog and (after the spawn lands) OpenPageInNewTab onto the NPCs page with the new id", async () => {
    const h = harness();
    const verb = TB_SPAWN_NPC_PALETTE_COMMANDS.find(
      (c) => c.label === "Spawn Alchemist",
    )!;
    verb.run({ userId: "u", role: "gm", client: h.client });
    await new Promise((r) => setTimeout(r, 10));

    const spawnCmd = h.dispatched.find(
      (d) => d.type === CreateNpcFromCatalog.name,
    );
    expect(spawnCmd).toBeTruthy();
    expect(spawnCmd!.payload).toMatchObject({
      templateId: "tb/npc/alchemist",
    });

    const spawned = h.world
      .query([Character, TbNpc, Team])
      .find((row) => {
        const c = row.values.Character as { name: string };
        return c.name === "Alchemist";
      });
    expect(spawned).toBeTruthy();

    const openCmd = h.dispatched.find(
      (d) => d.type === "@vtt/shell-workbench/OpenPageInNewTab",
    );
    expect(openCmd).toBeTruthy();
    expect(openCmd!.payload).toMatchObject({
      pageKind: "@vtt/system-torchbearer/npcs",
      entityId: spawned!.id,
    });
  });
});
