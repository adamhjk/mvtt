// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { qualifiedName } from "@vtt/substrate";
import { kit } from "@vtt/characters/client";
import type {
  CharacterSheetRegion,
  CharacterSheetTab,
} from "@vtt/characters/shared";
import { For, Show, type JSX } from "solid-js";
import { useTraitPath } from "@vtt/substrate/client";
import {
  Concept,
  MaxHp,
  Notes,
  Stats,
  StatCheck,
  Vitals,
} from "../shared/index.js";

const STATS = ["might", "quickness", "mind", "charm"] as const;

/* -------------------------------------------------------------------------
 * Identity sub-line — "Concept" text below the name
 * ----------------------------------------------------------------------- */

function ConceptSubline(props: { characterId: string }): JSX.Element {
  return (
    <kit.FieldStack label="Concept">
      <kit.TextField
        characterId={props.characterId}
        trait={Concept}
        path={["text"]}
        placeholder="A wandering adventurer…"
      />
    </kit.FieldStack>
  );
}

export const ConceptIdentityFill: CharacterSheetRegion = {
  id: qualifiedName("@vtt/system-simple/identity-concept") as CharacterSheetRegion["id"],
  priority: 50, // below the default name+player fill (priority 100)
  render: ({ characterId }: { characterId: string }) =>ConceptSubline({ characterId }),
};

/* -------------------------------------------------------------------------
 * Vitals — current HP shown as a TrackField + numeric summary
 * ----------------------------------------------------------------------- */

function VitalsRail(props: { characterId: string }): JSX.Element {
  const max = useTraitPath(props.characterId, MaxHp, []);
  return (
    <kit.SheetSection title="Health">
      <kit.SummaryStat
        label="HP"
        value={
          <span>
            <HpCurrent characterId={props.characterId} /> /{" "}
            <Show when={typeof max() === "number"} fallback={"—"}>
              <span>{max() as number}</span>
            </Show>
          </span>
        }
      />
      <Show when={typeof max() === "number" && (max() as number) > 0}>
        <kit.TrackField
          characterId={props.characterId}
          trait={Vitals}
          path={["current"]}
          max={(max() as number) ?? 6}
        />
      </Show>
    </kit.SheetSection>
  );
}

function HpCurrent(props: { characterId: string }): JSX.Element {
  return (
    <kit.ValueField
      characterId={props.characterId}
      trait={Vitals}
      path={["current"]}
    />
  );
}

export const VitalsFill: CharacterSheetRegion = {
  id: qualifiedName("@vtt/system-simple/vitals-hp") as CharacterSheetRegion["id"],
  render: ({ characterId }: { characterId: string }) =>VitalsRail({ characterId }),
};

/* -------------------------------------------------------------------------
 * Status — condition chips read from Vitals.conditions
 * ----------------------------------------------------------------------- */

function StatusChips(props: { characterId: string }): JSX.Element {
  const conditions = useTraitPath(props.characterId, Vitals, ["conditions"]);
  return (
    <Show
      when={Array.isArray(conditions()) && (conditions() as string[]).length > 0}
      fallback={
        <span style={{ "font-size": "0.7rem", color: "var(--color-fg-subtle)" }}>
          no conditions
        </span>
      }
    >
      <For each={conditions() as string[]}>
        {(c) => (
          <span
            style={{
              padding: "0.15rem 0.5rem",
              "border-radius": "999px",
              border: "1px solid var(--color-border-muted)",
              "background": "var(--color-surface-elevated)",
              "font-size": "0.7rem",
              color: "var(--color-fg-muted)",
            }}
          >
            {c}
          </span>
        )}
      </For>
    </Show>
  );
}

export const StatusFill: CharacterSheetRegion = {
  id: qualifiedName("@vtt/system-simple/status-conditions") as CharacterSheetRegion["id"],
  render: ({ characterId }: { characterId: string }) =>StatusChips({ characterId }),
};

/* -------------------------------------------------------------------------
 * Tabs — Stats and Notes
 * ----------------------------------------------------------------------- */

function StatsTab(props: { characterId: string }): JSX.Element {
  return (
    <kit.SheetSection title="Stats">
      <kit.SheetGroup layout="grid" cols={2}>
        <For each={STATS}>
          {(stat) => (
            <kit.FieldRow>
              <kit.RollableLabel
                characterId={props.characterId}
                rollable={StatCheck}
                opts={{ stat }}
              >
                {capitalize(stat)}
              </kit.RollableLabel>
              <div style={{ "margin-left": "auto", display: "flex", "align-items": "center", gap: "0.4rem" }}>
                <kit.DotsField
                  characterId={props.characterId}
                  trait={Stats}
                  path={[stat]}
                  max={5}
                />
              </div>
            </kit.FieldRow>
          )}
        </For>
      </kit.SheetGroup>
    </kit.SheetSection>
  );
}

function NotesTab(props: { characterId: string }): JSX.Element {
  return (
    <kit.SheetSection title="Notes">
      <kit.TextAreaField
        characterId={props.characterId}
        trait={Notes}
        path={["text"]}
        placeholder="Backstory, motivation, party reputation…"
        rows={12}
      />
    </kit.SheetSection>
  );
}

export const StatsTabFill: CharacterSheetTab = {
  id: qualifiedName("@vtt/system-simple/tab-stats") as CharacterSheetTab["id"],
  label: "Stats",
  priority: 100,
  render: ({ characterId }: { characterId: string }) =>StatsTab({ characterId }),
};

export const NotesTabFill: CharacterSheetTab = {
  id: qualifiedName("@vtt/system-simple/tab-notes") as CharacterSheetTab["id"],
  label: "Notes",
  priority: 50,
  render: ({ characterId }: { characterId: string }) =>NotesTab({ characterId }),
};

/* -------------------------------------------------------------------------
 * Actions — quick stat-check buttons
 * ----------------------------------------------------------------------- */

function ActionsBar(props: { characterId: string }): JSX.Element {
  return (
    <For each={STATS}>
      {(stat) => (
        <kit.RollButton
          characterId={props.characterId}
          rollable={StatCheck}
          opts={{ stat }}
          label={`Roll ${capitalize(stat)}`}
        />
      )}
    </For>
  );
}

export const ActionsFill: CharacterSheetRegion = {
  id: qualifiedName("@vtt/system-simple/actions-stats") as CharacterSheetRegion["id"],
  render: ({ characterId }: { characterId: string }) =>ActionsBar({ characterId }),
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
