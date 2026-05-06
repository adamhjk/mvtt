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
  defineTrait,
  EntityId,
  fail,
  ok,
  z,
  type EventInstance,
} from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { Character } from "@vtt/characters/shared";
import { ItemIdentity } from "@vtt/items/shared";
import { Conditions } from "./traits.js";
import { EntryStateChanged } from "./items/item-events.js";
import { TbCarries, TbSupply } from "./items/item-traits.js";

/**
 * The TB condition ladder, in the order the grind imposes them
 * (DH p.41 — emphatically NOT the recovery order on the character
 * sheet, which goes the opposite way to mirror how nasty this life
 * is). The full ladder, top to bottom: hungry+thirsty → exhausted
 * → angry → sick → injured → afraid → dead. After the seventh
 * tick a character drops, "unceremoniously … from all the abuse
 * and indignities of this wretched life."
 */
export const GrindConditionSchema = z.enum([
  "hungryThirsty",
  "exhausted",
  "angry",
  "sick",
  "injured",
  "afraid",
  "dead",
]);
export type GrindCondition = z.infer<typeof GrindConditionSchema>;

/**
 * Compute the next condition the grind would impose on a character
 * with the given Conditions snapshot. Returns null only if the
 * character is already dead — that's the final rung, no further
 * grind effect applies (the rules say they drop on the seventh
 * tick; afterwards there's nothing to do).
 */
export function nextGrindCondition(c: {
  hungryThirsty?: boolean;
  exhausted?: boolean;
  angry?: boolean;
  sick?: boolean;
  injured?: boolean;
  afraid?: boolean;
  dead?: boolean;
}): GrindCondition | null {
  if (c.dead) return null;
  if (!c.hungryThirsty) return "hungryThirsty";
  if (!c.exhausted) return "exhausted";
  if (!c.angry) return "angry";
  if (!c.sick) return "sick";
  if (!c.injured) return "injured";
  if (!c.afraid) return "afraid";
  return "dead";
}

/**
 * Deterministic id of the Grind sentinel — one per world. Picked at
 * a fixed string rather than allocated so server, clients, tests and
 * the seed all converge on the same entity id without coordination.
 */
export const GRIND_SENTINEL_ID = "tb-grind" as EntityId;

/**
 * Grind — TB's adventure-phase clock. The "turn" counts up from 1
 * as the party explores; on the cadence the GM picks (every 4th
 * turn for normal play, every 3rd for *extreme grind* per SG
 * p.42), all characters earn a condition (DH p.41). Camp resets
 * the count to 1 (DH p.96), modeled here as `turn = 0` meaning
 * "not in adventure phase / fresh out of camp."
 *
 * Light sources (TbSupply.supplyType="light") consume turns of
 * fuel as the grind ticks: candles last 4 turns, torches 2,
 * lanterns 3 (DH p.43).
 *
 * Carried by exactly one entity per world — the Grind sentinel
 * (see `GRIND_SENTINEL_ID`). The TB plugin's seed spawns it on
 * cold-boot with `turn: 0, extreme: false`.
 */
export const Grind = defineTrait({
  name: "@vtt/system-torchbearer/Grind",
  schema: z.object({
    /** Adventure-phase turn counter. 0 = camp / not yet started. */
    turn: z.number().int().nonnegative().max(999),
    /**
     * Extreme-grind toggle (SG p.42): when true, the toll fires
     * every 3rd turn instead of every 4th. Default false.
     */
    extreme: z.boolean().default(false),
  }),
});

/**
 * Toll cadence. 4 normally, 3 in extreme grind. Helper kept here
 * so client UI, server validate, and the apply step all share one
 * source of truth.
 */
export function tollCadence(extreme: boolean): number {
  return extreme ? 3 : 4;
}

/**
 * GrindExtremeSet — the extreme-grind toggle has been changed.
 * Universal mirror; the GrindTickSystem writes the value onto the
 * sentinel.
 */
export const GrindExtremeSet = defineEvent({
  name: "@vtt/system-torchbearer/GrindExtremeSet",
  schema: z.object({
    extreme: z.boolean(),
  }),
});

/**
 * SetGrindExtreme — GM-only flip of the extreme-grind toggle.
 * Doesn't retro-fire tolls or undo old ones; it only changes
 * the cadence used by future SetGrindTurn calls.
 */
