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
  previewRollable,
  qualifiedName,
  type CommandInstance,
  type EntityId,
  type Registry,
  type World,
} from "@vtt/substrate";
import { Character, OpenPendingRoll } from "@vtt/characters/shared";
import { canWrite, Permissions } from "@vtt/permissions/shared";
import type {
  PaletteAction,
  PaletteActionProvider,
} from "@vtt/shell-workbench/shared";
import {
  ALL_SKILLS,
  CirclesCheck,
  HealthCheck,
  NatureCheck,
  RawAbilities,
  ResourcesCheck,
  Skills,
  SkillCheck,
  TownAbilities,
  WillCheck,
} from "../shared/index.js";

/**
 * The fixed ability / town-ability rollables, in sheet order. Each takes
 * no per-call opts — `RollableLabel` dispatches them with `opts: {}`, so
 * we mirror that exactly. Skills are enumerated separately (one rollable,
 * parameterised by `skillId`).
 */
const FIXED_ROLLABLES: ReadonlyArray<{ label: string; name: string }> = [
  { label: "Will", name: WillCheck.name },
  { label: "Health", name: HealthCheck.name },
  { label: "Nature", name: NatureCheck.name },
  { label: "Resources", name: ResourcesCheck.name },
  { label: "Circles", name: CirclesCheck.name },
];

interface RollableOption {
  label: string;
  rollableName: string;
  opts: Record<string, unknown>;
}

/** `previewRollable` returns the system spec; we only need its pool. */
function rollablePool(
  registry: Registry,
  world: World,
  charId: EntityId,
  name: string,
  opts: Record<string, unknown>,
): number | null {
  const rollable = registry.rollables.get(
    name as Parameters<typeof registry.rollables.get>[0],
  );
  if (!rollable) return null;
  try {
    const spec = previewRollable(rollable, world, charId, opts) as
      | { pool?: number }
      | null;
    if (!spec) return null;
    return typeof spec.pool === "number" ? spec.pool : 0;
  } catch {
    return null;
  }
}

/**
 * Every ability / skill / town-ability the given character can actually
 * roll, mirroring what the sheet's `RollableLabel`s dispatch:
 *   - fixed rollables (Will/Health/Nature/Resources/Circles) are included
 *     when the rollable previews a non-empty dice pool — so a monster that
 *     only has Nature gets just Nature, and a PC gets all five.
 *   - skills: ALL of them, learned or not. Beginner's Luck (DH p.59) lets
 *     you roll any skill you have 0 in by falling back to the related
 *     ability, so every skill is rollable — `SkillCheck` previews fine at
 *     rating 0. `rollablePool` returns null only when the character can't
 *     roll skills at all (e.g. a monster with no Will/Health for BL to
 *     draw on), which correctly drops the whole skill set for it.
 */
export function tbRollablesForCharacter(
  registry: Registry,
  world: World,
  charId: EntityId,
): RollableOption[] {
  const out: RollableOption[] = [];
  for (const r of FIXED_ROLLABLES) {
    const pool = rollablePool(registry, world, charId, r.name, {});
    if (pool !== null && pool > 0) {
      out.push({ label: r.label, rollableName: r.name, opts: {} });
    }
  }
  for (const def of ALL_SKILLS) {
    const pool = rollablePool(registry, world, charId, SkillCheck.name, {
      skillId: def.id,
    });
    if (pool === null) continue;
    out.push({
      label: def.name,
      rollableName: SkillCheck.name,
      opts: { skillId: def.id },
    });
  }
  return out;
}

/**
 * ⌘K "roll" entries. For every character/monster the user can **write**
 * to (a player sees only their own; a GM sees all, including monsters),
 * emit one entry per rollable ability/skill: "Roll Tarn — Will", "Roll
 * Tarn — Fighter", … Choosing one dispatches the exact `OpenPendingRoll`
 * a sheet click would, so the Roll Atelier opens (via its auto-focus) on
 * that pending roll.
 *
 * Write-gating is the access model the user asked for: rollables are
 * things you control. `query([Character])` is already read-filtered, and
 * `canWrite` then drops characters you can see but can't act for (other
 * players, GM-only monsters in a player session).
 */
export const TbRollPaletteActions: PaletteActionProvider = {
  id: qualifiedName(
    "@vtt/system-torchbearer/roll-actions",
  ) as PaletteActionProvider["id"],
  reads: [Character, RawAbilities, TownAbilities, Skills, Permissions],
  list: (ctx) => {
    const actor = { userId: ctx.userId, role: ctx.role };
    const out: PaletteAction[] = [];
    for (const row of ctx.world.query([Character])) {
      const permRow = ctx.world.get(row.id, [Permissions]) as
        | { Permissions: Parameters<typeof canWrite>[1] }
        | undefined;
      if (!canWrite(actor, permRow?.Permissions)) continue;
      const charName = (row.values.Character as { name: string }).name;
      for (const r of tbRollablesForCharacter(
        ctx.registry,
        ctx.world,
        row.id as EntityId,
      )) {
        const skillId = (r.opts as { skillId?: string }).skillId ?? "";
        out.push({
          id: `tb-roll:${row.id}:${r.rollableName}:${skillId}`,
          label: `Roll ${charName} — ${r.label}`,
          tag: "roll",
          command: OpenPendingRoll({
            initiatorCharacterId: row.id as EntityId,
            rollableName: r.rollableName,
            opts: r.opts,
          }) as CommandInstance,
        });
      }
    }
    return out;
  },
};
