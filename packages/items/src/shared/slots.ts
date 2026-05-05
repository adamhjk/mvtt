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

import { defineSlot, z, type EntityId } from "@vtt/substrate";

/**
 * A renderer that game systems contribute to surface their item-subtype
 * traits in the Items workbench-page detail view. The Items page lists
 * every item entity in the world and renders generic identity +
 * economics; game systems fill this slot to render their specialised
 * subtype editors (e.g. weapon stat editor, armor type/absorbs, supply
 * lit/turns) underneath.
 *
 * Each fill is a record:
 *   - `id` — stable identifier so a fill can be replaced; namespace it
 *     under your plugin (e.g. "@vtt/system-torchbearer/weapon-section").
 *   - `label` — section heading shown to the user, e.g. "Weapon".
 *   - `appliesWhen({ traitsOnItem })` — predicate against the item's
 *     trait names. Return true if your section should render for this
 *     item (e.g. only when a TbWeapon trait is present).
 *   - `priority` — sections render in descending priority so a system's
 *     "headline" subtype shows first; default 0.
 *   - `render({ itemId, canEdit })` — Solid component returning JSX.
 *     The component is responsible for reading its own traits via
 *     `useTrait` and dispatching `EditItemField` (or system-specific
 *     commands) to mutate them.
 *
 * The slot is intentionally renderer-shaped, not data-shaped: each
 * fill is a one-trait or few-trait section the system already knows
 * how to display. Generic fields (ItemIdentity / ItemEconomics) are
 * always rendered by the page itself — game systems don't need to
 * fill those.
 */
const ItemDetailSectionSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(80),
  /**
   * Predicate against the entity's trait full-names ("@vtt/.../X").
   * Returning true mounts this section for the item.
   */
  appliesWhen: z.any(),
  priority: z.number().optional(),
  /**
   * Solid render function. Signature:
   *   ({ itemId, canEdit }) => JSX.Element
   * — components read their own traits and dispatch their own
   * commands; the slot just hands them the entity id + whether the
   * current user can edit (for permission gating).
   */
  render: z.any(),
});

export interface ItemDetailSection {
  readonly id: string;
  readonly label: string;
  readonly appliesWhen: (args: {
    readonly itemId: EntityId;
    readonly traitsOnItem: ReadonlySet<string>;
  }) => boolean;
  readonly priority?: number;
  readonly render: (args: {
    readonly itemId: EntityId;
    readonly canEdit: boolean;
  }) => unknown;
}

export const ItemDetailSectionsSlot = defineSlot({
  name: "@vtt/items/detail-sections",
  schema: ItemDetailSectionSchema,
  description:
    "Game-system contributions for item subtype editors. Each fill renders a section in the Items page detail view when its appliesWhen predicate matches the item's trait set.",
});
