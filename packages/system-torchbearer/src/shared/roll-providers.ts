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

import { defineSlot, z } from "@vtt/substrate";
import { TbRollKindSchema, TbRollModifierSchema } from "./roll-spec.js";

/**
 * "Things in the game that can offer a Torchbearer dice modifier" —
 * any plugin (this one or another) can register a fill into this slot
 * to advertise a modifier the panel should consider offering when an
 * eligible TB roll opens.
 *
 * The contract is intentionally narrow: a provider is a pure data
 * shape that says "I propose this modifier under these conditions".
 * The panel's TB contributor consumes the slot, filters by `eligibility`,
 * and renders each candidate as a togglable chip. The panel never
 * imports any provider's internals — the slot schema is the entire
 * extension API.
 *
 * Examples (deliberately not yet implemented):
 *
 *   - An enchanted axe: `{
 *       providerId: "@vtt/system-torchbearer/gear-axe",
 *       eligibility: { rollKinds: ["skill"], sourceIds: ["fighter"] },
 *       modifier: { kind: "dice", value: 1, label: "Razor's Edge",
 *                   apply: "always", source: "gear" },
 *     }`
 *
 *   - A wise that grants +1D when invoked: `{
 *       providerId: "@vtt/system-torchbearer/wise-tunnel",
 *       eligibility: { rollKinds: ["skill"], sourceIds: ["dungeoneer"] },
 *       modifier: { kind: "dice", value: 1, label: "Tunnel-wise",
 *                   apply: "always", source: "wise" },
 *     }`
 *
 *   - A faith reroll that fires on success: `{
 *       providerId: "@vtt/system-torchbearer/faith-reroll",
 *       eligibility: { rollKinds: ["skill"] },
 *       modifier: { kind: "success", value: 1, label: "Faith",
 *                   apply: "on-success", source: "fate" },
 *     }`
 *
 * The slot is declared here today; consumption (the panel iterating
 * fills and rendering toggles) lands when the wider modifier-source
 * UX is fleshed out. The shape is stable and additive — extending
 * `eligibility` later (e.g. `requiredConditions`, `partyOnly`) is
 * backwards compatible.
 */
const TbRollModifierProviderSchema = z.object({
  /**
   * Stable id — `<plugin>/<provider-key>`. Used to deduplicate when
   * the same item is registered by multiple plugins (a content pack
   * shipping a relic vs. a homebrew override).
   */
  providerId: z.string().min(1).max(120),

  /**
   * Filter the panel uses to decide whether to offer this provider's
   * modifier for a given roll. All fields are optional; an empty
   * eligibility means "offer for every TB roll".
   */
  eligibility: z
    .object({
      /** Restrict to specific roll kinds (e.g. only skill rolls). */
      rollKinds: z.array(TbRollKindSchema).min(1).optional(),
      /**
       * Restrict to a specific roll source — `will` / `health` /
       * `<skillId>` / etc. Matched against `TbRollSpec.sourceId`.
       */
      sourceIds: z.array(z.string().min(1).max(80)).min(1).optional(),
    })
    .default({}),

  /**
   * The modifier the provider would contribute. Validated against
   * the same schema the rollable's compute consumes — so what the
   * panel offers and what the dice see are the exact same shape.
   */
  modifier: TbRollModifierSchema,
});

export type TbRollModifierProvider = z.infer<
  typeof TbRollModifierProviderSchema
>;

export const TbRollModifierProvidersSlot = defineSlot({
  name: "@vtt/system-torchbearer/roll-modifier-providers",
  schema: TbRollModifierProviderSchema,
  description:
    "Game-system fills for ambient TB roll-modifier providers (gear, wises, traits, spells). The pending-roll panel consumes these to render togglable modifier chips for the active TB roll.",
});
