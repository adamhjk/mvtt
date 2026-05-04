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

import { qualifiedName } from "@vtt/substrate";
import { kit } from "@vtt/characters/client";
import type { CharacterSheetTab } from "@vtt/characters/shared";
import { useTrait } from "@vtt/substrate/client";
import { createMemo, For, type JSX } from "solid-js";
import { Inventory } from "../shared/index.js";

/**
 * "Inventory" tab — slot-based gear placement matching the printed
 * sheet layout (DH p.112). Each slot is a labeled cluster with a fixed
 * capacity. Containers (Satchel, Sacks) carry a Carried/Dropped/Lost
 * status; the Cache slot is for items stashed back home.
 *
 * Per-slot editing UI is read-only for the shape pass — it shows the
 * current item count + summary so the structure is testable. The
 * SlotList primitive (and a per-item editor) will land in the next
 * pass; today the data shape is reachable via SetField for callers
 * that want to populate it.
 */
function InventoryTab(props: { characterId: string }): JSX.Element {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}>
      <kit.SheetSection title="On Your Person">
        <kit.SheetGroup layout="grid" cols={2}>
          <SlotSummary characterId={props.characterId} kind="head" label="Head (worn)" cap={1} />
          <SlotSummary characterId={props.characterId} kind="neck" label="Neck (worn)" cap={1} />
          <SlotSummary characterId={props.characterId} kind="handsWorn" label="Hands (worn)" cap={2} />
          <SlotSummary characterId={props.characterId} kind="handsCarried" label="Hands (carried)" cap={2} />
          <SlotSummary characterId={props.characterId} kind="torso" label="Torso (worn)" cap={3} />
          <SlotSummary characterId={props.characterId} kind="belt" label="Belt" cap={3} />
          <SlotSummary characterId={props.characterId} kind="feet" label="Feet (worn)" cap={1} />
          <kit.FieldRow label="Pocket">
            <kit.TextField characterId={props.characterId} trait={Inventory} path={["pocket"]} placeholder="Trinkets" />
          </kit.FieldRow>
        </kit.SheetGroup>
      </kit.SheetSection>

      <kit.SheetSection title="Carried">
        <kit.SheetGroup layout="grid" cols={2}>
          <ContainerSummary characterId={props.characterId} kind="satchel" label="Satchel / Backpack" cap={6} />
          <ContainerSummary characterId={props.characterId} kind="largeSack" label="Large Sack" cap={6} />
          <ContainerSummary characterId={props.characterId} kind="smallSackOne" label="Small Sack #1" cap={2} />
          <ContainerSummary characterId={props.characterId} kind="smallSackTwo" label="Small Sack #2" cap={2} />
        </kit.SheetGroup>
      </kit.SheetSection>

      <kit.SheetSection title="Cache">
        <p style={{ "font-size": "0.85rem", color: "var(--color-fg-muted)", margin: 0 }}>
          Stashed in camp, in your home or at your mom's house — 12 slots.
        </p>
        <CacheSummary characterId={props.characterId} />
      </kit.SheetSection>
    </div>
  );
}

function SlotSummary(props: {
  characterId: string;
  kind: keyof Pick<
    {
      head: unknown;
      neck: unknown;
      handsWorn: unknown;
      handsCarried: unknown;
      torso: unknown;
      belt: unknown;
      feet: unknown;
    },
    "head" | "neck" | "handsWorn" | "handsCarried" | "torso" | "belt" | "feet"
  >;
  label: string;
  cap: number;
}): JSX.Element {
  const inv = useTrait(props.characterId, Inventory);
  const items = createMemo(() => {
    const v = inv();
    if (!v) return [] as Array<{ name: string }>;
    return ((v as Record<string, unknown>)[props.kind] as Array<{ name: string }>) ?? [];
  });
  return (
    <kit.FieldRow label={props.label}>
      <span style={{ "font-size": "0.85rem", color: "var(--color-fg)" }}>
        {items().length === 0 ? (
          <em style={{ color: "var(--color-fg-muted)" }}>empty</em>
        ) : (
          <For each={items()}>{(it) => <span style={{ "margin-right": "0.5rem" }}>{it.name}</span>}</For>
        )}
        <span style={{ "margin-left": "0.5rem", color: "var(--color-fg-muted)", "font-size": "0.75rem" }}>
          {items().length}/{props.cap}
        </span>
      </span>
    </kit.FieldRow>
  );
}

function ContainerSummary(props: {
  characterId: string;
  kind: "satchel" | "largeSack" | "smallSackOne" | "smallSackTwo";
  label: string;
  cap: number;
}): JSX.Element {
  const inv = useTrait(props.characterId, Inventory);
  const container = createMemo(() => {
    const v = inv();
    if (!v) return null;
    return ((v as Record<string, unknown>)[props.kind] as { items: Array<{ name: string }>; status: string } | null) ?? null;
  });
  return (
    <kit.FieldRow label={props.label}>
      <span style={{ "font-size": "0.85rem", color: "var(--color-fg)" }}>
        {container()?.items.length === 0 ? (
          <em style={{ color: "var(--color-fg-muted)" }}>empty</em>
        ) : (
          <For each={container()?.items ?? []}>
            {(it) => <span style={{ "margin-right": "0.5rem" }}>{it.name}</span>}
          </For>
        )}
        <span style={{ "margin-left": "0.5rem", color: "var(--color-fg-muted)", "font-size": "0.75rem" }}>
          {container()?.items.length ?? 0}/{props.cap} · {container()?.status ?? "—"}
        </span>
      </span>
    </kit.FieldRow>
  );
}

function CacheSummary(props: { characterId: string }): JSX.Element {
  const inv = useTrait(props.characterId, Inventory);
  const items = createMemo(() => inv()?.cache ?? []);
  return (
    <span style={{ "font-size": "0.75rem" }}>
      {items().length === 0 ? (
        <em style={{ color: "var(--color-fg-muted)" }}>nothing stashed</em>
      ) : (
        <For each={items()}>{(it) => <span style={{ "margin-right": "0.5rem" }}>{it.name}</span>}</For>
      )}
      <span style={{ "margin-left": "0.5rem", color: "var(--color-fg-muted)", "font-size": "0.8rem" }}>
        {items().length}/12
      </span>
    </span>
  );
}

export const TbInventoryTabFill: CharacterSheetTab = {
  id: qualifiedName("@vtt/system-torchbearer/tab-inventory") as CharacterSheetTab["id"],
  label: "Inventory",
  priority: 50,
  render: ({ characterId }) => InventoryTab({ characterId }),
};
