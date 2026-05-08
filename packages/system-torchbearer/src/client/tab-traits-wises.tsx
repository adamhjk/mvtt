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
import { RuleRef } from "./rule-ref.js";

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
 * "TRAITS" and "WISES" panels.
 *
 * Traits (DH p.79–82): each row holds a name, a level (1–3), a
 * "beneficial uses" counter capped at the level (Lv 1 = +1D once
 * per session, Lv 2 = +1D twice per session, Lv 3 = +1s on every
 * tied or passed appropriate test), a checks tally earned by
 * using the trait against yourself, and a single "vs Self" mark
 * (the once-per-session against-self gate). Full Trait List in
 * the Reference section (DH p.177) and an additional list in
 * LMM p.29.
 *
 * Wises (DH p.76–78): each row holds a name plus the four-box
 * matrix that gates "Gaining Wisdom" — I-Am-Wise on a passed
 * test, I-Am-Wise on a failed test, Deeper Understanding (1 fate),
 * Of Course! (1 persona). Filling all four lets the player either
 * change the wise, take a Beginner's Luck test toward a new
 * skill, or take a related skill advancement test. New wises
 * arrive in respite (SG p.126).
 */
function TraitsWisesTab(props: { characterId: string }): JSX.Element {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}>
      <kit.SheetSection title="Traits">
        <SectionLegend>
          <strong>Lv 1</strong> grants +1D to one roll per session ·{" "}
          <strong>Lv 2</strong> grants +1D to two rolls per session ·{" "}
          <strong>Lv 3</strong> grants +1s to each tied or passed test
          associated with the trait. Lv 1 and Lv 2 uses refresh after
          the prologue at the start of a new session.{" "}
          <strong>Checks</strong> are earned by using a trait against
          yourself: −1D on your own roll for 1 check, +2D for an opponent
          or breaking a tie in their favor for 2 checks. You may only use
          a trait against yourself once per session, and never in camp,
          town, or PvP. Spend checks in camp (1 check per test) or as
          you enter town (1 check per recovery test). The{" "}
          <strong>vs Self</strong> box auto-fills on an against-self use;
          flip it back at session start.{" "}
          <RuleRef book="DH" page={79} />{" "}
          <RuleRef book="DH" page={80} />{" "}
          <RuleRef book="DH" page={81} />{" "}
          <strong>Trait list:</strong>{" "}
          <RuleRef book="DH" page={177} />{" "}
          <RuleRef book="LMM" page={29} />
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
          emptyHint="No traits yet — pick from the Trait List (DH p.177, LMM p.29)."
        />
      </kit.SheetSection>

      <kit.SheetSection title="Wises">
        <SectionLegend>
          A wise is special, esoteric knowledge of a narrow subject — it
          has no rating and is never tested on its own. Used once per
          test (multiple wises per test are fine, but a different
          effect each), to one of three ends:{" "}
          <strong>I Am Wise</strong> grants +1D <em>aid</em> to a friend
          or ally on a related test (cannot help and use I-Am-Wise on
          the same test); <strong>Deeper Understanding</strong> spends 1
          fate to reroll one failed die on a related roll;{" "}
          <strong>Of Course!</strong> spends 1 persona to reroll all
          failed dice on a related test (use this before Luck). Mark
          all four boxes — I-Am-Wise on a passed test, I-Am-Wise on a
          failed test, Deeper Understanding, Of Course! — to{" "}
          <strong>Gain Wisdom</strong>: change the wise, take a
          Beginner's Luck test toward a new skill, or take a related
          skill advancement test. Then reset and try again. Maximum of
          four wises at once; new wises arrive in respite.{" "}
          <RuleRef book="DH" page={76} />{" "}
          <RuleRef book="DH" page={77} />{" "}
          <RuleRef book="DH" page={78} />{" "}
          <RuleRef book="SG" page={126} />
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
          emptyHint="No wises yet — name a narrow specialty (e.g. “Field Dressing-Wise”). Max 4."
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
