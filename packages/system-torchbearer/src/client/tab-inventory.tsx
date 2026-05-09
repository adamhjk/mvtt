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

import {
  qualifiedName,
  type CommandInstance,
  type EntityId,
} from "@vtt/substrate";
import { kit } from "@vtt/characters/client";
import type { CharacterSheetTab } from "@vtt/characters/shared";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import {
  CustomizeItem,
  DestroyItem,
  ItemBundle,
  ItemCatalogIndex,
  ItemDerivedFrom,
  ItemIdentity,
  JoinItemBundles,
  SplitItemBundle,
} from "@vtt/items/shared";

void ItemDerivedFrom;

/**
 * Is this item the canonical catalog entity for some plugin's
 * template? Catalog entities are shared across the world and must
 * never be destroyed by inventory operations — only forks of them
 * are per-character-specific and safe to delete on Remove.
 */
function isCatalogTemplate(
  world: import("@vtt/substrate").World,
  itemId: EntityId,
): boolean {
  for (const row of world.query([ItemCatalogIndex])) {
    const v = row.values.ItemCatalogIndex as {
      entries: Record<string, string>;
    };
    for (const id of Object.values(v.entries)) {
      if (id === itemId) return true;
    }
  }
  return false;
}
import { ItemIcon } from "@vtt/items/client";
import {
  DropItem,
  EquipItem,
  ItemPosition,
  MoveItem,
  PickUpItem,
  PlaceOnGround,
  RemoveFromGround,
  SetEntryState,
  TbCarries,
  TbContainer,
  TbItemSlotOptions,
  TbSupply,
  UnequipItem,
  summarizeCapacity,
  type TbBodySlot,
  type TbEquipChannelT,
} from "../shared/index.js";

/**
 * Sentinel scene id used for items dropped from the inventory tab
 * before per-scene drop coordinates exist. Every "On the Ground"
 * item lands here; future scene-floor work can route per-scene
 * drops to real scene ids.
 */
const GROUND_SCENE_ID = "world-ground";

/**
 * Inventory tab — Slot-Roof layout (design A).
 *
 * Vertical stack of body-slot panels, each grouping the items
 * currently placed there. Loose items (in inventory but not
 * placed) live in a "Loose" pool below. Items dropped on the
 * ground or marked missing get their own zones at the bottom.
 *
 * Each item row exposes `[<slot> · N]` pills for every slot in
 * its TbItemSlotOptions. Clicking a pill resolves to one or more
 * destinations:
 *
 *   - direct slots (head/neck/torso/feet/pocket/belt) → straight move
 *   - hand slots (carried/wornHand) → R / L picker
 *   - container slots (pack/pouch/quiver) → list every container
 *     of the right kind the character (or any container they
 *     hold) carries; nested containers participate
 *
 * Capacity is advisory: overfill lands and the slot panel turns
 * red so the player knows they need to shuffle. The validator
 * doesn't reject by capacity — only by slot kind / cost mismatch.
 */
function InventoryTab(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const carries = useTrait(props.characterId, TbCarries) as () =>
    | { entries: ReadonlyArray<CarryEntry> }
    | undefined;
  const entries = createMemo<ReadonlyArray<CarryEntry>>(
    () => carries()?.entries ?? [],
  );

  const liveEntries = createMemo(() =>
    entries().filter((e) => !e.state?.dropped && !e.state?.lost),
  );

  // Missing zone surfaces entries from anywhere in the character's
  // container tree (state.lost flag on the holder's TbCarries entry).
  // It stays per-character — the goblins took *your* sword, only
  // you know about it.
  const allCarries = useQuery([TbCarries]);
  const reachable = createMemo<Set<string>>(() => {
    const out = new Set<string>([props.characterId]);
    const visit = (holderId: string): void => {
      const got = client.world.get(holderId as never, [TbCarries]) as
        | { TbCarries: { entries: ReadonlyArray<{ itemId: string }> } }
        | undefined;
      if (!got) return;
      for (const e of got.TbCarries.entries) {
        if (
          client.world.get(e.itemId as never, [TbContainer]) &&
          !out.has(e.itemId)
        ) {
          out.add(e.itemId);
          visit(e.itemId);
        }
      }
    };
    visit(props.characterId);
    void allCarries();
    return out;
  });

  const missingEntries = createMemo(() => {
    const r = reachable();
    const out: Array<{ holderId: string; entry: CarryEntry; index: number }> = [];
    for (const row of allCarries()) {
      if (!r.has(row.id)) continue;
      const entries = (row.values.TbCarries as {
        entries: ReadonlyArray<CarryEntry>;
      }).entries;
      entries.forEach((entry, index) => {
        if (entry.state?.lost) {
          out.push({ holderId: row.id, entry, index });
        }
      });
    }
    return out;
  });

  // On the Ground is world-shared: every entity with an
  // ItemPosition trait shows up in every character's ground zone.
  // Anyone can pick it up via the slot pills.
  const groundItems = useQuery([ItemPosition]);
  const groundEntries = createMemo<EntityId[]>(() =>
    groundItems().map((row) => row.id as EntityId),
  );

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "0.75rem" }}>
      <CatalogQuickAdd characterId={props.characterId} />

      <For each={BODY_SLOT_PANELS}>
        {(panel) => (
          <SlotPanel
            characterId={props.characterId}
            panel={panel}
            entries={liveEntries}
          />
        )}
      </For>

      <PackPanel
        characterId={props.characterId}
        entries={liveEntries}
      />

      <LoosePanel
        characterId={props.characterId}
        entries={liveEntries}
      />

      <GroundPanel
        characterId={props.characterId}
        items={groundEntries}
      />

      <ZonePanel
        title="Missing"
        empty="Nothing missing — all your gear is accounted for."
        items={missingEntries}
        zoneKind="missing"
        permissionEntityId={props.characterId}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * CatalogQuickAdd — search the catalog, click a pill to equip
 * ----------------------------------------------------------------------- */

