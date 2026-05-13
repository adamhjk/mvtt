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
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { buildCharacterHarness, mountWithClient } from "@vtt/characters/testing";
import { items } from "@vtt/items";
import {
  CustomizeItem,
  ItemBundle,
  ItemEconomics,
  ItemIdentity,
  JoinItemBundles,
  SplitItemBundle,
  runCatalogMerge,
} from "@vtt/items/shared";
import { definePlugin, type EntityId } from "@vtt/substrate";
import {
  TbCarries,
  TbItemSlotOptions,
  TbWeapon,
  TbArmor,
  TbSupply,
  TbContainer,
  TbSkillBonuses,
  TbItemSpecialRules,
  ItemPosition,
  EquipItem,
  MoveItem,
  SetEntryState,
  DropItem,
  PickUpItem,
  PlaceOnGround,
  RemoveFromGround,
  UnequipItem,
  ItemEquipped,
  ItemMoved,
  EntryStateChanged,
  ItemDropped,
  ItemPickedUp,
  ItemPlacedOnGround,
  ItemRemovedFromGround,
  ItemUnequipped,
} from "./shared/index.js";
import {
  TbBundleJoinSystem,
  TbBundleSplitSystem,
  TbCarryRebindOnForkSystem,
  TbEntryStateSystem,
  TbItemDropSystem,
  TbItemEquipSystem,
  TbItemMoveSystem,
  TbItemPickUpSystem,
  TbItemPlacedSystem,
  TbItemRemovedFromGroundSystem,
  TbItemUnequipSystem,
} from "./server/index.js";
import { TbInventoryTabFill } from "./client/index.js";

afterEach(() => {
  cleanup();
});

const tbItemsTestPlugin = definePlugin({
  name: "@vtt/system-torchbearer-inventory-tab-test",
  version: "0",
  dependsOn: ["@vtt/items@^0", "@vtt/characters@^0"],
  traits: [
    TbItemSlotOptions,
    TbWeapon,
    TbArmor,
    TbSupply,
    TbContainer,
    TbSkillBonuses,
    TbItemSpecialRules,
    TbCarries,
    ItemPosition,
  ],
  events: [
    ItemEquipped,
    ItemMoved,
    EntryStateChanged,
    ItemDropped,
    ItemPickedUp,
    ItemPlacedOnGround,
    ItemRemovedFromGround,
    ItemUnequipped,
  ],
  commands: [
    EquipItem,
    MoveItem,
    SetEntryState,
    DropItem,
    PickUpItem,
    PlaceOnGround,
    RemoveFromGround,
    UnequipItem,
  ],
  systems: [
    TbItemEquipSystem,
    TbItemMoveSystem,
    TbEntryStateSystem,
    TbItemDropSystem,
    TbItemPickUpSystem,
    TbItemPlacedSystem,
    TbItemRemovedFromGroundSystem,
    TbItemUnequipSystem,
    TbBundleSplitSystem,
    TbBundleJoinSystem,
    TbCarryRebindOnForkSystem,
  ],
  gameSystem: true,
});

interface Setup {
  swordId: EntityId;
  backpackId: EntityId;
  arrowsId: EntityId;
}

function spawnItems(
  world: import("@vtt/substrate").World,
): Setup {
  const swordId = world.spawn([
    ItemIdentity({ name: "Sword" }),
    TbItemSlotOptions({ options: { carried: 1, belt: 1 } }),
    TbWeapon({
      wield: 1,
      conflictBonuses: {
        attack: { type: "dice", value: 1 },
        defend: { type: "dice", value: 0 },
        feint: { type: "dice", value: 0 },
        maneuver: { type: "dice", value: 0 },
      },
    }),
  ]);
  const backpackId = world.spawn([
    ItemIdentity({ name: "Backpack" }),
    TbItemSlotOptions({ options: { torso: 2 } }),
    TbContainer({ containerType: "backpack", containerSlots: 6 }),
    TbCarries({ entries: [] }),
  ]);
  const arrowsId = world.spawn([
    ItemIdentity({ name: "Arrows" }),
    TbItemSlotOptions({ options: { quiver: 1, pack: 1 } }),
  ]);
  return { swordId, backpackId, arrowsId };
}

function setupHarness(opts?: {
  initialEntries?: (s: Setup) => Array<Record<string, unknown>>;
}) {
  let cap: { setup: Setup } = { setup: { swordId: "" as EntityId, backpackId: "" as EntityId, arrowsId: "" as EntityId } };
  const h = buildCharacterHarness({
    asGm: true,
    plugins: [items, tbItemsTestPlugin],
    setupWorld: ({ world, characterId }) => {
      cap.setup = spawnItems(world);
      const initial = opts?.initialEntries
        ? opts.initialEntries(cap.setup)
        : [];
      world.set(characterId, TbCarries, { entries: initial });
    },
  });
  return { ...h, items: cap.setup };
}

