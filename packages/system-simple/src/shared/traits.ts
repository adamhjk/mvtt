// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { defineTrait, z } from "@vtt/substrate";

/**
 * Four ability scores in the simple system, each rated 1..5 (dot
 * scale). Provides the common "what is this character good at?" axis
 * that everything else reads from.
 */
export const Stats = defineTrait({
  name: "@vtt/system-simple/Stats",
  schema: z
    .object({
      might: z.number().int().min(1).max(5).default(2),
      quickness: z.number().int().min(1).max(5).default(2),
      mind: z.number().int().min(1).max(5).default(2),
      charm: z.number().int().min(1).max(5).default(2),
    })
    .default({ might: 2, quickness: 2, mind: 2, charm: 2 }),
});

/**
 * Vital state — current HP, conditions, exhaustion. `current` is
 * player-editable (TrackField); `max` is derived from Stats by the
 * MaxHp derivation. We split the derived bit (MaxHp) into its own
 * trait so the derivation can write a whole-trait value atomically;
 * Vitals.current is plain mutable state.
 */
export const Vitals = defineTrait({
  name: "@vtt/system-simple/Vitals",
  schema: z
    .object({
      current: z.number().int().min(0).default(6),
      conditions: z.array(z.string().min(1).max(40)).default([]),
    })
    .default({ current: 6, conditions: [] }),
});

/**
 * Derived from Stats.might × 3. Lives in its own trait so the
 * derivation can replace it atomically. Read by the kit's TrackField
 * to size the HP track.
 */
export const MaxHp = defineTrait({
  name: "@vtt/system-simple/MaxHp",
  schema: z.number().int().min(1).default(6),
});

/**
 * Free-form character notes. A simple text blob bound to a
 * TextAreaField in the Notes tab. Demonstrates the "edit any field"
 * loop end-to-end against a defaulted trait.
 */
export const Notes = defineTrait({
  name: "@vtt/system-simple/Notes",
  schema: z.object({ text: z.string().default("") }).default({ text: "" }),
});

/**
 * One-line character sub-line — "Wandering Adventurer", "Thief of
 * the East", a tagline. Renders below the name in the Identity slot.
 */
export const Concept = defineTrait({
  name: "@vtt/system-simple/Concept",
  schema: z.object({ text: z.string().max(120).default("") }).default({ text: "" }),
});