function CatalogQuickAdd(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const canEdit = kit.useCanEdit(props.characterId);
  const indexes = useQuery([ItemCatalogIndex]);
  const catalog = useQuery([ItemIdentity, TbItemSlotOptions, ItemDerivedFrom]);
  const [query, setQuery] = createSignal("");

  const indexed = createMemo<Set<string>>(() => {
    const out = new Set<string>();
    for (const idx of indexes()) {
      const v = idx.values.ItemCatalogIndex as { entries: Record<string, string> };
      for (const id of Object.values(v.entries)) out.add(id);
    }
    return out;
  });

  const matches = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (q.length < 2) return [] as Array<{
      id: EntityId;
      name: string;
      img: string;
      slotOptions: Record<string, number>;
    }>;
    const idxd = indexed();
    const out = catalog()
      .filter((row) => idxd.has(row.id))
      .filter((row) => {
        const ident = row.values.ItemIdentity as { name: string };
        return ident.name.toLowerCase().includes(q);
      })
      .map((row) => {
        const ident = row.values.ItemIdentity as { name: string; img: string };
        const opts = row.values.TbItemSlotOptions as { options: Record<string, number> };
        return {
          id: row.id,
          name: ident.name,
          img: ident.img,
          slotOptions: opts.options,
        };
      });
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out.slice(0, 10);
  });

  return (
    <section
      style={{
        border: "1px solid var(--color-border-muted)",
        "border-radius": "0.4rem",
        padding: "0.5rem 0.75rem",
        background: "var(--color-surface-elevated)",
      }}
    >
      <header
        style={{
          display: "flex",
          "align-items": "center",
          gap: "0.5rem",
          "margin-bottom": query().length >= 2 ? "0.4rem" : "0",
        }}
      >
        <span style={{ "font-weight": 500 }}>Add from Catalog</span>
        <input
          type="search"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          placeholder="search items…"
          autocomplete="off"
          spellcheck={false}
          name="tb-catalog-quickadd"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          data-testid="catalog-search"
          disabled={!canEdit()}
          style={{
            flex: 1,
            padding: "0.25rem 0.5rem",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            "border-radius": "0.25rem",
            "font-size": "0.85rem",
          }}
        />
      </header>
      <Show
        when={query().length >= 2}
        fallback={
          <p
            style={{
              "font-size": "0.8rem",
              color: "var(--color-fg-subtle)",
              margin: 0,
              "font-style": "italic",
            }}
          >
            type 2+ characters to search
          </p>
        }
      >
        <Show
          when={matches().length > 0}
          fallback={
            <p
              style={{
                "font-size": "0.8rem",
                color: "var(--color-fg-subtle)",
                margin: 0,
                "font-style": "italic",
              }}
            >
              no matches.
            </p>
          }
        >
          <ul
            style={{
              display: "flex",
              "flex-direction": "column",
              gap: "0.3rem",
              "list-style": "none",
              margin: 0,
              padding: 0,
            }}
          >
            <For each={matches()}>
              {(m) => (
                <CatalogRow
                  characterId={props.characterId}
                  item={m}
                />
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </section>
  );
}

function CatalogRow(props: {
  characterId: string;
  item: {
    id: EntityId;
    name: string;
    img: string;
    slotOptions: Record<string, number>;
  };
}): JSX.Element {
  const client = useClient();
  const canEdit = kit.useCanEdit(props.characterId);
  const [openPicker, setOpenPicker] = createSignal<string | null>(null);

  const dropOnGround = (): void => {
    void client.dispatch(
      PlaceOnGround({
        itemId: props.item.id,
        sceneId: GROUND_SCENE_ID,
        x: 0,
        y: 0,
      }) as CommandInstance,
    );
  };

  return (
    <li
      style={{
        display: "flex",
        "align-items": "center",
        gap: "0.5rem",
        "flex-wrap": "wrap",
      }}
    >
      <ItemIcon src={props.item.img} size={16} title={props.item.name} />
      <span style={{ "font-size": "0.9rem" }}>{props.item.name}</span>
      <span style={{ flex: 1 }} />
      <div
        style={{
          display: "flex",
          gap: "0.3rem",
          "flex-wrap": "wrap",
          position: "relative",
        }}
      >
        <For each={Object.entries(props.item.slotOptions)}>
          {([slotKey, cost]) => (
            <CatalogPill
              characterId={props.characterId as EntityId}
              itemId={props.item.id}
              slotKey={slotKey}
              slotsConsumed={cost}
              isOpen={openPicker() === slotKey}
              onToggleOpen={() =>
                setOpenPicker(openPicker() === slotKey ? null : slotKey)
              }
              onClose={() => setOpenPicker(null)}
            />
          )}
        </For>
        <Show when={canEdit()}>
          <button
            type="button"
            onClick={dropOnGround}
            data-testid={`catalog-drop-${props.item.id}`}
            style={{
              "font-size": "0.75rem",
              padding: "0.15rem 0.5rem",
              border: "1px dashed var(--color-border)",
              background: "transparent",
              color: "var(--color-fg-muted)",
              "border-radius": "0.25rem",
              cursor: "pointer",
            }}
            title="Drop directly on the ground (loot for the team)"
          >
            drop
          </button>
        </Show>
      </div>
    </li>
  );
}

function CatalogPill(props: {
  characterId: EntityId;
  itemId: EntityId;
  slotKey: string;
  slotsConsumed: number;
  isOpen: boolean;
  onToggleOpen: () => void;
  onClose: () => void;
}): JSX.Element {
  const client = useClient();
  const canEdit = kit.useCanEdit(props.characterId);

  // Build a synthetic "entry" for destination resolution so the same
  // resolveDestinations() machinery powers both equip-from-catalog
  // and move-existing flows.
  const syntheticEntry: CarryEntry = {
    slot: "",
    slotIndex: 0,
    channel: "default",
    slotsConsumed: props.slotsConsumed,
    itemId: props.itemId,
    quantity: 1,
  };

  const destinations = createMemo(() =>
    resolveDestinations({
      world: client.world,
      characterId: props.characterId,
      entry: syntheticEntry,
      slotKey: props.slotKey,
      slotsConsumed: props.slotsConsumed,
    }),
  );

  const equip = (dest: Destination): void => {
    void client.dispatch(
      EquipItem({
        holderId: dest.holderId,
        itemId: props.itemId,
        slot: dest.slot,
        slotIndex: 0,
        channel: dest.channel,
        slotsConsumed: props.slotsConsumed,
        quantity: 1,
      }) as CommandInstance,
    );
    props.onClose();
  };

  const onClick = (): void => {
    if (!canEdit()) return;
    const dests = destinations();
    if (dests.length === 0) return;
    if (dests.length === 1) {
      equip(dests[0]!);
      return;
    }
    props.onToggleOpen();
  };

  let pillRef: HTMLButtonElement | undefined;
  const onDocClick = (e: MouseEvent): void => {
    if (!props.isOpen) return;
    if (!pillRef) return;
    const target = e.target as Node | null;
    if (target && pillRef.parentElement?.contains(target)) return;
    props.onClose();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("click", onDocClick);
    onCleanup(() => document.removeEventListener("click", onDocClick));
  }

  return (
    <span style={{ position: "relative" }}>
      <button
        ref={pillRef}
        type="button"
        onClick={onClick}
        disabled={!canEdit() || destinations().length === 0}
        data-testid={`catalog-pill-${props.itemId}-${props.slotKey}`}
        style={{
          "font-size": "0.75rem",
          padding: "0.15rem 0.5rem",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          color: "var(--color-fg)",
          "border-radius": "0.25rem",
          cursor:
            canEdit() && destinations().length > 0 ? "pointer" : "default",
        }}
        title={
          destinations().length === 0
            ? "No valid destination — equip a container or free up a hand"
            : `Equip into ${props.slotKey}`
        }
      >
        {slotShortLabel(props.slotKey)}·{props.slotsConsumed}
        {destinations().length > 1 ? " ▾" : ""}
      </button>
      <Show when={props.isOpen}>
        <SlotPicker
          destinations={destinations()}
          onPick={equip}
          slotsConsumed={props.slotsConsumed}
          world={client.world}
        />
      </Show>
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Types
 * ----------------------------------------------------------------------- */

interface CarryEntry {
  slot: TbBodySlot | string;
  slotIndex: number;
  channel: TbEquipChannelT;
  slotsConsumed: number;
  itemId: EntityId;
  quantity: number;
  label?: string;
  state?: {
    damaged?: boolean;
    dropped?: boolean;
    lit?: boolean;
    turnsRemaining?: number;
    spent?: boolean;
    lost?: boolean;
  };
}

function entriesWithIndex(
  all: ReadonlyArray<CarryEntry>,
  pred: (e: CarryEntry) => boolean,
): Array<{ entry: CarryEntry; index: number }> {
  const out: Array<{ entry: CarryEntry; index: number }> = [];
  all.forEach((entry, index) => {
    if (pred(entry)) out.push({ entry, index });
  });
  return out;
}

interface BodySlotPanel {
  slot: TbBodySlot;
  channel: TbEquipChannelT;
  label: string;
}

const BODY_SLOT_PANELS: ReadonlyArray<BodySlotPanel> = [
  { slot: "head", channel: "default", label: "Head" },
  { slot: "neck", channel: "default", label: "Neck" },
  { slot: "handR", channel: "carried", label: "Right Hand · carried" },
  { slot: "handR", channel: "worn", label: "Right Hand · worn" },
  { slot: "handL", channel: "carried", label: "Left Hand · carried" },
  { slot: "handL", channel: "worn", label: "Left Hand · worn" },
  { slot: "torso", channel: "default", label: "Torso" },
  { slot: "belt", channel: "default", label: "Belt" },
  { slot: "feet", channel: "default", label: "Feet" },
  { slot: "pocket", channel: "default", label: "Pocket" },
];

/* -------------------------------------------------------------------------
 * SlotPanel — one body location with its current occupants + capacity
 * ----------------------------------------------------------------------- */

function SlotPanel(props: {
  characterId: string;
  panel: BodySlotPanel;
  entries: () => ReadonlyArray<CarryEntry>;
}): JSX.Element {
  const client = useClient();
  // Read TbCarries reactively so the memos below re-run when the
  // holder's carries change (entries added, slots flipped, items
  // moved). `summarizeCapacity` reads the same trait off the world
  // imperatively; without this subscription, the cap() memo would
  // freeze at its first computed value and only refresh on a hard
  // reload.
  const holderCarries = useTrait(props.characterId, TbCarries);
  const occupants = createMemo(() => {
    holderCarries(); // observe
    const want = props.panel;
    const all = props.entries();
    return all
      .map((e, idx) => ({ entry: e, index: indexOf(all, idx) }))
      .filter((e) => {
        const channelMatches =
          want.channel === "default"
            ? e.entry.channel === "default" || e.entry.channel === undefined
            : e.entry.channel === want.channel;
        if (!channelMatches) return false;
        // Direct match on the panel's slot.
        if (e.entry.slot === want.slot) return true;
        // Two-handed entries (slot="hands") appear in BOTH hand
        // panels of the matching channel — that's the whole point
        // of a "both hands" placement: each hand is occupied.
        if (
          e.entry.slot === "hands" &&
          (want.slot === "handR" || want.slot === "handL")
        ) {
          return true;
        }
        return false;
      });
  });
  const cap = createMemo(() => {
    holderCarries(); // observe
    return summarizeCapacity({
      world: client.world,
      holderId: props.characterId,
      slot: props.panel.slot,
      channel: props.panel.channel,
    });
  });
  const isOverfull = createMemo(() => {
    const c = cap();
    return c.limit !== null && c.used > c.limit;
  });
  return (
    <section
      class="vk-slot-panel"
      data-overfull={isOverfull() ? "true" : "false"}
      style={{
        border: `1px solid ${
          isOverfull()
            ? "var(--color-danger)"
            : "var(--color-border-muted)"
        }`,
        "border-radius": "0.4rem",
        padding: "0.5rem 0.75rem",
        background: isOverfull()
          ? "color-mix(in srgb, var(--color-danger) 8%, var(--color-surface-elevated))"
          : "var(--color-surface-elevated)",
      }}
    >
      <header
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          "margin-bottom": occupants().length > 0 ? "0.4rem" : "0",
        }}
      >
        <span style={{ "font-weight": 500 }}>{props.panel.label}</span>
        <span
          style={{
            "font-size": "0.75rem",
            color: isOverfull()
              ? "var(--color-danger)"
              : "var(--color-fg-subtle)",
          }}
        >
          {cap().used}
          {cap().limit !== null ? `/${cap().limit}` : ""}
          {isOverfull() ? " ⚠" : ""}
        </span>
      </header>
      <Show
        when={occupants().length > 0}
        fallback={
          <span
            style={{
              "font-size": "0.85rem",
              color: "var(--color-fg-subtle)",
              "font-style": "italic",
            }}
          >
            empty
          </span>
        }
      >
        <ul
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "0.4rem",
            "list-style": "none",
            margin: 0,
            padding: 0,
          }}
        >
          <For each={occupants()}>
            {(o) => (
              <ItemRow
                characterId={props.characterId}
                entry={o.entry}
                entryIndex={o.index}
              />
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * PackPanel — every container the character holds, plus its contents
 * ----------------------------------------------------------------------- */

function PackPanel(props: {
  characterId: string;
  entries: () => ReadonlyArray<CarryEntry>;
}): JSX.Element {
  const client = useClient();
  const containers = createMemo(() =>
    props.entries()
      .filter((e) => Boolean(client.world.get(e.itemId, [TbContainer])))
      .map((e) => e.itemId),
  );
  return (
    <Show when={containers().length > 0}>
      <For each={containers()}>
        {(cid) => (
          <ContainerPanel
            containerId={cid}
            permissionEntityId={props.characterId}
          />
        )}
      </For>
    </Show>
  );
}

function ContainerPanel(props: {
  containerId: EntityId;
  permissionEntityId?: string;
}): JSX.Element {
  const client = useClient();
  const ident = useTrait(props.containerId, ItemIdentity) as () =>
    | { name: string; img: string }
    | undefined;
  const carries = useTrait(props.containerId, TbCarries) as () =>
    | { entries: ReadonlyArray<CarryEntry> }
    | undefined;
  const containerInfo = useTrait(props.containerId, TbContainer) as () =>
    | { containerType: string; containerSlots: number }
    | undefined;
  const entries = createMemo(() => carries()?.entries ?? []);
  const live = createMemo(() =>
    entries().filter((e) => !e.state?.dropped && !e.state?.lost),
  );
  const cap = createMemo(() => {
    carries(); // observe the trait so this recomputes on every change
    return summarizeCapacity({
      world: client.world,
      holderId: props.containerId,
      slot: `container:${props.containerId}`,
      channel: "default",
    });
  });
  const isOverfull = createMemo(
    () => cap().limit !== null && cap().used > (cap().limit ?? 0),
  );
  return (
    <section
      style={{
        border: `1px solid ${
          isOverfull()
            ? "var(--color-danger)"
            : "var(--color-border-muted)"
        }`,
        "border-radius": "0.4rem",
        padding: "0.5rem 0.75rem",
        background: isOverfull()
          ? "color-mix(in srgb, var(--color-danger) 8%, var(--color-surface-elevated))"
          : "var(--color-surface-elevated)",
      }}
    >
      <header
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          "margin-bottom": live().length > 0 ? "0.4rem" : "0",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            "align-items": "center",
            gap: "0.4rem",
            "font-weight": 500,
          }}
        >
          <ItemIcon src={ident()?.img ?? ""} size={16} />
          {ident()?.name ?? "Container"}
          <small
            style={{
              "font-weight": 400,
              color: "var(--color-fg-subtle)",
              "font-size": "0.75rem",
            }}
          >
            ({containerInfo()?.containerType ?? "container"})
          </small>
        </span>
        <span
          style={{
            "font-size": "0.75rem",
            color: isOverfull()
              ? "var(--color-danger)"
              : "var(--color-fg-subtle)",
          }}
        >
          {cap().used}
          {cap().limit !== null ? `/${cap().limit}` : ""}
          {isOverfull() ? " ⚠" : ""}
        </span>
      </header>
      <Show
        when={live().length > 0}
        fallback={
          <span
            style={{
              "font-size": "0.85rem",
              color: "var(--color-fg-subtle)",
              "font-style": "italic",
            }}
          >
            empty
          </span>
        }
      >
        <ul
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "0.4rem",
            "list-style": "none",
            margin: 0,
            padding: 0,
          }}
        >
          <For each={live()}>
            {(e) => (
              <ItemRow
                characterId={props.containerId}
                permissionEntityId={props.permissionEntityId}
                entry={e}
                entryIndex={entries().indexOf(e)}
              />
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * LoosePanel — items not currently equipped or dropped
 * ----------------------------------------------------------------------- */

function LoosePanel(props: {
  characterId: string;
  entries: () => ReadonlyArray<CarryEntry>;
}): JSX.Element {
  // For now, a "loose" item is one whose slot starts with "loose:"
  // (a synthetic placement we use to stage items the player has
  // but hasn't equipped to a body slot). Future: a separate list
  // attached to the character. We render the section even if empty
  // so users can see the affordance.
  return (
    <section
      style={{
        border: "1px dashed var(--color-border-muted)",
        "border-radius": "0.4rem",
        padding: "0.5rem 0.75rem",
        background: "transparent",
      }}
    >
      <header
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          "margin-bottom": "0.4rem",
          color: "var(--color-fg-subtle)",
          "font-size": "0.85rem",
        }}
      >
        <span>Loose</span>
        <span style={{ "font-size": "0.75rem" }}>
          unequipped items the character is still holding
        </span>
      </header>
      <Show
        when={loose(props.entries()).length > 0}
        fallback={
          <span
            style={{
              "font-size": "0.85rem",
              color: "var(--color-fg-subtle)",
              "font-style": "italic",
            }}
          >
            none
          </span>
        }
      >
        <ul
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "0.4rem",
            "list-style": "none",
            margin: 0,
            padding: 0,
          }}
        >
          <For each={loose(props.entries())}>
            {(o) => (
              <ItemRow
                characterId={props.characterId}
                entry={o.entry}
                entryIndex={o.index}
              />
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function loose(
  all: ReadonlyArray<CarryEntry>,
): Array<{ entry: CarryEntry; index: number }> {
  return all
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.slot.startsWith("loose:"));
}

/* -------------------------------------------------------------------------
 * ContainerPeek — read-only expand-out of a container's contents.
 * Used inside Dropped / Missing / Ground rows so the player can see
 * what's inside a closed container without picking it up. Recursive
 * so a sack-inside-a-backpack expands too. Lives next to inventory
 * rendering helpers; no slot pills or actions — just names + bundle
 * counts + nested expanders.
 * ----------------------------------------------------------------------- */

function containerHasLiveContents(
  world: import("@vtt/substrate").World,
  itemId: EntityId,
): boolean {
  if (!world.get(itemId, [TbContainer])) return false;
  const got = world.get(itemId, [TbCarries]) as
    | { TbCarries: { entries: ReadonlyArray<{ state?: { dropped?: boolean; lost?: boolean } }> } }
    | undefined;
  if (!got) return false;
  return got.TbCarries.entries.some(
    (e) => !e.state?.dropped && !e.state?.lost,
  );
}

function ContainerPeek(props: { containerId: EntityId }): JSX.Element {
  const carries = useTrait(props.containerId, TbCarries) as () =>
    | { entries: ReadonlyArray<CarryEntry> }
    | undefined;
  const visible = createMemo(() => {
    const all = carries()?.entries ?? [];
    return all.filter((e) => !e.state?.dropped && !e.state?.lost);
  });
  return (
    <ul
      data-testid={`peek-${props.containerId}`}
      style={{
        "list-style": "none",
        margin: "0.2rem 0 0 1.4rem",
        padding: "0.25rem 0.5rem",
        "border-left": "2px solid var(--color-border-muted)",
        display: "flex",
        "flex-direction": "column",
        gap: "0.15rem",
        "font-size": "0.8rem",
      }}
    >
      <Show
        when={visible().length > 0}
        fallback={
          <li style={{ color: "var(--color-fg-subtle)", "font-style": "italic" }}>
            empty
          </li>
        }
      >
        <For each={visible()}>
          {(entry) => <PeekRow entry={entry} />}
        </For>
      </Show>
    </ul>
  );
}

function PeekRow(props: { entry: CarryEntry }): JSX.Element {
  const client = useClient();
  const ident = useTrait(props.entry.itemId, ItemIdentity) as () =>
    | { name: string; img: string }
    | undefined;
  const bundle = useTrait(props.entry.itemId, ItemBundle) as () =>
    | { count: number; capacity: number }
    | undefined;
  const isContainer = createMemo(() =>
    !!client.world.get(props.entry.itemId, [TbContainer]),
  );
  const hasContents = createMemo(() =>
    containerHasLiveContents(client.world, props.entry.itemId as EntityId),
  );
  const [open, setOpen] = createSignal(false);
  return (
    <li
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.15rem",
      }}
    >
      <span style={{ display: "flex", "align-items": "center", gap: "0.4rem" }}>
        <Show
          when={isContainer() && hasContents()}
          fallback={<span style={{ width: "1em", display: "inline-block" }} />}
        >
          <button
            type="button"
            onClick={() => setOpen(!open())}
            data-testid={`peek-toggle-${props.entry.itemId}`}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              "font-size": "0.7rem",
              cursor: "pointer",
              color: "inherit",
              width: "1em",
            }}
            title={open() ? "Collapse" : "Expand to peek inside"}
          >
            {open() ? "▼" : "▶"}
          </button>
        </Show>
        <ItemIcon src={ident()?.img ?? ""} size={14} />
        <span>{ident()?.name ?? "item"}</span>
        <Show when={bundle()}>
          <small style={{ color: "var(--color-fg-subtle)" }}>
            ×{bundle()!.count}/{bundle()!.capacity}
          </small>
        </Show>
        <Show when={isContainer() && !hasContents()}>
          <small style={{ color: "var(--color-fg-subtle)", "font-style": "italic" }}>
            empty
          </small>
        </Show>
      </span>
      <Show when={open() && isContainer() && hasContents()}>
        <ContainerPeek containerId={props.entry.itemId as EntityId} />
      </Show>
    </li>
  );
}

