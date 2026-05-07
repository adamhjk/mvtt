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
import { createMemo } from "solid-js";
import { Character } from "@vtt/characters/shared";
import { TbArmor, TbCarries } from "../../shared/index.js";
import {
  TbConflict,
  TbConflictParticipant,
  TbConflictScript,
  TbConflictWeapon,
} from "../shared/index.js";
import type {
  ConflictSide,
  ScriptSlot,
} from "../shared/index.js";

/**
 * Set of item-entity ids carried by *any* character in the world.
 * Reactive: re-derives whenever any TbCarries trait changes. Used by
 * the weapon/armor pickers to distinguish "owned by a character"
 * (only that character can wield it — Hideous Bite belongs to the
 * Vampire Lord) from "shared catalog conflict resource" (Blackmail,
 * Hostage, True Name — anyone can pick).
 */
export function useGloballyCarriedItemIds(): () => ReadonlySet<string> {
  const carriers = useQuery([TbCarries]);
  return createMemo<ReadonlySet<string>>(() => {
    const out = new Set<string>();
    for (const row of carriers()) {
      const c = row.values.TbCarries as ReturnType<typeof TbCarries>["value"];
      for (const e of c.entries) out.add(e.itemId as string);
    }
    return out;
  });
}

export interface ConflictView {
  readonly id: EntityId;
  readonly type: ReturnType<typeof TbConflict>["value"]["type"];
  readonly locationLabel: string;
  readonly captainCharacterId: EntityId;
  readonly gmUserId: string;
  readonly round: number;
  readonly revealIndex: number;
  readonly partyLocked: boolean;
  readonly enemyLocked: boolean;
  readonly revealedSlots: ReturnType<typeof TbConflict>["value"]["revealedSlots"];
  readonly dispoParty: { current: number; max: number };
  readonly dispoEnemy: { current: number; max: number };
  readonly winner: ReturnType<typeof TbConflict>["value"]["winner"];
  readonly endedAt: number | null;
}

export function useConflict(conflictId: EntityId): () => ConflictView | null {
  const t = useTrait(conflictId, TbConflict) as () =>
    | ReturnType<typeof TbConflict>["value"]
    | undefined;
  return createMemo(() => {
    const v = t();
    if (!v) return null;
    return { ...v, id: conflictId };
  });
}

/**
 * One participant row, *without* a snapshotted displayName. Pull
 * the name live from the bound character's `Character.name` via
 * `useParticipantName(characterId)` at the call site so the panel
 * reacts to renames.
 */
export interface ParticipantView {
  readonly entityId: EntityId;
  readonly conflictId: EntityId;
  readonly side: ConflictSide;
  readonly characterId: EntityId;
  readonly hp: number;
  readonly hpMax: number;
  readonly knockedOut: boolean;
  readonly label?: string;
}

export function useParticipants(
  conflictId: EntityId,
  side: ConflictSide,
): () => ParticipantView[] {
  const all = useQuery([TbConflictParticipant]);
  return createMemo(() => {
    const out: ParticipantView[] = [];
    for (const row of all()) {
      const p = row.values.TbConflictParticipant as ReturnType<
        typeof TbConflictParticipant
      >["value"];
      if (p.conflictId === conflictId && p.side === side) {
        out.push({ ...p, entityId: row.id });
      }
    }
    return out;
  });
}

/**
 * Live equipped-armor view for a character. Pure read off the
 * character's `TbCarries` + each item's `TbArmor` — no per-conflict
 * degradation state, since the conflict surface is a play aid, not
 * an automation engine. Picking up a fresh helmet mid-fight shows
 * up immediately.
 */
export interface EquippedArmor {
  readonly armorItemId: EntityId | null;
  readonly helmetItemId: EntityId | null;
  readonly shieldItemId: EntityId | null;
}

export function useEquippedArmor(
  characterId: EntityId,
): () => EquippedArmor {
  const carries = useTrait(characterId, TbCarries) as () =>
    | ReturnType<typeof TbCarries>["value"]
    | undefined;
  const allArmorItems = useQuery([TbArmor]);
  return createMemo<EquippedArmor>(() => {
    const c = carries();
    if (!c) {
      return { armorItemId: null, helmetItemId: null, shieldItemId: null };
    }
    const types = new Map<string, string>();
    for (const r of allArmorItems()) {
      const a = r.values.TbArmor as { armorType: string };
      types.set(r.id as string, a.armorType);
    }
    let armor: EntityId | null = null;
    let helmet: EntityId | null = null;
    let shield: EntityId | null = null;
    for (const entry of c.entries) {
      const t = types.get(entry.itemId as string);
      if (!t) continue;
      if (t === "helmet") helmet = entry.itemId as EntityId;
      else if (t === "shield") shield = entry.itemId as EntityId;
      else if (t === "leather" || t === "chain" || t === "plate")
        armor = entry.itemId as EntityId;
    }
    return { armorItemId: armor, helmetItemId: helmet, shieldItemId: shield };
  });
}

/**
 * Live character name accessor. Returns the current `Character.name`
 * or a fallback. The conflict panels render names through this so
 * renaming a character in the Characters tab updates the conflict
 * board immediately.
 */
export function useCharacterName(
  characterId: EntityId,
  fallback = "(character)",
): () => string {
  const ch = useTrait(characterId, Character) as () =>
    | { name: string }
    | undefined;
  return createMemo(() => ch()?.name ?? fallback);
}

export interface WeaponView {
  readonly conflictId: EntityId;
  readonly participantEntityId: EntityId;
  readonly weaponItemId: EntityId | null;
  readonly chosenAction: ReturnType<typeof TbConflictWeapon>["value"]["chosenAction"];
}

/**
 * Map of participantEntityId → current weapon binding for a conflict.
 * Indexed by the *participant* (not the character) so two goblins
 * referencing the same Goblin character entity can wield two
 * different weapons.
 */
export function useWeaponBindings(
  conflictId: EntityId,
): () => Map<EntityId, WeaponView> {
  const all = useQuery([TbConflictWeapon]);
  return createMemo(() => {
    const out = new Map<EntityId, WeaponView>();
    for (const row of all()) {
      const w = row.values.TbConflictWeapon as ReturnType<
        typeof TbConflictWeapon
      >["value"];
      if (w.conflictId !== conflictId) continue;
      out.set(w.participantEntityId, w);
    }
    return out;
  });
}

export interface ScriptView {
  readonly entityId: EntityId;
  readonly conflictId: EntityId;
  readonly side: ConflictSide;
  readonly locked: boolean;
  readonly slots: [ScriptSlot, ScriptSlot, ScriptSlot];
}

export function useScript(
  conflictId: EntityId,
  side: ConflictSide,
): () => ScriptView | null {
  const all = useQuery([TbConflictScript]);
  return createMemo(() => {
    for (const row of all()) {
      const s = row.values.TbConflictScript as ReturnType<
        typeof TbConflictScript
      >["value"];
      if (s.conflictId === conflictId && s.side === side) {
        return { ...s, entityId: row.id };
      }
    }
    return null;
  });
}

