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
  type CommandInstance,
  type EntityId,
} from "@vtt/substrate";
import { useClient, useTrait } from "@vtt/substrate/client";
import {
  EditItemField,
  ItemBundle,
  JoinItemBundles,
  RemoveItemTrait,
  SetItemTrait,
  SplitItemBundle,
} from "@vtt/items/shared";
import {
  createMemo,
  createSignal,
  For,
  Show,
  type JSX,
} from "solid-js";
import {
  SpellIdentity,
  TbArmor,
  TbContainer,
  TbItemSlotOptions,
  TbItemSpecialRules,
  TbScroll,
  TbSkillBonuses,
  TbSpellBook,
  TbSupply,
  TbWeapon,
  TB_BODY_SLOTS,
} from "../shared/index.js";
import { tbCanonicalBookAbbreviation } from "../data/seed.js";
import { BookCitation } from "@vtt/books/client";
import type { ItemDetailSection } from "@vtt/items/shared";

/**
 * Game-system contributions to the @vtt/items workbench-page detail
 * view. Every section is editable: each input dispatches
 * EditItemField against the item, and the items plugin's override-
 * tracking takes care of "this field is locally customized so re-
 * seed leaves it alone." The Items page already renders Identity
 * and Economics; these sections add TB subtype editors below.
 */

export const TbWeaponDetailSection: ItemDetailSection = {
  id: "@vtt/system-torchbearer/weapon",
  label: "Weapon",
  priority: 100,
  appliesWhen: ({ traitsOnItem }) => traitsOnItem.has(TbWeapon.name),
  render: ({ itemId, canEdit }) => (
    <WeaponSection itemId={itemId as EntityId} canEdit={canEdit} />
  ),
};

export const TbArmorDetailSection: ItemDetailSection = {
  id: "@vtt/system-torchbearer/armor",
  label: "Armor",
  priority: 90,
  appliesWhen: ({ traitsOnItem }) => traitsOnItem.has(TbArmor.name),
  render: ({ itemId, canEdit }) => (
    <ArmorSection itemId={itemId as EntityId} canEdit={canEdit} />
  ),
};

export const TbSupplyDetailSection: ItemDetailSection = {
  id: "@vtt/system-torchbearer/supply",
  label: "Supply",
  priority: 80,
  appliesWhen: ({ traitsOnItem }) => traitsOnItem.has(TbSupply.name),
  render: ({ itemId, canEdit }) => (
    <SupplySection itemId={itemId as EntityId} canEdit={canEdit} />
  ),
};

export const TbContainerDetailSection: ItemDetailSection = {
  id: "@vtt/system-torchbearer/container",
  label: "Container",
  priority: 70,
  appliesWhen: ({ traitsOnItem }) => traitsOnItem.has(TbContainer.name),
  render: ({ itemId, canEdit }) => (
    <ContainerSection itemId={itemId as EntityId} canEdit={canEdit} />
  ),
};

export const TbSlotOptionsDetailSection: ItemDetailSection = {
  id: "@vtt/system-torchbearer/slot-options",
  label: "Where it fits",
  priority: 50,
  appliesWhen: ({ traitsOnItem }) => traitsOnItem.has(TbItemSlotOptions.name),
  render: ({ itemId, canEdit }) => (
    <SlotOptionsSection itemId={itemId as EntityId} canEdit={canEdit} />
  ),
};

export const TbSkillBonusesDetailSection: ItemDetailSection = {
  id: "@vtt/system-torchbearer/skill-bonuses",
  label: "Skill Bonuses",
  priority: 40,
  appliesWhen: ({ traitsOnItem }) => traitsOnItem.has(TbSkillBonuses.name),
  render: ({ itemId, canEdit }) => (
    <SkillBonusesSection itemId={itemId as EntityId} canEdit={canEdit} />
  ),
};

export const TbSpecialRulesDetailSection: ItemDetailSection = {
  id: "@vtt/system-torchbearer/special-rules",
  label: "Special Rules",
  priority: 20,
  appliesWhen: ({ traitsOnItem }) =>
    traitsOnItem.has(TbItemSpecialRules.name),
  render: ({ itemId, canEdit }) => (
    <SpecialRulesSection itemId={itemId as EntityId} canEdit={canEdit} />
  ),
};

export const TbBundleDetailSection: ItemDetailSection = {
  id: "@vtt/system-torchbearer/bundle",
  label: "Bundle",
  priority: 60,
  appliesWhen: ({ traitsOnItem }) => traitsOnItem.has(ItemBundle.name),
  render: ({ itemId, canEdit }) => (
    <BundleSection itemId={itemId as EntityId} canEdit={canEdit} />
  ),
};