/* -------------------------------------------------------------------------
 * GroundPanel — world-shared "On the Ground" zone. Every entity
 * with an ItemPosition trait surfaces here for every character.
 * Click a slot pill to dispatch PickUpItem against the current
 * character; the item leaves the ground and lands in the chosen
 * destination.
 * ----------------------------------------------------------------------- */

function GroundPanel(props: {
  characterId: string;
  items: () => ReadonlyArray<EntityId>;
}): JSX.Element {
  return (
    <section
      style={{
        border: "1px solid var(--color-border-muted)",
        "border-radius": "0.4rem",
        padding: "0.5rem 0.75rem",
        background: "var(--color-surface-elevated)",
      }}
    >
      <header
        style={{
          "margin-bottom": props.items().length > 0 ? "0.4rem" : "0",
          "font-weight": 500,
        }}
      >
        On the Ground
      </header>
      <Show
        when={props.items().length > 0}
        fallback={
          <span
            style={{
              "font-size": "0.85rem",
              color: "var(--color-fg-subtle)",
              "font-style": "italic",
            }}
          >
            Nothing on the ground.
          </span>
        }
      >
        <ul
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "0.4rem",
            "list-style": "none",
            margin: 0,
            padding: 0,
          }}
        >
          <For each={props.items()}>
            {(itemId) => (
              <GroundItemRow
                characterId={props.characterId as EntityId}
                itemId={itemId}
              />
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function GroundItemRow(props: {
  characterId: EntityId;
  itemId: EntityId;
}): JSX.Element {
  const client = useClient();
  const canEdit = kit.useCanEdit(props.characterId);
  const ident = useTrait(props.itemId, ItemIdentity) as () =>
    | { name: string; img: string }
    | undefined;
  const slotOpts = useTrait(props.itemId, TbItemSlotOptions) as () =>
    | { options: Record<string, number> }
    | undefined;
  // Subscribe to the ground item's TbCarries so the peek toggle re-
  // renders if its contents change.
  const groundCarries = useTrait(props.itemId, TbCarries) as () =>
    | { entries: ReadonlyArray<CarryEntry> }
    | undefined;
  const peekable = createMemo(() => {
    void groundCarries();
    return containerHasLiveContents(client.world, props.itemId);
  });
  const [openPicker, setOpenPicker] = createSignal<string | null>(null);
  const [peekOpen, setPeekOpen] = createSignal(false);

  const removeFromGround = (): void => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Remove "${ident()?.name ?? "item"}" from the ground?`,
      )
    ) {
      return;
    }
    void client.dispatch(
      RemoveFromGround({ itemId: props.itemId }) as CommandInstance,
    );
    // Same rule as inventory Remove: destroy the entity unless it's
    // a shared catalog template. Drop-from-catalog auto-forks
    // containers but plain `gear`-shaped catalog items reach the
    // ground as the catalog entity itself; leave those alone.
    if (!isCatalogTemplate(client.world, props.itemId)) {
      void client.dispatch(
        DestroyItem({ itemId: props.itemId }) as CommandInstance,
      );
    }
  };

  return (
    <li
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.3rem",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "0.5rem",
          "flex-wrap": "wrap",
        }}
      >
        <Show when={peekable()}>
          <button
            type="button"
            onClick={() => setPeekOpen(!peekOpen())}
            data-testid={`peek-toggle-ground-${props.itemId}`}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              "font-size": "0.8rem",
              cursor: "pointer",
              color: "inherit",
              width: "1em",
            }}
            title={peekOpen() ? "Collapse" : "Peek inside"}
          >
            {peekOpen() ? "▼" : "▶"}
          </button>
        </Show>
        <ItemIcon src={ident()?.img ?? ""} size={18} title={ident()?.name} />
        <span
          style={{
            "font-weight": 500,
            "font-size": "0.9rem",
          }}
          data-testid={`ground-item-${props.itemId}`}
        >
          {ident()?.name ?? "item"}
        </span>
        <span style={{ flex: 1 }} />
        <Show when={canEdit()}>
          <button
            type="button"
            onClick={removeFromGround}
            data-testid={`ground-remove-${props.itemId}`}
            style={{
              ...tinyButton(),
              color: "var(--color-fg-muted)",
            }}
            title="Remove from the ground (item stays in the world's item registry)"
          >
            Remove
          </button>
        </Show>
      </div>
      <div
        style={{
          display: "flex",
          gap: "0.3rem",
          "flex-wrap": "wrap",
          position: "relative",
        }}
      >
        <For each={Object.entries(slotOpts()?.options ?? {})}>
          {([slotKey, cost]) => (
            <GroundSlotPill
              characterId={props.characterId}
              itemId={props.itemId}
              slotKey={slotKey}
              slotsConsumed={cost}
              isOpen={openPicker() === slotKey}
              onToggleOpen={() =>
                setOpenPicker(openPicker() === slotKey ? null : slotKey)
              }
              onClose={() => setOpenPicker(null)}
            />
          )}
        </For>
      </div>
      <Show when={peekOpen() && peekable()}>
        <ContainerPeek containerId={props.itemId} />
      </Show>
    </li>
  );
}

function GroundSlotPill(props: {
  characterId: EntityId;
  itemId: EntityId;
  slotKey: string;
  slotsConsumed: number;
  isOpen: boolean;
  onToggleOpen: () => void;
  onClose: () => void;
}): JSX.Element {
  const client = useClient();
  const canEdit = kit.useCanEdit(props.characterId);

  // Synthetic "off-character" entry purely so resolveDestinations
  // can use the same machinery; the entry has no current home, so
  // every pill click is a fresh placement.
  const syntheticEntry: CarryEntry = {
    slot: "",
    slotIndex: 0,
    channel: "default",
    slotsConsumed: props.slotsConsumed,
    itemId: props.itemId,
    quantity: 1,
  };

  const destinations = createMemo(() =>
    resolveDestinations({
      world: client.world,
      characterId: props.characterId,
      entry: syntheticEntry,
      slotKey: props.slotKey,
      slotsConsumed: props.slotsConsumed,
    }),
  );

  const pickUp = (dest: Destination): void => {
    // For body-slot destinations, dispatch PickUpItem so the server
    // clears Position and creates a new TbCarries entry. For
    // container destinations, the same flow works — the destination's
    // holder is the container, and PickUpItem's validate accepts
    // any item with non-empty slotOptions.
    void client.dispatch(
      PickUpItem({
        holderId: dest.holderId,
        itemId: props.itemId,
        slot: dest.slot,
        slotIndex: 0,
        channel: dest.channel,
        slotsConsumed: props.slotsConsumed,
        quantity: 1,
      }) as CommandInstance,
    );
    props.onClose();
  };

  const onClick = (): void => {
    if (!canEdit()) return;
    const dests = destinations();
    if (dests.length === 0) return;
    if (dests.length === 1) {
      pickUp(dests[0]!);
      return;
    }
    props.onToggleOpen();
  };

  let pillRef: HTMLButtonElement | undefined;
  const onDocClick = (e: MouseEvent): void => {
    if (!props.isOpen) return;
    if (!pillRef) return;
    const target = e.target as Node | null;
    if (target && pillRef.parentElement?.contains(target)) return;
    props.onClose();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("click", onDocClick);
    onCleanup(() => document.removeEventListener("click", onDocClick));
  }

  return (
    <span style={{ position: "relative" }}>
      <button
        ref={pillRef}
        type="button"
        onClick={onClick}
        disabled={!canEdit() || destinations().length === 0}
        data-testid={`ground-pill-${props.itemId}-${props.slotKey}`}
        style={{
          "font-size": "0.75rem",
          padding: "0.15rem 0.5rem",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          color: "var(--color-fg)",
          "border-radius": "0.25rem",
          cursor:
            canEdit() && destinations().length > 0 ? "pointer" : "default",
        }}
      >
        {slotShortLabel(props.slotKey)}·{props.slotsConsumed}
        {destinations().length > 1 ? " ▾" : ""}
      </button>
      <Show when={props.isOpen}>
        <SlotPicker
          destinations={destinations()}
          onPick={pickUp}
          slotsConsumed={props.slotsConsumed}
          world={client.world}
        />
      </Show>
    </span>
  );
}

/* -------------------------------------------------------------------------
 * ZonePanel — Dropped / Missing list. Items keep their slot-option
 * pills so the player can put them back where they want by clicking
 * a pill. The pill click also clears the dropped/lost flag.
 * ----------------------------------------------------------------------- */

function ZonePanel(props: {
  title: string;
  empty: string;
  items: () => ReadonlyArray<{
    holderId: string;
    entry: CarryEntry;
    index: number;
  }>;
  zoneKind: "dropped" | "missing";
  permissionEntityId: string;
}): JSX.Element {
  return (
    <section
      style={{
        border: "1px solid var(--color-border-muted)",
        "border-radius": "0.4rem",
        padding: "0.5rem 0.75rem",
        background: "var(--color-surface-elevated)",
      }}
    >
      <header
        style={{
          "margin-bottom": props.items().length > 0 ? "0.4rem" : "0",
          "font-weight": 500,
        }}
      >
        {props.title}
      </header>
      <Show
        when={props.items().length > 0}
        fallback={
          <span
            style={{
              "font-size": "0.85rem",
              color: "var(--color-fg-subtle)",
              "font-style": "italic",
            }}
          >
            {props.empty}
          </span>
        }
      >
        <ul
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "0.4rem",
            "list-style": "none",
            margin: 0,
            padding: 0,
          }}
        >
          <For each={props.items()}>
            {(o) => (
              <ItemRow
                characterId={o.holderId}
                permissionEntityId={props.permissionEntityId}
                entry={o.entry}
                entryIndex={o.index}
                clearOnPlace={props.zoneKind}
              />
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * ItemRow — one occupant inside any panel
 * ----------------------------------------------------------------------- */

function ItemRow(props: {
  /** The TbCarries holder this entry lives on — character or container. */
  characterId: EntityId | string;
  /**
   * The actual *character* the inventory tab is rendering for —
   * used for two things:
   *   - permission checks (containers don't carry the Character /
   *     Permissions traits the kit's `useCanEdit` consults), and
   *   - resolving slot-pill destinations against the character's
   *     body slots and container tree, regardless of where the
   *     entry currently lives. Without this, dropping an item
   *     that was inside a backpack would route the carry/pack
   *     pills back to the *backpack's* nonexistent body slots
   *     instead of the character's.
   *
   * Defaults to `characterId` for the simple case (entry on the
   * character's own TbCarries).
   */
  permissionEntityId?: EntityId | string;
  entry: CarryEntry;
  entryIndex: number;
  /**
   * When this row sits in a Dropped or Missing zone, clicking a pill
   * to relocate it should also clear the `dropped` / `lost` flag so
   * the entry returns to active inventory at the chosen slot. This
   * prop tells the row which flag to clear on placement; "none"
   * (default) means no extra side-effect.
   */
  clearOnPlace?: "dropped" | "missing";
}): JSX.Element {
  const client = useClient();
  const characterEntityId = (props.permissionEntityId ?? props.characterId) as
    | EntityId
    | string;
  const canEdit = kit.useCanEdit(characterEntityId);
  const ident = useTrait(props.entry.itemId, ItemIdentity) as () =>
    | { name: string; img: string }
    | undefined;
  const slotOpts = useTrait(props.entry.itemId, TbItemSlotOptions) as () =>
    | { options: Record<string, number> }
    | undefined;
  const bundle = useTrait(props.entry.itemId, ItemBundle) as () =>
    | { count: number; capacity: number }
    | undefined;
  const supply = useTrait(props.entry.itemId, TbSupply) as () =>
    | {
        supplyType: string;
        turnsRemaining: number;
        lit: boolean;
        nameSingular: string;
      }
    | undefined;
  const isLightSource = createMemo(() => supply()?.supplyType === "light");
  // A torch stowed in a backpack can't be lit — same rule the
  // SetEntryState validator enforces. UI disables the button so
  // there's no failed-dispatch round-trip; the validator is the
  // authority.
  const isStowed = createMemo(() =>
    typeof props.entry.slot === "string" &&
    props.entry.slot.startsWith("container:"),
  );
  const carries = useTrait(props.characterId, TbCarries) as () =>
    | { entries: ReadonlyArray<CarryEntry> }
    | undefined;
  // Subscribe to the item's own TbCarries so the peek toggle re-
  // renders when the contents change (a torch consumed, a sack
  // forked into the bag, etc.).
  const itemCarries = useTrait(props.entry.itemId, TbCarries) as () =>
    | { entries: ReadonlyArray<CarryEntry> }
    | undefined;
  const isContainer = createMemo(() =>
    !!client.world.get(props.entry.itemId, [TbContainer]),
  );
  const peekable = createMemo(() => {
    void itemCarries();
    return isContainer() &&
      containerHasLiveContents(client.world, props.entry.itemId);
  });
  const [openPicker, setOpenPicker] = createSignal<string | null>(null);
  const [peekOpen, setPeekOpen] = createSignal(false);

  // Display-only "Backpack #2" suffix when the same item entity
  // appears more than once in the holder's inventory. The user can
  // override this by setting a `label` on the entry; otherwise we
  // derive it from "this entry's ordinal among entries with the
  // same itemId."
  const displayName = createMemo<string>(() => {
    if (props.entry.label && props.entry.label.length > 0) {
      return props.entry.label;
    }
    const baseName = ident()?.name ?? "item";
    const all = carries()?.entries ?? [];
    const sameItem: number[] = [];
    all.forEach((e, idx) => {
      if (e.itemId === props.entry.itemId) sameItem.push(idx);
    });
    if (sameItem.length <= 1) return baseName;
    const ordinal = sameItem.indexOf(props.entryIndex) + 1;
    return ordinal > 0 ? `${baseName} #${ordinal}` : baseName;
  });

  const dropEntry = (): void => {
    // DropItem removes the entry from the holder and stamps an
    // ItemPosition on the item. The world-shared "On the Ground"
    // zone scans every entity with ItemPosition, so dropped loot
    // is visible to every character at the table.
    void client.dispatch(
      DropItem({
        holderId: props.characterId as EntityId,
        entryIndex: props.entryIndex,
        sceneId: GROUND_SCENE_ID,
        x: 0,
        y: 0,
      }) as CommandInstance,
    );
  };
  const markMissing = (): void => {
    void client.dispatch(
      SetEntryState({
        holderId: props.characterId as EntityId,
        entryIndex: props.entryIndex,
        state: { lost: true },
      }) as CommandInstance,
    );
  };
  const customize = (): void => {
    void client.dispatch(
      CustomizeItem({ sourceItemId: props.entry.itemId }) as CommandInstance,
    );
  };
  const splitOne = (): void => {
    const got = bundle();
    if (!got || got.count <= 1) return;
    void client.dispatch(
      SplitItemBundle({
        itemId: props.entry.itemId,
        count: 1,
      }) as CommandInstance,
    );
  };
  const lightUp = (): void => {
    const s = supply();
    if (!s) return;
    // Re-lighting a doused source preserves whatever fuel is left
    // on the entry (douse keeps state.turnsRemaining as-is). A
    // never-lit or freshly-customized entry has 0/undefined turns
    // here, so we fall back to the supply's per-unit default.
    const remaining = props.entry.state?.turnsRemaining ?? 0;
    const turns = remaining > 0 ? remaining : s.turnsRemaining;
    void client.dispatch(
      SetEntryState({
        holderId: props.characterId as EntityId,
        entryIndex: props.entryIndex,
        state: { lit: true, turnsRemaining: turns, spent: false },
      }) as CommandInstance,
    );
  };
  const douse = (): void => {
    void client.dispatch(
      SetEntryState({
        holderId: props.characterId as EntityId,
        entryIndex: props.entryIndex,
        state: { lit: false },
      }) as CommandInstance,
    );
  };
  const setTurns = (next: number): void => {
    const clamped = Math.max(0, Math.min(99, Math.floor(next)));
    void client.dispatch(
      SetEntryState({
        holderId: props.characterId as EntityId,
        entryIndex: props.entryIndex,
        state: { turnsRemaining: clamped },
      }) as CommandInstance,
    );
  };

  // Find sibling entries on the same holder whose item entity is a
  // bundle-compatible peer of this row's item: same catalog
  // templateId (if both are catalog-derived), else same identity
  // name. The destination must have headroom (`count < capacity`).
  const mergeTargets = createMemo<
    Array<{ entryIndex: number; itemId: EntityId; ordinal: number }>
  >(() => {
    const got = bundle();
    if (!got) return [];
    const all = carries()?.entries ?? [];
    const myDerived = client.world.get(props.entry.itemId, [
      ItemDerivedFrom,
    ]) as { ItemDerivedFrom: { templateId: string } } | undefined;
    const myIdent = ident();
    const sameByItemId = new Map<string, number[]>();
    all.forEach((e, idx) => {
      const arr = sameByItemId.get(e.itemId) ?? [];
      arr.push(idx);
      sameByItemId.set(e.itemId, arr);
    });
    const out: Array<{ entryIndex: number; itemId: EntityId; ordinal: number }> = [];
    for (let i = 0; i < all.length; i++) {
      if (i === props.entryIndex) continue;
      const e = all[i]!;
      if (e.itemId === props.entry.itemId) continue;
      const peerBundle = client.world.get(e.itemId as EntityId, [ItemBundle]) as
        | { ItemBundle: { count: number; capacity: number } }
        | undefined;
      if (!peerBundle) continue;
      if (peerBundle.ItemBundle.count >= peerBundle.ItemBundle.capacity) continue;
      const peerDerived = client.world.get(e.itemId as EntityId, [
        ItemDerivedFrom,
      ]) as { ItemDerivedFrom: { templateId: string } } | undefined;
      let compatible = false;
      if (myDerived && peerDerived) {
        compatible =
          myDerived.ItemDerivedFrom.templateId ===
          peerDerived.ItemDerivedFrom.templateId;
      } else if (!myDerived && !peerDerived) {
        const peerIdent = client.world.get(e.itemId as EntityId, [ItemIdentity]) as
          | { ItemIdentity: { name: string } }
          | undefined;
        compatible = !!myIdent && !!peerIdent &&
          myIdent.name === peerIdent.ItemIdentity.name;
      }
      if (!compatible) continue;
      const sameAll = sameByItemId.get(e.itemId) ?? [];
      const ordinal =
        sameAll.length > 1 ? sameAll.indexOf(i) + 1 : 0;
      out.push({ entryIndex: i, itemId: e.itemId as EntityId, ordinal });
    }
    return out;
  });

  const combineInto = (destItemId: EntityId): void => {
    void client.dispatch(
      JoinItemBundles({
        srcId: props.entry.itemId,
        destId: destItemId,
      }) as CommandInstance,
    );
    setCombineOpen(false);
  };

  const [combineOpen, setCombineOpen] = createSignal(false);
  const removeFromInventory = (): void => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Remove "${displayName()}" from inventory?`)
    ) {
      return;
    }
    // Detach the entry from the holder.
    void client.dispatch(
      UnequipItem({
        holderId: props.characterId as EntityId,
        entryIndex: props.entryIndex,
      }) as CommandInstance,
    );
    // Destroy the entity unless it's a shared catalog template —
    // forks and ad-hoc items carry per-instance data that no other
    // character should inherit, so cleaning them up here matches
    // the user's intent ("the pointer's specific data is gone").
    // Catalog templates are world-shared and must survive the
    // remove so other characters keep their copies.
    if (!isCatalogTemplate(client.world, props.entry.itemId)) {
      void client.dispatch(
        DestroyItem({ itemId: props.entry.itemId }) as CommandInstance,
      );
    }
  };

  const onPlaced = (): void => {
    // When the row is in the Dropped / Missing zone, placing an
    // item via a pill click should also clear that state flag.
    if (props.clearOnPlace === "dropped") {
      void client.dispatch(
        SetEntryState({
          holderId: props.characterId as EntityId,
          entryIndex: props.entryIndex,
          state: { dropped: false },
        }) as CommandInstance,
      );
    } else if (props.clearOnPlace === "missing") {
      void client.dispatch(
        SetEntryState({
          holderId: props.characterId as EntityId,
          entryIndex: props.entryIndex,
          state: { lost: false },
        }) as CommandInstance,
      );
    }
  };

  return (
    <li
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.3rem",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "0.5rem",
          "flex-wrap": "wrap",
        }}
      >
        <Show when={peekable() && (props.clearOnPlace === "dropped" || props.clearOnPlace === "missing")}>
          <button
            type="button"
            onClick={() => setPeekOpen(!peekOpen())}
            data-testid={`peek-toggle-row-${props.entry.itemId}-${props.entryIndex}`}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              "font-size": "0.8rem",
              cursor: "pointer",
              color: "inherit",
              width: "1em",
            }}
            title={peekOpen() ? "Collapse" : "Peek inside"}
          >
            {peekOpen() ? "▼" : "▶"}
          </button>
        </Show>
        <ItemIcon src={ident()?.img ?? ""} size={18} title={ident()?.name} />
        <span
          style={{
            "font-weight": 500,
            "font-size": "0.9rem",
          }}
          data-testid={`item-name-${props.entry.itemId}-${props.entryIndex}`}
        >
          {displayName()}
        </span>
        <Show when={props.entry.quantity > 1}>
          <small style={{ color: "var(--color-fg-subtle)" }}>
            ×{props.entry.quantity}
          </small>
        </Show>
        <Show when={bundle()}>
          <small
            style={{ color: "var(--color-fg-subtle)" }}
            title={`Bundle: ${bundle()!.count} of ${bundle()!.capacity}`}
            data-testid={`bundle-count-${props.entry.itemId}-${props.entryIndex}`}
          >
            ×{bundle()!.count}/{bundle()!.capacity}
          </small>
        </Show>
        <Show when={props.entry.state?.damaged}>
          <small style={{ color: "var(--color-warning)" }} title="Damaged">
            damaged
          </small>
        </Show>
        <span style={{ flex: 1 }} />
        <Show when={canEdit()}>
          {/* Drop and Missing only make sense for items that aren't
              already in those zones. */}
          <Show when={props.clearOnPlace !== "dropped"}>
            <button
              type="button"
              onClick={dropEntry}
              data-testid={`drop-${props.entry.itemId}-${props.entryIndex}`}
              style={tinyButton()}
              title="Drop on the ground"
            >
              Drop
            </button>
          </Show>
          <Show when={props.clearOnPlace !== "missing"}>
            <button
              type="button"
              onClick={markMissing}
              data-testid={`missing-${props.entry.itemId}-${props.entryIndex}`}
              style={tinyButton()}
              title="Mark missing (e.g. taken by foes)"
            >
              Missing
            </button>
          </Show>
          <Show when={bundle() && bundle()!.count > 1}>
            <button
              type="button"
              onClick={splitOne}
              data-testid={`split-${props.entry.itemId}-${props.entryIndex}`}
              style={tinyButton()}
              title={`Take 1 unit out of this stack of ${bundle()!.count}`}
            >
              Split 1
            </button>
          </Show>
          <Show when={isLightSource()}>
            <Show
              when={!props.entry.state?.lit}
              fallback={
                <button
                  type="button"
                  onClick={douse}
                  data-testid={`douse-${props.entry.itemId}-${props.entryIndex}`}
                  style={tinyButton()}
                  title="Snuff this light source (turns remaining are preserved)"
                >
                  Douse
                </button>
              }
            >
              <button
                type="button"
                onClick={lightUp}
                disabled={!!props.entry.state?.spent || isStowed()}
                data-testid={`light-${props.entry.itemId}-${props.entryIndex}`}
                style={{
                  ...tinyButton(),
                  opacity: props.entry.state?.spent || isStowed() ? 0.5 : 1,
                  cursor:
                    props.entry.state?.spent || isStowed()
                      ? "default"
                      : "pointer",
                }}
                title={
                  isStowed()
                    ? "Can't light an item stowed in a container — take it out first"
                    : props.entry.state?.spent
                      ? "Spent — no fuel remaining"
                      : (props.entry.state?.turnsRemaining ?? 0) > 0
                        ? `Re-light with ${props.entry.state!.turnsRemaining} turns remaining`
                        : `Light it (${supply()?.turnsRemaining ?? 0} turns of fuel)`
                }
              >
                Light
              </button>
              <Show when={props.entry.state?.spent}>
                <small
                  data-testid={`spent-${props.entry.itemId}-${props.entryIndex}`}
                  style={{
                    color: "var(--color-fg-subtle)",
                    "font-style": "italic",
                  }}
                  title="The light source has burned through all its fuel"
                >
                  spent
                </small>
              </Show>
            </Show>
            <Show when={props.entry.state?.lit}>
              <span
                style={{
                  display: "inline-flex",
                  "align-items": "center",
                  gap: "0.25rem",
                  "font-size": "0.75rem",
                  color: "var(--color-fg-subtle)",
                }}
                title="Turns remaining of light"
              >
                <span>turns</span>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={props.entry.state?.turnsRemaining ?? 0}
                  data-testid={`turns-${props.entry.itemId}-${props.entryIndex}`}
                  onChange={(e) => {
                    const n = Number(e.currentTarget.value);
                    if (Number.isFinite(n)) setTurns(n);
                  }}
                  style={{
                    width: "3.2rem",
                    padding: "0.1rem 0.25rem",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface)",
                    "border-radius": "0.2rem",
                    "text-align": "center",
                  }}
                />
              </span>
            </Show>
          </Show>
          <Show when={bundle() && mergeTargets().length > 0}>
            <div
              style={{
                position: "relative",
                display: "inline-flex",
                "align-items": "center",
              }}
            >
              <button
                type="button"
                onClick={() => setCombineOpen(!combineOpen())}
                data-testid={`combine-${props.entry.itemId}-${props.entryIndex}`}
                style={tinyButton()}
                title="Pour this stack into a compatible peer"
              >
                Combine ▾
              </button>
              <Show when={combineOpen()}>
                <ul
                  data-testid={`combine-menu-${props.entry.itemId}-${props.entryIndex}`}
                  style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    "z-index": 5,
                    "list-style": "none",
                    margin: 0,
                    padding: "0.25rem",
                    background: "var(--color-surface-elevated)",
                    border: "1px solid var(--color-border)",
                    "border-radius": "0.3rem",
                    "box-shadow": "0 2px 6px rgba(0,0,0,0.15)",
                    "min-width": "12rem",
                    "font-size": "0.8rem",
                  }}
                >
                  <For each={mergeTargets()}>
                    {(t) => {
                      const peerName = (() => {
                        const id = client.world.get(t.itemId, [
                          ItemIdentity,
                        ]) as { ItemIdentity: { name: string } } | undefined;
                        const base = id?.ItemIdentity.name ?? "stack";
                        return t.ordinal > 0 ? `${base} #${t.ordinal}` : base;
                      })();
                      const peerB = client.world.get(t.itemId, [
                        ItemBundle,
                      ]) as
                        | { ItemBundle: { count: number; capacity: number } }
                        | undefined;
                      const room = peerB
                        ? `${peerB.ItemBundle.count}/${peerB.ItemBundle.capacity}`
                        : "";
                      return (
                        <li>
                          <button
                            type="button"
                            onClick={() => combineInto(t.itemId)}
                            data-testid={`combine-target-${t.itemId}`}
                            style={{
                              display: "flex",
                              "justify-content": "space-between",
                              gap: "0.5rem",
                              width: "100%",
                              border: "none",
                              background: "transparent",
                              padding: "0.25rem 0.4rem",
                              "text-align": "left",
                              cursor: "pointer",
                              color: "inherit",
                            }}
                          >
                            <span>{peerName}</span>
                            <span style={{ color: "var(--color-fg-subtle)" }}>
                              {room}
                            </span>
                          </button>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </Show>
            </div>
          </Show>
          <button
            type="button"
            onClick={customize}
            style={tinyButton()}
            title="Customize (fork into a unique item)"
          >
            Fork
          </button>
          <button
            type="button"
            onClick={removeFromInventory}
            data-testid={`remove-${props.entry.itemId}-${props.entryIndex}`}
            style={{
              ...tinyButton(),
              color: "var(--color-fg-muted)",
            }}
            title="Remove from this inventory (item stays in the world)"
          >
            Remove
          </button>
        </Show>
      </div>
      <div
        style={{
          display: "flex",
          gap: "0.3rem",
          "flex-wrap": "wrap",
          position: "relative",
        }}
      >
        <For each={Object.entries(slotOpts()?.options ?? {})}>
          {([slotKey, cost]) => (
            <SlotPill
              characterId={characterEntityId as EntityId}
              entryHolderId={props.characterId as EntityId}
              entryIndex={props.entryIndex}
              entry={props.entry}
              slotKey={slotKey}
              slotsConsumed={cost}
              isOpen={openPicker() === slotKey}
              onToggleOpen={() =>
                setOpenPicker(openPicker() === slotKey ? null : slotKey)
              }
              onClose={() => setOpenPicker(null)}
              onAfterPlace={onPlaced}
            />
          )}
        </For>
      </div>
      <Show
        when={
          peekOpen() &&
          peekable() &&
          (props.clearOnPlace === "dropped" || props.clearOnPlace === "missing")
        }
      >
        <ContainerPeek containerId={props.entry.itemId} />
      </Show>
    </li>
  );
}

