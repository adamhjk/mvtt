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

import type { EntityId } from "@vtt/substrate";
import { useQuery, useTrait } from "@vtt/substrate/client";
import { BookCitation } from "@vtt/books/client";
import { createMemo, For, Show, type JSX } from "solid-js";
import { ItemDerivedFrom, ItemIdentity } from "@vtt/items/shared";
import {
  TbCarries,
  TbItemSpecialRules,
  TbWeapon,
} from "../../shared/items/index.js";
import { TbConflictResource } from "../../shared/monster-traits.js";
import { tbCanonicalBookAbbreviation } from "../../data/seed.js";
import {
  ALL_ACTIONS,
  type ConflictAction,
  type ConflictSide,
} from "../shared/index.js";
import {
  useCharacterName,
  useConflict,
  useParticipants,
  useWeaponBindings,
} from "./hooks.js";
import { ACTION_LETTERS } from "./styles.js";
import {
  TB_CONFLICT_TYPES,
  type ConflictType,
} from "../shared/index.js";

function citationLabel(canonicalId: string, page: number): string {
  const abbrev = tbCanonicalBookAbbreviation(canonicalId);
  return abbrev !== null ? `${abbrev} p.${page}` : `p.${page}`;
}

/**
 * Per-side weapon possibility table — every weapon each participant
 * could choose, not just the one they've selected. Helps the GM (and
 * the captain) see the full menu before locking in a script.
 *
 * Per character, the rows list every weapon the character *carries*
 * that's relevant to the current conflict (generic items like swords
 * always count; items with an explicit `applicableConflicts` only
 * when the active conflict is in the list — same gate as the
 * dropdown). Shared catalog conflict-resources (Blackmail, Hostage,
 * True Name) live in the standalone `<ConflictWeaponsReference>`
 * section so they're not duplicated for every participant.
 *
 * The currently-bound weapon (from `TbConflictWeapon`) is highlighted.
 * Read-only — the dropdown on the team column owns the actual pick.
 */
export function WeaponPanel(props: {
  conflictId: EntityId;
  side: ConflictSide;
  title: string;
}): JSX.Element {
  const participants = useParticipants(props.conflictId, props.side);
  return (
    <section
      class="px-3 py-3 border-t border-border-muted"
      data-testid={`weapon-panel-${props.side}`}
    >
      <h2 class="font-display text-[0.7rem] uppercase tracking-[0.16em] mb-2">
        {props.title} — Possibilities
      </h2>
      <For each={participants()}>
        {(p) => (
          <ParticipantWeapons
            conflictId={props.conflictId}
            participantEntityId={p.entityId}
            characterId={p.characterId}
            label={p.label}
          />
        )}
      </For>
    </section>
  );
}

