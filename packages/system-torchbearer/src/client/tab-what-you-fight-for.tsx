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
import type { CharacterSheetTab } from "@vtt/characters/shared";
import { type JSX } from "solid-js";
import { WhatYouFightFor } from "../shared/index.js";

/**
 * "What You Fight For" tab — Belief / Creed / Goal / Instinct, the BICG
 * earning anchors. Each is free-text rewritten between sessions; the
 * earning rules (DH p.86–88) live in the future system layer.
 *
 * A reminder line under each field captures the trigger so the player
 * remembers what's worth a fate or persona at the table.
 */
function WhatYouFightForTab(props: { characterId: string }): JSX.Element {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}>
      <Anchor
        characterId={props.characterId}
        path="belief"
        label="Belief"
        hint="Uphold your belief in your actions to earn a fate point."
      />
      <Anchor
        characterId={props.characterId}
        path="creed"
        label="Creed"
        hint="Endure a moral test driven by your creed to earn a persona point."
      />
      <Anchor
        characterId={props.characterId}
        path="goal"
        label="Goal"
        hint="Accomplish a goal to earn a persona point."
      />
      <Anchor
        characterId={props.characterId}
        path="instinct"
        label="Instinct"
        hint="Use an instinct to aid the group to earn a fate point."
      />
    </div>
  );
}

function Anchor(props: {
  characterId: string;
  path: "belief" | "creed" | "goal" | "instinct";
  label: string;
  hint: string;
}): JSX.Element {
  return (
    <kit.SheetSection title={props.label}>
      <kit.TextAreaField
        characterId={props.characterId}
        trait={WhatYouFightFor}
        path={[props.path]}
        rows={2}
        placeholder={props.hint}
      />
      <span style={{ "font-size": "0.8rem", color: "var(--color-fg-muted)" }}>
        {props.hint}
      </span>
    </kit.SheetSection>
  );
}

export const TbWhatYouFightForTabFill: CharacterSheetTab = {
  id: qualifiedName("@vtt/system-torchbearer/tab-what-you-fight-for") as CharacterSheetTab["id"],
  label: "What You Fight For",
  priority: 90,
  render: ({ characterId }) => WhatYouFightForTab({ characterId }),
};