/* -------------------------------------------------------------------------
 * SlotPill — `[<slot> · N]` with click-to-place / picker
 * ----------------------------------------------------------------------- */

function SlotPill(props: {
  /** The actual character entity — used for body-slot destinations. */
  characterId: EntityId;
  /** Where the entry currently lives (could be a container). */
  entryHolderId: EntityId;
  entryIndex: number;
  entry: CarryEntry;
  slotKey: string;
  slotsConsumed: number;
  isOpen: boolean;
  onToggleOpen: () => void;
  onClose: () => void;
  /**
   * Optional side-effect to run after a successful placement
   * dispatch — used by Dropped / Missing rows to also clear their
   * state flag so the entry returns to active inventory.
   */
  onAfterPlace?: () => void;
}): JSX.Element {
  const client = useClient();
  const canEdit = kit.useCanEdit(props.characterId);

  const isCurrent = createMemo(() => isCurrentSlot(props.entry, props.slotKey));

  // Resolve destinations against the *character* (body slots, the
  // character's container tree) regardless of where the entry
  // currently sits. A sack that lived inside a backpack and was
  // dropped should still target the character's hands when [carry·2]
  // is clicked, not the backpack's slots.
  const destinations = createMemo(() =>
    resolveDestinations({
      world: client.world,
      characterId: props.characterId,
      entry: props.entry,
      slotKey: props.slotKey,
      slotsConsumed: props.slotsConsumed,
    }),
  );

  const place = (dest: Destination): void => {
    moveEntryToDestination({
      client,
      sourceHolderId: props.entryHolderId,
      entry: props.entry,
      entryIndex: props.entryIndex,
      destination: dest,
      slotsConsumed: props.slotsConsumed,
    });
    props.onAfterPlace?.();
    props.onClose();
  };

  const onClick = (): void => {
    if (!canEdit()) return;
    if (isCurrent()) return;
    const dests = destinations();
    if (dests.length === 0) return;
    if (dests.length === 1) {
      place(dests[0]!);
      return;
    }
    props.onToggleOpen();
  };

  // Auto-close the picker on outside click.
  let pillRef: HTMLButtonElement | undefined;
  const onDocClick = (e: MouseEvent): void => {
    if (!props.isOpen) return;
    if (!pillRef) return;
    const target = e.target as Node | null;
    if (target && pillRef.parentElement?.contains(target)) return;
    props.onClose();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("click", onDocClick);
    onCleanup(() => document.removeEventListener("click", onDocClick));
  }

  const label = (): string =>
    `${slotShortLabel(props.slotKey)}·${props.slotsConsumed}`;

  return (
    <span style={{ position: "relative" }}>
      <button
        ref={pillRef}
        type="button"
        onClick={onClick}
        disabled={!canEdit() || (destinations().length === 0 && !isCurrent())}
        data-testid={`pill-${props.entry.itemId}-${props.slotKey}`}
        data-current={isCurrent() ? "true" : "false"}
        style={{
          "font-size": "0.75rem",
          padding: "0.15rem 0.5rem",
          border: `1px solid ${
            isCurrent() ? "var(--color-accent)" : "var(--color-border)"
          }`,
          background: isCurrent()
            ? "var(--color-accent)"
            : "var(--color-surface)",
          color: isCurrent() ? "var(--color-accent-fg)" : "var(--color-fg)",
          "border-radius": "0.25rem",
          cursor: canEdit() && !isCurrent() ? "pointer" : "default",
        }}
        title={pillTooltip(props.slotKey, props.slotsConsumed, isCurrent(), destinations().length)}
      >
        {label()}
        {isCurrent() ? " ✓" : destinations().length > 1 ? " ▾" : ""}
      </button>
      <Show when={props.isOpen}>
        <SlotPicker
          destinations={destinations()}
          onPick={place}
          slotsConsumed={props.slotsConsumed}
          world={client.world}
        />
      </Show>
    </span>
  );
}