function ParticipantWeapons(props: {
  conflictId: EntityId;
  participantEntityId: EntityId;
  characterId: EntityId;
  label: string | undefined;
}): JSX.Element {
  const characterName = useCharacterName(props.characterId);
  const name = createMemo(() => props.label ?? characterName());
  const conflict = useConflict(props.conflictId);
  const carries = useTrait(props.characterId, TbCarries) as () =>
    | ReturnType<typeof TbCarries>["value"]
    | undefined;
  const allWeapons = useQuery([TbWeapon]);
  const conflictResources = useQuery([TbWeapon, TbConflictResource]);
  const bindings = useWeaponBindings(props.conflictId);

  const boundId = createMemo<EntityId | null>(
    () => bindings().get(props.participantEntityId)?.weaponItemId ?? null,
  );

  const possibleIds = createMemo<EntityId[]>(() => {
    // Per-participant rows are exactly the weapons this character
    // carries that match the conflict — generic items (no
    // `TbConflictResource`, e.g. a sword) always; items with an
    // explicit `applicableConflicts` only when the conflict is in
    // the list. Shared catalog resources (Blackmail, Hostage, etc.)
    // live in the dedicated reference section, not duplicated here.
    const ct = conflict()?.type;
    const carried = new Set(
      (carries()?.entries ?? []).map((e) => e.itemId as string),
    );
    const matches = (cr: {
      applicableConflicts: ReadonlyArray<string>;
    }): boolean => {
      if (cr.applicableConflicts.length === 0) return true;
      if (!ct) return true;
      return cr.applicableConflicts.includes(ct);
    };
    const crById = new Map<
      string,
      { applicableConflicts: ReadonlyArray<string>; kind: string }
    >();
    for (const row of conflictResources()) {
      crById.set(
        row.id as string,
        row.values.TbConflictResource as {
          applicableConflicts: ReadonlyArray<string>;
          kind: string;
        },
      );
    }
    const ids = new Set<string>();
    for (const row of allWeapons()) {
      if (!carried.has(row.id as string)) continue;
      const cr = crById.get(row.id as string);
      if (!cr) {
        ids.add(row.id as string);
      } else if (cr.kind === "weapon" && matches(cr)) {
        ids.add(row.id as string);
      }
    }
    return Array.from(ids) as EntityId[];
  });

  return (
    <div
      class="mb-3 last:mb-0"
      data-testid={`weapon-participant-${props.participantEntityId}`}
    >
      <div class="font-display text-[0.6rem] uppercase tracking-[0.14em] text-fg-subtle mb-1">
        {name()}
      </div>
      <Show
        when={possibleIds().length > 0}
        fallback={
          <p
            class="text-[0.7rem] text-fg-subtle italic"
            data-testid={`weapon-empty-${props.participantEntityId}`}
          >
            no weapon available for this conflict — would fight unarmed
            (-1D)
          </p>
        }
      >
        <table
          class="w-full text-sm font-mono border-collapse"
          style={{ "table-layout": "fixed" }}
        >
          <colgroup>
            <col style={{ width: "1.2rem" }} />
            <col style={{ width: "10rem" }} />
            <For each={ALL_ACTIONS}>
              {() => <col style={{ width: "2.5rem" }} />}
            </For>
            <col />
          </colgroup>
          <thead>
            <tr class="text-fg-subtle">
              <th aria-hidden="true" />
              <th class="text-left pb-1 font-normal">weapon</th>
              <For each={ALL_ACTIONS}>
                {(a) => (
                  <th class="text-center pb-1 font-normal">
                    {ACTION_LETTERS[a]}
                  </th>
                )}
              </For>
              <th class="text-left pb-1 pl-2 font-normal">special</th>
            </tr>
          </thead>
          <tbody>
            <For each={possibleIds()}>
              {(id) => (
                <WeaponRow
                  itemId={id}
                  bound={boundId() === id}
                />
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}

function WeaponRow(props: {
  itemId: EntityId;
  bound: boolean;
}): JSX.Element {
  const ident = useTrait(props.itemId, ItemIdentity) as () =>
    | { name: string }
    | undefined;
  const weapon = useTrait(props.itemId, TbWeapon) as () =>
    | ReturnType<typeof TbWeapon>["value"]
    | undefined;
  const special = useTrait(props.itemId, TbItemSpecialRules) as () =>
    | { text: string }
    | undefined;
  const conflictRes = useTrait(props.itemId, TbConflictResource) as () =>
    | {
        note: string;
        applicableConflicts: ReadonlyArray<string>;
        pageRef?: { canonicalId: string; page: number } | null;
      }
    | undefined;
  const weaponPageRef = createMemo(() => conflictRes()?.pageRef ?? null);
  const bonusFor = (action: ConflictAction): string => {
    const b = weapon()?.conflictBonuses?.[action];
    if (!b || b.value === 0) return "—";
    const sign = b.value > 0 ? "+" : "";
    const suffix = b.type === "dice" ? "D" : b.type === "success" ? "s" : "r";
    return `${sign}${b.value}${suffix}`;
  };
  const specialText = (): string => {
    const sp = special()?.text ?? "";
    const cr = conflictRes()?.note ?? "";
    if (sp && cr && sp !== cr) return `${sp} · ${cr}`;
    return sp || cr;
  };
  return (
    <tr
      class="border-t border-border-muted/40"
      classList={{ "bg-surface-elevated": props.bound }}
      data-testid="weapon-row"
      data-bound={props.bound ? "true" : "false"}
    >
      <td class="py-1 text-center text-accent" aria-hidden="true">
        <Show when={props.bound} fallback={<span>&nbsp;</span>}>
          ▸
        </Show>
      </td>
      <td class="py-1 truncate" title={ident()?.name ?? ""}>
        {ident()?.name ?? "(item)"}
      </td>
      <For each={ALL_ACTIONS}>
        {(a) => (
          <td class="text-center" data-testid={`weapon-bonus-${a}`}>
            {bonusFor(a)}
          </td>
        )}
      </For>
      <td
        class="py-1 pl-2 text-[0.65rem] text-fg-subtle leading-snug"
        title={specialText()}
      >
        <span class="inline-flex flex-wrap items-baseline gap-1.5">
          <Show when={specialText().length > 0}>
            <span>{specialText()}</span>
          </Show>
          <Show when={weaponPageRef()}>
            {(ref) => (
              <BookCitation
                canonicalId={ref().canonicalId}
                page={ref().page}
                label={citationLabel(ref().canonicalId, ref().page)}
                ariaLabel={`open ${ident()?.name ?? "weapon"} entry in ${ref().canonicalId} at page ${ref().page}`}
              />
            )}
          </Show>
        </span>
      </td>
    </tr>
  );
}

/**
 * Single shared "Conflict Weapons — Quick Reference" section listing
 * every catalog `TbConflictResource{kind:"weapon"}` whose
 * `applicableConflicts` covers the active conflict. Mirrors
 * `ConflictArmorReference` in `ArmorPanel.tsx`.
 *
 * Only catalog resources that aren't carried by anyone show up —
 * monster weapons (Hideous Bite, Cloak of Shadow) are owned by their
 * monster and surfaced under that monster's `WeaponPanel` row, not
 * here.
 */
export function ConflictWeaponsReference(props: {
  conflictId: import("@vtt/substrate").EntityId;
}): JSX.Element {
  const conflict = useConflict(props.conflictId);
  // Only items spawned via the items catalog (carrying
  // `ItemDerivedFrom`) ever appear in the shared reference. Monster
  // weapons are spawned outside the catalog index and therefore
  // never carry ItemDerivedFrom — they're surfaced under the
  // monster's per-participant row in the GM-only enemy WeaponPanel
  // and stay out of the players' shared menu by construction. The
  // belt-and-suspenders `ownerCharacterId` check below catches any
  // catalog item a GM has stamped with explicit ownership.
  const allConflictWeapons = useQuery([
    TbWeapon,
    TbConflictResource,
    ItemDerivedFrom,
    ItemIdentity,
  ]);

  const grouped = createMemo<
    ReadonlyArray<{
      conflictType: ConflictType | "any";
      label: string;
      ids: ReadonlyArray<EntityId>;
    }>
  >(() => {
    const ct = conflict()?.type;
    const byType = new Map<ConflictType | "any", EntityId[]>();
    for (const row of allConflictWeapons()) {
      const cr = row.values.TbConflictResource as {
        applicableConflicts: ConflictType[];
        kind: string;
        ownerCharacterId?: string | null;
      };
      // Defence in depth: ItemDerivedFrom in the query already
      // restricts to catalog items, but if a GM ever stamps a
      // catalog item with explicit ownership (forked instance), keep
      // it out of the shared menu too.
      if (cr.ownerCharacterId) continue;
      if (cr.kind !== "weapon") continue;
      const buckets =
        cr.applicableConflicts.length > 0
          ? cr.applicableConflicts
          : (["any" as const]);
      // Only include in the active conflict (or "any") — same gate
      // as the dropdown so the reference matches what's pickable.
      if (
        ct &&
        cr.applicableConflicts.length > 0 &&
        !cr.applicableConflicts.includes(ct)
      ) {
        continue;
      }
      for (const b of buckets) {
        const list = byType.get(b as ConflictType | "any") ?? [];
        list.push(row.id as EntityId);
        byType.set(b as ConflictType | "any", list);
      }
    }
    const out: Array<{
      conflictType: ConflictType | "any";
      label: string;
      ids: ReadonlyArray<EntityId>;
    }> = [];
    for (const [b, ids] of byType) {
      const label = b === "any" ? "Any" : (TB_CONFLICT_TYPES[b]?.label ?? b);
      out.push({ conflictType: b, label, ids });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  });

  return (
    <Show when={grouped().length > 0}>
      <section
        class="px-3 py-3 border-t border-border-muted"
        data-testid="conflict-weapons-reference"
      >
        <h2 class="font-display text-[0.7rem] uppercase tracking-[0.16em] mb-2">
          Conflict Weapons — Quick Reference
        </h2>
        <For each={grouped()}>
          {(group) => (
            <div class="mb-2 last:mb-0">
              <span class="font-display text-[0.6rem] uppercase tracking-[0.14em] text-fg-subtle">
                {group.label}
              </span>
              <table
                class="w-full text-sm font-mono border-collapse mt-0.5"
                style={{ "table-layout": "fixed" }}
              >
                <colgroup>
                  <col style={{ width: "10rem" }} />
                  <For each={ALL_ACTIONS}>
                    {() => <col style={{ width: "2.5rem" }} />}
                  </For>
                  <col />
                </colgroup>
                <thead>
                  <tr class="text-fg-subtle">
                    <th class="text-left pb-1 font-normal">weapon</th>
                    <For each={ALL_ACTIONS}>
                      {(a) => (
                        <th class="text-center pb-1 font-normal">
                          {ACTION_LETTERS[a]}
                        </th>
                      )}
                    </For>
                    <th class="text-left pb-1 pl-2 font-normal">special</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={group.ids}>
                    {(id) => (
                      <ReferenceRow itemId={id} />
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          )}
        </For>
      </section>
    </Show>
  );
}

function ReferenceRow(props: {
  itemId: import("@vtt/substrate").EntityId;
}): JSX.Element {
  const ident = useTrait(props.itemId, ItemIdentity) as () =>
    | { name: string }
    | undefined;
  const weapon = useTrait(props.itemId, TbWeapon) as () =>
    | ReturnType<typeof TbWeapon>["value"]
    | undefined;
  const cr = useTrait(props.itemId, TbConflictResource) as () =>
    | { note: string }
    | undefined;
  const bonusFor = (action: ConflictAction): string => {
    const b = weapon()?.conflictBonuses?.[action];
    if (!b || b.value === 0) return "—";
    const sign = b.value > 0 ? "+" : "";
    const suffix = b.type === "dice" ? "D" : b.type === "success" ? "s" : "r";
    return `${sign}${b.value}${suffix}`;
  };
  return (
    <tr
      class="border-t border-border-muted/40"
      data-testid={`conflict-weapon-ref-${props.itemId}`}
    >
      <td class="py-1 truncate" title={ident()?.name ?? ""}>
        {ident()?.name ?? "(weapon)"}
      </td>
      <For each={ALL_ACTIONS}>
        {(a) => (
          <td class="text-center" data-testid={`weapon-bonus-${a}`}>
            {bonusFor(a)}
          </td>
        )}
      </For>
      <td
        class="py-1 pl-2 text-[0.65rem] text-fg-subtle leading-snug"
        title={cr()?.note ?? ""}
      >
        {cr()?.note ?? ""}
      </td>
    </tr>
  );
}
