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

/**
 * Conflict subsystem mirror systems. Pure event → world mutations,
 * no resolution engine — players roll dice on their own character
 * sheets and the GM types in dispo / HP changes via the live-edit
 * commands. Reveal flips slot statuses; round-advance clears scripts.
 */

import { defineSystem, type EntityId, type World } from "@vtt/substrate";
import { actors, Permissions } from "@vtt/permissions/shared";
import {
  TbConflict,
  TbConflictParticipant,
  TbConflictScript,
  TbConflictWeapon,
} from "../shared/traits.js";
import {
  CaptainElected,
  CompromiseApplied,
  ConflictDeclared,
  ConflictEnded,
  ConflictParticipantsAdded,
  ConflictWeaponChosen,
  DispositionRolled,
  HpAssigned,
  ParticipantHpSet,
  RoundAdvanced,
  ScriptLocked,
  ScriptSlotCleared,
  ScriptSlotSet,
  ScriptUnlocked,
  SlotRevealed,
  TeamDispositionSet,
} from "../shared/events.js";
import type { ScriptSlot } from "../shared/resolution.js";

/* -------------------------------------------------------------------------
 * Helpers
 * ----------------------------------------------------------------------- */

function getConflict(world: World, conflictId: EntityId) {
  const got = world.get(conflictId, [TbConflict]);
  if (!got) return null;
  return (got as { TbConflict: ReturnType<typeof TbConflict>["value"] })
    .TbConflict;
}

function setConflict(
  world: World,
  conflictId: EntityId,
  patch: Partial<ReturnType<typeof TbConflict>["value"]>,
): void {
  const cur = getConflict(world, conflictId);
  if (!cur) return;
  world.set(conflictId, TbConflict, { ...cur, ...patch });
}

function getScript(
  world: World,
  scriptEntityId: EntityId,
): ReturnType<typeof TbConflictScript>["value"] | null {
  const got = world.get(scriptEntityId, [TbConflictScript]);
  if (!got) return null;
  return (got as { TbConflictScript: ReturnType<typeof TbConflictScript>["value"] })
    .TbConflictScript;
}

function setScriptSlots(
  world: World,
  scriptEntityId: EntityId,
  slots: [ScriptSlot, ScriptSlot, ScriptSlot],
): void {
  const cur = getScript(world, scriptEntityId);
  if (!cur) return;
  world.set(scriptEntityId, TbConflictScript, { ...cur, slots });
}

const EMPTY_SLOTS: [ScriptSlot, ScriptSlot, ScriptSlot] = [
  { status: "empty" },
  { status: "empty" },
  { status: "empty" },
];

/* -------------------------------------------------------------------------
 * Lifecycle
 * ----------------------------------------------------------------------- */

export const ConflictDeclaredSystem = defineSystem({
  name: "@vtt/system-torchbearer/ConflictDeclaredSystem",
  on: ConflictDeclared,
  reads: [],
  writes: [TbConflict, TbConflictParticipant, TbConflictScript],
  run: ({ event, world }) => {
    world.spawnAt(event.conflictId, [
      TbConflict({
        type: event.type,
        locationLabel: event.locationLabel,
        captainCharacterId: event.captainCharacterId,
        gmUserId: event.gmUserId,
        round: 1,
        revealIndex: 0,
        partyLocked: false,
        enemyLocked: false,
        revealedSlots: [null, null, null],
        dispoParty: { current: 0, max: 0 },
        dispoEnemy: { current: 0, max: 0 },
        winner: null,
        endedAt: null,
      }),
    ]);
    world.spawnAt(event.partyScriptEntityId, [
      TbConflictScript({
        conflictId: event.conflictId,
        side: "party",
        locked: false,
        slots: EMPTY_SLOTS,
      }),
      Permissions({
        read: actors([...event.partyUserIds, event.gmUserId]),
        write: actors([...event.partyUserIds, event.gmUserId]),
      }),
    ]);
    world.spawnAt(event.enemyScriptEntityId, [
      TbConflictScript({
        conflictId: event.conflictId,
        side: "enemy",
        locked: false,
        slots: EMPTY_SLOTS,
      }),
      Permissions({
        read: actors([event.gmUserId]),
        write: actors([event.gmUserId]),
      }),
    ]);
    for (const p of event.partyParticipants) {
      world.spawnAt(p.participantEntityId, [
        TbConflictParticipant({
          conflictId: event.conflictId,
          side: "party",
          characterId: p.characterId,
          hp: 0,
          hpMax: 0,
          knockedOut: false,
          label: p.label,
        }),
      ]);
    }
    for (const p of event.enemyParticipants) {
      world.spawnAt(p.participantEntityId, [
        TbConflictParticipant({
          conflictId: event.conflictId,
          side: "enemy",
          characterId: p.characterId,
          hp: 0,
          hpMax: 0,
          knockedOut: false,
          label: p.label,
        }),
      ]);
    }
    return [];
  },
});