function pillTooltip(
  slotKey: string,
  cost: number,
  current: boolean,
  numDestinations: number,
): string {
  if (current) return `Currently here (${cost} slot)`;
  if (numDestinations === 0) return "No valid destination — equip a container or free up a hand";
  if (numDestinations === 1) return `Move here (${cost} slot)`;
  return `${slotKey}: pick a destination`;
}

function slotShortLabel(slot: string): string {
  switch (slot) {
    case "carried":
      return "carry";
    case "wornHand":
      return "worn";
    case "pocket":
      return "pkt";
    default:
      return slot;
  }
}

/* -------------------------------------------------------------------------
 * SlotPicker — the dropdown popover
 * ----------------------------------------------------------------------- */

function SlotPicker(props: {
  destinations: ReadonlyArray<Destination>;
  slotsConsumed: number;
  onPick: (d: Destination) => void;
  world: import("@vtt/substrate").World;
}): JSX.Element {
  return (
    <div
      role="menu"
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        "margin-top": "0.25rem",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        "border-radius": "0.3rem",
        padding: "0.25rem",
        "box-shadow": "0 4px 16px rgba(0,0,0,0.18)",
        "min-width": "12rem",
        "z-index": 10,
      }}
    >
      <For each={props.destinations}>
        {(d) => {
          const overfill =
            d.capacity.limit !== null &&
            d.capacity.used + props.slotsConsumed > d.capacity.limit;
          return (
            <button
              type="button"
              onClick={() => props.onPick(d)}
              data-testid={`picker-${d.id}`}
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                width: "100%",
                "text-align": "left",
                padding: "0.3rem 0.5rem",
                background: "transparent",
                border: "none",
                "border-radius": "0.2rem",
                cursor: "pointer",
                color: overfill ? "var(--color-danger)" : "var(--color-fg)",
                "font-size": "0.85rem",
              }}
              title={
                overfill
                  ? `Overfull — would land at ${d.capacity.used + props.slotsConsumed}/${d.capacity.limit}`
                  : ""
              }
            >
              <span>{d.label}</span>
              <span
                style={{
                  "font-size": "0.7rem",
                  color: overfill
                    ? "var(--color-danger)"
                    : "var(--color-fg-subtle)",
                }}
              >
                {d.capacity.limit === null
                  ? "—"
                  : `${d.capacity.used}/${d.capacity.limit}${overfill ? " ⚠" : ""}`}
              </span>
            </button>
          );
        }}
      </For>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Destination resolution — pure, testable
 * ----------------------------------------------------------------------- */