export const TbSpellBookDetailSection: ItemDetailSection = {
  id: "@vtt/system-torchbearer/spellbook",
  label: "Spell Book",
  priority: 75,
  appliesWhen: ({ traitsOnItem }) => traitsOnItem.has(TbSpellBook.name),
  render: ({ itemId, canEdit }) => (
    <SpellBookDetail itemId={itemId as EntityId} canEdit={canEdit} />
  ),
};

export const TbScrollDetailSection: ItemDetailSection = {
  id: "@vtt/system-torchbearer/scroll",
  label: "Scroll",
  priority: 76,
  appliesWhen: ({ traitsOnItem }) => traitsOnItem.has(TbScroll.name),
  render: ({ itemId, canEdit }) => (
    <ScrollDetail itemId={itemId as EntityId} canEdit={canEdit} />
  ),
};

/**
 * Manage Subtypes — always-visible affordance for adding or
 * removing TB subtype traits on an item. New items start with
 * just ItemIdentity; the GM toggles weapon/armor/supply/etc.
 * here, which dispatches SetItemTrait with a sensible default
 * value so the matching editor section shows up immediately.
 */
export const TbManageSubtypesDetailSection: ItemDetailSection = {
  id: "@vtt/system-torchbearer/manage-subtypes",
  label: "Subtypes",
  priority: 110,
  // Always visible — the user always wants to be able to add/remove
  // subtypes regardless of what's currently on the item.
  appliesWhen: () => true,
  render: ({ itemId, canEdit }) => (
    <ManageSubtypesSection itemId={itemId as EntityId} canEdit={canEdit} />
  ),
};

export const TB_ITEM_DETAIL_SECTIONS: ReadonlyArray<ItemDetailSection> = [
  TbManageSubtypesDetailSection,
  TbWeaponDetailSection,
  TbArmorDetailSection,
  TbSupplyDetailSection,
  TbContainerDetailSection,
  TbSpellBookDetailSection,
  TbScrollDetailSection,
  TbBundleDetailSection,
  TbSlotOptionsDetailSection,
  TbSkillBonusesDetailSection,
  TbSpecialRulesDetailSection,
];

/* -------------------------------------------------------------------------
 * Manage Subtypes — checkboxes that toggle the existence of each
 * subtype trait on the item.
 * ----------------------------------------------------------------------- */

interface SubtypeDescriptor {
  shortName: string;
  label: string;
  /** A schema-valid default the SetItemTrait dispatch hands the system. */
  defaultValue: unknown;
}

const TB_SUBTYPES: ReadonlyArray<SubtypeDescriptor> = [
  {
    shortName: "TbItemSlotOptions",
    label: "Where it fits",
    defaultValue: { options: {} },
  },
  {
    shortName: "TbWeapon",
    label: "Weapon",
    defaultValue: {
      wield: 1,
      conflictBonuses: {
        attack: { type: "dice", value: 0 },
        defend: { type: "dice", value: 0 },
        feint: { type: "dice", value: 0 },
        maneuver: { type: "dice", value: 0 },
      },
    },
  },
  {
    shortName: "TbArmor",
    label: "Armor",
    defaultValue: { armorType: "leather", absorbs: 1 },
  },
  {
    shortName: "TbSupply",
    label: "Supply",
    defaultValue: {
      supplyType: "other",
      turnsRemaining: 0,
      lit: false,
      nameSingular: "",
    },
  },
  {
    shortName: "TbContainer",
    label: "Container",
    defaultValue: { containerType: "pouch", containerSlots: 1 },
  },
  {
    shortName: "TbSkillBonuses",
    label: "Skill Bonuses",
    defaultValue: { entries: [] },
  },
  {
    shortName: "TbItemSpecialRules",
    label: "Special Rules",
    defaultValue: { text: "" },
  },
  {
    shortName: "ItemBundle",
    label: "Bundle / Stack",
    defaultValue: { count: 1, capacity: 1 },
  },
];

