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

import { qualifiedName } from "@vtt/substrate";
import type { RollAtelierRailAccessory, RollAtelierRailArgs } from "@vtt/characters/shared";
import type { JSX } from "solid-js";
import { VersusShadow } from "./VersusShadow.jsx";
import { ConflictCluster } from "./ConflictCluster.jsx";

/**
 * Rail accessory slot fill. Renders below the selected pill in the
 * Atelier's left rail; stacks the versus shadow and conflict cluster
 * vertically. Each child is its own `<Show>`-guarded component so only
 * the relevant ones light up.
 */
function TbRailAccessoryRender(args: RollAtelierRailArgs): JSX.Element {
  if (!args.selected) return null;
  return (
    <div class="flex flex-col gap-1" data-testid="atelier-tb-rail-accessory">
      <VersusShadow rollId={args.rollId} />
      <ConflictCluster rollId={args.rollId} />
    </div>
  );
}

export const TbRailAccessory: RollAtelierRailAccessory = {
  id: qualifiedName("@vtt/system-torchbearer/atelier-rail-accessory") as RollAtelierRailAccessory["id"],
  priority: 100,
  rollablePrefix: "@vtt/system-torchbearer/",
  render: (args) => TbRailAccessoryRender(args),
};
