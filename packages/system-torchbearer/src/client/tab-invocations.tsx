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

// "Invocations" tab — manager UI for the Ritualist subsystem. Mirrors
// `tab-arcane.tsx` shape: filter the catalog by the character's class
// → tradition, expose [Perform] (Ritualist roll), [Have relic] toggle,
// and the Immortal Burden / Urðr counters (moved here from the
// previous Arcane tab Relics section). The Invocations tab is a
// manager — it doesn't enforce relic-cost rules at the wire boundary;
// the post-roll [Apply burden] commit does that based on whether the
// rolling character holds the invocation's relic.

import { qualifiedName, type EntityId } from "@vtt/substrate";
import { kit } from "@vtt/characters/client";
import type { CharacterSheetTab } from "@vtt/characters/shared";
import { useClient, useTrait } from "@vtt/substrate/client";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { RuleRef } from "./rule-ref.js";
import {
  AcquireRelic,
  Identity,
  INVOCATION_TRADITIONS,
  InvocationPerformRollable,
  LoseRelic,
  Relics,
  TbInvocationRelics,
  type InvocationTradition,
} from "../shared/index.js";
import { OpenPendingRoll } from "@vtt/characters/shared";
import { InvocationCard } from "./invocation-card.js";
import { useInvocationCatalog } from "./invocation-picker.js";
import { fuzzyMatch } from "./monsters-picker.js";

/**
 * Open the standard pending-roll panel for an invocation perform.
 * Identical roll infrastructure to every other TB roll — the panel
 * mounts, the player adds Help / wises / persona dice / channel-nature
 * / etc., and clicks Commit. The only difference is
 * `opts.invocationId` (carried through the rollable into
 * `spec.invocationPerform`) so the chat row's `[Apply burden]`
 * post-roll commit fires.
 */
function openInvocationPerform(
  client: ReturnType<typeof useClient>,
  characterId: string,
  invocationId: string,
): void {
  client.dispatch(
    OpenPendingRoll({
      initiatorCharacterId: characterId as EntityId,
      rollableName: InvocationPerformRollable.name,
      opts: { invocationId },
    }),
  );
}

/**
 * Map a character's class string to the invocation traditions they
 * can draw from. RAW:
 *   - DH p.98 — theurges perform from the theurge list (DH p.209-231).
 *   - LMM p.41 — shamans perform from the shaman list (LMM p.41-58)
 *     and explicitly NOT the theurge list.
 *   - LMM p.20 (Skald level 6, Gondul) — a skald who bears a relic
 *     can perform that relic's invocation using Ritualist, drawing
 *     from either canon list. So skald gets the union.
 *
 * Empty class falls back to the union as well, so a GM previewing the
 * full catalog sees everything without setting a class first.
 */
function traditionsForClass(klass: string): ReadonlyArray<InvocationTradition> {
  const slug = klass.trim().toLowerCase();
  if (slug === "theurge") return ["theurge"];
  if (slug === "shaman") return ["shaman"];
  if (slug === "skald") return ["theurge", "shaman"];
  if (slug.length === 0) return ["theurge", "shaman"];
  return [];
}