function ManageSubtypesSection(props: {
  itemId: EntityId;
  canEdit: boolean;
}): JSX.Element {
  const client = useClient();
  // Re-evaluate when any trait on this entity changes — `useTrait`
  // can subscribe per-trait, but here we want a list of which
  // traits are present. Subscribe to one of the relevant ones to
  // wake up on changes; in practice trait set/remove fires for
  // each, and the world's subscribe fires on every (id, trait)
  // change so memos rebuild.
  const wakeup = useTrait(props.itemId, TbItemSlotOptions);
  const present = createMemo<Set<string>>(() => {
    void wakeup();
    const set = new Set<string>();
    for (const [traitFullName] of client.world.traitsOn(props.itemId)) {
      const short = traitFullName.split("/").pop();
      if (short) set.add(short);
    }
    return set;
  });

  const add = (s: SubtypeDescriptor): void => {
    void client.dispatch(
      SetItemTrait({
        itemId: props.itemId,
        traitShortName: s.shortName,
        value: s.defaultValue,
      }) as CommandInstance,
    );
  };
  const remove = (s: SubtypeDescriptor): void => {
    void client.dispatch(
      RemoveItemTrait({
        itemId: props.itemId,
        traitShortName: s.shortName,
      }) as CommandInstance,
    );
  };

  return (
    <div class="flex flex-col gap-1.5 text-sm">
      <p class="text-fg-subtle text-[0.75rem]">
        Toggle subtypes to control which sections appear below.
      </p>
      <ul class="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
        <For each={TB_SUBTYPES}>
          {(s) => (
            <li class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={present().has(s.shortName)}
                disabled={!props.canEdit}
                onChange={(e) => {
                  if (e.currentTarget.checked) add(s);
                  else remove(s);
                }}
                data-testid={`subtype-toggle-${s.shortName}`}
              />
              <span>{s.label}</span>
              <span class="text-[0.65rem] text-fg-subtle font-mono">
                {s.shortName}
              </span>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Edit dispatch helper used by every section.
 * ----------------------------------------------------------------------- */

function useEditField(itemId: EntityId): (path: string, value: unknown) => void {
  const client = useClient();
  return (path: string, value: unknown): void => {
    void client.dispatch(
      EditItemField({ itemId, path, value }) as CommandInstance,
    );
  };
}

/* -------------------------------------------------------------------------
 * Slot options — the user's main ask: add/remove/edit "where it fits"
 * ----------------------------------------------------------------------- */

const ADDABLE_SLOTS = TB_BODY_SLOTS.filter(
  // Skip the canonical handR/handL — items use the catalog-shaped
  // category names ("carried", "wornHand", "hands") in slotOptions,
  // not the body-side hand slot keys.
  (s) => s !== "handR" && s !== "handL",
);

function SlotOptionsSection(props: {
  itemId: EntityId;
  canEdit: boolean;
}): JSX.Element {
  const editField = useEditField(props.itemId);
  const slotOpts = useTrait(props.itemId, TbItemSlotOptions) as () =>
    | { options: Record<string, number> }
    | undefined;
  const options = createMemo<Record<string, number>>(
    () => slotOpts()?.options ?? {},
  );
  const [newSlot, setNewSlot] = createSignal<string>(ADDABLE_SLOTS[0] ?? "pack");
  const [newCost, setNewCost] = createSignal<number>(1);

  const setCost = (slot: string, cost: number): void => {
    editField("TbItemSlotOptions.options", { ...options(), [slot]: cost });
  };
  const removeSlot = (slot: string): void => {
    const next = { ...options() };
    delete next[slot];
    editField("TbItemSlotOptions.options", next);
  };
  const addSlot = (): void => {
    const slot = newSlot().trim();
    if (!slot) return;
    const cost = Math.max(1, Math.floor(newCost()));
    editField("TbItemSlotOptions.options", { ...options(), [slot]: cost });
  };

  return (
    <div class="flex flex-col gap-2 text-sm">
      <Show
        when={Object.keys(options()).length > 0}
        fallback={
          <em class="text-fg-subtle">No allowed slots — add one below.</em>
        }
      >
        <ul class="flex flex-col gap-1.5">
          <For each={Object.entries(options()).sort(([a], [b]) => a.localeCompare(b))}>
            {([slot, cost]) => (
              <li class="flex items-center gap-2">
                <span
                  class="font-mono px-1.5 py-0.5 rounded border border-border-muted bg-surface"
                  data-testid={`slot-row-${slot}`}
                >
                  {slot}
                </span>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={cost}
                  disabled={!props.canEdit}
                  onChange={(e) => {
                    const v = Number.parseInt(e.currentTarget.value, 10);
                    if (Number.isFinite(v) && v >= 1) setCost(slot, v);
                  }}
                  data-testid={`slot-cost-${slot}`}
                  class="w-16 rounded border border-border bg-surface px-2 py-1 text-sm"
                />
                <Show when={props.canEdit}>
                  <button
                    type="button"
                    onClick={() => removeSlot(slot)}
                    data-testid={`slot-remove-${slot}`}
                    class="text-[0.65rem] uppercase tracking-wider rounded border border-border-muted px-2 py-1 text-fg-subtle hover:text-danger hover:border-danger"
                    title={`Remove the ${slot} slot option`}
                  >
                    ✕
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.canEdit}>
        <div class="flex items-center gap-2 pt-2 mt-2 border-t border-border-muted">
          <select
            value={newSlot()}
            onChange={(e) => setNewSlot(e.currentTarget.value)}
            data-testid="slot-add-key"
            class="rounded border border-border bg-surface px-2 py-1 text-sm"
          >
            <For each={ADDABLE_SLOTS}>
              {(s) => <option value={s}>{s}</option>}
            </For>
          </select>
          <input
            type="number"
            min="1"
            max="20"
            value={newCost()}
            onInput={(e) => {
              const v = Number.parseInt(e.currentTarget.value, 10);
              setNewCost(Number.isFinite(v) && v >= 1 ? v : 1);
            }}
            data-testid="slot-add-cost"
            class="w-16 rounded border border-border bg-surface px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={addSlot}
            data-testid="slot-add"
            class="rounded border border-border bg-surface-elevated px-3 py-1 text-sm hover:border-accent"
          >
            + add
          </button>
          <span class="text-[0.7rem] text-fg-subtle">
            Use the catalog vocabulary: <code>pack</code> /{" "}
            <code>carried</code> / <code>wornHand</code> /{" "}
            <code>hands</code> / <code>pouch</code> / <code>quiver</code> /{" "}
            <code>belt</code> / <code>torso</code> / <code>head</code> /{" "}
            <code>neck</code> / <code>feet</code> / <code>pocket</code>
          </span>
        </div>
      </Show>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Weapon
 * ----------------------------------------------------------------------- */

function WeaponSection(props: { itemId: EntityId; canEdit: boolean }): JSX.Element {
  const editField = useEditField(props.itemId);
  const w = useTrait(props.itemId, TbWeapon) as () =>
    | {
        wield: number;
        conflictBonuses: Record<
          "attack" | "defend" | "feint" | "maneuver",
          { type: string; value: number }
        >;
      }
    | undefined;
  return (
    <Show when={w()}>
      {(weapon) => (
        <div class="flex flex-col gap-3 text-sm">
          <div class="flex items-center gap-2">
            <label class="text-fg-subtle w-24">Wield</label>
            <select
              value={weapon().wield}
              disabled={!props.canEdit}
              onChange={(e) =>
                editField(
                  "TbWeapon.wield",
                  Number.parseInt(e.currentTarget.value, 10),
                )
              }
              data-testid="weapon-wield"
              class="rounded border border-border bg-surface px-2 py-1 text-sm"
            >
              <option value={1}>1 hand</option>
              <option value={2}>2 hands</option>
            </select>
          </div>
          <div class="grid grid-cols-[max-content_max-content_1fr] gap-x-3 gap-y-1.5 items-center">
            <For each={["attack", "defend", "feint", "maneuver"] as const}>
              {(action) => (
                <ConflictBonusRow
                  action={action}
                  bonus={weapon().conflictBonuses[action]}
                  canEdit={props.canEdit}
                  edit={editField}
                />
              )}
            </For>
          </div>
        </div>
      )}
    </Show>
  );
}

function ConflictBonusRow(props: {
  action: "attack" | "defend" | "feint" | "maneuver";
  bonus: { type: string; value: number };
  canEdit: boolean;
  edit: (path: string, value: unknown) => void;
}): JSX.Element {
  return (
    <>
      <span class="text-fg-subtle capitalize">{props.action}</span>
      <select
        value={props.bonus.type}
        disabled={!props.canEdit}
        onChange={(e) =>
          props.edit(
            `TbWeapon.conflictBonuses.${props.action}.type`,
            e.currentTarget.value,
          )
        }
        data-testid={`weapon-${props.action}-type`}
        class="rounded border border-border bg-surface px-2 py-1 text-sm"
      >
        <option value="dice">D (dice)</option>
        <option value="success">s (successes)</option>
        <option value="rerolls">r (rerolls)</option>
      </select>
      <input
        type="number"
        value={props.bonus.value}
        disabled={!props.canEdit}
        onChange={(e) => {
          const v = Number.parseInt(e.currentTarget.value, 10);
          if (Number.isFinite(v)) {
            props.edit(`TbWeapon.conflictBonuses.${props.action}.value`, v);
          }
        }}
        data-testid={`weapon-${props.action}-value`}
        class="w-20 rounded border border-border bg-surface px-2 py-1 text-sm"
      />
    </>
  );
}

/* -------------------------------------------------------------------------
 * Armor
 * ----------------------------------------------------------------------- */

const ARMOR_TYPES = ["leather", "chain", "plate", "helmet", "shield", "other"] as const;

function ArmorSection(props: { itemId: EntityId; canEdit: boolean }): JSX.Element {
  const editField = useEditField(props.itemId);
  const a = useTrait(props.itemId, TbArmor) as () =>
    | { armorType: string; absorbs: number }
    | undefined;
  return (
    <Show when={a()}>
      {(armor) => (
        <div class="flex flex-col gap-2 text-sm">
          <div class="flex items-center gap-2">
            <label class="text-fg-subtle w-24">Type</label>
            <select
              value={armor().armorType}
              disabled={!props.canEdit}
              onChange={(e) =>
                editField("TbArmor.armorType", e.currentTarget.value)
              }
              data-testid="armor-type"
              class="rounded border border-border bg-surface px-2 py-1 text-sm"
            >
              <For each={ARMOR_TYPES}>
                {(t) => <option value={t}>{t}</option>}
              </For>
            </select>
          </div>
          <div class="flex items-center gap-2">
            <label class="text-fg-subtle w-24">Absorbs</label>
            <input
              type="number"
              min="0"
              value={armor().absorbs}
              disabled={!props.canEdit}
              onChange={(e) => {
                const v = Number.parseInt(e.currentTarget.value, 10);
                if (Number.isFinite(v) && v >= 0) {
                  editField("TbArmor.absorbs", v);
                }
              }}
              data-testid="armor-absorbs"
              class="w-20 rounded border border-border bg-surface px-2 py-1 text-sm"
            />
          </div>
        </div>
      )}
    </Show>
  );
}

/* -------------------------------------------------------------------------
 * Supply
 * ----------------------------------------------------------------------- */

const SUPPLY_TYPES = [
  "food",
  "light",
  "ammunition",
  "sacramental",
  "spellMaterial",
  "other",
] as const;

function SupplySection(props: { itemId: EntityId; canEdit: boolean }): JSX.Element {
  const editField = useEditField(props.itemId);
  const s = useTrait(props.itemId, TbSupply) as () =>
    | {
        supplyType: string;
        turnsRemaining: number;
        lit: boolean;
        nameSingular: string;
      }
    | undefined;
  return (
    <Show when={s()}>
      {(supply) => (
        <div class="flex flex-col gap-2 text-sm">
          <div class="flex items-center gap-2">
            <label class="text-fg-subtle w-28">Kind</label>
            <select
              value={supply().supplyType}
              disabled={!props.canEdit}
              onChange={(e) =>
                editField("TbSupply.supplyType", e.currentTarget.value)
              }
              data-testid="supply-type"
              class="rounded border border-border bg-surface px-2 py-1 text-sm"
            >
              <For each={SUPPLY_TYPES}>
                {(t) => <option value={t}>{t}</option>}
              </For>
            </select>
          </div>
          <div class="flex items-center gap-2">
            <label class="text-fg-subtle w-28">Turns remaining</label>
            <input
              type="number"
              min="0"
              value={supply().turnsRemaining}
              disabled={!props.canEdit}
              onChange={(e) => {
                const v = Number.parseInt(e.currentTarget.value, 10);
                if (Number.isFinite(v) && v >= 0) {
                  editField("TbSupply.turnsRemaining", v);
                }
              }}
              data-testid="supply-turns"
              class="w-20 rounded border border-border bg-surface px-2 py-1 text-sm"
            />
          </div>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={supply().lit}
              disabled={!props.canEdit}
              onChange={(e) => editField("TbSupply.lit", e.currentTarget.checked)}
              data-testid="supply-lit"
            />
            <span>Currently lit</span>
          </label>
          <div class="flex items-center gap-2">
            <label class="text-fg-subtle w-28">Singular name</label>
            <input
              type="text"
              value={supply().nameSingular}
              disabled={!props.canEdit}
              onBlur={(e) => editField("TbSupply.nameSingular", e.currentTarget.value)}
              data-testid="supply-singular"
              class="flex-1 rounded border border-border bg-surface px-2 py-1 text-sm"
            />
          </div>
        </div>
      )}
    </Show>
  );
}

/* -------------------------------------------------------------------------
 * Container
 * ----------------------------------------------------------------------- */

function ContainerSection(props: { itemId: EntityId; canEdit: boolean }): JSX.Element {
  const editField = useEditField(props.itemId);
  const c = useTrait(props.itemId, TbContainer) as () =>
    | { containerType: string; containerSlots: number }
    | undefined;
  return (
    <Show when={c()}>
      {(container) => (
        <div class="flex flex-col gap-2 text-sm">
          <div class="flex items-center gap-2">
            <label class="text-fg-subtle w-28">Type</label>
            <input
              type="text"
              value={container().containerType}
              disabled={!props.canEdit}
              onBlur={(e) =>
                editField("TbContainer.containerType", e.currentTarget.value)
              }
              data-testid="container-type"
              class="flex-1 rounded border border-border bg-surface px-2 py-1 text-sm"
              placeholder="backpack / satchel / smallSack / pouch / quiver / …"
            />
          </div>
          <div class="flex items-center gap-2">
            <label class="text-fg-subtle w-28">Internal slots</label>
            <input
              type="number"
              min="0"
              max="50"
              value={container().containerSlots}
              disabled={!props.canEdit}
              onChange={(e) => {
                const v = Number.parseInt(e.currentTarget.value, 10);
                if (Number.isFinite(v) && v >= 0) {
                  editField("TbContainer.containerSlots", v);
                }
              }}
              data-testid="container-slots"
              class="w-20 rounded border border-border bg-surface px-2 py-1 text-sm"
            />
          </div>
        </div>
      )}
    </Show>
  );
}

/* -------------------------------------------------------------------------
 * Skill bonuses
 * ----------------------------------------------------------------------- */

function SkillBonusesSection(props: {
  itemId: EntityId;
  canEdit: boolean;
}): JSX.Element {
  const editField = useEditField(props.itemId);
  const s = useTrait(props.itemId, TbSkillBonuses) as () =>
    | {
        entries: Array<{ skill: string; value: number; condition: string }>;
      }
    | undefined;
  const entries = createMemo(() => s()?.entries ?? []);

  const setAll = (next: Array<{ skill: string; value: number; condition: string }>): void => {
    editField("TbSkillBonuses.entries", next);
  };
  const setEntry = (idx: number, patch: Partial<{ skill: string; value: number; condition: string }>): void => {
    const cur = entries();
    const next = cur.slice();
    next[idx] = { ...cur[idx]!, ...patch };
    setAll(next);
  };
  const removeEntry = (idx: number): void => {
    setAll(entries().filter((_, i) => i !== idx));
  };
  const addEntry = (): void => {
    setAll([...entries(), { skill: "", value: 1, condition: "" }]);
  };

  return (
    <div class="flex flex-col gap-2 text-sm">
      <Show
        when={entries().length > 0}
        fallback={<em class="text-fg-subtle">No bonuses — add one below.</em>}
      >
        <ul class="flex flex-col gap-1.5">
          <For each={entries()}>
            {(entry, idx) => (
              <li
                class="grid grid-cols-[1fr_5rem_2fr_max-content] gap-2 items-center"
                data-testid={`skill-bonus-row-${idx()}`}
              >
                <input
                  type="text"
                  value={entry.skill}
                  disabled={!props.canEdit}
                  onBlur={(e) => setEntry(idx(), { skill: e.currentTarget.value })}
                  placeholder="Skill name"
                  data-testid={`skill-bonus-name-${idx()}`}
                  class="rounded border border-border bg-surface px-2 py-1 text-sm"
                />
                <input
                  type="number"
                  value={entry.value}
                  disabled={!props.canEdit}
                  onChange={(e) => {
                    const v = Number.parseInt(e.currentTarget.value, 10);
                    if (Number.isFinite(v)) setEntry(idx(), { value: v });
                  }}
                  data-testid={`skill-bonus-value-${idx()}`}
                  class="rounded border border-border bg-surface px-2 py-1 text-sm"
                />
                <input
                  type="text"
                  value={entry.condition}
                  disabled={!props.canEdit}
                  onBlur={(e) =>
                    setEntry(idx(), { condition: e.currentTarget.value })
                  }
                  placeholder="When (optional)"
                  data-testid={`skill-bonus-condition-${idx()}`}
                  class="rounded border border-border bg-surface px-2 py-1 text-sm"
                />
                <Show when={props.canEdit}>
                  <button
                    type="button"
                    onClick={() => removeEntry(idx())}
                    data-testid={`skill-bonus-remove-${idx()}`}
                    class="text-[0.65rem] uppercase tracking-wider rounded border border-border-muted px-2 py-1 text-fg-subtle hover:text-danger hover:border-danger"
                  >
                    ✕
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.canEdit}>
        <button
          type="button"
          onClick={addEntry}
          data-testid="skill-bonus-add"
          class="self-start rounded border border-border bg-surface-elevated px-3 py-1 text-sm hover:border-accent"
        >
          + add bonus
        </button>
      </Show>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Special rules — free-text
 * ----------------------------------------------------------------------- */

function SpecialRulesSection(props: {
  itemId: EntityId;
  canEdit: boolean;
}): JSX.Element {
  const editField = useEditField(props.itemId);
  const r = useTrait(props.itemId, TbItemSpecialRules) as () =>
    | { text: string }
    | undefined;
  const [draft, setDraft] = createSignal(r()?.text ?? "");
  let lastSeen = r()?.text ?? "";
  const sync = (): void => {
    const cur = r()?.text ?? "";
    if (cur !== lastSeen) {
      setDraft(cur);
      lastSeen = cur;
    }
  };
  sync();
  const commit = (): void => {
    if (draft() !== lastSeen) {
      editField("TbItemSpecialRules.text", draft());
      lastSeen = draft();
    }
  };
  return (
    <textarea
      value={draft()}
      disabled={!props.canEdit}
      onInput={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      data-testid="special-rules-text"
      rows={4}
      placeholder="Free-text rules notes"
      class="w-full rounded border border-border bg-surface px-2 py-1 text-sm font-mono"
    />
  );
}

/* -------------------------------------------------------------------------
 * Bundle / stack — count + capacity for items that come in fixed
 * groups (TB torches: 4 per pack-1 slot; iron spikes: 6; etc.).
 * Editing capacity is a normal field-edit; count goes through the
 * dedicated SplitItemBundle command (since bumping the count by
 * editing it would skip the new-fork allocation).
 * ----------------------------------------------------------------------- */

function BundleSection(props: { itemId: EntityId; canEdit: boolean }): JSX.Element {
  const client = useClient();
  const editField = useEditField(props.itemId);
  const b = useTrait(props.itemId, ItemBundle) as () =>
    | { count: number; capacity: number }
    | undefined;
  const [splitN, setSplitN] = createSignal(1);

  const onSplit = (): void => {
    const got = b();
    const n = Math.max(1, Math.min(splitN(), got ? got.count - 1 : 1));
    if (!got || n < 1 || n >= got.count) return;
    void client.dispatch(
      SplitItemBundle({
        itemId: props.itemId,
        count: n,
      }) as CommandInstance,
    );
  };

  void JoinItemBundles; // re-exported for downstream UIs that wire item-vs-item join

  return (
    <div class="flex flex-col gap-2 text-sm">
      <div class="flex items-center gap-2">
        <span class="w-24 text-fg-subtle">Capacity</span>
        <input
          type="number"
          min={1}
          max={99}
          value={b()?.capacity ?? 1}
          disabled={!props.canEdit}
          onChange={(e) => {
            const next = Math.max(1, Math.floor(Number(e.currentTarget.value)));
            if (!Number.isFinite(next)) return;
            editField("ItemBundle.capacity", next);
          }}
          data-testid="bundle-capacity"
          class="w-20 rounded border border-border bg-surface px-2 py-1"
        />
        <span class="text-fg-subtle text-[0.7rem]">max units in a full stack</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-24 text-fg-subtle">Count</span>
        <input
          type="number"
          min={1}
          max={99}
          value={b()?.count ?? 1}
          disabled={!props.canEdit}
          onChange={(e) => {
            const next = Math.max(1, Math.floor(Number(e.currentTarget.value)));
            if (!Number.isFinite(next)) return;
            editField("ItemBundle.count", next);
          }}
          data-testid="bundle-count"
          class="w-20 rounded border border-border bg-surface px-2 py-1"
        />
        <span class="text-fg-subtle text-[0.7rem]">
          current units (use Split to peel some off into a new entity)
        </span>
      </div>
      <Show when={b() && b()!.count > 1}>
        <div class="flex items-center gap-2">
          <span class="w-24 text-fg-subtle">Split</span>
          <input
            type="number"
            min={1}
            max={Math.max(1, (b()?.count ?? 1) - 1)}
            value={splitN()}
            disabled={!props.canEdit}
            onInput={(e) => setSplitN(Math.max(1, Math.floor(Number(e.currentTarget.value))))}
            data-testid="bundle-split-count"
            class="w-20 rounded border border-border bg-surface px-2 py-1"
          />
          <button
            type="button"
            onClick={onSplit}
            disabled={!props.canEdit}
            data-testid="bundle-split"
            class="rounded border border-border bg-surface px-2 py-1 text-xs"
          >
            Split off {splitN()}
          </button>
        </div>
      </Show>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Spell Book / Scroll detail sections
 *
 * Lightweight read-only views — the canonical place to manage spells
 * is the Arcane tab on the carrying character's sheet, where the
 * cast/copy/scribe action buttons live alongside the rest of the
 * arcane state. Here we just summarise the contents and surface a
 * deep-link to the spell's rulebook citation.
 * ----------------------------------------------------------------------- */

function SpellBookDetail(props: {
  itemId: EntityId;
  canEdit: boolean;
}): JSX.Element {
  void props.canEdit;
  const book = useTrait(props.itemId, TbSpellBook);
  const folios = createMemo(() => book()?.folios ?? 5);
  const contents = createMemo(() => book()?.contents ?? []);
  return (
    <div
      data-testid={`item-spellbook-${props.itemId}`}
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.4rem",
        "font-size": "0.8rem",
      }}
    >
      <div style={{ color: "var(--color-fg-muted)" }}>
        Folio capacity: {folios()} · Spells: {contents().length}
      </div>
      <Show
        when={contents().length > 0}
        fallback={
          <span style={{ "font-style": "italic", color: "var(--color-fg-muted)" }}>
            (empty book)
          </span>
        }
      >
        <ul
          style={{
            "list-style": "none",
            padding: 0,
            margin: 0,
            display: "flex",
            "flex-direction": "column",
            gap: "0.2rem",
          }}
        >
          <For each={contents()}>
            {(sid) => <SpellSummaryRow spellId={sid} />}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function ScrollDetail(props: {
  itemId: EntityId;
  canEdit: boolean;
}): JSX.Element {
  void props.canEdit;
  const scroll = useTrait(props.itemId, TbScroll);
  const sid = createMemo(() => scroll()?.spellId ?? null);
  const consumed = createMemo(() => scroll()?.consumed ?? false);
  return (
    <div
      data-testid={`item-scroll-${props.itemId}`}
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.4rem",
        "font-size": "0.8rem",
      }}
    >
      <Show
        when={sid()}
        fallback={
          <span style={{ "font-style": "italic", color: "var(--color-fg-muted)" }}>
            blank scroll — scribe a spell to fill it
          </span>
        }
      >
        {(spellId) => <SpellSummaryRow spellId={spellId()} />}
      </Show>
      <Show when={consumed()}>
        <span style={{ color: "var(--color-fg-error)", "font-style": "italic" }}>
          consumed
        </span>
      </Show>
    </div>
  );
}

function SpellSummaryRow(props: { spellId: string }): JSX.Element {
  const ident = useTrait(props.spellId, SpellIdentity);
  return (
    <li
      style={{
        display: "flex",
        "align-items": "center",
        gap: "0.5rem",
        padding: "0.25rem 0.4rem",
        "border-radius": "var(--radius-control)",
        background: "var(--color-surface-elevated)",
        border: "1px solid var(--color-border-muted)",
      }}
    >
      <span style={{ "font-weight": "500" }}>{ident()?.name ?? "Unknown"}</span>
      <span style={{ color: "var(--color-fg-muted)", "font-size": "0.7rem" }}>
        circle {ident()?.circle ?? "?"}
      </span>
      <span style={{ color: "var(--color-fg-muted)", "font-size": "0.7rem" }}>
        {ident()?.school ?? "Other"}
      </span>
      <span style={{ "margin-left": "auto" }}>
        <Show when={ident()?.pageRef}>
          {(ref) => (
            <BookCitation
              canonicalId={ref().canonicalId}
              page={ref().page}
              label={
                tbCanonicalBookAbbreviation(ref().canonicalId)
                  ? `${tbCanonicalBookAbbreviation(ref().canonicalId)} p.${ref().page}`
                  : `p.${ref().page}`
              }
            />
          )}
        </Show>
      </span>
    </li>
  );
}