describe("Tab body — Inventory (slot-roof)", () => {
  it("renders every body-slot panel", () => {
    const h = setupHarness();
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    expect(screen.getByText("Head")).toBeInTheDocument();
    expect(screen.getByText("Neck")).toBeInTheDocument();
    expect(screen.getByText("Right Hand · carried")).toBeInTheDocument();
    expect(screen.getByText("Left Hand · carried")).toBeInTheDocument();
    expect(screen.getByText("Torso")).toBeInTheDocument();
    expect(screen.getByText("Belt")).toBeInTheDocument();
    expect(screen.getByText("Feet")).toBeInTheDocument();
    expect(screen.getByText("Pocket")).toBeInTheDocument();
    expect(screen.getByText("On the Ground")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
  });

  it("renders each item's slot-option pills", () => {
    const h = setupHarness({
      initialEntries: ({ swordId }) => [
        {
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: swordId,
          quantity: 1,
        },
      ],
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    expect(
      screen.getByTestId(`pill-${h.items.swordId}-carried`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`pill-${h.items.swordId}-belt`),
    ).toBeInTheDocument();
  });

  it("clicking the currently-occupied pill is a no-op (it shows ✓)", async () => {
    const h = setupHarness({
      initialEntries: ({ swordId }) => [
        {
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: swordId,
          quantity: 1,
        },
      ],
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    const pill = screen.getByTestId(`pill-${h.items.swordId}-carried`);
    expect(pill.textContent).toContain("✓");
    fireEvent.click(pill);
    // No move dispatched.
    await waitFor(() => {
      expect(h.dispatched.find((d) => d.type === MoveItem.name)).toBeUndefined();
    });
  });

  it("clicking [belt·1] on a sword in hand dispatches a MoveItem to belt", async () => {
    const h = setupHarness({
      initialEntries: ({ swordId }) => [
        {
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: swordId,
          quantity: 1,
        },
      ],
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    const beltPill = screen.getByTestId(`pill-${h.items.swordId}-belt`);
    fireEvent.click(beltPill);
    await waitFor(() => {
      expect(h.dispatched.some((d) => d.type === MoveItem.name)).toBe(true);
    });
    const move = h.dispatched.find((d) => d.type === MoveItem.name)!;
    const payload = move.payload as { toSlot: string };
    expect(payload.toSlot).toBe("belt");
  });

  it("clicking [carry·1] when not in a hand opens a R/L picker", () => {
    const h = setupHarness({
      initialEntries: ({ swordId }) => [
        {
          // Sword on belt — clicking carry should pop the picker.
          slot: "belt",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 1,
          itemId: swordId,
          quantity: 1,
        },
      ],
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.click(screen.getByTestId(`pill-${h.items.swordId}-carried`));
    expect(
      screen.getByTestId(`picker-${h.characterId}:handR-carried`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`picker-${h.characterId}:handL-carried`),
    ).toBeInTheDocument();
  });

  it("[pack·1] on arrows with one container goes straight to that container", async () => {
    const h = setupHarness({
      initialEntries: ({ backpackId, arrowsId }) => [
        {
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
          itemId: backpackId,
          quantity: 1,
        },
        {
          slot: "loose:1",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 1,
          itemId: arrowsId,
          quantity: 1,
        },
      ],
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.click(screen.getByTestId(`pill-${h.items.arrowsId}-pack`));
    await waitFor(() => {
      expect(h.dispatched.some((d) => d.type === EquipItem.name)).toBe(true);
    });
    const ev = h.dispatched.find((d) => d.type === EquipItem.name)!;
    const payload = ev.payload as { holderId: string; slot: string };
    expect(payload.holderId).toBe(h.items.backpackId);
    expect(payload.slot).toBe(`container:${h.items.backpackId}`);
  });

  it("[pack·1] with multiple pack-capable containers opens a picker listing them all", () => {
    const h = setupHarness({
      initialEntries: ({ backpackId, arrowsId }) => [
        {
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
          itemId: backpackId,
          quantity: 1,
        },
        {
          slot: "loose:1",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 1,
          itemId: arrowsId,
          quantity: 1,
        },
      ],
    });
    // Add a second container to the character so the picker has > 1
    // destination.
    const sackId = h.world.spawn([
      ItemIdentity({ name: "Small Sack" }),
      TbItemSlotOptions({ options: { pack: 1, carried: 1 } }),
      TbContainer({ containerType: "smallSack", containerSlots: 2 }),
      TbCarries({ entries: [] }),
    ]);
    const carries = h.world.get(h.characterId, [TbCarries]) as {
      TbCarries: { entries: Array<unknown> };
    };
    h.world.set(h.characterId, TbCarries, {
      entries: [
        ...(carries.TbCarries.entries as Array<unknown>),
        {
          slot: "handL",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: sackId,
          quantity: 1,
        },
      ],
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.click(screen.getByTestId(`pill-${h.items.arrowsId}-pack`));
    expect(
      screen.getByTestId(`picker-container:${h.items.backpackId}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`picker-container:${sackId}`),
    ).toBeInTheDocument();
  });

  it("Drop button removes the entry from the holder and stamps an ItemPosition for the world-shared ground", async () => {
    const h = setupHarness({
      initialEntries: ({ swordId }) => [
        {
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: swordId,
          quantity: 1,
        },
      ],
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.click(screen.getByTestId(`drop-${h.items.swordId}-0`));
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => {
      const c = h.world.get(h.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<unknown> };
      };
      expect(c.TbCarries.entries).toHaveLength(0);
      expect(h.world.get(h.items.swordId, [ItemPosition])).toBeDefined();
    });
  });

  it("Missing button moves the item into the Missing zone via SetEntryState", async () => {
    const h = setupHarness({
      initialEntries: ({ swordId }) => [
        {
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: swordId,
          quantity: 1,
        },
      ],
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.click(screen.getByTestId(`missing-${h.items.swordId}-0`));
    await waitFor(() => {
      expect(
        h.dispatched.some((d) => d.type === SetEntryState.name),
      ).toBe(true);
    });
    const ev = h.dispatched.find((d) => d.type === SetEntryState.name)!;
    const payload = ev.payload as {
      state: { lost?: boolean };
    };
    expect(payload.state.lost).toBe(true);
  });

  describe("Catalog quick-add", () => {
    function setupWithCatalog() {
      return buildCharacterHarness({
        asGm: true,
        plugins: [items, tbItemsTestPlugin],
        setupWorld: ({ world, registry, characterId }) => {
          world.set(characterId, TbCarries, { entries: [] });
          runCatalogMerge({
            world,
            registry,
            pluginName: "@vtt/test-system",
            templates: [
              {
                templateId: "test/sword",
                traits: {
                  ItemIdentity: { name: "Sword" },
                  TbItemSlotOptions: { options: { carried: 1, belt: 1 } },
                },
              },
              {
                templateId: "test/lantern",
                traits: {
                  ItemIdentity: { name: "Lantern" },
                  TbItemSlotOptions: { options: { carried: 1, pack: 1 } },
                },
              },
            ],
          });
        },
      });
    }

    it("typing in the search filters catalog entries", () => {
      const h = setupWithCatalog();
      mountWithClient(h, () =>
        TbInventoryTabFill.render({ characterId: h.characterId }) as never,
      );
      const search = screen.getByTestId("catalog-search") as HTMLInputElement;
      fireEvent.input(search, { target: { value: "swo" } });
      expect(screen.getByText("Sword")).toBeInTheDocument();
      expect(screen.queryByText("Lantern")).toBeNull();
    });

    it("clicking a catalog pill dispatches EquipItem with the chosen slot", async () => {
      const h = setupWithCatalog();
      mountWithClient(h, () =>
        TbInventoryTabFill.render({ characterId: h.characterId }) as never,
      );
      fireEvent.input(screen.getByTestId("catalog-search"), {
        target: { value: "sword" },
      });
      // Find the catalog row's belt pill.
      const swordRow = h.world.query([ItemIdentity]).find((r) => {
        const v = r.values.ItemIdentity as { name: string };
        return v.name === "Sword";
      })!;
      fireEvent.click(
        screen.getByTestId(`catalog-pill-${swordRow.id}-belt`),
      );
      await waitFor(() => {
        expect(h.dispatched.some((d) => d.type === EquipItem.name)).toBe(true);
      });
      const ev = h.dispatched.find((d) => d.type === EquipItem.name)!;
      const payload = ev.payload as { slot: string; itemId: string };
      expect(payload.slot).toBe("belt");
      expect(payload.itemId).toBe(swordRow.id);
    });

    it("equipping two catalog backpacks lands both as torso·2 entries (slot count = 4)", async () => {
      const h = buildCharacterHarness({
        asGm: true,
        plugins: [items, tbItemsTestPlugin],
        setupWorld: ({ world, registry, characterId }) => {
          world.set(characterId, TbCarries, { entries: [] });
          runCatalogMerge({
            world,
            registry,
            pluginName: "@vtt/test-system",
            templates: [
              {
                templateId: "test/backpack",
                traits: {
                  ItemIdentity: { name: "Backpack" },
                  TbItemSlotOptions: { options: { torso: 2 } },
                  TbContainer: {
                    containerType: "backpack",
                    containerSlots: 6,
                  },
                },
              },
            ],
          });
        },
      });
      mountWithClient(h, () =>
        TbInventoryTabFill.render({ characterId: h.characterId }) as never,
      );
      fireEvent.input(screen.getByTestId("catalog-search"), {
        target: { value: "back" },
      });
      const backpack = h.world
        .query([ItemIdentity])
        .find((r) => (r.values.ItemIdentity as { name: string }).name === "Backpack")!;
      // Two consecutive clicks. The pipeline serializes them; we
      // need to drain the microtask queue between fireEvents AND
      // after the second click so the test reads post-equip state.
      fireEvent.click(
        screen.getByTestId(`catalog-pill-${backpack.id}-torso`),
      );
      await new Promise((r) => setTimeout(r, 0));
      fireEvent.click(
        screen.getByTestId(`catalog-pill-${backpack.id}-torso`),
      );
      await new Promise((r) => setTimeout(r, 0));
      await waitFor(
        () => {
          const carries = h.world.get(h.characterId, [TbCarries]) as {
            TbCarries: { entries: Array<{ slotsConsumed: number }> };
          };
          if (carries.TbCarries.entries.length !== 2) {
            throw new Error(
              `expected 2 entries, got ${carries.TbCarries.entries.length}`,
            );
          }
        },
        { timeout: 2000 },
      );
      const carries = h.world.get(h.characterId, [TbCarries]) as {
        TbCarries: {
          entries: Array<{ slot: string; slotsConsumed: number; itemId: string }>;
        };
      };
      expect(carries.TbCarries.entries).toHaveLength(2);
      for (const e of carries.TbCarries.entries) {
        expect(e.slot).toBe("torso");
        expect(e.slotsConsumed).toBe(2);
      }
      // Two distinct forked entity ids — different from the catalog's
      // and from each other.
      const [a, b] = carries.TbCarries.entries;
      expect(a!.itemId).not.toBe(backpack.id);
      expect(b!.itemId).not.toBe(backpack.id);
      expect(a!.itemId).not.toBe(b!.itemId);
    });

    it("equipping a sword via [carry·1] then clicking R-hand dispatches the right MoveItem", async () => {
      const h = buildCharacterHarness({
        asGm: true,
        plugins: [items, tbItemsTestPlugin],
        setupWorld: ({ world, registry, characterId }) => {
          world.set(characterId, TbCarries, { entries: [] });
          runCatalogMerge({
            world,
            registry,
            pluginName: "@vtt/test-system",
            templates: [
              {
                templateId: "test/sword",
                traits: {
                  ItemIdentity: { name: "Sword" },
                  TbItemSlotOptions: { options: { carried: 1, belt: 1 } },
                },
              },
            ],
          });
        },
      });
      mountWithClient(h, () =>
        TbInventoryTabFill.render({ characterId: h.characterId }) as never,
      );
      // Equip via [belt·1] first so the sword sits on the belt.
      fireEvent.input(screen.getByTestId("catalog-search"), {
        target: { value: "swo" },
      });
      const sword = h.world
        .query([ItemIdentity])
        .find((r) => (r.values.ItemIdentity as { name: string }).name === "Sword")!;
      fireEvent.click(screen.getByTestId(`catalog-pill-${sword.id}-belt`));
      await waitFor(() => {
        const c = h.world.get(h.characterId, [TbCarries]) as {
          TbCarries: { entries: Array<unknown> };
        };
        return c.TbCarries.entries.length === 1;
      });

      // Clear the search so the catalog row collapses; click the
      // sword's [carry·1] pill on the equipped row.
      fireEvent.input(screen.getByTestId("catalog-search"), {
        target: { value: "" },
      });
      // Wait for the EquipItem to actually settle (the pipeline is
      // async — fireEvent returns immediately but the dispatch
      // promise resolves on the next microtask tick).
      await new Promise((r) => setTimeout(r, 0));
      fireEvent.click(screen.getByTestId(`pill-${sword.id}-carried`));
      // Picker open with R/L choices. Pick R.
      fireEvent.click(
        screen.getByTestId(`picker-${h.characterId}:handR-carried`),
      );
      // The pipeline is async — fireEvent returns immediately but
      // the dispatch promise resolves on the next microtask. Drain
      // it before reading state.
      await new Promise((r) => setTimeout(r, 0));
      await waitFor(() => {
        const c = h.world.get(h.characterId, [TbCarries]) as {
          TbCarries: { entries: Array<{ slot: string }> };
        };
        return c.TbCarries.entries[0]!.slot === "handR";
      });
      const c = h.world.get(h.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ slot: string; channel: string }> };
      };
      expect(c.TbCarries.entries[0]!.slot).toBe("handR");
      expect(c.TbCarries.entries[0]!.channel).toBe("carried");
    });
  });

  it("ground items show pills and clicking one dispatches PickUpItem to the chosen slot", async () => {
    const h = setupHarness();
    // The sword sits on the world ground (ItemPosition stamped,
    // no TbCarries entry referencing it).
    h.world.set(h.items.swordId, ItemPosition, {
      sceneId: "world-ground",
      x: 0,
      y: 0,
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    // The sword renders inside the "On the Ground" zone with its
    // slot-option pills available.
    expect(
      screen.getByTestId(`ground-pill-${h.items.swordId}-belt`),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId(`ground-pill-${h.items.swordId}-belt`),
    );
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => {
      expect(h.dispatched.some((d) => d.type === PickUpItem.name)).toBe(true);
    });
    const pick = h.dispatched.find((d) => d.type === PickUpItem.name)!;
    const payload = pick.payload as {
      slot: string;
      itemId: string;
      holderId: string;
    };
    expect(payload.slot).toBe("belt");
    expect(payload.itemId).toBe(h.items.swordId);
    expect(payload.holderId).toBe(h.characterId);
  });

  it("ground items are world-shared — every character sees the same items", () => {
    const h = setupHarness();
    h.world.set(h.items.swordId, ItemPosition, {
      sceneId: "world-ground",
      x: 0,
      y: 0,
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    expect(
      screen.getByTestId(`ground-item-${h.items.swordId}`),
    ).toBeInTheDocument();
  });

  it("missing items show pills and clicking one clears `lost`", async () => {
    const h = setupHarness({
      initialEntries: ({ swordId }) => [
        {
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: swordId,
          quantity: 1,
          state: { lost: true },
        },
      ],
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.click(screen.getByTestId(`pill-${h.items.swordId}-belt`));
    await waitFor(() => {
      expect(
        h.dispatched.some(
          (d) =>
            d.type === SetEntryState.name &&
            (d.payload as { state: { lost?: boolean } }).state.lost === false,
        ),
      ).toBe(true);
    });
  });

  it("Remove on a non-catalog (fork/ad-hoc) entry detaches AND destroys the pointer entity", async () => {
    // Standalone sword (no catalog index entry referencing it) —
    // counts as fork-shaped per-instance data, so Remove should
    // destroy it once detached.
    const h = setupHarness({
      initialEntries: ({ swordId }) => [
        {
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: swordId,
          quantity: 1,
        },
      ],
    });
    const orig = window.confirm;
    window.confirm = () => true;
    try {
      mountWithClient(h, () =>
        TbInventoryTabFill.render({ characterId: h.characterId }) as never,
      );
      fireEvent.click(screen.getByTestId(`remove-${h.items.swordId}-0`));
      await new Promise((r) => setTimeout(r, 0));
      await waitFor(() => {
        if (h.world.has(h.items.swordId)) {
          throw new Error("expected sword entity destroyed");
        }
      });
      expect(
        h.dispatched.some((d) => d.type === UnequipItem.name),
      ).toBe(true);
      expect(
        h.dispatched.some((d) => d.type === "@vtt/items/DestroyItem"),
      ).toBe(true);
    } finally {
      window.confirm = orig;
    }
  });

  it("Remove on a catalog-template entry detaches but preserves the catalog entity", async () => {
    const h = buildCharacterHarness({
      asGm: true,
      plugins: [items, tbItemsTestPlugin],
      setupWorld: ({ world, registry, characterId }) => {
        runCatalogMerge({
          world,
          registry,
          pluginName: "@vtt/test-system",
          templates: [
            {
              templateId: "test/sword",
              traits: {
                ItemIdentity: { name: "Sword" },
                TbItemSlotOptions: { options: { carried: 1, belt: 1 } },
              },
            },
          ],
        });
        const swordEntity = world.query([ItemIdentity]).find(
          (r) => (r.values.ItemIdentity as { name: string }).name === "Sword",
        )!;
        world.set(characterId, TbCarries, {
          entries: [
            {
              slot: "handR",
              slotIndex: 0,
              channel: "carried",
              slotsConsumed: 1,
              itemId: swordEntity.id,
              quantity: 1,
            },
          ],
        });
      },
    });
    const swordEntity = h.world.query([ItemIdentity]).find(
      (r) => (r.values.ItemIdentity as { name: string }).name === "Sword",
    )!;
    const orig = window.confirm;
    window.confirm = () => true;
    try {
      mountWithClient(h, () =>
        TbInventoryTabFill.render({ characterId: h.characterId }) as never,
      );
      fireEvent.click(
        screen.getByTestId(`remove-${swordEntity.id}-0`),
      );
      await waitFor(() => {
        expect(h.dispatched.some((d) => d.type === UnequipItem.name)).toBe(true);
      });
      // Catalog entity is preserved — no DestroyItem dispatched.
      expect(
        h.dispatched.some((d) => d.type === "@vtt/items/DestroyItem"),
      ).toBe(false);
      expect(h.world.has(swordEntity.id)).toBe(true);
    } finally {
      window.confirm = orig;
    }
  });

  it("Ground Remove destroys a fork on the ground but preserves the catalog template", async () => {
    const h = buildCharacterHarness({
      asGm: true,
      plugins: [items, tbItemsTestPlugin],
      setupWorld: ({ world, registry, characterId }) => {
        world.set(characterId, TbCarries, { entries: [] });
        runCatalogMerge({
          world,
          registry,
          pluginName: "@vtt/test-system",
          templates: [
            {
              templateId: "test/sword",
              traits: {
                ItemIdentity: { name: "Sword" },
                TbItemSlotOptions: { options: { carried: 1, belt: 1 } },
              },
            },
          ],
        });
      },
    });
    const catalogSword = h.world.query([ItemIdentity]).find(
      (r) => (r.values.ItemIdentity as { name: string }).name === "Sword",
    )!;
    // Catalog item placed directly on ground (no fork — gear-shaped
    // catalog items reach the ground as themselves; only containers
    // auto-fork on PlaceOnGround).
    h.world.set(catalogSword.id, ItemPosition, {
      sceneId: "world-ground",
      x: 0,
      y: 0,
    });
    // Also a separate non-catalog item on the ground.
    const adhocSword = h.world.spawn([
      ItemIdentity({ name: "Adhoc Sword" }),
      TbItemSlotOptions({ options: { carried: 1 } }),
    ]);
    h.world.set(adhocSword, ItemPosition, {
      sceneId: "world-ground",
      x: 0,
      y: 0,
    });
    const orig = window.confirm;
    window.confirm = () => true;
    try {
      mountWithClient(h, () =>
        TbInventoryTabFill.render({ characterId: h.characterId }) as never,
      );
      // Remove the ad-hoc one — should destroy.
      fireEvent.click(screen.getByTestId(`ground-remove-${adhocSword}`));
      await new Promise((r) => setTimeout(r, 0));
      await waitFor(() => {
        if (h.world.has(adhocSword)) {
          throw new Error("expected adhoc sword destroyed");
        }
      });
      // Remove the catalog one — should NOT destroy.
      fireEvent.click(screen.getByTestId(`ground-remove-${catalogSword.id}`));
      await new Promise((r) => setTimeout(r, 0));
      await waitFor(() => {
        // Position cleared.
        expect(h.world.get(catalogSword.id, [ItemPosition])).toBeUndefined();
      });
      // But the catalog entity is still in the world.
      expect(h.world.has(catalogSword.id)).toBe(true);
    } finally {
      window.confirm = orig;
    }
  });

  it("dropping an item that lives inside a container removes it from the container and lands it on the world ground", async () => {
    const h = setupHarness({
      initialEntries: ({ backpackId }) => [
        {
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
          itemId: backpackId,
          quantity: 1,
        },
      ],
    });
    h.world.set(h.items.backpackId, TbCarries, {
      entries: [
        {
          slot: `container:${h.items.backpackId}`,
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 1,
          itemId: h.items.arrowsId,
          quantity: 1,
        },
      ],
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.click(screen.getByTestId(`drop-${h.items.arrowsId}-0`));
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => {
      const bp = h.world.get(h.items.backpackId, [TbCarries]) as {
        TbCarries: { entries: Array<unknown> };
      };
      // Arrows removed from the backpack.
      expect(bp.TbCarries.entries).toHaveLength(0);
      // And now on the world ground via ItemPosition.
      expect(h.world.get(h.items.arrowsId, [ItemPosition])).toBeDefined();
    });
    // Visible in the world-shared On the Ground zone.
    expect(
      screen.getByTestId(`ground-item-${h.items.arrowsId}`),
    ).toBeInTheDocument();
  });

  it("marking a container's content missing surfaces it in the character's Missing zone", async () => {
    const h = setupHarness({
      initialEntries: ({ backpackId }) => [
        {
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
          itemId: backpackId,
          quantity: 1,
        },
      ],
    });
    h.world.set(h.items.backpackId, TbCarries, {
      entries: [
        {
          slot: `container:${h.items.backpackId}`,
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 1,
          itemId: h.items.arrowsId,
          quantity: 1,
        },
      ],
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.click(screen.getByTestId(`missing-${h.items.arrowsId}-0`));
    await waitFor(() => {
      const bp = h.world.get(h.items.backpackId, [TbCarries]) as {
        TbCarries: { entries: Array<{ state?: { lost?: boolean } }> };
      };
      expect(bp.TbCarries.entries[0]!.state?.lost).toBe(true);
    });
  });

  it("a sack on the ground can be picked up via [carry·2] back into both hands", async () => {
    const h = setupHarness();
    const sackId = h.world.spawn([
      ItemIdentity({ name: "Large Sack" }),
      TbItemSlotOptions({ options: { carried: 2, pack: 1 } }),
      TbContainer({ containerType: "largeSack", containerSlots: 6 }),
      TbCarries({ entries: [] }),
    ]);
    // The sack is on the ground (ItemPosition stamped, no holder
    // entry).
    h.world.set(sackId, ItemPosition, {
      sceneId: "world-ground",
      x: 0,
      y: 0,
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.click(screen.getByTestId(`ground-pill-${sackId}-carried`));
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => {
      const c = h.world.get(h.characterId, [TbCarries]) as {
        TbCarries: {
          entries: Array<{ slot: string; slotsConsumed: number; itemId: string }>;
        };
      };
      const sackEntry = c.TbCarries.entries.find((e) => e.itemId === sackId);
      if (!sackEntry) {
        throw new Error("expected sack on character");
      }
      expect(sackEntry.slot).toBe("hands");
      expect(sackEntry.slotsConsumed).toBe(2);
    });
    // Position cleared — item no longer on the ground.
    expect(h.world.get(sackId, [ItemPosition])).toBeUndefined();
  });

  it("[carry·2] on a sack dropped from inside a backpack puts it on the *character's* hands", async () => {
    const h = setupHarness();
    const sackId = h.world.spawn([
      ItemIdentity({ name: "Large Sack" }),
      TbItemSlotOptions({ options: { carried: 2, pack: 1 } }),
      TbContainer({ containerType: "largeSack", containerSlots: 6 }),
      TbCarries({ entries: [] }),
    ]);
    h.world.set(h.characterId, TbCarries, {
      entries: [
        {
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
          itemId: h.items.backpackId,
          quantity: 1,
        },
      ],
    });
    // Sack started inside the backpack but is now on the ground —
    // the backpack no longer references it.
    h.world.set(sackId, ItemPosition, {
      sceneId: "world-ground",
      x: 0,
      y: 0,
    });
    h.world.set(h.items.backpackId, TbCarries, {
      entries: [
        {
          slot: `container:${h.items.backpackId}`,
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 1,
          itemId: sackId,
          quantity: 1,
          state: { dropped: true },
        },
      ],
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.click(screen.getByTestId(`ground-pill-${sackId}-carried`));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => {
      const c = h.world.get(h.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ slot: string; itemId: string }> };
      };
      const sackEntry = c.TbCarries.entries.find((e) => e.itemId === sackId);
      if (!sackEntry) {
        throw new Error(
          `expected sack on character; character has ${JSON.stringify(c.TbCarries.entries)}`,
        );
      }
      expect(sackEntry.slot).toBe("hands");
    });
  });

  it("a sack on the ground can be picked up via [pack·1] into a backpack", async () => {
    const h = setupHarness();
    const sackId = h.world.spawn([
      ItemIdentity({ name: "Large Sack" }),
      TbItemSlotOptions({ options: { carried: 2, pack: 1 } }),
      TbContainer({ containerType: "largeSack", containerSlots: 6 }),
      TbCarries({ entries: [] }),
    ]);
    h.world.set(h.characterId, TbCarries, {
      entries: [
        {
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
          itemId: h.items.backpackId,
          quantity: 1,
        },
      ],
    });
    h.world.set(sackId, ItemPosition, {
      sceneId: "world-ground",
      x: 0,
      y: 0,
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.click(screen.getByTestId(`ground-pill-${sackId}-pack`));
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => {
      const bp = h.world.get(h.items.backpackId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      const sackInBp = bp.TbCarries.entries.find((e) => e.itemId === sackId);
      if (!sackInBp) {
        throw new Error("sack not in backpack");
      }
    });
  });

  it("catalog Drop button puts the item on the world ground (auto-forks containers)", async () => {
    const h = buildCharacterHarness({
      asGm: true,
      plugins: [items, tbItemsTestPlugin],
      setupWorld: ({ world, registry, characterId }) => {
        world.set(characterId, TbCarries, { entries: [] });
        runCatalogMerge({
          world,
          registry,
          pluginName: "@vtt/test-system",
          templates: [
            {
              templateId: "test/sack",
              traits: {
                ItemIdentity: { name: "Large Sack" },
                TbItemSlotOptions: { options: { carried: 2, pack: 1 } },
                TbContainer: {
                  containerType: "largeSack",
                  containerSlots: 6,
                },
              },
            },
          ],
        });
      },
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.input(screen.getByTestId("catalog-search"), {
      target: { value: "large" },
    });
    const catalogSack = h.world
      .query([ItemIdentity])
      .find(
        (r) =>
          (r.values.ItemIdentity as { name: string }).name === "Large Sack",
      )!;
    fireEvent.click(screen.getByTestId(`catalog-drop-${catalogSack.id}`));
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => {
      const grounded = h.world.query([ItemPosition]);
      if (grounded.length === 0) {
        throw new Error("expected at least one grounded item");
      }
      // The grounded item is a fork of the catalog sack — distinct
      // entity id, but pointing at the same template.
      const groundedId = grounded[0]!.id;
      expect(groundedId).not.toBe(catalogSack.id);
      // The character's TbCarries was not touched.
      const c = h.world.get(h.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<unknown> };
      };
      expect(c.TbCarries.entries).toHaveLength(0);
    });
  });

  it("clicking [carry·2] on an item already in pack moves it into both hands with the new cost", async () => {
    const h = setupHarness();
    const sackId = h.world.spawn([
      ItemIdentity({ name: "Large Sack" }),
      TbItemSlotOptions({ options: { carried: 2, pack: 1 } }),
      TbContainer({ containerType: "largeSack", containerSlots: 6 }),
      TbCarries({ entries: [] }),
    ]);
    // The sack is currently packed inside a backpack at slot
    // `container:<backpackId>` with slotsConsumed=1.
    const carries = h.world.get(h.characterId, [TbCarries]) as {
      TbCarries: { entries: Array<unknown> };
    };
    h.world.set(h.characterId, TbCarries, {
      entries: [
        ...(carries.TbCarries.entries as Array<unknown>),
        {
          slot: "loose:1",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 1,
          itemId: sackId,
          quantity: 1,
        },
      ],
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.click(screen.getByTestId(`pill-${sackId}-carried`));
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => {
      const c = h.world.get(h.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ slot: string; slotsConsumed: number }> };
      };
      const sackEntry = c.TbCarries.entries.find((e) => e.slot === "hands");
      if (!sackEntry) {
        throw new Error(
          `expected entry at slot=hands; got ${JSON.stringify(c.TbCarries.entries)}`,
        );
      }
      expect(sackEntry.slot).toBe("hands");
      expect(sackEntry.slotsConsumed).toBe(2);
    });
  });

  it("clicking [carry·2] in the catalog lands the item at slot=hands, both panels see it", async () => {
    const h = buildCharacterHarness({
      asGm: true,
      plugins: [items, tbItemsTestPlugin],
      setupWorld: ({ world, registry, characterId }) => {
        world.set(characterId, TbCarries, { entries: [] });
        runCatalogMerge({
          world,
          registry,
          pluginName: "@vtt/test-system",
          templates: [
            {
              templateId: "test/large-sack",
              traits: {
                ItemIdentity: { name: "Large Sack" },
                TbItemSlotOptions: { options: { carried: 2, pack: 1 } },
                TbContainer: {
                  containerType: "largeSack",
                  containerSlots: 6,
                },
              },
            },
          ],
        });
      },
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.input(screen.getByTestId("catalog-search"), {
      target: { value: "large" },
    });
    const catalogSack = h.world
      .query([ItemIdentity])
      .find(
        (r) =>
          (r.values.ItemIdentity as { name: string }).name === "Large Sack",
      )!;
    fireEvent.click(
      screen.getByTestId(`catalog-pill-${catalogSack.id}-carried`),
    );
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => {
      const c = h.world.get(h.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ slot: string; channel: string }> };
      };
      if (c.TbCarries.entries.length !== 1) {
        throw new Error(
          `expected 1 entry, got ${c.TbCarries.entries.length}`,
        );
      }
    });
    const c = h.world.get(h.characterId, [TbCarries]) as {
      TbCarries: {
        entries: Array<{ slot: string; channel: string; slotsConsumed: number }>;
      };
    };
    expect(c.TbCarries.entries[0]!.slot).toBe("hands");
    expect(c.TbCarries.entries[0]!.channel).toBe("carried");
    expect(c.TbCarries.entries[0]!.slotsConsumed).toBe(2);
  });

  it("carry:2 items occupy both hand carried slots", async () => {
    const h = setupHarness();
    // Spawn a "Large Sack" with carried:2 and put it in inventory.
    const sackId = h.world.spawn([
      ItemIdentity({ name: "Large Sack" }),
      TbItemSlotOptions({ options: { carried: 2, pack: 1 } }),
    ]);
    h.world.set(h.characterId, TbCarries, {
      entries: [
        {
          slot: "hands",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 2,
          itemId: sackId,
          quantity: 1,
        },
      ],
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    // The sack should appear in both R-carried and L-carried panels
    // — there are two ItemRows for the same itemId.
    const sackNames = screen.getAllByText("Large Sack");
    expect(sackNames.length).toBeGreaterThanOrEqual(2);
    // Right-hand carried panel header: "Right Hand · carried (1/1)".
    const rightHand = screen.getByText(/^Right Hand · carried/).closest(
      "section",
    )!;
    expect(rightHand.textContent).toContain("1/1");
    expect(rightHand.getAttribute("data-overfull")).toBe("false");
    // Left-hand carried panel: same.
    const leftHand = screen.getByText(/^Left Hand · carried/).closest(
      "section",
    )!;
    expect(leftHand.textContent).toContain("1/1");
    expect(leftHand.getAttribute("data-overfull")).toBe("false");
  });

  it("two of the same item entity render with #1 / #2 suffixes", () => {
    const h = setupHarness({
      initialEntries: ({ swordId }) => [
        {
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: swordId,
          quantity: 1,
        },
        {
          slot: "belt",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 1,
          itemId: swordId,
          quantity: 1,
        },
      ],
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    expect(screen.getByText("Sword #1")).toBeInTheDocument();
    expect(screen.getByText("Sword #2")).toBeInTheDocument();
  });

  it("an over-capacity slot turns the panel red (overfull state)", () => {
    const h = setupHarness({
      initialEntries: ({ swordId, backpackId }) => [
        {
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
          itemId: backpackId,
          quantity: 1,
        },
        {
          // Force an overfill: a sword stuffed onto torso (claims 1
          // slot via a manual entry; total = 3 fits; we add one more).
          slot: "torso",
          slotIndex: 1,
          channel: "default",
          slotsConsumed: 3,
          itemId: swordId,
          quantity: 1,
        },
      ],
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    // Find the Torso panel header — its capacity readout includes the
    // ⚠ glyph when overfull.
    const torsoPanel = screen.getByText("Torso").closest("section")!;
    expect(torsoPanel.getAttribute("data-overfull")).toBe("true");
  });
});

describe("Bundle items in the inventory", () => {
  function setupTorches(opts: { count: number; capacity: number }) {
    let torchId!: EntityId;
    const h = buildCharacterHarness({
      asGm: true,
      plugins: [items, tbItemsTestPlugin],
      setupWorld: ({ world, characterId }) => {
        torchId = world.spawn([
          ItemIdentity({ name: "Torch" }),
          TbItemSlotOptions({ options: { pack: 1, carried: 1 } }),
          ItemBundle({ count: opts.count, capacity: opts.capacity }),
        ]);
        world.set(characterId, TbCarries, {
          entries: [
            {
              slot: "torso",
              slotIndex: 0,
              channel: "default",
              slotsConsumed: 1,
              itemId: torchId,
              quantity: 1,
            },
          ],
        });
      },
    });
    return { ...h, torchId };
  }

  it("renders ×count/capacity next to a stacked item's name", () => {
    const h = setupTorches({ count: 4, capacity: 4 });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    const badge = screen.getByTestId(`bundle-count-${h.torchId}-0`);
    expect(badge.textContent).toContain("×4/4");
  });

  it("Split 1 dispatches SplitItemBundle and the holder ends up with two carries entries", async () => {
    const h = setupTorches({ count: 4, capacity: 4 });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.click(screen.getByTestId(`split-${h.torchId}-0`));
    await waitFor(() => {
      expect(
        h.dispatched.some((d) => d.type === SplitItemBundle.name),
      ).toBe(true);
    });
    await waitFor(() => {
      const carries = h.world.get(h.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      expect(carries.TbCarries.entries.length).toBe(2);
      const ids = carries.TbCarries.entries.map((e) => e.itemId);
      expect(ids).toContain(h.torchId);
      expect(ids.find((id) => id !== h.torchId)).toBeTruthy();
    });
    // The new entity carries its own ItemBundle with count=1.
    const carries = h.world.get(h.characterId, [TbCarries]) as {
      TbCarries: { entries: Array<{ itemId: string }> };
    };
    const newId = carries.TbCarries.entries.find(
      (e) => e.itemId !== h.torchId,
    )!.itemId;
    const nb = h.world.get(newId as EntityId, [ItemBundle]) as {
      ItemBundle: { count: number; capacity: number };
    };
    expect(nb.ItemBundle.count).toBe(1);
    expect(nb.ItemBundle.capacity).toBe(4);
  });

  it("hides the Split button when count is 1", () => {
    const h = setupTorches({ count: 1, capacity: 4 });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    expect(screen.queryByTestId(`split-${h.torchId}-0`)).toBeNull();
  });

  function setupTwoStacks(opts: {
    a: { count: number; capacity: number };
    b: { count: number; capacity: number };
    sameKind?: boolean;
  }) {
    let aId!: EntityId;
    let bId!: EntityId;
    const h = buildCharacterHarness({
      asGm: true,
      plugins: [items, tbItemsTestPlugin],
      setupWorld: ({ world, characterId }) => {
        aId = world.spawn([
          ItemIdentity({ name: "Torch" }),
          TbItemSlotOptions({ options: { pack: 1, carried: 1 } }),
          ItemBundle({ count: opts.a.count, capacity: opts.a.capacity }),
        ]);
        bId = world.spawn([
          ItemIdentity({
            name: opts.sameKind === false ? "Candle" : "Torch",
          }),
          TbItemSlotOptions({ options: { pack: 1, carried: 1 } }),
          ItemBundle({ count: opts.b.count, capacity: opts.b.capacity }),
        ]);
        world.set(characterId, TbCarries, {
          entries: [
            {
              slot: "torso",
              slotIndex: 0,
              channel: "default",
              slotsConsumed: 1,
              itemId: aId,
              quantity: 1,
            },
            {
              slot: "torso",
              slotIndex: 1,
              channel: "default",
              slotsConsumed: 1,
              itemId: bId,
              quantity: 1,
            },
          ],
        });
      },
    });
    return { ...h, aId, bId };
  }

  it("shows a Combine button when a compatible peer with headroom exists", () => {
    const h = setupTwoStacks({
      a: { count: 1, capacity: 4 },
      b: { count: 2, capacity: 4 },
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    expect(screen.getByTestId(`combine-${h.aId}-0`)).toBeInTheDocument();
    expect(screen.getByTestId(`combine-${h.bId}-1`)).toBeInTheDocument();
  });

  it("hides Combine when there's no compatible peer (different kind)", () => {
    const h = setupTwoStacks({
      a: { count: 1, capacity: 4 },
      b: { count: 1, capacity: 4 },
      sameKind: false,
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    expect(screen.queryByTestId(`combine-${h.aId}-0`)).toBeNull();
    expect(screen.queryByTestId(`combine-${h.bId}-1`)).toBeNull();
  });

  it("hides Combine on a row whose only peer is at capacity", () => {
    const h = setupTwoStacks({
      a: { count: 1, capacity: 4 },
      b: { count: 4, capacity: 4 },
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    // A's only peer (B) is full → A has no destination → button hidden.
    expect(screen.queryByTestId(`combine-${h.aId}-0`)).toBeNull();
    // B's only peer (A) has headroom → B can pour into A → button shown.
    expect(screen.getByTestId(`combine-${h.bId}-1`)).toBeInTheDocument();
  });

  it("clicking a 'carry' pill on a stack splits 1 off; the rest stays in pack", async () => {
    let torchId!: EntityId;
    const h = buildCharacterHarness({
      asGm: true,
      plugins: [items, tbItemsTestPlugin],
      setupWorld: ({ world, characterId }) => {
        torchId = world.spawn([
          ItemIdentity({ name: "Torch" }),
          TbItemSlotOptions({ options: { pack: 1, carried: 1 } }),
          ItemBundle({ count: 4, capacity: 4 }),
        ]);
        world.set(characterId, TbCarries, {
          entries: [
            {
              slot: "torso",
              slotIndex: 0,
              channel: "default",
              slotsConsumed: 1,
              itemId: torchId,
              quantity: 1,
            },
          ],
        });
      },
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    // The "carried" pill is the carry-in-hand placement option.
    const pill = screen.getByTestId(`pill-${torchId}-carried`);
    fireEvent.click(pill);
    // A picker appears with handR-carried / handL-carried options.
    // Picker ids are `${characterId}:<slot>-<channel>`.
    await waitFor(() => {
      const opts = screen.queryAllByTestId(
        new RegExp(`^picker-${h.characterId}:hand[RL]-carried$`),
      );
      expect(opts.length).toBeGreaterThan(0);
    });
    const firstHandOption = screen.queryAllByTestId(
      new RegExp(`^picker-${h.characterId}:hand[RL]-carried$`),
    )[0]!;
    fireEvent.click(firstHandOption);
    await waitFor(() => {
      const carries = h.world.get(h.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string; slot: string; channel: string }> };
      };
      // Two entries: original stack of 3 in pack/torso, new singleton in handR or handL.
      expect(carries.TbCarries.entries.length).toBe(2);
      const handEntry = carries.TbCarries.entries.find(
        (e) => e.channel === "carried",
      );
      expect(handEntry).toBeTruthy();
      expect(handEntry!.itemId).not.toBe(torchId);
      const handBundle = h.world.get(handEntry!.itemId as EntityId, [
        ItemBundle,
      ]) as { ItemBundle: { count: number } };
      expect(handBundle.ItemBundle.count).toBe(1);
      // The original stack is decremented to 3 and stayed put.
      const stackEntry = carries.TbCarries.entries.find(
        (e) => e.itemId === torchId,
      );
      expect(stackEntry).toBeTruthy();
      const stackBundle = h.world.get(torchId, [ItemBundle]) as {
        ItemBundle: { count: number };
      };
      expect(stackBundle.ItemBundle.count).toBe(3);
    });
  });

  it("clicking a NON-carry pill on a stack moves the whole stack (no split)", async () => {
    let torchId!: EntityId;
    const h = buildCharacterHarness({
      asGm: true,
      plugins: [items, tbItemsTestPlugin],
      setupWorld: ({ world, characterId }) => {
        torchId = world.spawn([
          ItemIdentity({ name: "Torch" }),
          TbItemSlotOptions({ options: { pack: 1, pouch: 1 } }),
          ItemBundle({ count: 4, capacity: 4 }),
        ]);
        world.set(characterId, TbCarries, {
          entries: [
            {
              slot: "torso",
              slotIndex: 0,
              channel: "default",
              slotsConsumed: 1,
              itemId: torchId,
              quantity: 1,
            },
          ],
        });
      },
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.click(screen.getByTestId(`pill-${torchId}-pouch`));
    // Pouch may need a picker; if so, click the first option.
    await new Promise((r) => setTimeout(r, 0));
    const pouchOpts = screen.queryAllByTestId(/^picker-pocket/);
    if (pouchOpts.length > 0) fireEvent.click(pouchOpts[0]!);
    await waitFor(() => {
      const carries = h.world.get(h.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      // Still one entry — the same item, just moved.
      expect(carries.TbCarries.entries.length).toBe(1);
      expect(carries.TbCarries.entries[0]!.itemId).toBe(torchId);
      // No split happened: the source's count is still 4.
      const stackBundle = h.world.get(torchId, [ItemBundle]) as {
        ItemBundle: { count: number };
      };
      expect(stackBundle.ItemBundle.count).toBe(4);
    });
  });

  it("peek-inside: missing backpack with contents shows expand toggle and reveals contents", async () => {
    let backpackId!: EntityId;
    let torchId!: EntityId;
    const h = buildCharacterHarness({
      asGm: true,
      plugins: [items, tbItemsTestPlugin],
      setupWorld: ({ world, characterId }) => {
        torchId = world.spawn([
          ItemIdentity({ name: "Torch" }),
          TbItemSlotOptions({ options: { pack: 1 } }),
          ItemBundle({ count: 4, capacity: 4 }),
        ]);
        backpackId = world.spawn([
          ItemIdentity({ name: "Backpack" }),
          TbItemSlotOptions({ options: { torso: 2 } }),
          TbContainer({ containerType: "backpack", containerSlots: 6 }),
        ]);
        world.set(backpackId, TbCarries, {
          entries: [
            {
              slot: `container:${backpackId}`,
              slotIndex: 0,
              channel: "default",
              slotsConsumed: 1,
              itemId: torchId,
              quantity: 1,
            },
          ],
        });
        // Missing zone: entry stays on the holder with state.lost=true
        // (something nicked your backpack but you remember what it had).
        world.set(characterId, TbCarries, {
          entries: [
            {
              slot: "torso",
              slotIndex: 0,
              channel: "default",
              slotsConsumed: 2,
              itemId: backpackId,
              quantity: 1,
              state: { lost: true },
            },
          ],
        });
      },
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    const toggle = screen.getByTestId(`peek-toggle-row-${backpackId}-0`);
    expect(toggle).toBeInTheDocument();
    // Contents not yet shown.
    expect(screen.queryByTestId(`peek-${backpackId}`)).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByTestId(`peek-${backpackId}`)).toBeInTheDocument();
    });
    // Torch name visible inside the peek; bundle ×count too.
    const peek = screen.getByTestId(`peek-${backpackId}`);
    expect(peek.textContent).toContain("Torch");
    expect(peek.textContent).toContain("×4/4");
  });

  it("peek-inside: ground container shows expand toggle and reveals contents", async () => {
    let sackId!: EntityId;
    let coinsId!: EntityId;
    const h = buildCharacterHarness({
      asGm: true,
      plugins: [items, tbItemsTestPlugin],
      setupWorld: ({ world }) => {
        coinsId = world.spawn([
          ItemIdentity({ name: "Copper Coins" }),
          TbItemSlotOptions({ options: { pack: 2 } }),
        ]);
        sackId = world.spawn([
          ItemIdentity({ name: "Sack, Small" }),
          TbItemSlotOptions({ options: { carried: 1, pack: 1 } }),
          TbContainer({ containerType: "smallSack", containerSlots: 2 }),
          ItemPosition({ sceneId: "world-ground" as EntityId, x: 0, y: 0 }),
        ]);
        world.set(sackId, TbCarries, {
          entries: [
            {
              slot: `container:${sackId}`,
              slotIndex: 0,
              channel: "default",
              slotsConsumed: 2,
              itemId: coinsId,
              quantity: 1,
            },
          ],
        });
      },
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    const toggle = screen.getByTestId(`peek-toggle-ground-${sackId}`);
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByTestId(`peek-${sackId}`)).toBeInTheDocument();
    });
    expect(
      screen.getByTestId(`peek-${sackId}`).textContent,
    ).toContain("Copper Coins");
  });

  it("peek-inside: empty container does NOT show expand toggle", () => {
    let backpackId!: EntityId;
    const h = buildCharacterHarness({
      asGm: true,
      plugins: [items, tbItemsTestPlugin],
      setupWorld: ({ world, characterId }) => {
        backpackId = world.spawn([
          ItemIdentity({ name: "Backpack" }),
          TbItemSlotOptions({ options: { torso: 2 } }),
          TbContainer({ containerType: "backpack", containerSlots: 6 }),
          TbCarries({ entries: [] }),
        ]);
        world.set(characterId, TbCarries, {
          entries: [
            {
              slot: "torso",
              slotIndex: 0,
              channel: "default",
              slotsConsumed: 2,
              itemId: backpackId,
              quantity: 1,
              state: { lost: true },
            },
          ],
        });
      },
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    expect(
      screen.queryByTestId(`peek-toggle-row-${backpackId}-0`),
    ).toBeNull();
  });

  it("clicking a target dispatches JoinItemBundles and dest absorbs src", async () => {
    const h = setupTwoStacks({
      a: { count: 1, capacity: 4 },
      b: { count: 2, capacity: 4 },
    });
    mountWithClient(h, () =>
      TbInventoryTabFill.render({ characterId: h.characterId }) as never,
    );
    fireEvent.click(screen.getByTestId(`combine-${h.aId}-0`));
    fireEvent.click(screen.getByTestId(`combine-target-${h.bId}`));
    await waitFor(() => {
      expect(
        h.dispatched.some((d) => d.type === JoinItemBundles.name),
      ).toBe(true);
    });
    await waitFor(() => {
      // src destroyed (full transfer), dest count = 3
      expect(h.world.has(h.aId)).toBe(false);
      const v = h.world.get(h.bId, [ItemBundle]) as {
        ItemBundle: { count: number };
      };
      expect(v.ItemBundle.count).toBe(3);
      const carries = h.world.get(h.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      // Only dest entry remains in carries.
      expect(carries.TbCarries.entries.map((e) => e.itemId)).toEqual([h.bId]);
    });
  });

  describe("Edit (fork + open in tab)", () => {
    it("Edit on a non-catalog (fork/ad-hoc) entry opens its detail page directly — no fork", async () => {
      const h = setupHarness({
        initialEntries: ({ swordId }) => [
          {
            slot: "handR",
            slotIndex: 0,
            channel: "carried",
            slotsConsumed: 1,
            itemId: swordId,
            quantity: 1,
          },
        ],
      });
      mountWithClient(h, () =>
        TbInventoryTabFill.render({ characterId: h.characterId }) as never,
      );
      fireEvent.click(screen.getByTestId(`edit-${h.items.swordId}-0`));
      await waitFor(() => {
        expect(
          h.dispatched.some(
            (d) => d.type === "@vtt/shell-workbench/OpenPage",
          ),
        ).toBe(true);
      });
      // No fork happened — the standalone sword is already a private
      // entity; Edit just navigates to its detail page.
      expect(h.dispatched.some((d) => d.type === CustomizeItem.name)).toBe(
        false,
      );
      const open = h.dispatched.find(
        (d) => d.type === "@vtt/shell-workbench/OpenPage",
      );
      expect(open).toBeDefined();
      expect((open!.payload as { pageKind: string }).pageKind).toBe(
        "@vtt/items/items",
      );
      expect((open!.payload as { entityId: string }).entityId).toBe(
        h.items.swordId,
      );
    });

    it("Edit on a catalog-template entry forks first, rebinds the carry entry, then opens the fork's detail page", async () => {
      const h = buildCharacterHarness({
        asGm: true,
        plugins: [items, tbItemsTestPlugin],
        setupWorld: ({ world, registry, characterId }) => {
          runCatalogMerge({
            world,
            registry,
            pluginName: "@vtt/test-system",
            templates: [
              {
                templateId: "test/sword",
                traits: {
                  ItemIdentity: { name: "Sword" },
                  TbItemSlotOptions: { options: { carried: 1, belt: 1 } },
                  ItemEconomics: { value: { dice: 2, negotiated: false } },
                },
              },
            ],
          });
          const swordEntity = world.query([ItemIdentity]).find(
            (r) => (r.values.ItemIdentity as { name: string }).name === "Sword",
          )!;
          world.set(characterId, TbCarries, {
            entries: [
              {
                slot: "handR",
                slotIndex: 0,
                channel: "carried",
                slotsConsumed: 1,
                itemId: swordEntity.id,
                quantity: 1,
              },
            ],
          });
        },
      });
      const catalogSword = h.world.query([ItemIdentity]).find(
        (r) => (r.values.ItemIdentity as { name: string }).name === "Sword",
      )!;
      mountWithClient(h, () =>
        TbInventoryTabFill.render({ characterId: h.characterId }) as never,
      );
      fireEvent.click(screen.getByTestId(`edit-${catalogSword.id}-0`));
      await waitFor(() => {
        expect(h.dispatched.some((d) => d.type === CustomizeItem.name)).toBe(
          true,
        );
      });
      await waitFor(() => {
        expect(
          h.dispatched.some(
            (d) => d.type === "@vtt/shell-workbench/OpenPage",
          ),
        ).toBe(true);
      });
      const open = h.dispatched.find(
        (d) => d.type === "@vtt/shell-workbench/OpenPage",
      );
      expect(open).toBeDefined();
      const target = (open!.payload as { entityId: string }).entityId;
      expect((open!.payload as { pageKind: string }).pageKind).toBe(
        "@vtt/items/items",
      );
      // Routes to the fork, NOT the shared catalog entity.
      expect(target).not.toBe(catalogSword.id);
      // The fork is a real entity in the world by now.
      expect(h.world.has(target as EntityId)).toBe(true);
      // The holder's TbCarries entry has been rebound to the fork —
      // future edits on the fork are visible from this row.
      const carries = h.world.get(h.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      expect(carries.TbCarries.entries[0]!.itemId).toBe(target);
    });

    it("CustomizeItem with holder hints rebinds the matching carry entry to the new fork", async () => {
      const h = buildCharacterHarness({
        asGm: true,
        plugins: [items, tbItemsTestPlugin],
        setupWorld: ({ world, registry, characterId }) => {
          runCatalogMerge({
            world,
            registry,
            pluginName: "@vtt/test-system",
            templates: [
              {
                templateId: "test/pouch",
                traits: {
                  ItemIdentity: { name: "Pouch of Gold" },
                  TbItemSlotOptions: { options: { belt: 1, pack: 1 } },
                  ItemEconomics: { value: { dice: 2, negotiated: false } },
                },
              },
            ],
          });
          const pouchEntity = world.query([ItemIdentity]).find(
            (r) =>
              (r.values.ItemIdentity as { name: string }).name ===
              "Pouch of Gold",
          )!;
          world.set(characterId, TbCarries, {
            entries: [
              {
                slot: "belt",
                slotIndex: 0,
                channel: "default",
                slotsConsumed: 1,
                itemId: pouchEntity.id,
                quantity: 1,
              },
            ],
          });
        },
      });
      const catalogPouch = h.world.query([ItemIdentity]).find(
        (r) =>
          (r.values.ItemIdentity as { name: string }).name === "Pouch of Gold",
      )!;
      const handle = h.client.dispatch(
        CustomizeItem({
          sourceItemId: catalogPouch.id as EntityId,
          holderId: h.characterId,
          entryIndex: 0,
        }) as never,
      );
      await handle.ack;
      const carries = h.world.get(h.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      const reboundId = carries.TbCarries.entries[0]!.itemId;
      expect(reboundId).not.toBe(catalogPouch.id);
      // Fork inherited ItemEconomics from the catalog source.
      const econ = h.world.get(reboundId as EntityId, [ItemEconomics]) as
        | { ItemEconomics: { value: { dice: number; negotiated: boolean } } }
        | undefined;
      expect(econ?.ItemEconomics.value).toEqual({ dice: 2, negotiated: false });
    });

    it("CustomizeItem WITHOUT holder hints does not touch any TbCarries (legacy 'fork-from-workbench' path)", async () => {
      const h = setupHarness({
        initialEntries: ({ swordId }) => [
          {
            slot: "handR",
            slotIndex: 0,
            channel: "carried",
            slotsConsumed: 1,
            itemId: swordId,
            quantity: 1,
          },
        ],
      });
      const handle = h.client.dispatch(
        CustomizeItem({ sourceItemId: h.items.swordId }) as never,
      );
      await handle.ack;
      // Sword still in hand, unchanged — the bare fork didn't touch
      // any holder's entry.
      const carries = h.world.get(h.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      expect(carries.TbCarries.entries[0]!.itemId).toBe(h.items.swordId);
    });
  });

  describe("ItemEconomics.value badge", () => {
    it("renders `· 2D` next to the item name when value is present", () => {
      const h = buildCharacterHarness({
        asGm: true,
        plugins: [items, tbItemsTestPlugin],
        setupWorld: ({ world, characterId }) => {
          const pouchId = world.spawn([
            ItemIdentity({ name: "Pouch of Gold" }),
            TbItemSlotOptions({ options: { belt: 1, pack: 1 } }),
            ItemEconomics({ value: { dice: 2, negotiated: false } }),
          ]);
          world.set(characterId, TbCarries, {
            entries: [
              {
                slot: "belt",
                slotIndex: 0,
                channel: "default",
                slotsConsumed: 1,
                itemId: pouchId,
                quantity: 1,
              },
            ],
          });
        },
      });
      mountWithClient(h, () =>
        TbInventoryTabFill.render({ characterId: h.characterId }) as never,
      );
      const pouch = h.world.query([ItemIdentity]).find(
        (r) =>
          (r.values.ItemIdentity as { name: string }).name === "Pouch of Gold",
      )!;
      const badge = screen.getByTestId(`value-${pouch.id}-0`);
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toBe("· 2D");
    });

    it("renders `· 2D?` when value is negotiated", () => {
      const h = buildCharacterHarness({
        asGm: true,
        plugins: [items, tbItemsTestPlugin],
        setupWorld: ({ world, characterId }) => {
          const gemId = world.spawn([
            ItemIdentity({ name: "Rough Gem" }),
            TbItemSlotOptions({ options: { pack: 1 } }),
            ItemEconomics({ value: { dice: 2, negotiated: true } }),
          ]);
          world.set(characterId, TbCarries, {
            entries: [
              {
                slot: "pocket",
                slotIndex: 0,
                channel: "default",
                slotsConsumed: 1,
                itemId: gemId,
                quantity: 1,
              },
            ],
          });
        },
      });
      mountWithClient(h, () =>
        TbInventoryTabFill.render({ characterId: h.characterId }) as never,
      );
      const gem = h.world.query([ItemIdentity]).find(
        (r) =>
          (r.values.ItemIdentity as { name: string }).name === "Rough Gem",
      )!;
      const badge = screen.getByTestId(`value-${gem.id}-0`);
      expect(badge.textContent).toBe("· 2D?");
    });

    it("renders no badge when ItemEconomics.value is absent", () => {
      const h = setupHarness({
        initialEntries: ({ swordId }) => [
          {
            slot: "belt",
            slotIndex: 0,
            channel: "default",
            slotsConsumed: 1,
            itemId: swordId,
            quantity: 1,
          },
        ],
      });
      mountWithClient(h, () =>
        TbInventoryTabFill.render({ characterId: h.characterId }) as never,
      );
      expect(screen.queryByTestId(`value-${h.items.swordId}-0`)).toBeNull();
    });
  });
});
