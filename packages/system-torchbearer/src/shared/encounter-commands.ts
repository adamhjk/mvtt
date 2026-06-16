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
  defineCommand,
  defineEvent,
  defineSystem,
  EntityId,
  fail,
  ok,
  z,
  type EventInstance,
  type TraitName,
} from "@vtt/substrate";
import { EncounterTemplate } from "@vtt/adventures/shared";
import { requireSession } from "@vtt/identity/shared";
import { Character, Team } from "@vtt/characters/shared";
import { gmOnly, Permissions } from "@vtt/permissions/shared";
import { ConflictDeclared, ConflictTypeEnum } from "../conflict/shared/index.js";
import type { ConflictType } from "../conflict/shared/index.js";
import { Conditions, Heroic, Pools, RawAbilities, TownAbilities } from "./traits.js";
import {
  MonsterCopy,
  MonsterTemplate,
  TbMonster,
  TbMonsterSpecialRules,
  TbMonsterWeapons,
} from "./monster-traits.js";

/**
 * StartEncounter — instantiate a live encounter from an
 * `EncounterTemplate` recipe entity (typically authored as an
 * `encounter` fenced block).
 *
 * Hybrid binding per design/adventures.md § "Encounter instantiation":
 *   - Singular refs (no quantifier) bind directly to the named entity.
 *     Live edits to that entity propagate; conditions stick.
 *   - Quantified refs (`4× character:goblin scout`) require the
 *     referenced entity to carry `MonsterTemplate`. Each copy is
 *     spawned via MonsterCopySpawned events; copies carry
 *     MonsterCopy{templateId, ordinal} so the conflict UI can label
 *     them and a future "rebase mob copies" admin can find them.
 *
 * For v1 the resolved sides are emitted in the EncounterStarted event;
 * the actual TbConflict spawn is left for a follow-up wire-up that
 * hooks into the conflict subsystem's DeclareConflict command. This
 * keeps the encounter instantiation contract testable without
 * dragging in the full conflict-state machine.
 */