export const SetGrindExtreme = defineCommand({
  name: "@vtt/system-torchbearer/SetGrindExtreme",
  schema: z.object({
    extreme: z.boolean(),
  }),
  validate: (ctx) => {
    const auth = requireSession(ctx);
    if (!auth) return fail("not authenticated");
    if (auth.role !== "gm") {
      return fail("only a GM can change extreme-grind");
    }
    if (!ctx.world.has(GRIND_SENTINEL_ID)) {
      return fail("grind sentinel missing — world not seeded");
    }
    return ok();
  },
  apply: ({ cmd }) => [GrindExtremeSet({ extreme: cmd.extreme })],
});

/**
 * GrindTurnSet — the grind clock just changed. Carries the previous
 * and new turn values so reaction systems (light-source decrement,
 * conditional-failure check at every fourth turn, future
 * extensions) can tell forward from backward and skip-ahead.
 *
 * Universal mirror — runs on every side. The GrindTickSystem
 * writes `Grind.turn = to` and, when forward (to > from), runs
 * the light-source decrement sweep.
 */
export const GrindTurnSet = defineEvent({
  name: "@vtt/system-torchbearer/GrindTurnSet",
  schema: z.object({
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
  }),
});

/**
 * LightSourceWentOut — a lit TbSupply entry just hit zero turns
 * remaining. The mirror system spawns a `LightWentOutNotice`
 * entity at `id` with the captured names + sent-at; the chat
 * timeline contributor surfaces those entities as rows.
 *
 * `id` is server-allocated in `SetGrindTurn.apply` and embedded
 * here so every side spawns the same entity.
 */
export const LightSourceWentOut = defineEvent({
  name: "@vtt/system-torchbearer/LightSourceWentOut",
  schema: z.object({
    id: EntityId,
    holderId: EntityId,
    holderName: z.string().max(120),
    itemId: EntityId,
    itemName: z.string().max(120),
    /** Turn the burnout happened on. */
    turn: z.number().int().nonnegative(),
    /** Wall-clock timestamp for chat sort order. */
    sentAt: z.number().int().nonnegative(),
  }),
});

/**
 * LightWentOutNotice — persistent record of one burnout, spawned
 * onto its own entity so the chat-timeline contributor can query
 * for "every notice with sortKey = sentAt" the same way the skill
 * improvement opportunity contributor works. Keeps the chat card
 * stable across reconnects: it's just an entity, the timeline
 * rebuilds the row from the trait every render.
 */
export const LightWentOutNotice = defineTrait({
  name: "@vtt/system-torchbearer/LightWentOutNotice",
  schema: z.object({
    holderId: EntityId,
    holderName: z.string().max(120),
    itemId: EntityId,
    itemName: z.string().max(120),
    turn: z.number().int().nonnegative(),
    sentAt: z.number().int().nonnegative(),
  }),
});

/**
 * GrindToll — a single chat card spawned when the grind clock
 * crosses a multiple of 4 (DH p.41: every fourth turn imposes a
 * condition). Each row pre-resolves "what condition would this
 * character take next" so the card renders without re-walking
 * the world. Players click the button per row to actually apply
 * the condition; clicked rows flip to `applied: true` and read
 * "{character} {condition} applied". When every row is applied
 * the toll entity is despawned and the card disappears.
 *
 * Sentinel-style: one entity per toll, persisted so the card
 * survives reconnects, and queried by the chat-timeline
 * contributor.
 */
export const GrindToll = defineTrait({
  name: "@vtt/system-torchbearer/GrindToll",
  schema: z.object({
    /** Adventure-phase turn the toll happened on. */
    turn: z.number().int().nonnegative(),
    sentAt: z.number().int().nonnegative(),
    rows: z.array(
      z.object({
        characterId: EntityId,
        characterName: z.string().max(120),
        condition: GrindConditionSchema,
        applied: z.boolean(),
      }),
    ),
  }),
});

/**
 * GrindTollOpened — a toll has been calculated. Carries `id`
 * (server-allocated in apply) plus the per-row plan; the mirror
 * system spawns the GrindToll entity at that id.
 */
export const GrindTollOpened = defineEvent({
  name: "@vtt/system-torchbearer/GrindTollOpened",
  schema: z.object({
    id: EntityId,
    turn: z.number().int().nonnegative(),
    sentAt: z.number().int().nonnegative(),
    rows: z.array(
      z.object({
        characterId: EntityId,
        characterName: z.string().max(120),
        condition: GrindConditionSchema,
      }),
    ),
  }),
});

