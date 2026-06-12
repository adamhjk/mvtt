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
  defineTrait,
  EntityId,
  fail,
  ok,
  z,
  type World,
} from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { Permissions, everyone, gmOnly, requireWrite } from "@vtt/permissions/shared";
import { Character } from "@vtt/characters/shared";
import { RawAbilities, TownAbilities } from "./traits.js";

/**
 * The P/F-advancing rated abilities — Will / Health (RawAbilities) and the
 * two town abilities Resources / Circles (TownAbilities). Nature is
 * deliberately excluded: it advances against its *maximum* with its own
 * rules (DH p.69) and isn't part of this standard improve flow.
 */
export type RatedAbilityId = "will" | "health" | "resources" | "circles";

export const ABILITY_LABELS: Record<RatedAbilityId, string> = {
  will: "Will",
  health: "Health",
  resources: "Resources",
  circles: "Circles",
};

/** PCs cap these at 6 in standard play; the trait schemas allow more, but
 * the improve verb stops here so the track can't push past the ceiling. */
const ABILITY_MAX_RATING = 6;

const RATED_ABILITY_IDS = new Set<string>(["will", "health", "resources", "circles"]);
export function isRatedAbilityId(id: string): id is RatedAbilityId {
  return RATED_ABILITY_IDS.has(id);
}

/** Same P/F thresholds skills use (DH p.108): pass = rating, fail = rating−1
 * (a rating-≤1 ability needs a single pass and no fails). */
export function abilityAdvancementNeed(rating: number): {
  passNeeded: number;
  failNeeded: number;
} {
  if (rating <= 1) return { passNeeded: 1, failNeeded: 0 };
  return { passNeeded: rating, failNeeded: rating - 1 };
}

interface RatedEntry {
  rating: number;
  advancement: { pass: number; fail: number };
}

/** Read a rated ability's {rating, advancement} from whichever trait holds
 * it, or undefined if the owning trait isn't attached. */
export function readRatedAbility(
  world: World,
  characterId: EntityId,
  ability: RatedAbilityId,
): RatedEntry | undefined {
  if (ability === "will" || ability === "health") {
    const ra = world.get(characterId, [RawAbilities]) as
      | { RawAbilities: Record<string, RatedEntry> }
      | undefined;
    const e = ra?.RawAbilities[ability];
    return e ? { rating: e.rating, advancement: e.advancement } : undefined;
  }
  const ta = world.get(characterId, [TownAbilities]) as
    | { TownAbilities: Record<string, RatedEntry> }
    | undefined;
  const e = ta?.TownAbilities[ability];
  return e ? { rating: e.rating, advancement: e.advancement } : undefined;
}

export function isAbilityTrackFull(entry: RatedEntry): boolean {
  if (entry.rating >= ABILITY_MAX_RATING) return false;
  const need = abilityAdvancementNeed(entry.rating);
  return (
    entry.advancement.pass >= need.passNeeded &&
    entry.advancement.fail >= need.failNeeded
  );
}

/* -------------------------------------------------------------------------
 * Events
 * ----------------------------------------------------------------------- */

export const AbilityImprovementOpened = defineEvent({
  name: "@vtt/system-torchbearer/AbilityImprovementOpened",
  schema: z.object({
    characterId: EntityId,
    ability: z.enum(["will", "health", "resources", "circles"]),
    opportunityId: EntityId,
    openedAt: z.number(),
  }),
  broadcast: true,
});

export const AbilityImproved = defineEvent({
  name: "@vtt/system-torchbearer/AbilityImproved",
  schema: z.object({
    characterId: EntityId,
    ability: z.enum(["will", "health", "resources", "circles"]),
    improvedAt: z.number(),
  }),
  broadcast: true,
});

/* -------------------------------------------------------------------------
 * Opportunity entity — the notification card's backing trait. Mirrors
 * SkillImprovementOpportunity.
 * ----------------------------------------------------------------------- */

export const AbilityImprovementOpportunity = defineTrait({
  name: "@vtt/system-torchbearer/AbilityImprovementOpportunity",
  schema: z.object({
    characterId: EntityId,
    characterName: z.string().min(1).max(120),
    ability: z.enum(["will", "health", "resources", "circles"]),
    abilityLabel: z.string().min(1).max(40),
    rating: z.number().int().min(0).max(10),
    sentAt: z.number(),
  }),
});

/* -------------------------------------------------------------------------
 * Commands
 * ----------------------------------------------------------------------- */

/**
 * Advance a rated ability from R to R+1. Validates the DH p.108 thresholds
 * server-side (so the sheet arrow and the notification card's Improve
 * button both go through one gate), emits `AbilityImproved`.
 */