export const CaptainElectedSystem = defineSystem({
  name: "@vtt/system-torchbearer/CaptainElectedSystem",
  on: CaptainElected,
  reads: [TbConflict],
  writes: [TbConflict],
  run: ({ event, world }) => {
    setConflict(world, event.conflictId, {
      captainCharacterId: event.captainCharacterId,
    });
    return [];
  },
});

/**
 * Universal mirror for `ConflictParticipantsAdded`. Spawns each
 * participant row at the server-allocated id (no per-side
 * `world.spawn` — that would auto-allocate a different id and
 * silently collide; CLAUDE.md "Entity ids are server-authoritative").
 * `label` is recorded as-is — undefined for solos, "Goblin 1" /
 * "Goblin 2" / … for multi-spawns.
 */
export const ParticipantsAddedSystem = defineSystem({
  name: "@vtt/system-torchbearer/ParticipantsAddedSystem",
  on: ConflictParticipantsAdded,
  reads: [],
  writes: [TbConflictParticipant],
  run: ({ event, world }) => {
    for (const p of event.participants) {
      world.spawnAt(p.participantEntityId, [
        TbConflictParticipant({
          conflictId: event.conflictId,
          side: event.side,
          characterId: p.characterId,
          hp: 0,
          hpMax: 0,
          knockedOut: false,
          label: p.label,
        }),
      ]);
    }
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Disposition + HP
 * ----------------------------------------------------------------------- */

export const DispositionRolledSystem = defineSystem({
  name: "@vtt/system-torchbearer/DispositionRolledSystem",
  on: DispositionRolled,
  reads: [TbConflict],
  writes: [TbConflict],
  run: ({ event, world }) => {
    if (event.side === "party") {
      setConflict(world, event.conflictId, {
        dispoParty: { current: event.finalDispo, max: event.finalDispo },
      });
    } else {
      setConflict(world, event.conflictId, {
        dispoEnemy: { current: event.finalDispo, max: event.finalDispo },
      });
    }
    return [];
  },
});

export const TeamDispositionSetSystem = defineSystem({
  name: "@vtt/system-torchbearer/TeamDispositionSetSystem",
  on: TeamDispositionSet,
  reads: [TbConflict],
  writes: [TbConflict],
  run: ({ event, world }) => {
    const patch =
      event.side === "party"
        ? { dispoParty: { current: event.current, max: event.max } }
        : { dispoEnemy: { current: event.current, max: event.max } };
    setConflict(world, event.conflictId, patch);
    return [];
  },
});

export const ParticipantHpSetSystem = defineSystem({
  name: "@vtt/system-torchbearer/ParticipantHpSetSystem",
  on: ParticipantHpSet,
  reads: [TbConflictParticipant],
  writes: [TbConflictParticipant],
  run: ({ event, world }) => {
    const got = world.get(event.participantEntityId, [TbConflictParticipant]);
    if (!got) return [];
    const cur = (got as { TbConflictParticipant: ReturnType<typeof TbConflictParticipant>["value"] })
      .TbConflictParticipant;
    world.set(event.participantEntityId, TbConflictParticipant, {
      ...cur,
      hp: event.hp,
      hpMax: event.hpMax,
      knockedOut: event.hp === 0,
    });
    return [];
  },
});

export const HpAssignedSystem = defineSystem({
  name: "@vtt/system-torchbearer/HpAssignedSystem",
  on: HpAssigned,
  reads: [TbConflictParticipant],
  writes: [TbConflictParticipant],
  run: ({ event, world }) => {
    for (const a of event.allocations) {
      const got = world.get(a.participantEntityId, [TbConflictParticipant]);
      if (!got) continue;
      const cur = (got as { TbConflictParticipant: ReturnType<typeof TbConflictParticipant>["value"] })
        .TbConflictParticipant;
      world.set(a.participantEntityId, TbConflictParticipant, {
        ...cur,
        hp: a.hp,
        hpMax: a.hp,
      });
    }
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Weapons
 * ----------------------------------------------------------------------- */

export const WeaponChosenSystem = defineSystem({
  name: "@vtt/system-torchbearer/ConflictWeaponChosenSystem",
  on: ConflictWeaponChosen,
  reads: [TbConflictWeapon],
  writes: [TbConflictWeapon],
  run: ({ event, world }) => {
    for (const row of world.query([TbConflictWeapon])) {
      const w = row.values.TbConflictWeapon as ReturnType<typeof TbConflictWeapon>["value"];
      if (
        w.conflictId === event.conflictId &&
        w.participantEntityId === event.participantEntityId
      ) {
        world.set(row.id, TbConflictWeapon, {
          ...w,
          weaponItemId: event.weaponItemId,
        });
        return [];
      }
    }
    world.spawn([
      TbConflictWeapon({
        conflictId: event.conflictId,
        participantEntityId: event.participantEntityId,
        weaponItemId: event.weaponItemId,
        chosenAction: null,
      }),
    ]);
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Script slots
 * ----------------------------------------------------------------------- */

export const ScriptSlotSetSystem = defineSystem({
  name: "@vtt/system-torchbearer/ScriptSlotSetSystem",
  on: ScriptSlotSet,
  reads: [TbConflictScript],
  writes: [TbConflictScript],
  run: ({ event, world }) => {
    const script = getScript(world, event.scriptEntityId);
    if (!script) return [];
    const slots: [ScriptSlot, ScriptSlot, ScriptSlot] = [
      script.slots[0],
      script.slots[1],
      script.slots[2],
    ];
    slots[event.slotIndex] = {
      status: "filled",
      action: event.action,
      performerParticipantEntityId: event.performerParticipantEntityId,
      performerCharacterId: event.performerCharacterId,
      weaponItemId: event.weaponItemId,
    };
    setScriptSlots(world, event.scriptEntityId, slots);
    return [];
  },
});

export const ScriptSlotClearedSystem = defineSystem({
  name: "@vtt/system-torchbearer/ScriptSlotClearedSystem",
  on: ScriptSlotCleared,
  reads: [TbConflictScript],
  writes: [TbConflictScript],
  run: ({ event, world }) => {
    const script = getScript(world, event.scriptEntityId);
    if (!script) return [];
    const slots: [ScriptSlot, ScriptSlot, ScriptSlot] = [
      script.slots[0],
      script.slots[1],
      script.slots[2],
    ];
    slots[event.slotIndex] = { status: "empty" };
    setScriptSlots(world, event.scriptEntityId, slots);
    return [];
  },
});

export const ScriptLockedSystem = defineSystem({
  name: "@vtt/system-torchbearer/ScriptLockedSystem",
  on: ScriptLocked,
  reads: [TbConflictScript, TbConflict],
  writes: [TbConflictScript, TbConflict],
  run: ({ event, world }) => {
    const script = getScript(world, event.scriptEntityId);
    if (script) {
      world.set(event.scriptEntityId, TbConflictScript, {
        ...script,
        locked: true,
      });
    }
    setConflict(
      world,
      event.conflictId,
      event.side === "party" ? { partyLocked: true } : { enemyLocked: true },
    );
    return [];
  },
});

export const ScriptUnlockedSystem = defineSystem({
  name: "@vtt/system-torchbearer/ScriptUnlockedSystem",
  on: ScriptUnlocked,
  reads: [TbConflictScript, TbConflict],
  writes: [TbConflictScript, TbConflict],
  run: ({ event, world }) => {
    const script = getScript(world, event.scriptEntityId);
    if (script) {
      world.set(event.scriptEntityId, TbConflictScript, {
        ...script,
        locked: false,
      });
    }
    setConflict(
      world,
      event.conflictId,
      event.side === "party" ? { partyLocked: false } : { enemyLocked: false },
    );
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Reveal — flip both sides' slot status from filled to revealed and
 * bump revealIndex. No resolution.
 * ----------------------------------------------------------------------- */

type RevealedPayload = Extract<ScriptSlot, { status: "revealed" }>;

function flipSlotToRevealed(
  world: World,
  scriptEntityId: EntityId,
  slotIndex: number,
  payload: Omit<RevealedPayload, "status">,
): void {
  const script = getScript(world, scriptEntityId);
  if (!script) return;
  const slots: [ScriptSlot, ScriptSlot, ScriptSlot] = [
    script.slots[0],
    script.slots[1],
    script.slots[2],
  ];
  slots[slotIndex] = { status: "revealed", ...payload };
  setScriptSlots(world, scriptEntityId, slots);
}

export const SlotRevealedSystem = defineSystem({
  name: "@vtt/system-torchbearer/SlotRevealedSystem",
  on: SlotRevealed,
  reads: [TbConflict, TbConflictScript],
  writes: [TbConflict, TbConflictScript],
  run: ({ event, world }) => {
    flipSlotToRevealed(world, event.partyScriptEntityId, event.slotIndex, event.partySlot);
    flipSlotToRevealed(world, event.enemyScriptEntityId, event.slotIndex, event.enemySlot);
    // Mirror the revealed pair onto the publicly-readable conflict
    // sentinel so non-side viewers (players watching the enemy
    // reveal, or vice versa) see it without needing read access to
    // the opposing script entity.
    const conf = getConflict(world, event.conflictId);
    if (conf) {
      const revealed: ReturnType<typeof TbConflict>["value"]["revealedSlots"] = [
        conf.revealedSlots[0],
        conf.revealedSlots[1],
        conf.revealedSlots[2],
      ];
      revealed[event.slotIndex] = {
        partyAction: event.partySlot.action,
        partyPerformerParticipantEntityId:
          event.partySlot.performerParticipantEntityId,
        partyPerformerCharacterId: event.partySlot.performerCharacterId,
        partyWeaponItemId: event.partySlot.weaponItemId,
        enemyAction: event.enemySlot.action,
        enemyPerformerParticipantEntityId:
          event.enemySlot.performerParticipantEntityId,
        enemyPerformerCharacterId: event.enemySlot.performerCharacterId,
        enemyWeaponItemId: event.enemySlot.weaponItemId,
      };
      setConflict(world, event.conflictId, {
        revealIndex: Math.min(3, event.slotIndex + 1),
        revealedSlots: revealed,
      });
    }
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Round advance — manual. Clears both scripts to empty + unlocked,
 * resets revealIndex, bumps round.
 * ----------------------------------------------------------------------- */

export const RoundAdvancedSystem = defineSystem({
  name: "@vtt/system-torchbearer/RoundAdvancedSystem",
  on: RoundAdvanced,
  reads: [TbConflict, TbConflictScript],
  writes: [TbConflict, TbConflictScript],
  run: ({ event, world }) => {
    setConflict(world, event.conflictId, {
      round: event.round,
      revealIndex: 0,
      partyLocked: false,
      enemyLocked: false,
      revealedSlots: [null, null, null],
    });
    for (const row of world.query([TbConflictScript])) {
      const s = row.values.TbConflictScript as ReturnType<typeof TbConflictScript>["value"];
      if (s.conflictId !== event.conflictId) continue;
      world.set(row.id, TbConflictScript, {
        ...s,
        locked: false,
        slots: EMPTY_SLOTS,
      });
    }
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Conflict end / compromise
 * ----------------------------------------------------------------------- */

export const ConflictEndedSystem = defineSystem({
  name: "@vtt/system-torchbearer/ConflictEndedSystem",
  on: ConflictEnded,
  reads: [TbConflict],
  writes: [TbConflict],
  run: ({ event, world }) => {
    setConflict(world, event.conflictId, {
      winner: event.winner,
      endedAt: event.endedAt,
    });
    return [];
  },
});

export const CompromiseAppliedSystem = defineSystem({
  name: "@vtt/system-torchbearer/CompromiseAppliedSystem",
  on: CompromiseApplied,
  reads: [],
  writes: [],
  run: () => {
    // The compromise itself is descriptive — conditions land on
    // characters via downstream commands. Nothing to do here today.
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Plugin registration list
 * ----------------------------------------------------------------------- */

export const ALL_CONFLICT_SYSTEMS = [
  ConflictDeclaredSystem,
  ParticipantsAddedSystem,
  CaptainElectedSystem,
  DispositionRolledSystem,
  TeamDispositionSetSystem,
  ParticipantHpSetSystem,
  HpAssignedSystem,
  WeaponChosenSystem,
  ScriptSlotSetSystem,
  ScriptSlotClearedSystem,
  ScriptLockedSystem,
  ScriptUnlockedSystem,
  SlotRevealedSystem,
  RoundAdvancedSystem,
  ConflictEndedSystem,
  CompromiseAppliedSystem,
] as const;
