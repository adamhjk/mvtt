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
import {
  buildTestClient,
  mountWithClient,
} from "@vtt/substrate/client-testing";
import { items } from "@vtt/items";
import {
  ItemBundle,
  ItemIdentity,
  SetItemTrait,
  SplitItemBundle,
} from "@vtt/items/shared";
import { definePlugin, type EntityId } from "@vtt/substrate";
import {
  TbArmor,
  TbCarries,
  TbContainer,
  TbItemSlotOptions,
  TbItemSpecialRules,
  TbSkillBonuses,
  TbSupply,
  TbWeapon,
  ItemPosition,
} from "./shared/index.js";
import {
  TbBundleDetailSection,
  TbManageSubtypesDetailSection,
  TbSlotOptionsDetailSection,
  TbWeaponDetailSection,
} from "./client/item-detail-sections.js";

afterEach(() => {
  cleanup();
});

const tbItemsTestPlugin = definePlugin({
  name: "@vtt/system-torchbearer-detail-sections-test",
  version: "0",
  dependsOn: ["@vtt/items@^0"],
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
  gameSystem: true,
});

function setup(opts?: {
  initialTraits?: (world: import("@vtt/substrate").World) => EntityId;
}) {
  let itemId!: EntityId;
  const h = buildTestClient({
    plugins: [items, tbItemsTestPlugin],
    setupWorld: ({ world }) => {
      if (opts?.initialTraits) {
        itemId = opts.initialTraits(world);
      } else {
        itemId = world.spawn([ItemIdentity({ name: "Hat" })]);
      }
    },
  });
  return { ...h, itemId };
}

describe("Manage Subtypes section", () => {
  it("toggles a subtype on, dispatching SetItemTrait with default values", async () => {
    const h = setup();
    mountWithClient(h, () =>
      TbManageSubtypesDetailSection.render({
        itemId: h.itemId,
        canEdit: true,
      }) as never,
    );
    fireEvent.click(screen.getByTestId("subtype-toggle-TbWeapon"));
    await waitFor(() => {
      expect(h.dispatched.some((d) => d.type === SetItemTrait.name)).toBe(true);
    });
    const ev = h.dispatched.find((d) => d.type === SetItemTrait.name)!;
    const payload = ev.payload as {
      traitShortName: string;
      value: { wield: number };
    };
    expect(payload.traitShortName).toBe("TbWeapon");
    expect(payload.value.wield).toBe(1);
    // After dispatch, the trait actually lands on the item.
    await waitFor(() => {
      expect(h.world.get(h.itemId, [TbWeapon])).toBeDefined();
    });
  });

  it("toggles a subtype off, dispatching RemoveItemTrait", async () => {
    const h = setup({
      initialTraits: (world) =>
        world.spawn([
          ItemIdentity({ name: "Hat" }),
          TbWeapon({
            wield: 1,
            conflictBonuses: {
              attack: { type: "dice", value: 0 },
              defend: { type: "dice", value: 0 },
              feint: { type: "dice", value: 0 },
              maneuver: { type: "dice", value: 0 },
            },
          }),
        ]),
    });
    mountWithClient(h, () =>
      TbManageSubtypesDetailSection.render({
        itemId: h.itemId,
        canEdit: true,
      }) as never,
    );
    fireEvent.click(screen.getByTestId("subtype-toggle-TbWeapon"));
    await waitFor(() => {
      expect(
        h.dispatched.some((d) => d.type === "@vtt/items/RemoveItemTrait"),
      ).toBe(true);
    });
    expect(h.world.get(h.itemId, [TbWeapon])).toBeUndefined();
  });
});