export const StartEncounter = defineCommand({
  name: "@vtt/system-torchbearer/StartEncounter",
  schema: z.object({
    templateId: EntityId,
    /** Optional scene to spawn into; omitted = scene-less encounter. */
    sceneId: EntityId.optional(),
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") return fail("only a GM can start an encounter");
    if (!ctx.world.has(ctx.cmd.templateId)) {
      return fail(`unknown encounter template ${ctx.cmd.templateId}`);
    }
    const tmpl = ctx.world.get(ctx.cmd.templateId, [EncounterTemplate]) as
      | { EncounterTemplate: { sides: ReadonlyArray<unknown> } }
      | undefined;
    if (!tmpl) {
      return fail(`entity ${ctx.cmd.templateId} is not an EncounterTemplate`);
    }
    return ok();
  },
  apply: ({ cmd, world }) => {
    const tmpl = world.get(cmd.templateId, [EncounterTemplate]) as
      | {
          EncounterTemplate: {
            name: string;
            type: string;
            sides: ReadonlyArray<{
              name: string;
              participants: ReadonlyArray<{
                kind: string;
                body: string;
                quantity?: number;
              }>;
            }>;
          };
        }
      | undefined;
    if (!tmpl) return [];
    const events: EventInstance[] = [];

    // Resolve every participant. For singular refs, the resolved side
    // entry just carries the entity id directly. For quantified refs,
    // we allocate N ids server-side, emit MonsterCopySpawned per copy
    // (which the universal-mirror system will spawnAt), and reference
    // the new copy ids in the EncounterStarted side payload.
    const resolvedSides: Array<{
      name: string;
      participantIds: EntityId[];
      missing: Array<{ kind: string; body: string }>;
    }> = [];

    for (const side of tmpl.EncounterTemplate.sides) {
      const participantIds: EntityId[] = [];
      const missing: Array<{ kind: string; body: string }> = [];
      for (const p of side.participants) {
        const target = resolveParticipantEntity(world, p.kind, p.body);
        if (target === null) {
          missing.push({ kind: p.kind, body: p.body });
          continue;
        }
        if (p.quantity && p.quantity > 1) {
          // Quantified — must point at a MonsterTemplate. Spawn N copies.
          const isTemplate = world.get(target, [MonsterTemplate]) !== undefined;
          if (!isTemplate) {
            missing.push({ kind: p.kind, body: p.body });
            continue;
          }
          for (let i = 1; i <= p.quantity; i += 1) {
            const copyId = world.allocateId();
            participantIds.push(copyId);
            events.push(
              MonsterCopySpawned({
                copyId,
                templateId: target,
                ordinal: i,
              }),
            );
          }
        } else {
          // Singular bind — use the entity directly.
          participantIds.push(target);
        }
      }
      resolvedSides.push({ name: side.name, participantIds, missing });
    }

    const encounterId = world.allocateId();
    events.push(
      EncounterStarted({
        encounterId,
        templateId: cmd.templateId,
        ...(cmd.sceneId !== undefined && { sceneId: cmd.sceneId }),
        type: tmpl.EncounterTemplate.type,
        name: tmpl.EncounterTemplate.name,
        sides: resolvedSides,
      }),
    );

    // Also emit ConflictDeclared so the existing TB conflict subsystem
    // can spawn a real TbConflict + per-participant entities. We
    // duplicate DeclareConflict's apply work here (allocate ids,
    // build participants, pick captain) rather than dispatching a
    // command from inside apply (which the substrate forbids).
    //
    // Side classification: "pcs" / "party" → party side; everything
    // else → enemy. If the party side is empty (e.g. "any present"
    // shorthand), enumerate world Characters with Team{kind:"party"}.
    const conflictTypeMapped = mapConflictType(tmpl.EncounterTemplate.type);
    if (conflictTypeMapped) {
      const partySide = resolvedSides.find((s) => ["pcs", "party"].includes(s.name.toLowerCase()));
      const enemySide = resolvedSides.find((s) => !["pcs", "party"].includes(s.name.toLowerCase()));
      const partyIds: import("@vtt/substrate").EntityId[] = partySide
        ? [...partySide.participantIds]
        : [];
      if (partyIds.length === 0) {
        for (const row of world.query([Character, Team])) {
          const t = row.values.Team as { kind: string };
          if (t.kind === "party") partyIds.push(row.id);
        }
      }
      const enemyIds: import("@vtt/substrate").EntityId[] = enemySide
        ? [...enemySide.participantIds]
        : [];
      // Skip ConflictDeclared if either side is empty — the conflict
      // requires min 1 participant per side, and a degenerate
      // encounter doesn't make sense to start automatically. The
      // EncounterStarted event is still emitted so the GM can see
      // missing participants in the diagnostic.
      if (partyIds.length > 0 && enemyIds.length > 0) {
        const partyParticipants = partyIds.map((characterId) => ({
          participantEntityId: world.allocateId(),
          characterId,
          armorStateEntityId: world.allocateId(),
        }));
        const enemyParticipants = enemyIds.map((characterId) => ({
          participantEntityId: world.allocateId(),
          characterId,
          armorStateEntityId: world.allocateId(),
        }));
        const conflictId = world.allocateId();
        const partyScriptEntityId = world.allocateId();
        const enemyScriptEntityId = world.allocateId();
        events.push(
          ConflictDeclared({
            conflictId,
            partyScriptEntityId,
            enemyScriptEntityId,
            type: conflictTypeMapped,
            locationLabel: tmpl.EncounterTemplate.name,
            captainCharacterId: partyIds[0]!,
            gmUserId: "encounter-orchestrator",
            partyUserIds: [],
            partyParticipants,
            enemyParticipants,
          }),
        );
      }
    }
    return events;
  },
});

/**
 * Normalise an encounter block's free-text `type` (`"kill"`, `"drive_off"`,
 * `"convince crowd"`, etc.) to one of the ConflictTypeEnum members.
 * Returns null when no mapping is found — caller skips ConflictDeclared.
 */
export function mapConflictType(raw: string): ConflictType | null {
  const norm = raw.toLowerCase().replace(/[^a-z]/g, "");
  const aliases: Record<string, ConflictType> = {
    kill: "kill",
    driveoff: "driveOff",
    capture: "capture",
    convince: "convince",
    convincecrowd: "convinceCrowd",
    flee: "flee",
    pursue: "pursue",
    trick: "trick",
    other: "other",
  };
  return aliases[norm] ?? null;
}

void ConflictTypeEnum;

/**
 * Resolve a participant's `(kind, body)` to a live entity id by name.
 * v1 walks the world looking for a matching name; matches case-
 * insensitive. Returns null when nothing matches.
 *
 * The wiki-link kind (`character`, `item`, `spell`) is informational
 * for now — every entity-by-name lookup goes through the same name
 * search. Future work can route by kind to the right registry.
 */
function resolveParticipantEntity(
  world: import("@vtt/substrate").World,
  kind: string,
  body: string,
): EntityId | null {
  void kind;
  const target = body.toLowerCase().trim();
  for (const row of world.query([Character])) {
    const v = row.values.Character as { name: string };
    if (v.name.toLowerCase() === target) return row.id;
  }
  return null;
}

/** Emitted by StartEncounter once a template has been instantiated. */
export const EncounterStarted = defineEvent({
  name: "@vtt/system-torchbearer/EncounterStarted",
  schema: z.object({
    encounterId: EntityId,
    templateId: EntityId,
    sceneId: EntityId.optional(),
    type: z.string().min(1).max(60),
    name: z.string().min(1).max(240),
    sides: z.array(
      z.object({
        name: z.string().min(1).max(60),
        participantIds: z.array(EntityId),
        missing: z.array(
          z.object({
            kind: z.string().min(1).max(60),
            body: z.string().min(1).max(240),
          }),
        ),
      }),
    ),
  }),
});

/** Emitted by StartEncounter for each per-encounter mob copy. */
export const MonsterCopySpawned = defineEvent({
  name: "@vtt/system-torchbearer/MonsterCopySpawned",
  schema: z.object({
    copyId: EntityId,
    templateId: EntityId,
    ordinal: z.number().int().min(1).max(99),
  }),
});

/**
 * Universal-mirror system: react to MonsterCopySpawned by spawning the
 * copy entity at the server-allocated id, with traits cloned from the
 * template (minus the MonsterTemplate marker, plus a MonsterCopy
 * marker, plus reset runtime state).
 */
export const MonsterCopySpawningSystem = defineSystem({
  name: "MonsterCopySpawning",
  on: MonsterCopySpawned,
  reads: [
    Character,
    RawAbilities,
    TownAbilities,
    TbMonster,
    TbMonsterWeapons,
    TbMonsterSpecialRules,
  ],
  writes: [
    Character,
    Permissions,
    Team,
    RawAbilities,
    TownAbilities,
    Conditions,
    Heroic,
    Pools,
    TbMonster,
    TbMonsterWeapons,
    TbMonsterSpecialRules,
    MonsterCopy,
  ],
  run: ({ event, world }) => {
    if (!world.has(event.templateId)) return [];
    const tname = world.get(event.templateId, [Character]) as
      | { Character: { name: string } }
      | undefined;
    const tabilities = world.get(event.templateId, [RawAbilities]) as
      | { RawAbilities: unknown }
      | undefined;
    const ttown = world.get(event.templateId, [TownAbilities]) as
      | { TownAbilities: unknown }
      | undefined;
    const tmonster = world.get(event.templateId, [TbMonster]) as { TbMonster: unknown } | undefined;
    const tweapons = world.get(event.templateId, [TbMonsterWeapons]) as
      | { TbMonsterWeapons: unknown }
      | undefined;
    const trules = world.get(event.templateId, [TbMonsterSpecialRules]) as
      | { TbMonsterSpecialRules: unknown }
      | undefined;

    const factories: Array<{ name: TraitName; value: unknown }> = [
      Character({ name: `${tname?.Character.name ?? "Mob"} #${event.ordinal}` }),
      Permissions({ read: gmOnly(), write: gmOnly() }),
      Team({ kind: "enemy" }),
      Heroic({ abilities: [], townAbilities: [], skills: [] }),
      Pools({
        fate: { current: 0, totalSpent: 0 },
        persona: { current: 0, totalSpent: 0 },
      }),
      Conditions({
        fresh: false,
        hungryThirsty: false,
        angry: false,
        afraid: false,
        exhausted: false,
        injured: false,
        sick: false,
        dead: false,
      }),
      MonsterCopy({ templateId: event.templateId, ordinal: event.ordinal }),
    ];
    if (tabilities) {
      factories.push(RawAbilities(tabilities.RawAbilities as never));
    }
    if (ttown) {
      factories.push(TownAbilities(ttown.TownAbilities as never));
    }
    if (tmonster) {
      factories.push(TbMonster(tmonster.TbMonster as never));
    }
    if (tweapons) {
      factories.push(TbMonsterWeapons(tweapons.TbMonsterWeapons as never));
    }
    if (trules) {
      factories.push(TbMonsterSpecialRules(trules.TbMonsterSpecialRules as never));
    }
    world.spawnAt(event.copyId, factories);
    return [];
  },
});