/**
 * GrindTollRowApplied — one row of a toll has been resolved.
 * The mirror system flips the row's `applied` flag and writes
 * the imposed condition onto the character's Conditions trait.
 * If every row of the toll is now applied, the toll entity is
 * despawned (the chat card disappears).
 */
export const GrindTollRowApplied = defineEvent({
  name: "@vtt/system-torchbearer/GrindTollRowApplied",
  schema: z.object({
    tollId: EntityId,
    rowIndex: z.number().int().min(0),
    characterId: EntityId,
    condition: GrindConditionSchema,
  }),
});

/**
 * MarkGrindToll — apply the condition recorded for one row of
 * an open toll to the named character. Anyone at the table can
 * resolve a row (typically the player whose character is named).
 * Rejects re-applying an already-applied row.
 */
export const MarkGrindToll = defineCommand({
  name: "@vtt/system-torchbearer/MarkGrindToll",
  schema: z.object({
    tollId: EntityId,
    rowIndex: z.number().int().min(0),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.tollId)) {
      return fail(`toll ${ctx.cmd.tollId} no longer exists`);
    }
    const got = ctx.world.get(ctx.cmd.tollId, [GrindToll]) as
      | {
          GrindToll: {
            rows: Array<{
              characterId: EntityId;
              condition: GrindCondition;
              applied: boolean;
            }>;
          };
        }
      | undefined;
    if (!got) return fail(`toll ${ctx.cmd.tollId} has no GrindToll`);
    const row = got.GrindToll.rows[ctx.cmd.rowIndex];
    if (!row) return fail(`no row at index ${ctx.cmd.rowIndex}`);
    if (row.applied) return fail("row already applied");
    return ok();
  },
  apply: ({ cmd, world }) => {
    const got = world.get(cmd.tollId, [GrindToll]) as {
      GrindToll: {
        rows: Array<{ characterId: EntityId; condition: GrindCondition }>;
      };
    };
    const row = got.GrindToll.rows[cmd.rowIndex]!;
    return [
      GrindTollRowApplied({
        tollId: cmd.tollId,
        rowIndex: cmd.rowIndex,
        characterId: row.characterId,
        condition: row.condition,
      }),
    ];
  },
});

/**
 * NoticeDismissed — a `LightWentOutNotice` chat-card has been
 * removed by a player. Carries the burnt-out item id so the
 * mirror can also drop the inventory entry pointing at it (the
 * item burned through its fuel; it's a depleted candle stub or
 * a charred torch — the player most likely just wants it gone).
 */
export const NoticeDismissed = defineEvent({
  name: "@vtt/system-torchbearer/NoticeDismissed",
  schema: z.object({
    noticeId: EntityId,
    /** Original holder of the burnt item (for entry removal). */
    holderId: EntityId,
    /**
     * The burnt-out item entity id. The system uses this to find
     * the holder's TbCarries entry pointing at the same id and
     * remove it.
     */
    itemId: EntityId,
  }),
});

/**
 * DismissLightWentOut — clear a burnout chat card. Anyone at the
 * table can dismiss it (the burnt-out torch is gone, the chat
 * card is informational). The mirror system removes the holder's
 * TbCarries entry that points at the burnt item, and despawns
 * both the notice and the item entity (if it isn't a catalog
 * template).
 */
export const DismissLightWentOut = defineCommand({
  name: "@vtt/system-torchbearer/DismissLightWentOut",
  schema: z.object({
    noticeId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.noticeId)) {
      return fail(`notice ${ctx.cmd.noticeId} no longer exists`);
    }
    return ok();
  },
  apply: ({ cmd, world }) => {
    const n = world.get(cmd.noticeId, [LightWentOutNotice]) as
      | { LightWentOutNotice: { holderId: EntityId; itemId: EntityId } }
      | undefined;
    if (!n) return [];
    return [
      NoticeDismissed({
        noticeId: cmd.noticeId,
        holderId: n.LightWentOutNotice.holderId,
        itemId: n.LightWentOutNotice.itemId,
      }),
    ];
  },
});

