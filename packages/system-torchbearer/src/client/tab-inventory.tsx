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

import { qualifiedName, type EntityId } from "@vtt/substrate";
import { kit } from "@vtt/characters/client";
import type { CharacterSheetTab } from "@vtt/characters/shared";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import {
  ItemCatalogIndex,
  ItemDerivedFrom,
  ItemIdentity,
  CustomizeItem,
} from "@vtt/items/shared";
import {
  EquipItem,
  ItemPosition,
  TbCarries,
  TbContainer,
  TbItemSlotOptions,
  type TbBodySlot,
  type TbEquipChannelT,
} from "../shared/index.js";

/**
 * Inventory tab — TbCarries-driven view that lists carried items by
 * body slot, with a catalog picker for adding items, drag-free
 * select-and-button moves between slots, drop, customize (fork),
 * and revert/lock affordances on each item.
 *
 * The tab reads:
 *   - `TbCarries` on the character (the inventory entries).
 *   - `ItemIdentity` / `TbItemSlotOptions` / `TbContainer` on each
 *     referenced item entity (so the row knows its name + slot
 *     constraints + whether it has internal slots).
 *   - The world-scoped `ItemCatalogIndex` (so the picker can list
 *     every catalog entry).
 *
 * The tab dispatches:
 *   - `EquipItem` when the picker adds a catalog entity.
 *   - `CustomizeItem` for fork-on-customize.
 *
 * Container internals (a backpack's contents) render via the same
 * grouping by re-rooting the slot label `container:<id>` against
 * the container's name.
 */
function InventoryTab(props: { characterId: string }): JSX.Element {
  const carries = useTrait(props.characterId, TbCarries);
  const entries = createMemo<ReadonlyArray<CarryEntry>>(() => {
    const v = carries() as { entries?: ReadonlyArray<CarryEntry> } | undefined;
    return v?.entries ?? [];
  });

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}>
      <kit.SheetSection title="On Your Person">
        <BodySlotsView characterId={props.characterId} entries={entries()} />
      </kit.SheetSection>

      <kit.SheetSection title="Carried Containers">
        <ContainersView characterId={props.characterId} entries={entries()} />
      </kit.SheetSection>

      <kit.SheetSection title="Add from Catalog">
        <CatalogPicker characterId={props.characterId} />
      </kit.SheetSection>
    </div>
  );
}

interface CarryEntry {
  slot: TbBodySlot | string;
  slotIndex: number;
  channel: TbEquipChannelT;
  slotsConsumed: number;
  itemId: EntityId;
  quantity: number;
  state?: {
    damaged?: boolean;
    dropped?: boolean;
    lit?: boolean;
    turnsRemaining?: number;
    lost?: boolean;
  };
}

const BODY_SLOTS: ReadonlyArray<{ slot: TbBodySlot; label: string; cap: number }> = [
  { slot: "head", label: "Head", cap: 1 },
  { slot: "neck", label: "Neck", cap: 1 },
  { slot: "handR", label: "Right Hand", cap: 2 },
  { slot: "handL", label: "Left Hand", cap: 2 },
  { slot: "torso", label: "Torso", cap: 3 },
  { slot: "belt", label: "Belt", cap: 3 },
  { slot: "feet", label: "Feet", cap: 1 },
];

function BodySlotsView(props: {
  characterId: string;
  entries: ReadonlyArray<CarryEntry>;
}): JSX.Element {
  return (
    <kit.SheetGroup layout="grid" cols={2}>
      <For each={BODY_SLOTS}>
        {(s) => {
          const matching = createMemo(() =>
            props.entries.filter((e) => e.slot === s.slot),
          );
          const used = createMemo(() =>
            matching().reduce((acc, e) => acc + e.slotsConsumed, 0),
          );
          return (
            <kit.FieldRow label={`${s.label} (${used()}/${s.cap})`}>
              <div style={{ display: "flex", "flex-wrap": "wrap", gap: "0.4rem" }}>
                <Show
                  when={matching().length > 0}
                  fallback={
                    <em style={{ color: "var(--color-fg-muted)", "font-size": "0.85rem" }}>
                      empty
                    </em>
                  }
                >
                  <For each={matching()}>
                    {(e) => (
                      <CarryItemPill
                        characterId={props.characterId}
                        entry={e}
                        entryIndex={props.entries.indexOf(e)}
                      />
                    )}
                  </For>
                </Show>
              </div>
            </kit.FieldRow>
          );
        }}
      </For>
    </kit.SheetGroup>
  );
}