export const ImproveAbility = defineCommand({
  name: "@vtt/system-torchbearer/ImproveAbility",
  schema: z.object({
    characterId: EntityId,
    ability: z.enum(["will", "health", "resources", "circles"]),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`character ${ctx.cmd.characterId} does not exist`);
    }
    if (!ctx.world.get(ctx.cmd.characterId, [Character])) {
      return fail(`entity ${ctx.cmd.characterId} is not a character`);
    }
    const entry = readRatedAbility(ctx.world, ctx.cmd.characterId, ctx.cmd.ability);
    if (!entry) return fail(`character has no ${ctx.cmd.ability}`);
    if (entry.rating >= ABILITY_MAX_RATING) {
      return fail(`${ctx.cmd.ability} is already at the max rating`);
    }
    const need = abilityAdvancementNeed(entry.rating);
    if (entry.advancement.pass < need.passNeeded) {
      return fail(
        `pass track not full: ${entry.advancement.pass} of ${need.passNeeded}`,
      );
    }
    if (entry.advancement.fail < need.failNeeded) {
      return fail(
        `fail track not full: ${entry.advancement.fail} of ${need.failNeeded}`,
      );
    }
    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd }) => [
    AbilityImproved({
      characterId: cmd.characterId,
      ability: cmd.ability,
      improvedAt: Date.now(),
    }),
  ],
});

/* -------------------------------------------------------------------------
 * Systems (universal mirrors)
 * ----------------------------------------------------------------------- */

export const AbilityImprovementOpenedSystem = defineSystem({
  name: "AbilityImprovementOpened",
  on: AbilityImprovementOpened,
  reads: [Character, RawAbilities, TownAbilities],
  writes: [AbilityImprovementOpportunity, Permissions],
  run: ({ event, world }) => {
    if (world.has(event.opportunityId)) return [];
    const entry = readRatedAbility(world, event.characterId, event.ability);
    const char = world.get(event.characterId, [Character]) as
      | { Character: { name: string } }
      | undefined;
    world.spawnAt(event.opportunityId, [
      AbilityImprovementOpportunity({
        characterId: event.characterId,
        characterName: char?.Character.name ?? "Someone",
        ability: event.ability,
        abilityLabel: ABILITY_LABELS[event.ability],
        rating: entry?.rating ?? 0,
        sentAt: event.openedAt,
      }),
      // Read everyone / write GM-only, mirroring SkillImprovementOpportunity.
      Permissions({ read: everyone(), write: gmOnly() }),
    ]);
    return [];
  },
});

export const AbilityImprovedSystem = defineSystem({
  name: "AbilityImproved",
  on: AbilityImproved,
  reads: [RawAbilities, TownAbilities, AbilityImprovementOpportunity],
  writes: [RawAbilities, TownAbilities, AbilityImprovementOpportunity],
  run: ({ event, world }) => {
    const { characterId, ability } = event;
    if (ability === "will" || ability === "health") {
      const ra = world.get(characterId, [RawAbilities]) as
        | { RawAbilities: Record<string, RatedEntry> }
        | undefined;
      const e = ra?.RawAbilities[ability];
      if (ra && e) {
        world.set(characterId, RawAbilities, {
          ...ra.RawAbilities,
          [ability]: {
            ...e,
            rating: e.rating + 1,
            advancement: { pass: 0, fail: 0 },
          },
        });
      }
    } else {
      const ta = world.get(characterId, [TownAbilities]) as
        | { TownAbilities: Record<string, RatedEntry> }
        | undefined;
      const e = ta?.TownAbilities[ability];
      if (ta && e) {
        world.set(characterId, TownAbilities, {
          ...ta.TownAbilities,
          [ability]: {
            ...e,
            rating: e.rating + 1,
            advancement: { pass: 0, fail: 0 },
          },
        });
      }
    }
    // Sweep any matching opportunity now that the click landed.
    for (const row of world.query([AbilityImprovementOpportunity])) {
      const v = row.values.AbilityImprovementOpportunity as {
        characterId: string;
        ability: string;
      };
      if (v.characterId === characterId && v.ability === ability) {
        world.despawn(row.id);
      }
    }
    return [];
  },
});

/**
 * True when an ability-improvement opportunity already exists for this
 * character + ability — the dedup guard for the `LogAdvancement` open path.
 */
export function hasAbilityOpportunity(
  world: World,
  characterId: string,
  ability: RatedAbilityId,
): boolean {
  return world.query([AbilityImprovementOpportunity]).some((row) => {
    const v = row.values.AbilityImprovementOpportunity as {
      characterId: string;
      ability: string;
    };
    return v.characterId === characterId && v.ability === ability;
  });
}