/**
 * SetGrindTurn — GM-only authoritative set of the adventure-phase
 * turn count. Validates the auth session is a GM (the grind tracker
 * lives in the GM-only chat-rail panel; clients can't set it
 * themselves regardless of UI gating). Used both by the +/- buttons
 * (which dispatch `to: current ± 1`) and by the manual input.
 */
export const SetGrindTurn = defineCommand({
  name: "@vtt/system-torchbearer/SetGrindTurn",
  schema: z.object({
    to: z.number().int().nonnegative().max(999),
  }),
  validate: (ctx) => {
    const auth = requireSession(ctx);
    if (!auth) return fail("not authenticated");
    if (auth.role !== "gm") return fail("only a GM can advance the grind");
    if (!ctx.world.has(GRIND_SENTINEL_ID)) {
      return fail("grind sentinel missing — world not seeded");
    }
    return ok();
  },
  apply: ({ cmd, world }) => {
    const cur = world.get(GRIND_SENTINEL_ID, [Grind]) as
      | { Grind: { turn: number; extreme: boolean } }
      | undefined;
    const from = cur?.Grind.turn ?? 0;
    const cadence = tollCadence(cur?.Grind.extreme ?? false);
    const events: EventInstance[] = [GrindTurnSet({ from, to: cmd.to })];
    if (cmd.to <= from) return events;
    // Toll: every Nth turn imposes a condition (DH p.41 / SG p.42
    // for extreme grind, N=3). We fire one toll when the destination
    // turn is a multiple of N — if the GM jumps several turns ahead,
    // we don't try to retro-apply each missed multiple, since the
    // GM is presumably skipping for a reason.
    if (cmd.to > 0 && cmd.to % cadence === 0) {
      const sentAt = Date.now();
      const rows: Array<{
        characterId: EntityId;
        characterName: string;
        condition: GrindCondition;
      }> = [];
      for (const row of world.query([Character, Conditions])) {
        const cond = row.values.Conditions as {
          hungryThirsty?: boolean;
          exhausted?: boolean;
          angry?: boolean;
          afraid?: boolean;
          injured?: boolean;
          sick?: boolean;
        };
        const next = nextGrindCondition(cond);
        if (!next) continue;
        const ch = row.values.Character as { name: string };
        rows.push({
          characterId: row.id,
          characterName: ch.name,
          condition: next,
        });
      }
      if (rows.length > 0) {
        events.push(
          GrindTollOpened({
            id: world.allocateId(),
            turn: cmd.to,
            sentAt,
            rows,
          }),
        );
      }
    }
    // Forward tick: sweep every lit light-source entry, decrement
    // turnsRemaining, and emit burnout-notice events for any that
    // hit zero. Allocating notice ids in apply (not in a system)
    // is the safe place to do it — server-authoritative.
    const delta = cmd.to - from;
    const sentAt = Date.now();
    for (const holderRow of world.query([TbCarries])) {
      const holderId = holderRow.id;
      const carries = holderRow.values.TbCarries as {
        entries: Array<{
          itemId: string;
          state?: { lit?: boolean; turnsRemaining?: number };
        }>;
      };
      carries.entries.forEach((entry, entryIndex) => {
        if (!entry.state?.lit) return;
        const supply = world.get(entry.itemId, [TbSupply]) as
          | { TbSupply: { supplyType: string } }
          | undefined;
        if (!supply || supply.TbSupply.supplyType !== "light") return;
        const next = (entry.state.turnsRemaining ?? 0) - delta;
        if (next <= 0) {
          const ident = world.get(entry.itemId, [ItemIdentity]) as
            | { ItemIdentity: { name: string } }
            | undefined;
          const character = world.get(holderId, [Character]) as
            | { Character: { name: string } }
            | undefined;
          events.push(
            EntryStateChanged({
              holderId,
              entryIndex,
              state: { lit: false, turnsRemaining: 0, spent: true },
            }),
          );
          events.push(
            LightSourceWentOut({
              id: world.allocateId(),
              holderId,
              holderName: character?.Character.name ?? "Someone",
              itemId: entry.itemId,
              itemName: ident?.ItemIdentity.name ?? "light source",
              turn: cmd.to,
              sentAt,
            }),
          );
        } else {
          events.push(
            EntryStateChanged({
              holderId,
              entryIndex,
              state: { turnsRemaining: next },
            }),
          );
        }
      });
    }
    return events;
  },
});
