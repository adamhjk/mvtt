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
import { useTrait } from "@vtt/substrate/client";
import { kit } from "@vtt/characters/client";
import type { CharacterSheetRegion } from "@vtt/characters/shared";
import { createMemo, For, Show, type JSX } from "solid-js";
import {
  CirclesCheck,
  HealthCheck,
  NatureCheck,
  PinnedRolls,
  ResourcesCheck,
  SkillCheck,
  WillCheck,
  getSkill,
  type PinnedRollEntryT,
} from "../shared/index.js";

interface AbilityDescriptor {
  rollable: string;
  label: string;
}

type PinnedAbility = Extract<PinnedRollEntryT, { kind: "ability" }>["ability"];

const ABILITY_DESCRIPTORS: Record<PinnedAbility, AbilityDescriptor> = {
  will: { rollable: WillCheck.name, label: "Roll Will" },
  health: { rollable: HealthCheck.name, label: "Roll Health" },
  nature: { rollable: NatureCheck.name, label: "Roll Nature" },
  resources: { rollable: ResourcesCheck.name, label: "Roll Resources" },
  circles: { rollable: CirclesCheck.name, label: "Roll Circles" },
};

const DEFAULT_ENTRIES: PinnedRollEntryT[] = [
  { kind: "ability", ability: "will" },
  { kind: "ability", ability: "health" },
];

/**
 * Sticky action bar — driven by the character's `PinnedRolls` trait.
 * Defaults to Will + Health (the two ability rolls every TB session
 * opens with). The player can pin / unpin abilities and skills from
 * the row toggles on the Abilities & Skills tab.
 *
 * When Nature is pinned, the "Tap Nature" companion button is shown
 * alongside the regular Roll Nature button — taxing untaxed Nature
 * is the most-frequent player decision at the table and shouldn't
 * cost an extra modal step.
 */
function ActionsBar(props: { characterId: string }): JSX.Element {
  const pinned = useTrait(props.characterId, PinnedRolls);
  const entries = createMemo<PinnedRollEntryT[]>(() => {
    const v = pinned();
    if (!v) return DEFAULT_ENTRIES;
    return v.entries;
  });
  return (
    <For each={entries()}>
      {(entry) => <PinnedButton characterId={props.characterId} entry={entry} />}
    </For>
  );
}

function PinnedButton(props: { characterId: string; entry: PinnedRollEntryT }): JSX.Element {
  return (
    <Show
      when={props.entry.kind === "ability"}
      fallback={
        <SkillPinButton
          characterId={props.characterId}
          entry={props.entry as Extract<PinnedRollEntryT, { kind: "skill" }>}
        />
      }
    >
      <AbilityPinButtons
        characterId={props.characterId}
        entry={props.entry as Extract<PinnedRollEntryT, { kind: "ability" }>}
      />
    </Show>
  );
}

function AbilityPinButtons(props: {
  characterId: string;
  entry: Extract<PinnedRollEntryT, { kind: "ability" }>;
}): JSX.Element {
  const desc = ABILITY_DESCRIPTORS[props.entry.ability];
  return (
    <>
      <kit.RollButton characterId={props.characterId} rollable={desc.rollable} label={desc.label} />
      <Show when={props.entry.ability === "nature"}>
        <kit.RollButton
          characterId={props.characterId}
          rollable={NatureCheck.name}
          opts={{ tap: true }}
          label="Tap Nature"
        />
      </Show>
    </>
  );
}

function SkillPinButton(props: {
  characterId: string;
  entry: Extract<PinnedRollEntryT, { kind: "skill" }>;
}): JSX.Element {
  const skill = getSkill(props.entry.skillId);
  if (!skill) return <></>;
  return (
    <kit.RollButton
      characterId={props.characterId}
      rollable={SkillCheck.name}
      opts={{ skillId: props.entry.skillId }}
      label={`Roll ${skill.name}`}
    />
  );
}

export const TbActionsFill: CharacterSheetRegion = {
  id: qualifiedName("@vtt/system-torchbearer/actions-bar") as CharacterSheetRegion["id"],
  render: ({ characterId }) => ActionsBar({ characterId }),
};
