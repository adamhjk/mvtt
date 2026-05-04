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
import { AlliesEnemies, Identity } from "../shared/index.js";

/**
 * "Who You Are" tab: identity fields plus the Allies & Enemies table.
 * The TB section "Allies & Enemies" is folded into this tab as a labeled
 * sub-section since it's the same kind of content (relationships) at a
 * different scale and is touched at session-edge cadence — keeps the
 * top-level tab list short without inventing a tab name.
 */
function WhoYouAreTab(props: { characterId: string }): JSX.Element {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}>
      <kit.SheetSection title="Who You Are">
        <kit.SheetGroup layout="grid" cols={2}>
          <kit.FieldRow label="Stock">
            <kit.TextField characterId={props.characterId} trait={Identity} path={["stock"]} placeholder="Human, Dwarf, Elf…" />
          </kit.FieldRow>
          <kit.FieldRow label="Class">
            <kit.TextField characterId={props.characterId} trait={Identity} path={["class"]} placeholder="Warrior, Magician…" />
          </kit.FieldRow>
          <kit.FieldRow label="Age">
            <kit.NumberField characterId={props.characterId} trait={Identity} path={["age"]} min={0} max={999} />
          </kit.FieldRow>
          <kit.FieldRow label="Level">
            <kit.NumberField characterId={props.characterId} trait={Identity} path={["level"]} min={1} max={10} />
          </kit.FieldRow>
          <kit.FieldRow label="Home">
            <kit.TextField characterId={props.characterId} trait={Identity} path={["home"]} placeholder="Hometown" />
          </kit.FieldRow>
          <kit.FieldRow label="Raiment">
            <kit.TextField characterId={props.characterId} trait={Identity} path={["raiment"]} placeholder="What you wear that marks you" />
          </kit.FieldRow>
          <kit.FieldRow label="Parents">
            <kit.TextField characterId={props.characterId} trait={Identity} path={["parents"]} placeholder="Family of origin" />
          </kit.FieldRow>
          <kit.FieldRow label="Mentor">
            <kit.TextField characterId={props.characterId} trait={Identity} path={["mentor"]} placeholder="A 7th-level character who trains you" />
          </kit.FieldRow>
          <kit.FieldRow label="Friend">
            <kit.TextField characterId={props.characterId} trait={Identity} path={["friend"]} placeholder="A friend you can rely on" />
          </kit.FieldRow>
          <kit.FieldRow label="Enemy">
            <kit.TextField characterId={props.characterId} trait={Identity} path={["enemy"]} placeholder="A rival or antagonist" />
          </kit.FieldRow>
        </kit.SheetGroup>
      </kit.SheetSection>

      <kit.SheetSection title="Allies & Enemies">
        <p style={{ "font-size": "0.85rem", color: "var(--color-fg-muted)", margin: 0 }}>
          Relationships you accumulate in play. Track name, where they live, and current standing.
        </p>
        <kit.EntryRowsField<AlliesEnemiesEntry>
          characterId={props.characterId}
          trait={AlliesEnemies}
          path={["entries"]}
          columns={[
            { key: "name", type: "text", label: "Name", width: "minmax(8rem, 1.4fr)", placeholder: "who they are", maxLength: 80 },
            { key: "location", type: "text", label: "Location", width: "minmax(8rem, 1fr)", placeholder: "where to find them", maxLength: 80 },
            { key: "status", type: "text", label: "Status", width: "minmax(8rem, 1fr)", placeholder: "ally · enemy · debt …", maxLength: 80 },
          ]}
          seedEntry={(name) => ({ name, location: "", status: "" })}
          addPlaceholder="add an ally or enemy…"
          emptyHint="No allies or enemies yet — note one below as the campaign unfolds."
        />
      </kit.SheetSection>
    </div>
  );
}

interface AlliesEnemiesEntry extends Record<string, unknown> {
  name: string;
  location: string;
  status: string;
}

export const TbWhoYouAreTabFill: CharacterSheetTab = {
  id: qualifiedName("@vtt/system-torchbearer/tab-who-you-are") as CharacterSheetTab["id"],
  label: "Who You Are",
  // Tabs sort by descending priority; pick descending values so the
  // printed-sheet order (Who → What For → Abilities → Traits → Arcane → Inventory)
  // appears left-to-right.
  priority: 100,
  render: ({ characterId }) => WhoYouAreTab({ characterId }),
};