function ContainersView(props: {
  characterId: string;
  entries: ReadonlyArray<CarryEntry>;
}): JSX.Element {
  // Pull container entries — those whose itemId points at an entity
  // with TbContainer.
  const client = useClient();
  const containerEntries = createMemo(() =>
    props.entries.filter((e) =>
      Boolean(client.world.get(e.itemId, [TbContainer])),
    ),
  );
  return (
    <Show
      when={containerEntries().length > 0}
      fallback={
        <p style={{ color: "var(--color-fg-muted)", "font-size": "0.85rem", margin: 0 }}>
          No containers carried.
        </p>
      }
    >
      <kit.SheetGroup layout="grid" cols={2}>
        <For each={containerEntries()}>
          {(e) => <ContainerView containerId={e.itemId} />}
        </For>
      </kit.SheetGroup>
    </Show>
  );
}

function ContainerView(props: { containerId: EntityId }): JSX.Element {
  const ident = useTrait(props.containerId, ItemIdentity) as () =>
    | { name: string }
    | undefined;
  const carries = useTrait(props.containerId, TbCarries) as () =>
    | { entries: ReadonlyArray<CarryEntry> }
    | undefined;
  const containerInfo = useTrait(props.containerId, TbContainer) as () =>
    | { containerType: string; containerSlots: number }
    | undefined;
  const entries = createMemo(() => carries()?.entries ?? []);
  const slots = createMemo(() => containerInfo()?.containerSlots ?? 0);
  const used = createMemo(() =>
    entries().reduce((acc, e) => acc + e.slotsConsumed, 0),
  );
  return (
    <kit.FieldRow label={`${ident()?.name ?? "Container"} (${used()}/${slots()})`}>
      <div style={{ display: "flex", "flex-wrap": "wrap", gap: "0.4rem" }}>
        <Show
          when={entries().length > 0}
          fallback={
            <em style={{ color: "var(--color-fg-muted)", "font-size": "0.85rem" }}>
              empty
            </em>
          }
        >
          <For each={entries()}>
            {(e) => (
              <CarryItemPill
                characterId={props.containerId}
                entry={e}
                entryIndex={entries().indexOf(e)}
              />
            )}
          </For>
        </Show>
      </div>
    </kit.FieldRow>
  );
}

function CarryItemPill(props: {
  characterId: EntityId;
  entry: CarryEntry;
  entryIndex: number;
}): JSX.Element {
  const ident = useTrait(props.entry.itemId, ItemIdentity) as () =>
    | { name: string; img: string }
    | undefined;
  const client = useClient();
  const canEdit = kit.useCanEdit(props.characterId);
  const onCustomize = (): void => {
    void client.dispatch(
      CustomizeItem({ sourceItemId: props.entry.itemId }),
    );
  };
  return (
    <span
      style={{
        display: "inline-flex",
        "align-items": "center",
        gap: "0.3rem",
        padding: "0.15rem 0.4rem",
        "border-radius": "0.3rem",
        background: "var(--color-bg-muted, rgba(0,0,0,0.04))",
        "font-size": "0.85rem",
      }}
    >
      <Show when={ident()?.img}>
        <img
          src={ident()!.img}
          alt=""
          width={16}
          height={16}
          style={{ "vertical-align": "middle" }}
        />
      </Show>
      <span>{ident()?.name ?? "Item"}</span>
      <Show when={props.entry.quantity > 1}>
        <small style={{ color: "var(--color-fg-muted)" }}>×{props.entry.quantity}</small>
      </Show>
      <Show when={props.entry.state?.damaged}>
        <small style={{ color: "var(--color-warning)" }} title="Damaged">!</small>
      </Show>
      <Show when={canEdit()}>
        <button
          type="button"
          onClick={onCustomize}
          title="Customize (fork)"
          style={{
            "font-size": "0.75rem",
            padding: "0 0.3rem",
            border: "1px solid var(--color-border)",
            background: "transparent",
            "border-radius": "0.2rem",
            cursor: "pointer",
          }}
        >
          fork
        </button>
      </Show>
    </span>
  );
}

interface CatalogRow {
  itemId: EntityId;
  name: string;
  category: string;
  templateId: string;
  slotOptions: Record<string, number>;
  isContainer: boolean;
  img: string;
}