function InvocationsTab(props: { characterId: string }): JSX.Element {
  const identity = useTrait(props.characterId, Identity);
  const klass = createMemo(() => identity()?.class ?? "");
  const allowedTraditions = createMemo(() => traditionsForClass(klass()));

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}>
      <kit.SheetSection title="Immortal Burden">
        <p
          style={{
            "font-size": "0.85rem",
            color: "var(--color-fg-muted)",
            margin: 0,
            display: "flex",
            gap: "0.4rem",
            "align-items": "center",
            "flex-wrap": "wrap",
          }}
        >
          <span>
            Performing an invocation increases your burden by the listed amount (less if you hold
            the relic). Purify in camp or town.
          </span>
          <RuleRef book="DH" page={100} />
          <RuleRef book="DH" page={101} />
          <RuleRef book="DH" page={102} />
        </p>
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

      <kit.SheetSection title="Held Relics">
        <p
          style={{
            "font-size": "0.85rem",
            color: "var(--color-fg-muted)",
            margin: 0,
            display: "flex",
            gap: "0.4rem",
            "align-items": "center",
            "flex-wrap": "wrap",
          }}
        >
          <span>
            Sacred artifacts you carry. Each fuels an invocation — performing with the relic
            shortens the ritual and lowers its burden cost.
          </span>
          <RuleRef book="DH" page={103} />
        </p>
        <HeldRelicsList characterId={props.characterId} />
      </kit.SheetSection>

      <kit.SheetSection title="Available Invocations">
        <p
          style={{
            "font-size": "0.85rem",
            color: "var(--color-fg-muted)",
            margin: 0,
            display: "flex",
            gap: "0.4rem",
            "align-items": "center",
            "flex-wrap": "wrap",
          }}
        >
          <span>
            All invocations from your class's tradition. You may perform any of these, but holding
            the relic shortens the time and lowers the Immortal burden cost.
          </span>
          <RuleRef book="DH" page={209} />
          <RuleRef book="LMM" page={41} />
        </p>
        <Show when={allowedTraditions().length === 0}>
          <p
            style={{
              "font-size": "0.8rem",
              "font-style": "italic",
              color: "var(--color-fg-muted)",
              margin: 0,
            }}
          >
            Class "{klass()}" has no associated invocation tradition. Set a relic-bearing class
            (theurge, shaman, skald) on the Who You Are tab.
          </p>
        </Show>
        <Show when={allowedTraditions().length > 0}>
          <InvocationsList characterId={props.characterId} allowedTraditions={allowedTraditions} />
        </Show>
      </kit.SheetSection>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Available Invocations — grouped by circle
 * ----------------------------------------------------------------------- */