interface Destination {
  /** Stable id for picker keying / test ids. */
  id: string;
  /** Human-readable label shown in the picker. */
  label: string;
  /** The TbCarries holder the entry should land on. */
  holderId: EntityId;
  /** The slot string to record on the entry (e.g. "torso", "container:e9"). */
  slot: string;
  /** The channel (carried/worn/default). */
  channel: TbEquipChannelT;
  /** Capacity info at the destination. */
  capacity: ReturnType<typeof summarizeCapacity>;
}

interface ResolveArgs {
  world: import("@vtt/substrate").World;
  characterId: EntityId;
  entry: CarryEntry;
  slotKey: string;
  slotsConsumed: number;
}

/**
 * Compute the set of legal destinations for a slot pill click. The
 * shape of the destination list drives the picker's behaviour:
 * empty → disabled pill; one → click goes straight; many → click
 * opens a picker.
 *
 * The character is treated as the default holder for direct body
 * slots. For container-shaped slots (pack/pouch/quiver) the
 * resolver scans every container the character holds AND every
 * container nested inside those containers — sacks-within-sacks
 * is part of the rules.
 */
export function resolveDestinations(args: ResolveArgs): Destination[] {
  const { world, characterId, slotKey, slotsConsumed } = args;
  switch (slotKey) {
    case "head":
    case "neck":
    case "torso":
    case "feet":
    case "pocket":
    case "belt":
      return [
        directBodyDestination(world, characterId, slotKey, "default", slotsConsumed),
      ];
    case "hands":
      // Catalog "hands:N" — gloves and similar worn-on-both-hands
      // items. Stored at slot="hands", channel="worn" so each hand
      // panel sees the entry occupying one slot.
      return [
        {
          id: `${characterId}:hands-worn`,
          label: "Both Hands (worn)",
          holderId: characterId,
          slot: "hands",
          channel: "worn",
          capacity: summarizeCapacity({
            world,
            holderId: characterId,
            slot: "hands",
            channel: "worn",
          }),
        },
      ];
    case "carried":
      return slotsConsumed >= 2
        ? [
            // Two-handed carry: large sack, two-handed weapon held
            // ready. Stored at slot="hands", channel="carried" so
            // both hand panels show it occupying one slot each.
            {
              id: `${characterId}:hands-carried`,
              label: "Both Hands",
              holderId: characterId,
              slot: "hands",
              channel: "carried",
              capacity: summarizeCapacity({
                world,
                holderId: characterId,
                slot: "hands",
                channel: "carried",
              }),
            },
          ]
        : [
            {
              id: `${characterId}:handR-carried`,
              label: "Right Hand (carried)",
              holderId: characterId,
              slot: "handR",
              channel: "carried",
              capacity: summarizeCapacity({
                world,
                holderId: characterId,
                slot: "handR",
                channel: "carried",
              }),
            },
            {
              id: `${characterId}:handL-carried`,
              label: "Left Hand (carried)",
              holderId: characterId,
              slot: "handL",
              channel: "carried",
              capacity: summarizeCapacity({
                world,
                holderId: characterId,
                slot: "handL",
                channel: "carried",
              }),
            },
          ];
    case "wornHand":
      return slotsConsumed >= 2
        ? [
            {
              id: `${characterId}:hands-worn`,
              label: "Both Hands (worn)",
              holderId: characterId,
              slot: "hands",
              channel: "worn",
              capacity: summarizeCapacity({
                world,
                holderId: characterId,
                slot: "hands",
                channel: "worn",
              }),
            },
          ]
        : [
            {
              id: `${characterId}:handR-worn`,
              label: "Right Hand (worn)",
              holderId: characterId,
              slot: "handR",
              channel: "worn",
              capacity: summarizeCapacity({
                world,
                holderId: characterId,
                slot: "handR",
                channel: "worn",
              }),
            },
            {
              id: `${characterId}:handL-worn`,
              label: "Left Hand (worn)",
              holderId: characterId,
              slot: "handL",
              channel: "worn",
              capacity: summarizeCapacity({
                world,
                holderId: characterId,
                slot: "handL",
                channel: "worn",
              }),
            },
          ];
    case "pack":
      return collectContainers(world, characterId, args.entry.itemId, () => true).map(
        (c) => containerDestination(world, c.id, c.label, c.depth),
      );
    case "pouch":
      return collectContainers(
        world,
        characterId,
        args.entry.itemId,
        (containerType) => containerType === "pouch",
      ).map((c) => containerDestination(world, c.id, c.label, c.depth));
    case "quiver":
      return collectContainers(
        world,
        characterId,
        args.entry.itemId,
        (containerType) => containerType === "quiver",
      ).map((c) => containerDestination(world, c.id, c.label, c.depth));
    default:
      return [];
  }
}

