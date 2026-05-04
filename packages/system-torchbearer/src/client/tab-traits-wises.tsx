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
import { CharacterTraits, Wises } from "../shared/index.js";

interface TraitEntry extends Record<string, unknown> {
  name: string;
  level: number;
  beneficialUses: number;
  checks: number;
  usedAgainst: boolean;
}

interface WiseEntry extends Record<string, unknown> {
  name: string;
  pass: boolean;
  fail: boolean;
  fate: boolean;
  persona: boolean;
}

/**
 * "Traits & Wises" tab — mirrors the printed character sheet's
 * "TRAITS" and "WISES" panels (DH p.8 / p.83 / p.85).
 *
 * Traits: each row holds a name, a level (1–3), a "uses" counter
 * tracking beneficial uses spent this session (0–2), and a single
 * "all appropriate tests" check (the level-3 effect).
 *
 * Wises: each row holds a name plus the four-box matrix the rules
 * track per session — I-Am-Wise on a Pass, I-Am-Wise on a Fail,
 * Deeper Understanding (Fate), Of Course! (Persona). Filling all
 * four lets the player evolve the wise (DH p.78).
 */
function TraitsWisesTab(props: { characterId: string }): JSX.Element {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}>
      <kit.SheetSection title="Traits">
        <SectionLegend>
          <strong>Lv 1</strong> grants one beneficial use per session ·{" "}
          <strong>Lv 2</strong> two beneficial uses per session ·{" "}
          <strong>Lv 3</strong> +1s on every appropriate passed or tied
          test (DH p.79). <strong>Checks</strong> are earned by using the
          trait against yourself — −1D on your own roll for 1 check, or
          +2D / break-tie for an opponent for 2 checks (DH p.80). The
          <strong> vs Self</strong> box auto-fills when you log an
          against-self use; flip it back at session start so the trait
          is available again. Checks accumulate across sessions until
          you spend them at camp.
        </SectionLegend>
        <kit.EntryRowsField<TraitEntry>
          characterId={props.characterId}
          trait={CharacterTraits}
          path={["entries"]}
          columns={[
            { key: "name", type: "text", label: "Trait", placeholder: "trait name", maxLength: 60, width: "minmax(8rem, 1.6fr)" },
            { key: "level", type: "number", label: "Lv", min: 1, max: 3, width: "3.5rem", align: "center" },
            { key: "beneficialUses", type: "dots", label: "Beneficial Uses", max: (e) => e.level, placeholder: (e) => (e.level >= 3 ? "all" : null), width: "5.5rem", align: "center" },
            { key: "checks", type: "number", label: "Checks", min: 0, max: 20, width: "4rem", align: "center" },
            { key: "usedAgainst", type: "check", label: "vs Self", width: "4rem", align: "center" },
          ]}
          seedEntry={(name) => ({ name, level: 1, beneficialUses: 0, checks: 0, usedAgainst: false })}
          addPlaceholder="add a trait…"
          emptyHint="No traits yet — pick from the Trait List (DH p.177) and add up to four."
        />
      </kit.SheetSection>

      <kit.SheetSection title="Wises">
        <SectionLegend>
          Each wise tracks four uses per session — <strong>Pass</strong>{" "}
          (I-Am-Wise on a passed test), <strong>Fail</strong> (on a failed
          test), <strong>Fate</strong> (Deeper Understanding) and{" "}
          <strong>Persona</strong> (Of Course!). When all four are checked
          you may evolve the wise (DH p.78).
        </SectionLegend>
        <kit.EntryRowsField<WiseEntry>
          characterId={props.characterId}
          trait={Wises}
          path={["entries"]}
          columns={[
            { key: "name", type: "text", label: "Wise", placeholder: "what you're wise to", maxLength: 80, width: "minmax(10rem, 2.4fr)" },
            { key: "pass", type: "check", label: "Pass", width: "3.6rem", align: "center" },
            { key: "fail", type: "check", label: "Fail", width: "3.4rem", align: "center" },
            { key: "fate", type: "check", label: "Fate", width: "3.5rem", align: "center" },
            { key: "persona", type: "check", label: "Persona", width: "4.4rem", align: "center" },
          ]}
          seedEntry={(name) => ({ name, pass: false, fail: false, fate: false, persona: false })}
          addPlaceholder="add a wise…"
          emptyHint="No wises yet — name a narrow specialty (e.g. “Field Dressing-Wise”)."
        />
      </kit.SheetSection>
    </div>
  );
}

function SectionLegend(props: { children: JSX.Element }): JSX.Element {
  return (
    <p
      style={{
        "font-size": "0.8rem",
        "line-height": "1.45",
        color: "var(--color-fg-muted)",
        margin: 0,
      }}
    >
      {props.children}
    </p>
  );
}

export const TbTraitsWisesTabFill: CharacterSheetTab = {
  id: qualifiedName("@vtt/system-torchbearer/tab-traits-wises") as CharacterSheetTab["id"],
  label: "Traits & Wises",
  priority: 70,
  render: ({ characterId }) => TraitsWisesTab({ characterId }),
};
