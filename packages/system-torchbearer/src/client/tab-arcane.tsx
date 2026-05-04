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
import { useTrait } from "@vtt/substrate/client";
import { createMemo, For, Show, type JSX } from "solid-js";
import { Identity, Relics, Spells } from "../shared/index.js";

/**
 * "Arcane" tab — Spells, Relics, Memory Palace, Urðr / Burden. Mounted
 * unconditionally for the shape pass; the body shows a polite empty
 * state for classes that don't have arcane content. A future
 * slot-level `visible(args)` predicate (or class-class registry) will
 * hide the tab entirely for non-casters.
 *
 * Spells column shape mirrors the printed sheet (DH p.97):
 *   library | spellbook | mem. | cast | scroll | supplies | effect
 *
 * Relics column shape mirrors DH p.105:
 *   relic | inventory | invocation/name/circle
 * plus the Urðr (1–4) and Burden (1–6) tracks.
 */
function ArcaneTab(props: { characterId: string }): JSX.Element {
  const identity = useTrait(props.characterId, Identity);
  const klass = createMemo(() => identity()?.class ?? "");

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}>
      <Show
        when={klass().length === 0}
        fallback={null}
      >
        <p style={{ "font-size": "0.85rem", color: "var(--color-fg-muted)", margin: 0 }}>
          No class set on the Who You Are tab — the Arcane tab is shown for all
          characters until class-conditional tab visibility lands.
        </p>
      </Show>

      <kit.SheetSection title="Arcane Spells">
        <p style={{ "font-size": "0.85rem", color: "var(--color-fg-muted)", margin: 0 }}>
          Spells you've learned. The library / spellbook / memorized / cast /
          scroll / supplies columns track where the spell lives and whether you
          have what you need to cast (DH p.97).
        </p>
        <SpellsList characterId={props.characterId} />
        <kit.FieldRow label="Memory Palace">
          <kit.NumberField
            characterId={props.characterId}
            trait={Spells}
            path={["memoryPalace"]}
            min={0}
            max={6}
          />
          <span style={{ "font-size": "0.8rem", color: "var(--color-fg-muted)" }}>
            slots (max 6)
          </span>
        </kit.FieldRow>
      </kit.SheetSection>

      <kit.SheetSection title="Relics">
        <p style={{ "font-size": "0.85rem", color: "var(--color-fg-muted)", margin: 0 }}>
          Sacred artifacts and the invocations they carry. Theurges and shamans
          channel the Immortals through them (DH p.105, LMM p.41+).
        </p>
        <RelicsList characterId={props.characterId} />
        <kit.SheetGroup layout="grid" cols={2}>
          <kit.FieldRow label="Urðr">
            <kit.NumberField
              characterId={props.characterId}
              trait={Relics}
              path={["urdr"]}
              min={0}
              max={4}
            />
            <span style={{ "font-size": "0.75rem", color: "var(--color-fg-muted)" }}>
              divine favor
            </span>
          </kit.FieldRow>
          <kit.FieldRow label="Burden">
            <kit.NumberField
              characterId={props.characterId}
              trait={Relics}
              path={["burden"]}
              min={0}
              max={6}
            />
            <span style={{ "font-size": "0.75rem", color: "var(--color-fg-muted)" }}>
              divine debt
            </span>
          </kit.FieldRow>
        </kit.SheetGroup>
      </kit.SheetSection>
    </div>
  );
}

function SpellsList(props: { characterId: string }): JSX.Element {
  const spells = useTrait(props.characterId, Spells);
  const entries = createMemo(() => spells()?.entries ?? []);
  return (
    <Show
      when={entries().length > 0}
      fallback={
        <span style={{ "font-size": "0.85rem", "font-style": "italic", color: "var(--color-fg-muted)" }}>
          no spells yet — entry editor lands with the EntryListField primitive
        </span>
      }
    >
      <ul style={{ "list-style": "none", padding: 0, margin: 0, display: "flex", "flex-direction": "column", gap: "0.3rem" }}>
        <For each={entries()}>
          {(s) => (
            <li
              style={{
                display: "flex",
                "align-items": "center",
                gap: "0.5rem",
                padding: "0.3rem 0.5rem",
                "border-radius": "var(--radius-control)",
                background: "var(--color-surface-elevated)",
                border: "1px solid var(--color-border-muted)",
                "font-size": "0.75rem",
              }}
            >
              <span style={{ "font-weight": "500", "min-width": "10rem" }}>{s.name}</span>
              <span style={{ color: "var(--color-fg-muted)" }}>Ob {s.ob}</span>
              <span style={{ color: "var(--color-fg-muted)" }}>
                {[s.library && "lib", s.spellbook && "book", s.memorized && "mem", s.cast && "cast", s.scroll && "scroll", s.supplies && "supplies"]
                  .filter(Boolean).join(" · ") || "—"}
              </span>
              <span style={{ color: "var(--color-fg-muted)", "font-style": "italic" }}>
                {s.effect}
              </span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

function RelicsList(props: { characterId: string }): JSX.Element {
  const relics = useTrait(props.characterId, Relics);
  const entries = createMemo(() => relics()?.entries ?? []);
  return (
    <Show
      when={entries().length > 0}
      fallback={
        <span style={{ "font-size": "0.85rem", "font-style": "italic", color: "var(--color-fg-muted)" }}>
          no relics yet — entry editor lands with the EntryListField primitive
        </span>
      }
    >
      <ul style={{ "list-style": "none", padding: 0, margin: 0, display: "flex", "flex-direction": "column", gap: "0.3rem" }}>
        <For each={entries()}>
          {(r) => (
            <li
              style={{
                display: "flex",
                "align-items": "center",
                gap: "0.5rem",
                padding: "0.3rem 0.5rem",
                "border-radius": "var(--radius-control)",
                background: "var(--color-surface-elevated)",
                border: "1px solid var(--color-border-muted)",
                "font-size": "0.75rem",
              }}
            >
              <span style={{ "font-weight": "500", "min-width": "10rem" }}>{r.relic}</span>
              <span style={{ color: "var(--color-fg-muted)" }}>{r.inventory || "—"}</span>
              <span style={{ color: "var(--color-fg-muted)" }}>{r.invocation}</span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

export const TbArcaneTabFill: CharacterSheetTab = {
  id: qualifiedName("@vtt/system-torchbearer/tab-arcane") as CharacterSheetTab["id"],
  label: "Arcane",
  priority: 60,
  render: ({ characterId }) => ArcaneTab({ characterId }),
};
