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
  defineSlot,
  type EntityId,
  type QualifiedName,
  QualifiedNameSchema,
  z,
} from "@vtt/substrate";

/**
 * Per-render arguments handed to every roll-actions fill. `rollId` is
 * the resolved Roll entity in the world (Formula + RollResult + RolledBy).
 * `rollableName` is the Formula's `meta.system`-anchored rollable name
 * if present; absent for ad-hoc /r rolls. Fills should resolve all
 * other state (Pools, the rolling character, the roll's spec) by
 * reading the world directly.
 */
export interface RollActionsArgs {
  readonly rollId: EntityId;
  readonly rollableName?: string;
}

/**
 * Game-system fills for **post-roll** chat-card actions on a resolved
 * Roll entity — the symmetric counterpart of
 * `PendingRollContributorsSlot` (which targets pre-commit pending rolls).
 *
 * Use cases:
 *   - System-specific log buttons (TB Pass/Fail, advancement, trait
 *     usage, fate/persona spends).
 *   - Cross-system add-ons (pin-to-journal, GM annotation, "share to
 *     party chat") that don't care which system rolled.
 *
 * Fills render in priority order (high first). The `rollablePrefix`
 * gates a fill by the roll's rollable name — e.g.
 * `@vtt/system-torchbearer/` for TB-specific buttons. Omit the prefix
 * to fill on every resolved roll regardless of system.
 *
 * Per-user gating (roller-only, helper-only, GM-only) is each fill's
 * own concern — the slot machinery just stacks contributors.
 */
export interface RollActionsContributor {
  id: QualifiedName;
  /** Higher priority sorts toward the top of the action stack. */
  priority?: number;
  /**
   * Optional filter: only render when the rollable name starts with
   * this prefix. e.g. `"@vtt/system-torchbearer/"` for TB-only fills.
   * Omit to render on every resolved roll.
   */
  rollablePrefix?: string;
  render: (args: RollActionsArgs) => unknown;
}

const RollActionsContributorSchema = z.object({
  id: QualifiedNameSchema,
  priority: z.number().optional(),
  rollablePrefix: z.string().optional(),
  render: z.any(),
});

export const RollActionsSlot = defineSlot({
  name: "@vtt/resolution/roll-actions",
  schema: RollActionsContributorSchema,
  description:
    "Post-roll action contributors for the chat card — log buttons, fate/persona spends, GM annotations, cross-system add-ons.",
});