describe("SlotOptions section", () => {
  it("adds a new slot via the + add form", async () => {
    const h = setup({
      initialTraits: (world) =>
        world.spawn([
          ItemIdentity({ name: "Hat" }),
          TbItemSlotOptions({ options: {} }),
        ]),
    });
    mountWithClient(h, () =>
      TbSlotOptionsDetailSection.render({
        itemId: h.itemId,
        canEdit: true,
      }) as never,
    );
    // Default add form: pack, cost 1.
    fireEvent.change(screen.getByTestId("slot-add-key"), {
      target: { value: "pack" },
    });
    fireEvent.input(screen.getByTestId("slot-add-cost"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByTestId("slot-add"));
    await waitFor(() => {
      const opts = h.world.get(h.itemId, [TbItemSlotOptions]) as
        | { TbItemSlotOptions: { options: Record<string, number> } }
        | undefined;
      expect(opts?.TbItemSlotOptions.options.pack).toBe(1);
    });
  });

  it("removes an existing slot", async () => {
    const h = setup({
      initialTraits: (world) =>
        world.spawn([
          ItemIdentity({ name: "Hat" }),
          TbItemSlotOptions({
            options: { torso: 1, pack: 2 },
          }),
        ]),
    });
    mountWithClient(h, () =>
      TbSlotOptionsDetailSection.render({
        itemId: h.itemId,
        canEdit: true,
      }) as never,
    );
    fireEvent.click(screen.getByTestId("slot-remove-torso"));
    await waitFor(() => {
      const opts = h.world.get(h.itemId, [TbItemSlotOptions]) as
        | { TbItemSlotOptions: { options: Record<string, number> } }
        | undefined;
      expect(opts?.TbItemSlotOptions.options.torso).toBeUndefined();
      expect(opts?.TbItemSlotOptions.options.pack).toBe(2);
    });
  });

  it("changes the cost of an existing slot", async () => {
    const h = setup({
      initialTraits: (world) =>
        world.spawn([
          ItemIdentity({ name: "Hat" }),
          TbItemSlotOptions({ options: { torso: 1 } }),
        ]),
    });
    mountWithClient(h, () =>
      TbSlotOptionsDetailSection.render({
        itemId: h.itemId,
        canEdit: true,
      }) as never,
    );
    fireEvent.change(screen.getByTestId("slot-cost-torso"), {
      target: { value: "3" },
    });
    await waitFor(() => {
      const opts = h.world.get(h.itemId, [TbItemSlotOptions]) as
        | { TbItemSlotOptions: { options: Record<string, number> } }
        | undefined;
      expect(opts?.TbItemSlotOptions.options.torso).toBe(3);
    });
  });
});

describe("Weapon section", () => {
  it("editing the wield count dispatches an EditItemField on TbWeapon.wield", async () => {
    const h = setup({
      initialTraits: (world) =>
        world.spawn([
          ItemIdentity({ name: "Sword" }),
          TbWeapon({
            wield: 1,
            conflictBonuses: {
              attack: { type: "dice", value: 0 },
              defend: { type: "dice", value: 0 },
              feint: { type: "dice", value: 0 },
              maneuver: { type: "dice", value: 0 },
            },
          }),
        ]),
    });
    mountWithClient(h, () =>
      TbWeaponDetailSection.render({
        itemId: h.itemId,
        canEdit: true,
      }) as never,
    );
    fireEvent.change(screen.getByTestId("weapon-wield"), {
      target: { value: "2" },
    });
    await waitFor(() => {
      const w = h.world.get(h.itemId, [TbWeapon]) as
        | { TbWeapon: { wield: number } }
        | undefined;
      expect(w?.TbWeapon.wield).toBe(2);
    });
  });

  it("editing the attack bonus value dispatches a nested EditItemField", async () => {
    const h = setup({
      initialTraits: (world) =>
        world.spawn([
          ItemIdentity({ name: "Sword" }),
          TbWeapon({
            wield: 1,
            conflictBonuses: {
              attack: { type: "dice", value: 0 },
              defend: { type: "dice", value: 0 },
              feint: { type: "dice", value: 0 },
              maneuver: { type: "dice", value: 0 },
            },
          }),
        ]),
    });
    mountWithClient(h, () =>
      TbWeaponDetailSection.render({
        itemId: h.itemId,
        canEdit: true,
      }) as never,
    );
    fireEvent.change(screen.getByTestId("weapon-attack-value"), {
      target: { value: "1" },
    });
    await waitFor(() => {
      const w = h.world.get(h.itemId, [TbWeapon]) as
        | {
            TbWeapon: {
              conflictBonuses: { attack: { value: number } };
            };
          }
        | undefined;
      expect(w?.TbWeapon.conflictBonuses.attack.value).toBe(1);
    });
  });
});

describe("Bundle section", () => {
  it("renders count + capacity, lets the GM edit capacity", async () => {
    let itemId!: EntityId;
    const h = buildTestClient({
      plugins: [items, tbItemsTestPlugin],
      setupWorld: ({ world }) => {
        itemId = world.spawn([
          ItemIdentity({ name: "Torch" }),
          ItemBundle({ count: 4, capacity: 4 }),
        ]);
      },
    });
    mountWithClient(h, () =>
      TbBundleDetailSection.render({ itemId, canEdit: true }) as never,
    );
    expect(
      (screen.getByTestId("bundle-capacity") as HTMLInputElement).value,
    ).toBe("4");
    expect(
      (screen.getByTestId("bundle-count") as HTMLInputElement).value,
    ).toBe("4");
    fireEvent.change(screen.getByTestId("bundle-capacity"), {
      target: { value: "6" },
    });
    await waitFor(() => {
      const v = h.world.get(itemId, [ItemBundle]) as {
        ItemBundle: { capacity: number };
      };
      expect(v.ItemBundle.capacity).toBe(6);
    });
  });

  it("dispatches SplitItemBundle when the GM clicks Split off N", async () => {
    let itemId!: EntityId;
    const h = buildTestClient({
      plugins: [items, tbItemsTestPlugin],
      setupWorld: ({ world }) => {
        itemId = world.spawn([
          ItemIdentity({ name: "Torch" }),
          ItemBundle({ count: 4, capacity: 4 }),
        ]);
      },
    });
    mountWithClient(h, () =>
      TbBundleDetailSection.render({ itemId, canEdit: true }) as never,
    );
    fireEvent.input(screen.getByTestId("bundle-split-count"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByTestId("bundle-split"));
    await waitFor(() => {
      expect(
        h.dispatched.some((d) => d.type === SplitItemBundle.name),
      ).toBe(true);
    });
    const ev = h.dispatched.find((d) => d.type === SplitItemBundle.name)!;
    const payload = ev.payload as { itemId: EntityId; count: number };
    expect(payload.itemId).toBe(itemId);
    expect(payload.count).toBe(2);
    // After dispatch, the original is decremented and a new entity exists.
    await waitFor(() => {
      const src = h.world.get(itemId, [ItemBundle]) as {
        ItemBundle: { count: number };
      };
      expect(src.ItemBundle.count).toBe(2);
      const all = h.world.query([ItemBundle]).map((r) => r.id as string);
      expect(all.length).toBe(2);
      const newId = all.find((id) => id !== itemId)!;
      const newBundle = h.world.get(newId as EntityId, [ItemBundle]) as {
        ItemBundle: { count: number };
      };
      expect(newBundle.ItemBundle.count).toBe(2);
    });
  });

  it("hides the Split control when count is 1", () => {
    let itemId!: EntityId;
    const h = buildTestClient({
      plugins: [items, tbItemsTestPlugin],
      setupWorld: ({ world }) => {
        itemId = world.spawn([
          ItemIdentity({ name: "Torch" }),
          ItemBundle({ count: 1, capacity: 4 }),
        ]);
      },
    });
    mountWithClient(h, () =>
      TbBundleDetailSection.render({ itemId, canEdit: true }) as never,
    );
    expect(screen.queryByTestId("bundle-split")).toBeNull();
  });
});
