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
import { kit } from "@vtt/characters/client";
import type { CharacterSheetRegion } from "@vtt/characters/shared";
import { type JSX } from "solid-js";
import {
  HealthCheck,
  NatureCheck,
  WillCheck,
} from "../shared/index.js";

/**
 * Sticky action bar — the three raw ability rolls every TB session
 * touches. Tap-Nature is exposed alongside Roll Nature because the
 * "tax untaxed Nature" branch is the most-frequent player decision at
 * the table. Actions for skills / town abilities live next to the
 * skill itself on the Skills tab — the bottom bar stays narrow.
 */
function ActionsBar(props: { characterId: string }): JSX.Element {
  return (
    <>
      <kit.RollButton characterId={props.characterId} rollable={WillCheck.name} label="Roll Will" />
      <kit.RollButton characterId={props.characterId} rollable={HealthCheck.name} label="Roll Health" />
      <kit.RollButton characterId={props.characterId} rollable={NatureCheck.name} label="Roll Nature" />
      <kit.RollButton
        characterId={props.characterId}
        rollable={NatureCheck.name}
        opts={{ tap: true }}
        label="Tap Nature"
      />
    </>
  );
}

export const TbActionsFill: CharacterSheetRegion = {
  id: qualifiedName("@vtt/system-torchbearer/actions-bar") as CharacterSheetRegion["id"],
  render: ({ characterId }) => ActionsBar({ characterId }),
};
