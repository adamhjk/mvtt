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
import { ItemDetailSectionsSlot, ItemIdentity } from "@vtt/items/shared";
import { TbContainer } from "./shared/items/index.js";
import { LinkKindsSlot } from "@vtt/notes/shared";
import { BlockKindsSlot } from "@vtt/adventures/shared";
import { PaletteCommandsSlot } from "@vtt/shell-workbench/shared";
import { WorkbenchChatRailSurface } from "@vtt/shell-workbench/shared";
import { systemTorchbearer } from "./manifest.js";
import {
  AddSpellToBook,
  AddSpellToLibrary,
  ClearMemoryPalace,
  FillMemoryPalace,
  ScribeSpellToScroll,
  SpellCastRollable,
  SpellCatalogIndex,
  SpellIdentity,
  TbCarries,
  TbLibrary,
  TbMemoryPalace,
  TbScroll,
  TbSpellBook,
  TbSpellCasting,
} from "./shared/index.js";
import { OpenPendingRoll } from "@vtt/characters/shared";
import { TbArcaneTabFill } from "./client/tab-arcane.js";

const sheetSlotsTestInfra = definePlugin({
  name: "@vtt/test-tab-arcane-slots",
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

function harness(): CharacterHarness {
  let spellId!: string;
  let spellTwoId!: string;
  let bookId!: string;
  let scrollId!: string;
  const out = buildCharacterHarness({
    plugins: [sheetSlotsTestInfra, systemTorchbearer],
    asGm: true,
    setupWorld: ({ world, characterId }) => {
      world.set(characterId, TbMemoryPalace, {
        capacity: 3,
        memorized: [],
      });
      world.set(characterId, TbLibrary, {
        spellIds: [],
        location: "home",
        lonerLocation: "",
      });
      spellId = world.spawn([
        SpellIdentity({
          name: "Wayfinder's Friend",
          circle: 1,
          school: "Divination",
          pageRef: { canonicalId: "tb/book/dungeoneers-handbook", page: 190 },
        }),
        TbSpellCasting({
          kind: "fixed",
          fixedOb: 2,
          versusSkill: null,
          castingTime: "one-turn",
          duration: "Instantaneous",
          materials: "",
          focus: "",
        }),
      ]);
      spellTwoId = world.spawn([
        SpellIdentity({
          name: "Lightning Step",
          circle: 2,
          school: "Transmutation",
          pageRef: { canonicalId: "tb/book/dungeoneers-handbook", page: 205 },
        }),
        TbSpellCasting({
          kind: "fixed",
          fixedOb: 3,
          versusSkill: null,
          castingTime: "one-turn",
          duration: "One conflict",
          materials: "",
          focus: "",
        }),
      ]);
      bookId = world.spawn([
        ItemIdentity({
          name: "Master Vermes' Primer",
          description: "",
          img: "",
        }),
        TbSpellBook({ folios: 5, contents: [spellId, spellTwoId] }),
      ]);
      scrollId = world.spawn([
        ItemIdentity({
          name: "Scroll of Wayfinder's Friend",
          description: "",
          img: "",
        }),
        TbScroll({ spellId, consumed: false }),
      ]);
      // Spell catalog index sentinel so the picker can resolve the
      // catalog through useQuery([SpellCatalogIndex]).
      world.spawn([
        SpellCatalogIndex({
          pluginName: "@vtt/system-torchbearer",
          entries: {
            "tb/spell/wayfinders-friend": spellId,
            "tb/spell/lightning-step": spellTwoId,
          },
        }),
      ]);
      // Place both items in the character's inventory.
      world.set(characterId, TbCarries, {
        entries: [
          {
            slot: "pack",
            slotIndex: 0,
            channel: "carried",
            slotsConsumed: 1,
            itemId: bookId,
            quantity: 1,
          },
          {
            slot: "pack",
            slotIndex: 1,
            channel: "carried",
            slotsConsumed: 1,
            itemId: scrollId,
            quantity: 1,
          },
        ],
      });
    },
  });
  // Stash for tests below.
  (out as { _spellId?: string; _spellTwoId?: string; _bookId?: string; _scrollId?: string })._spellId = spellId;
  (out as { _spellId?: string; _spellTwoId?: string; _bookId?: string; _scrollId?: string })._spellTwoId = spellTwoId;
  (out as { _spellId?: string; _spellTwoId?: string; _bookId?: string; _scrollId?: string })._bookId = bookId;
  (out as { _spellId?: string; _spellTwoId?: string; _bookId?: string; _scrollId?: string })._scrollId = scrollId;
  return out;
}

function mount(h: CharacterHarness): void {
  mountWithClient(h, () =>
    TbArcaneTabFill.render({ characterId: h.characterId }) as JSX.Element,
  );
}

describe("Arcane tab", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders all four sections — palace / books / scrolls / library", () => {
    const h = harness();
    mount(h);
    expect(screen.getAllByText("Memory Palace").length).toBeGreaterThan(0);
    expect(screen.getByText("Spell Books")).toBeInTheDocument();
    expect(screen.getByText("Scrolls")).toBeInTheDocument();
    expect(screen.getByText("Library")).toBeInTheDocument();
    // Relics moved to the Invocations tab.
    expect(screen.queryByText("Relics")).not.toBeInTheDocument();
  });

  it("shows the carried spell book with its contents and the carried scroll", () => {
    const h = harness();
    mount(h);
    expect(screen.getByText("Master Vermes' Primer")).toBeInTheDocument();
    // The spell appears in the book's contents row.
    expect(screen.getAllByText("Wayfinder's Friend").length).toBeGreaterThan(0);
    expect(screen.getByText("Lightning Step")).toBeInTheDocument();
  });

  it("opens a pending roll for SpellCastRollable when the book row's [Cast] is clicked", async () => {
    const h = harness();
    mount(h);
    const spellId = (h as unknown as { _spellId: string })._spellId;
    const bookId = (h as unknown as { _bookId: string })._bookId;
    const btn = await screen.findByTestId(`cast-from-book-${bookId}-${spellId}`);
    fireEvent.click(btn);
    const open = h.dispatched.find((c) => c.type === OpenPendingRoll.name);
    expect(open).toBeDefined();
    const payload = open!.payload as {
      rollableName: string;
      opts: { spellId: string; source: { kind: string; bookId?: string } };
    };
    expect(payload.rollableName).toBe(SpellCastRollable.name);
    expect(payload.opts.spellId).toBe(spellId);
    expect(payload.opts.source.kind).toBe("spellbook");
    expect(payload.opts.source.bookId).toBe(bookId);
  });

  it("opens a pending roll for SpellCastRollable when the scroll row's [Cast] is clicked", async () => {
    const h = harness();
    mount(h);
    const scrollId = (h as unknown as { _scrollId: string })._scrollId;
    const btn = await screen.findByTestId(`cast-from-scroll-${scrollId}`);
    fireEvent.click(btn);
    const open = h.dispatched.find((c) => c.type === OpenPendingRoll.name);
    expect(open).toBeDefined();
    const payload = open!.payload as {
      rollableName: string;
      opts: { source: { kind: string; scrollId?: string } };
    };
    expect(payload.rollableName).toBe(SpellCastRollable.name);
    expect(payload.opts.source.kind).toBe("scroll");
    expect(payload.opts.source.scrollId).toBe(scrollId);
  });

  it("dispatches AddSpellToLibrary directly when [Copy → library] is clicked on a spell book row", async () => {
    const h = harness();
    mount(h);
    const bookId = (h as unknown as { _bookId: string })._bookId;
    const spellId = (h as unknown as { _spellId: string })._spellId;
    fireEvent.click(
      await screen.findByTestId(`copy-to-library-${bookId}-${spellId}`),
    );
    const add = h.dispatched.find((c) => c.type === AddSpellToLibrary.name);
    expect(add).toBeDefined();
    expect((add!.payload as { spellId: string }).spellId).toBe(spellId);
  });

  it("dispatches AddSpellToLibrary directly when [Copy → library] is clicked on a scroll row", async () => {
    const h = harness();
    mount(h);
    const scrollId = (h as unknown as { _scrollId: string })._scrollId;
    const spellId = (h as unknown as { _spellId: string })._spellId;
    fireEvent.click(
      await screen.findByTestId(`copy-scroll-to-library-${scrollId}`),
    );
    const add = h.dispatched.find((c) => c.type === AddSpellToLibrary.name);
    expect(add).toBeDefined();
    expect((add!.payload as { spellId: string }).spellId).toBe(spellId);
  });

  it("dispatches AddSpellToLibrary when the row's inline + Add is clicked", async () => {
    const h = harness();
    mount(h);
    fireEvent.click(screen.getByTestId("open-add-to-library"));
    // Inline-add: filter / scroll to the row, click + Add directly,
    // no separate commit step.
    const spellId = (h as unknown as { _spellId: string })._spellId;
    fireEvent.click(
      await screen.findByTestId(`library-add-picker-add-${spellId}`),
    );
    const add = h.dispatched.find((c) => c.type === AddSpellToLibrary.name);
    expect(add).toBeDefined();
    expect((add!.payload as { spellId: string }).spellId).toBe(spellId);
  });

  it("memorize dialog computes Lore Master Ob = sum of circles + already-memorized", async () => {
    const h = harness();
    mount(h);
    fireEvent.click(screen.getByTestId("open-memorize"));
    const spellId = (h as unknown as { _spellId: string })._spellId;
    const spellTwoId = (h as unknown as { _spellTwoId: string })._spellTwoId;
    fireEvent.click(await screen.findByTestId(`memorize-pick-${spellId}`));
    fireEvent.click(await screen.findByTestId(`memorize-pick-${spellTwoId}`));
    // sum of circles (1+2) + already-memorized (0) = 3
    expect(screen.getByText(/Lore Master Ob: 3/)).toBeInTheDocument();
  });

  it("Memorize dispatches FillMemoryPalace directly with the picks", async () => {
    const h = harness();
    mount(h);
    fireEvent.click(screen.getByTestId("open-memorize"));
    const spellId = (h as unknown as { _spellId: string })._spellId;
    fireEvent.click(await screen.findByTestId(`memorize-pick-${spellId}`));
    fireEvent.click(screen.getByTestId("memorize-commit"));
    const fill = h.dispatched.find((c) => c.type === FillMemoryPalace.name);
    expect(fill).toBeDefined();
    expect(
      (fill!.payload as { picks: ReadonlyArray<{ spellId: string }> }).picks,
    ).toEqual([{ spellId }]);
  });

  it("surfaces spell books and scrolls nested inside a carried container", () => {
    // Build a character whose inventory holds a backpack, and the
    // backpack holds the spell book and the scroll. The Arcane tab
    // should still surface both — RAW p.92 says the magician needs
    // the book "in their inventory," which includes containers.
    let backpackId!: string;
    let bookId!: string;
    let scrollId!: string;
    let spellId!: string;
    const h = buildCharacterHarness({
      plugins: [sheetSlotsTestInfra, systemTorchbearer],
      asGm: true,
      setupWorld: ({ world, characterId }) => {
        spellId = world.spawn([
          SpellIdentity({
            name: "Wayfinder's Friend",
            circle: 1,
            school: "Divination",
            pageRef: { canonicalId: "tb/book/dungeoneers-handbook", page: 190 },
          }),
          TbSpellCasting({
            kind: "fixed",
            fixedOb: 2,
            versusSkill: null,
            castingTime: "one-turn",
            duration: "Instantaneous",
            materials: "",
            focus: "",
          }),
        ]);
        backpackId = world.spawn([
          ItemIdentity({ name: "Backpack", description: "", img: "" }),
          TbContainer({ containerType: "backpack", containerSlots: 6 }),
          // Backpack holds the book and the scroll inside it.
          TbCarries({
            entries: [
              {
                slot: "pack",
                slotIndex: 0,
                channel: "carried",
                slotsConsumed: 2,
                itemId: "PLACEHOLDER_BOOK",
                quantity: 1,
              },
              {
                slot: "pack",
                slotIndex: 2,
                channel: "carried",
                slotsConsumed: 1,
                itemId: "PLACEHOLDER_SCROLL",
                quantity: 1,
              },
            ],
          }),
        ]);
        bookId = world.spawn([
          ItemIdentity({ name: "Vermes' Primer", description: "", img: "" }),
          TbSpellBook({ folios: 5, contents: [spellId] }),
        ]);
        scrollId = world.spawn([
          ItemIdentity({ name: "Scroll", description: "", img: "" }),
          TbScroll({ spellId, consumed: false }),
        ]);
        // Patch the backpack's TbCarries with the real ids now that we
        // know them. This is what a real EquipItem flow would emit.
        world.set(backpackId, TbCarries, {
          entries: [
            {
              slot: "pack",
              slotIndex: 0,
              channel: "carried",
              slotsConsumed: 2,
              itemId: bookId,
              quantity: 1,
            },
            {
              slot: "pack",
              slotIndex: 2,
              channel: "carried",
              slotsConsumed: 1,
              itemId: scrollId,
              quantity: 1,
            },
          ],
        });
        // The character's slots hold the backpack only.
        world.set(characterId, TbCarries, {
          entries: [
            {
              slot: "torso",
              slotIndex: 0,
              channel: "worn",
              slotsConsumed: 1,
              itemId: backpackId,
              quantity: 1,
            },
          ],
        });
      },
    });
    mountWithClient(h, () =>
      TbArcaneTabFill.render({ characterId: h.characterId }) as JSX.Element,
    );

    // Both the book (named "Vermes' Primer") and the scroll surface,
    // even though neither is in the character's own slots.
    expect(screen.getByText("Vermes' Primer")).toBeInTheDocument();
    // The scroll holds Wayfinder's Friend; the spell name appears on
    // the scroll row's SpellCard. Use queryAllBy to dodge the multi-
    // match from the book contents.
    expect(
      screen.getAllByText("Wayfinder's Friend").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("excludes a spell book whose carry entry is dropped or lost", () => {
    let bookId!: string;
    const h = buildCharacterHarness({
      plugins: [sheetSlotsTestInfra, systemTorchbearer],
      asGm: true,
      setupWorld: ({ world, characterId }) => {
        bookId = world.spawn([
          ItemIdentity({ name: "Lost Tome", description: "", img: "" }),
          TbSpellBook({ folios: 5, contents: [] }),
        ]);
        world.set(characterId, TbCarries, {
          entries: [
            {
              slot: "pack",
              slotIndex: 0,
              channel: "carried",
              slotsConsumed: 2,
              itemId: bookId,
              quantity: 1,
              state: { lost: true },
            },
          ],
        });
      },
    });
    mountWithClient(h, () =>
      TbArcaneTabFill.render({ characterId: h.characterId }) as JSX.Element,
    );
    expect(screen.queryByText("Lost Tome")).toBeNull();
    expect(
      screen.getByText(/no spell books carried/i),
    ).toBeInTheDocument();
    void bookId;
  });

  it("blank scroll surfaces a Scribe affordance and dispatches ScribeSpellToScroll", async () => {
    let blankScrollId!: string;
    let spellId!: string;
    const h = buildCharacterHarness({
      plugins: [sheetSlotsTestInfra, systemTorchbearer],
      asGm: true,
      setupWorld: ({ world, characterId }) => {
        spellId = world.spawn([
          SpellIdentity({
            name: "Wayfinder's Friend",
            circle: 1,
            school: "Divination",
            pageRef: { canonicalId: "tb/book/dungeoneers-handbook", page: 190 },
          }),
          TbSpellCasting({
            kind: "fixed",
            fixedOb: 2,
            versusSkill: null,
            castingTime: "one-turn",
            duration: "Instantaneous",
            materials: "",
            focus: "",
          }),
        ]);
        blankScrollId = world.spawn([
          ItemIdentity({ name: "Blank scroll", description: "", img: "" }),
          TbScroll({ spellId: null, consumed: false }),
        ]);
        // The character has the spell in their library.
        world.set(characterId, TbLibrary, {
          spellIds: [spellId],
          location: "home",
          lonerLocation: "",
        });
        world.set(characterId, TbCarries, {
          entries: [
            {
              slot: "pack",
              slotIndex: 0,
              channel: "carried",
              slotsConsumed: 1,
              itemId: blankScrollId,
              quantity: 1,
            },
          ],
        });
        world.spawn([
          SpellCatalogIndex({
            pluginName: "@vtt/system-torchbearer",
            entries: { "tb/spell/wayfinders-friend": spellId },
          }),
        ]);
      },
    });
    mountWithClient(h, () =>
      TbArcaneTabFill.render({ characterId: h.characterId }) as JSX.Element,
    );
    // Blank-scroll affordance present.
    const open = await screen.findByTestId(`open-scribe-scroll-${blankScrollId}`);
    fireEvent.click(open);
    // Pick the only option (the library spell).
    const opt = await screen.findByTestId(`spell-option-${spellId}`);
    fireEvent.click(opt);
    fireEvent.click(screen.getByTestId(`scribe-commit-${blankScrollId}`));
    const scribe = h.dispatched.find(
      (c) => c.type === ScribeSpellToScroll.name,
    );
    expect(scribe).toBeDefined();
    const payload = scribe!.payload as {
      scrollId: string;
      spellId: string;
      source: "library" | "palace";
    };
    expect(payload.scrollId).toBe(blankScrollId);
    expect(payload.spellId).toBe(spellId);
    expect(payload.source).toBe("library");
  });

  it("Discharge dispatches ClearMemoryPalace once the palace is filled", async () => {
    const h = harness();
    // Pre-fill the palace directly so the discharge button is enabled
    // synchronously — the memorize-roll dispatch path is exercised
    // by its own test above.
    h.world.set(h.characterId, TbMemoryPalace, {
      capacity: 3,
      memorized: [
        {
          spellId: (h as unknown as { _spellId: string })._spellId,
          slotsConsumed: 1,
          cast: false,
        },
      ],
    });
    mount(h);
    fireEvent.click(screen.getByTestId("discharge-palace"));
    const clear = h.dispatched.find((c) => c.type === ClearMemoryPalace.name);
    expect(clear).toBeDefined();
  });
});