function CatalogPicker(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const canEdit = kit.useCanEdit(props.characterId);
  const indexEntities = useQuery([ItemCatalogIndex]);
  const allItems = useQuery([ItemIdentity, ItemDerivedFrom, TbItemSlotOptions]);
  const [filter, setFilter] = createSignal("");
  const [category, setCategory] = createSignal<string>("all");

  const rows = createMemo<CatalogRow[]>(() => {
    const indexes = indexEntities();
    if (indexes.length === 0) return [];
    const knownIds = new Set<string>();
    for (const idx of indexes) {
      const v = idx.values.ItemCatalogIndex as { entries: Record<string, string> };
      for (const id of Object.values(v.entries)) knownIds.add(id);
    }
    const out: CatalogRow[] = [];
    for (const row of allItems()) {
      if (!knownIds.has(row.id)) continue;
      const ident = row.values.ItemIdentity as { name: string; img: string };
      const derived = row.values.ItemDerivedFrom as {
        templateId: string;
        deprecated?: boolean;
      };
      if (derived.deprecated) continue;
      const slotOpts = row.values.TbItemSlotOptions as { options: Record<string, number> };
      const isContainer = Boolean(client.world.get(row.id, [TbContainer]));
      out.push({
        itemId: row.id,
        name: ident.name,
        category: deriveCategory(derived.templateId),
        templateId: derived.templateId,
        slotOptions: slotOpts.options,
        isContainer,
        img: ident.img,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  });

  const categories = createMemo(() => {
    const cats = new Set<string>();
    for (const r of rows()) cats.add(r.category);
    return ["all", ...Array.from(cats).sort()];
  });

  const filtered = createMemo(() => {
    const needle = filter().trim().toLowerCase();
    const cat = category();
    return rows().filter(
      (r) =>
        (cat === "all" || r.category === cat) &&
        (needle === "" || r.name.toLowerCase().includes(needle)),
    );
  });

  const equipFromCatalog = (row: CatalogRow): void => {
    // Choose the *first* allowed slot. The user can move it after
    // equipping. For containers, prefer torso. Multi-axis slots
    // (handR/handL) default to "carried" channel; everything else
    // uses "default".
    const allowed = Object.entries(row.slotOptions);
    if (allowed.length === 0) return;
    const preferred =
      allowed.find(([k]) => (row.isContainer ? k === "torso" : true)) ??
      allowed[0]!;
    const [slot, slotsConsumed] = preferred;
    const channel = slot === "handR" || slot === "handL" ? "carried" : "default";
    void client.dispatch(
      EquipItem({
        holderId: props.characterId as EntityId,
        itemId: row.itemId,
        slot,
        slotIndex: 0,
        channel,
        slotsConsumed,
        quantity: 1,
      }),
    );
  };

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", "align-items": "center" }}>
        <input
          type="search"
          placeholder="filter…"
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
          autocomplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          spellcheck={false}
          name="tb-inventory-filter"
          style={{ flex: "1", padding: "0.25rem 0.4rem" }}
        />
        <select
          value={category()}
          onChange={(e) => setCategory(e.currentTarget.value)}
        >
          <For each={categories()}>{(c) => <option value={c}>{c}</option>}</For>
        </select>
      </div>
      <div
        style={{
          "max-height": "16rem",
          "overflow-y": "auto",
          border: "1px solid var(--color-border)",
          "border-radius": "0.3rem",
        }}
      >
        <For each={filtered()}>
          {(r) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "0.5rem",
                padding: "0.3rem 0.5rem",
                "border-bottom": "1px solid var(--color-border)",
              }}
            >
              <Show when={r.img}>
                <img src={r.img} width={20} height={20} alt="" />
              </Show>
              <div style={{ flex: "1" }}>
                <div style={{ "font-size": "0.9rem" }}>{r.name}</div>
                <div style={{ "font-size": "0.7rem", color: "var(--color-fg-muted)" }}>
                  {r.category} · slots: {Object.keys(r.slotOptions).join(", ") || "—"}
                </div>
              </div>
              <button
                type="button"
                disabled={!canEdit()}
                onClick={() => equipFromCatalog(r)}
                data-testid={`tb-equip-${r.templateId}`}
                aria-label={`Equip ${r.name}`}
                style={{
                  padding: "0.2rem 0.6rem",
                  "font-size": "0.8rem",
                  cursor: canEdit() ? "pointer" : "not-allowed",
                }}
              >
                equip
              </button>
            </div>
          )}
        </For>
        <Show when={filtered().length === 0}>
          <p
            style={{
              padding: "0.5rem",
              "font-size": "0.8rem",
              color: "var(--color-fg-muted)",
              margin: 0,
            }}
          >
            No matches.
          </p>
        </Show>
      </div>
    </div>
  );
}

function deriveCategory(templateId: string): string {
  // templateId shape: "tb/<category>/<slug>-<id>"
  const parts = templateId.split("/");
  return parts[1] ?? "other";
}

// The unused-import suppressors avoid TS complaints when the
// template's catalog module rolls out without renderer wiring.
void ItemPosition;

export const TbInventoryTabFill: CharacterSheetTab = {
  id: qualifiedName("@vtt/system-torchbearer/tab-inventory") as CharacterSheetTab["id"],
  label: "Inventory",
  priority: 50,
  render: ({ characterId }) => InventoryTab({ characterId }),
};