function directBodyDestination(
  world: import("@vtt/substrate").World,
  characterId: EntityId,
  slot: string,
  channel: TbEquipChannelT,
  _slotsConsumed: number,
): Destination {
  return {
    id: `${characterId}:${slot}`,
    label: capitalize(slot),
    holderId: characterId,
    slot,
    channel,
    capacity: summarizeCapacity({ world, holderId: characterId, slot, channel }),
  };
}

function containerDestination(
  world: import("@vtt/substrate").World,
  containerId: EntityId,
  label: string,
  depth: number,
): Destination {
  return {
    id: `container:${containerId}`,
    label: depth > 0 ? `${"› ".repeat(depth)}${label}` : label,
    holderId: containerId,
    slot: `container:${containerId}`,
    channel: "default",
    capacity: summarizeCapacity({
      world,
      holderId: containerId,
      slot: `container:${containerId}`,
      channel: "default",
    }),
  };
}

interface ContainerEntry {
  id: EntityId;
  label: string;
  depth: number;
  containerType: string;
}

function collectContainers(
  world: import("@vtt/substrate").World,
  rootHolderId: EntityId,
  excludeItemId: EntityId,
  filter: (containerType: string) => boolean,
): ContainerEntry[] {
  const out: ContainerEntry[] = [];
  const visit = (holderId: EntityId, depth: number): void => {
    const got = world.get(holderId, [TbCarries]) as
      | {
          TbCarries: {
            entries: Array<{
              itemId: EntityId;
              state?: { dropped?: boolean; lost?: boolean };
            }>;
          };
        }
      | undefined;
    if (!got) return;
    for (const entry of got.TbCarries.entries) {
      // Skip the item being moved (you can't put a sack into
      // itself) and any container that's currently dropped or
      // missing (its contents aren't reachable).
      if (entry.itemId === excludeItemId) continue;
      if (entry.state?.dropped || entry.state?.lost) continue;
      const cinfo = world.get(entry.itemId, [TbContainer]) as
        | { TbContainer: { containerType: string } }
        | undefined;
      if (!cinfo) continue;
      const ident = world.get(entry.itemId, [ItemIdentity]) as
        | { ItemIdentity: { name: string } }
        | undefined;
      if (filter(cinfo.TbContainer.containerType)) {
        out.push({
          id: entry.itemId,
          label: ident?.ItemIdentity.name ?? cinfo.TbContainer.containerType,
          depth,
          containerType: cinfo.TbContainer.containerType,
        });
      }
      visit(entry.itemId, depth + 1);
    }
  };
  visit(rootHolderId, 0);
  return out;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/* -------------------------------------------------------------------------
 * Action plumbing — moves, drop/pickup/recover
 * ----------------------------------------------------------------------- */

function isCurrentSlot(entry: CarryEntry, slotKey: string): boolean {
  // Dropped or lost entries don't currently occupy any slot — the
  // item is off the body. Show every pill as clickable so the user
  // can re-place it anywhere it's allowed to go.
  if (entry.state?.dropped || entry.state?.lost) return false;
  switch (slotKey) {
    case "carried":
      return (
        ((entry.slot === "handR" || entry.slot === "handL") &&
          entry.channel === "carried") ||
        (entry.slot === "hands" && entry.channel === "carried")
      );
    case "wornHand":
      return (
        ((entry.slot === "handR" || entry.slot === "handL") &&
          entry.channel === "worn") ||
        (entry.slot === "hands" && entry.channel === "worn")
      );
    case "pack":
    case "pouch":
    case "quiver":
      return entry.slot.startsWith("container:");
    case "hands":
      return entry.slot === "hands";
    default:
      return entry.slot === slotKey;
  }
}

function indexOf(all: ReadonlyArray<CarryEntry>, idx: number): number {
  return idx < 0 ? -1 : idx;
}

interface MoveArgs {
  client: import("@vtt/substrate/client").ClientHandle;
  /** Where the entry currently lives (character or container). */
  sourceHolderId: EntityId;
  entry: CarryEntry;
  entryIndex: number;
  destination: Destination;
  slotsConsumed: number;
}

/**
 * Cross-holder placement: if the destination's holder differs from
 * the entry's current holder we need to remove from the source
 * (UnequipItem) and add to the destination (EquipItem). On the
 * same holder, MoveItem suffices.
 *
 * Bundle "carry one" rule: when the source is a stack (ItemBundle
 * with count > 1) and the destination's channel is "carried", we
 * split a single unit off first and place THAT one in hand. The
 * rest of the stack stays at the source slot. You can't carry a
 * bundle of four torches in one hand — you can carry one.
 *
 * We compose locally rather than introduce a TransferItem command
 * — both events are well-defined and the visible effect is the
 * same; if a future requirement demands atomic cross-holder
 * transfer, we'll add the dedicated command then.
 */
function moveEntryToDestination(args: MoveArgs): void {
  const { client, sourceHolderId, entry, entryIndex, destination, slotsConsumed } = args;

  const bundle = client.world.get(entry.itemId, [ItemBundle]) as
    | { ItemBundle: { count: number; capacity: number } }
    | undefined;
  const shouldAutoSplit =
    !!bundle &&
    bundle.ItemBundle.count > 1 &&
    destination.channel === "carried";

  if (shouldAutoSplit) {
    void splitOneThenPlace(args);
    return;
  }

  if (sourceHolderId === destination.holderId) {
    void client.dispatch(
      MoveItem({
        holderId: sourceHolderId,
        fromIndex: entryIndex,
        toSlot: destination.slot,
        toSlotIndex: 0,
        toChannel: destination.channel,
        // The destination slot may have a different catalog cost
        // than the source (sack moving from pack:1 to carried:2).
        // Pass through whenever it's known different so the entry
        // updates atomically and the new validate sees the right
        // cost.
        ...(slotsConsumed !== entry.slotsConsumed
          ? { toSlotsConsumed: slotsConsumed }
          : {}),
      }) as CommandInstance,
    );
    return;
  }
  // Cross-holder: unequip then equip.
  void client.dispatch(
    UnequipItem({
      holderId: sourceHolderId,
      entryIndex,
    }) as CommandInstance,
  );
  void client.dispatch(
    EquipItem({
      holderId: destination.holderId,
      itemId: entry.itemId,
      slot: destination.slot,
      slotIndex: 0,
      channel: destination.channel,
      slotsConsumed,
      quantity: entry.quantity,
    }) as CommandInstance,
  );
}

/**
 * Split-one-off-and-place flow. Dispatched when the user picks a
 * carry-channel destination for a stack of more than one unit.
 *
 *   1. Snapshot the set of TbCarries-known item ids on the source
 *      holder (so we can spot the new fork after it lands).
 *   2. Dispatch SplitItemBundle({itemId, count: 1}); await ack.
 *      The server validates + emits ItemBundleSplit; the items
 *      plugin spawns the new fork with shareable traits + count=1;
 *      the TB plugin's TbBundleSplitSystem appends a TbCarries
 *      entry on the same holder, in the source's slot.
 *   3. Find the new entry's index — it's whichever entry now
 *      points at an item id we hadn't seen before.
 *   4. MoveItem (same holder) or UnequipItem + EquipItem (cross
 *      holder) on the new entry to the carry destination.
 *
 * If anything in step 2 fails (validate rejection, server error)
 * we return without dispatching the move; the user sees no change
 * and the original stack is left untouched.
 */
async function splitOneThenPlace(args: MoveArgs): Promise<void> {
  const { client, sourceHolderId, entry, destination, slotsConsumed } = args;
  const beforeIds = new Set<string>(
    (
      (
        client.world.get(sourceHolderId, [TbCarries]) as
          | { TbCarries: { entries: Array<{ itemId: string }> } }
          | undefined
      )?.TbCarries.entries ?? []
    ).map((e) => e.itemId),
  );
  const handle = client.dispatch(
    SplitItemBundle({
      itemId: entry.itemId,
      count: 1,
    }) as CommandInstance,
  );
  const ack = await handle.ack;
  if (!ack.ok) return;

  const carries = client.world.get(sourceHolderId, [TbCarries]) as
    | { TbCarries: { entries: Array<{ itemId: string; slotsConsumed: number; quantity: number }> } }
    | undefined;
  if (!carries) return;
  const newIndex = carries.TbCarries.entries.findIndex(
    (e) => !beforeIds.has(e.itemId),
  );
  if (newIndex < 0) return;
  const newEntry = carries.TbCarries.entries[newIndex]!;

  if (sourceHolderId === destination.holderId) {
    void client.dispatch(
      MoveItem({
        holderId: sourceHolderId,
        fromIndex: newIndex,
        toSlot: destination.slot,
        toSlotIndex: 0,
        toChannel: destination.channel,
        ...(slotsConsumed !== newEntry.slotsConsumed
          ? { toSlotsConsumed: slotsConsumed }
          : {}),
      }) as CommandInstance,
    );
    return;
  }
  // Cross-holder split-then-place: unequip the new entry from the
  // source and equip it on the destination.
  void client.dispatch(
    UnequipItem({
      holderId: sourceHolderId,
      entryIndex: newIndex,
    }) as CommandInstance,
  );
  void client.dispatch(
    EquipItem({
      holderId: destination.holderId,
      itemId: newEntry.itemId as EntityId,
      slot: destination.slot,
      slotIndex: 0,
      channel: destination.channel,
      slotsConsumed,
      quantity: newEntry.quantity,
    }) as CommandInstance,
  );
}


function tinyButton(): JSX.CSSProperties {
  return {
    "font-size": "0.7rem",
    padding: "0.1rem 0.4rem",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    "border-radius": "0.25rem",
    cursor: "pointer",
  };
}

// Suppressed unused-import warning for symbols imported for type
// consumers but not directly referenced at runtime.
void ItemCatalogIndex;
void ItemDerivedFrom;
void PickUpItem;

export const TbInventoryTabFill: CharacterSheetTab = {
  id: qualifiedName("@vtt/system-torchbearer/tab-inventory") as CharacterSheetTab["id"],
  label: "Inventory",
  priority: 60,
  render: ({ characterId }) => InventoryTab({ characterId }),
};

/**
 * Re-export the InventoryTab body so other surfaces (the NPC sheet
 * in particular) can mount the same equip / unequip / catalog-quick-
 * add UI inline rather than duplicating a lightweight equip picker.
 * Same `{ characterId }` contract — works against any holder, PC or
 * NPC. The NPC sheet wraps this in a section header so the visual
 * rhythm matches the rest of the simplified sheet.
 */
export { InventoryTab as TbInventoryView };
