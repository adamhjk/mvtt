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
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { buildTestClient, mountWithClient } from "@vtt/substrate/client-testing";
import {
  EditItemField,
  ItemDerivedFrom,
  ItemIdentity,
  RevertItemField,
  runCatalogMerge,
} from "./shared/index.js";
import { items } from "./manifest.js";
import { ItemsPageProvider } from "./client/index.js";

afterEach(() => {
  cleanup();
});

function buildHarness() {
  return buildTestClient({
    plugins: [items],
    setupWorld: ({ world, registry }) => {
      runCatalogMerge({
        world,
        registry,
        pluginName: "@vtt/test-system",
        templates: [
          {
            templateId: "test/sword",
            traits: {
              ItemIdentity: {
                name: "Sword",
                description: "A sharp blade.",
                img: "/icons/lorc/broadsword.svg",
              },
              ItemEconomics: { cost: 3 },
            },
          },
          {
            templateId: "test/bow",
            traits: {
              ItemIdentity: {
                name: "Bow",
                description: "Shoots arrows.",
                img: "",
              },
            },
          },
        ],
      });
    },
  });
}

describe("ItemsPageProvider", () => {
  describe("hub view", () => {
    it("lists every item with its name", () => {
      const h = buildHarness();
      mountWithClient(h, () =>
        ItemsPageProvider.render({
          tabId: "tab-1",
          entityId: null,
        }) as never,
      );
      expect(screen.getByText("Sword")).toBeInTheDocument();
      expect(screen.getByText("Bow")).toBeInTheDocument();
    });

    it("filters by name", () => {
      const h = buildHarness();
      mountWithClient(h, () =>
        ItemsPageProvider.render({
          tabId: "tab-1",
          entityId: null,
        }) as never,
      );
      fireEvent.input(screen.getByPlaceholderText("filter by name…"), {
        target: { value: "bow" },
      });
      expect(screen.queryByText("Sword")).toBeNull();
      expect(screen.getByText("Bow")).toBeInTheDocument();
    });

    it("renders a list of clickable open buttons per item", () => {
      const h = buildHarness();
      mountWithClient(h, () =>
        ItemsPageProvider.render({
          tabId: "tab-1",
          entityId: null,
        }) as never,
      );
      const swordRow = h.world.query([ItemIdentity]).find((r) => {
        const v = r.values.ItemIdentity as { name: string };
        return v.name === "Sword";
      })!;
      expect(
        screen.getByTestId(`open-item-${swordRow.id}`),
      ).toBeInTheDocument();
    });
  });

  describe("detail view", () => {
    it("renders the identity editor with the current name", () => {
      const h = buildHarness();
      const swordRow = h.world.query([ItemIdentity]).find((r) => {
        const v = r.values.ItemIdentity as { name: string };
        return v.name === "Sword";
      })!;
      mountWithClient(h, () =>
        ItemsPageProvider.render({
          tabId: "tab-1",
          entityId: swordRow.id,
        }) as never,
      );
      const nameInput = screen.getByTestId(
        "field-ItemIdentity.name",
      ) as HTMLInputElement;
      expect(nameInput.value).toBe("Sword");
    });

    it("editing the name dispatches EditItemField with the new value", () => {
      const h = buildHarness();
      const swordRow = h.world.query([ItemIdentity]).find((r) => {
        const v = r.values.ItemIdentity as { name: string };
        return v.name === "Sword";
      })!;
      mountWithClient(h, () =>
        ItemsPageProvider.render({
          tabId: "tab-1",
          entityId: swordRow.id,
        }) as never,
      );
      const nameInput = screen.getByTestId(
        "field-ItemIdentity.name",
      ) as HTMLInputElement;
      fireEvent.input(nameInput, { target: { value: "Mythril Sword" } });
      fireEvent.blur(nameInput);
      const dispatched = h.dispatched.find(
        (d) => d.type === EditItemField.name,
      );
      expect(dispatched).toBeDefined();
      const payload = dispatched!.payload as {
        path: string;
        value: unknown;
      };
      expect(payload.path).toBe("ItemIdentity.name");
      expect(payload.value).toBe("Mythril Sword");
    });

    it("once the field is overridden, a revert button appears", () => {
      const h = buildHarness();
      const swordRow = h.world.query([ItemIdentity]).find((r) => {
        const v = r.values.ItemIdentity as { name: string };
        return v.name === "Sword";
      })!;
      // Pre-mark the name path as overridden.
      const derived = h.world.get(swordRow.id, [ItemDerivedFrom]) as {
        ItemDerivedFrom: {
          templateId: string;
          pluginName: string;
          overrides: string[];
        };
      };
      h.world.set(swordRow.id, ItemDerivedFrom, {
        ...derived.ItemDerivedFrom,
        overrides: ["ItemIdentity.name"],
      });
      mountWithClient(h, () =>
        ItemsPageProvider.render({
          tabId: "tab-1",
          entityId: swordRow.id,
        }) as never,
      );
      const revertBtn = screen.getByTestId("revert-ItemIdentity.name");
      expect(revertBtn).toBeInTheDocument();
      fireEvent.click(revertBtn);
      const dispatched = h.dispatched.find(
        (d) => d.type === RevertItemField.name,
      );
      expect(dispatched).toBeDefined();
    });
  });
});

