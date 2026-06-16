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
import { definePageProvider } from "@vtt/shell-workbench/shared";
import { Character } from "../shared/traits.js";
import { PendingRoll } from "../shared/pending.js";
import { ROLL_ATELIER_KIND } from "../shared/atelier.js";
import { RollAtelier } from "./RollAtelier.jsx";

/**
 * The Roll Atelier page kind. `list` returns every active PendingRoll
 * (so the TabPicker can seed an initial selection on a specific roll);
 * `defaultEntity` returns null because the Atelier is hub-style — it
 * shows every pending roll regardless of which one was named.
 *
 * Auto-focus from `AtelierAutoFocusMount` dispatches `OpenPage` with
 * `entityId: null`, which lands on this provider with no specific roll
 * named — selection then defaults to the most-recently-opened roll.
 */
export const RollAtelierPageProvider = definePageProvider({
  kind: ROLL_ATELIER_KIND,
  icon: "dice",
  label: "Rolls",
  reads: [PendingRoll, Character],
  list: ({ world }) =>
    world.query([PendingRoll]).map((row) => {
      const v = row.values.PendingRoll as {
        rollableName: string;
        initiatorCharacterId: EntityId;
      };
      const char = world.get(v.initiatorCharacterId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      const charName = char?.Character.name ?? "(unknown)";
      const source = v.rollableName.split("/").pop() ?? v.rollableName;
      return {
        id: row.id,
        label: `${charName} · ${source}`,
        hint: v.rollableName,
      };
    }),
  defaultEntity: () => null,
  render: ({ tabId, entityId }) => <RollAtelier tabId={tabId} initialSelection={entityId} />,
  priority: 50,
});