function InvocationsList(props: {
  characterId: string;
  allowedTraditions: () => ReadonlyArray<InvocationTradition>;
}): JSX.Element {
  const client = useClient();
  const catalog = useInvocationCatalog();
  const canEdit = kit.useCanEdit(props.characterId);
  const relics = useTrait(props.characterId, TbInvocationRelics);
  const heldSet = createMemo(() => new Set(relics()?.invocationIds ?? []));

  // Class-level filter — every invocation must match one of the
  // character's tradition entitlements before any user-driven filter
  // applies. Computed once per render-cycle so the per-pill / per-keystroke
  // memo below doesn't have to re-walk the allowed set.
  const inAllowedTraditions = createMemo(() => {
    const allowed = new Set(props.allowedTraditions());
    return catalog().filter((inv) => inv.traditions.some((t) => allowed.has(t)));
  });

  // User-driven filters: a tradition pill (null = "all") and a fuzzy
  // search box. Both compose with the class-level filter; clearing
  // both reverts to the full class-tradition list.
  //
  // Tradition selection is sticky per-character — a player almost
  // always wants the same list every time they open the sheet. We
  // persist via localStorage rather than a world trait because this
  // is a UI preference, not game state, and shouldn't synchronise
  // across players or seats. Search query is intentionally transient.
  const [traditionFilter, setTraditionFilterRaw] = createSignal<InvocationTradition | null>(
    readStickyTradition(props.characterId),
  );
  const setTraditionFilter = (v: InvocationTradition | null): void => {
    writeStickyTradition(props.characterId, v);
    setTraditionFilterRaw(v);
  };
  const [query, setQuery] = createSignal("");

  const visible = createMemo(() => {
    const tf = traditionFilter();
    const q = query().trim();
    return inAllowedTraditions().filter((inv) => {
      if (tf !== null && !inv.traditions.includes(tf)) return false;
      if (q.length > 0 && !fuzzyMatch(inv.name, q)) return false;
      return true;
    });
  });

  const grouped = createMemo(() => {
    const groups = new Map<number, typeof visible extends () => infer T ? T : never>();
    for (const inv of visible()) {
      const arr = (groups.get(inv.circle) as Array<typeof inv> | undefined) ?? [];
      arr.push(inv);
      groups.set(inv.circle, arr as never);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  });

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.5rem",
      }}
    >
      {/* Filter row — search box + tradition pills. The pills only
          render when the character's class spans more than one
          tradition (otherwise the choice is trivial — "all" and the
          single tradition are identical). The search box always
          renders. */}
      <div
        style={{
          display: "flex",
          gap: "0.4rem",
          "align-items": "center",
          "flex-wrap": "wrap",
        }}
      >
        <input
          type="text"
          value={query()}
          placeholder="Search invocations…"
          autocomplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          spellcheck={false}
          data-testid="invocations-search"
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          style={{
            flex: "1 1 14rem",
            "min-width": "12rem",
            padding: "0.35rem 0.5rem",
            "border-radius": "var(--radius-control)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-fg)",
            "font-size": "0.8rem",
          }}
        />
        <Show when={props.allowedTraditions().length > 1}>
          <span
            style={{
              display: "inline-flex",
              gap: "0.3rem",
              "flex-wrap": "wrap",
              "align-items": "center",
            }}
          >
            <button
              type="button"
              data-testid="invocations-tradition-all"
              onClick={() => setTraditionFilter(null)}
              style={pillStyle(traditionFilter() === null)}
            >
              All
            </button>
            <For each={props.allowedTraditions()}>
              {(t) => (
                <button
                  type="button"
                  data-testid={`invocations-tradition-${t}`}
                  onClick={() => setTraditionFilter(t)}
                  style={pillStyle(traditionFilter() === t)}
                  title={`Show only ${t} invocations`}
                >
                  {t}
                </button>
              )}
            </For>
          </span>
        </Show>
      </div>

      <Show
        when={visible().length > 0}
        fallback={
          <p
            style={{
              "font-size": "0.8rem",
              "font-style": "italic",
              color: "var(--color-fg-muted)",
              margin: 0,
            }}
          >
            <Show
              when={query().trim().length > 0 || traditionFilter() !== null}
              fallback={<>No invocations in your tradition.</>}
            >
              No invocations match your filter.
            </Show>
          </p>
        }
      >
        <ul
          data-testid="invocations-list"
          style={{
            "list-style": "none",
            padding: 0,
            margin: 0,
            display: "flex",
            "flex-direction": "column",
            gap: "0.6rem",
          }}
        >
          <For each={grouped()}>
            {([circle, list]) => (
              <li>
                <div
                  style={{
                    "font-size": "0.7rem",
                    color: "var(--color-fg-muted)",
                    "font-variant": "small-caps",
                    "letter-spacing": "0.06em",
                    "padding-bottom": "0.25rem",
                  }}
                >
                  Circle {circle}
                </div>
                <ul
                  style={{
                    "list-style": "none",
                    padding: 0,
                    margin: 0,
                    display: "flex",
                    "flex-direction": "column",
                    gap: "0.35rem",
                  }}
                >
                  <For each={list as ReadonlyArray<{ id: string; name: string }>}>
                    {(inv) => {
                      const has = createMemo(() => heldSet().has(inv.id));
                      return (
                        <li>
                          <InvocationCard
                            invocationId={inv.id}
                            hasRelic={has}
                            status={() =>
                              has() ? (
                                <span
                                  style={{
                                    "font-size": "0.65rem",
                                    color: "var(--color-accent)",
                                    background: "var(--color-accent-soft)",
                                    padding: "0 0.3rem",
                                    "border-radius": "var(--radius-control)",
                                  }}
                                  title="You hold the relic for this invocation"
                                >
                                  ✓ relic
                                </span>
                              ) : null
                            }
                            actions={() => (
                              <>
                                <button
                                  type="button"
                                  data-testid={`perform-invocation-${inv.id}`}
                                  disabled={!canEdit()}
                                  onClick={() =>
                                    openInvocationPerform(client, props.characterId, inv.id)
                                  }
                                  style={btnStyle(false)}
                                >
                                  Perform
                                </button>
                                <button
                                  type="button"
                                  data-testid={`toggle-relic-${inv.id}`}
                                  disabled={!canEdit()}
                                  onClick={() =>
                                    client.dispatch(
                                      has()
                                        ? LoseRelic({
                                            characterId: props.characterId as EntityId,
                                            invocationId: inv.id as EntityId,
                                          })
                                        : AcquireRelic({
                                            characterId: props.characterId as EntityId,
                                            invocationId: inv.id as EntityId,
                                          }),
                                    )
                                  }
                                  style={btnStyle(false)}
                                >
                                  {has() ? "Drop relic" : "Acquire relic"}
                                </button>
                              </>
                            )}
                          />
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Held Relics — list of invocation cards for which the character holds
 * the relic. Same InvocationCard shell, with [Perform] / [Drop relic]
 * affordances so the player can manage their relic loadout from one
 * focused list.
 * ----------------------------------------------------------------------- */

function HeldRelicsList(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const canEdit = kit.useCanEdit(props.characterId);
  const relics = useTrait(props.characterId, TbInvocationRelics);
  const heldIds = createMemo<ReadonlyArray<string>>(() => relics()?.invocationIds ?? []);
  return (
    <Show
      when={heldIds().length > 0}
      fallback={
        <p
          style={{
            "font-size": "0.8rem",
            "font-style": "italic",
            color: "var(--color-fg-muted)",
            margin: 0,
          }}
        >
          No relics held — toggle "Acquire relic" on an invocation above to mark a relic in your
          inventory.
        </p>
      }
    >
      <ul
        data-testid="held-relics-list"
        style={{
          "list-style": "none",
          padding: 0,
          margin: 0,
          display: "flex",
          "flex-direction": "column",
          gap: "0.4rem",
        }}
      >
        <For each={heldIds()}>
          {(invId) => (
            <li>
              <InvocationCard
                invocationId={invId}
                hasRelic={() => true}
                testid={`held-relic-${invId}`}
                actions={() => (
                  <>
                    <button
                      type="button"
                      data-testid={`held-perform-${invId}`}
                      disabled={!canEdit()}
                      onClick={() => openInvocationPerform(client, props.characterId, invId)}
                      style={btnStyle(false)}
                    >
                      Perform
                    </button>
                    <button
                      type="button"
                      data-testid={`held-drop-${invId}`}
                      disabled={!canEdit()}
                      onClick={() =>
                        client.dispatch(
                          LoseRelic({
                            characterId: props.characterId as EntityId,
                            invocationId: invId as EntityId,
                          }),
                        )
                      }
                      style={btnStyle(false)}
                    >
                      Drop relic
                    </button>
                  </>
                )}
              />
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

function btnStyle(disabled: boolean): JSX.CSSProperties {
  return {
    padding: "0.3rem 0.55rem",
    "border-radius": "var(--radius-control)",
    border: "1px solid var(--color-border)",
    background: disabled ? "var(--color-surface-sunken)" : "var(--color-surface)",
    color: disabled ? "var(--color-fg-muted)" : "var(--color-fg)",
    cursor: disabled ? "not-allowed" : "pointer",
    "font-size": "0.75rem",
    opacity: disabled ? 0.6 : 1,
  };
}

/* -------------------------------------------------------------------------
 * Sticky-tradition persistence
 *
 * Per-character UI preference, persisted to localStorage so the filter
 * survives tab swaps, sheet remounts, and page reloads. Stays opt-in:
 * a brand-new character starts with the filter cleared (`null` = "All").
 *
 * Server-side rendering / SSR-bound test runners may not expose a
 * `localStorage` object; both helpers guard with try/catch so the read
 * path returns null and the write path silently no-ops.
 * ----------------------------------------------------------------------- */

const TRADITION_STICKY_PREFIX = "mvtt:tb-invocations-tradition:";

function readStickyTradition(characterId: string): InvocationTradition | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const v = localStorage.getItem(TRADITION_STICKY_PREFIX + characterId);
    if (v === null || v === "all") return null;
    return (INVOCATION_TRADITIONS as ReadonlyArray<string>).includes(v)
      ? (v as InvocationTradition)
      : null;
  } catch {
    return null;
  }
}

function writeStickyTradition(characterId: string, value: InvocationTradition | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(TRADITION_STICKY_PREFIX + characterId, value ?? "all");
  } catch {
    // Quota exceeded, disabled storage, etc. — drop silently.
  }
}

/**
 * Tradition-pill style — accents the active filter and stays subtle
 * for the inactive ones. Matches the Arcane tab's `scopeBtnStyle` so
 * the two surfaces feel coherent.
 */
function pillStyle(active: boolean): JSX.CSSProperties {
  return {
    padding: "0.15rem 0.6rem",
    "border-radius": "var(--radius-control)",
    border: active ? "1px solid var(--color-accent)" : "1px solid var(--color-border-muted)",
    background: active ? "var(--color-accent-soft)" : "var(--color-surface)",
    color: active ? "var(--color-accent)" : "var(--color-fg-muted)",
    cursor: "pointer",
    "font-size": "0.7rem",
    "font-variant": "small-caps",
    "letter-spacing": "0.04em",
  };
}

export const TbInvocationsTabFill: CharacterSheetTab = {
  id: qualifiedName("@vtt/system-torchbearer/tab-invocations") as CharacterSheetTab["id"],
  label: "Invocations",
  priority: 40,
  render: ({ characterId }) => InvocationsTab({ characterId }),
};
