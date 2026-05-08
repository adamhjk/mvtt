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

import { type CommandInstance } from "@vtt/substrate";
import { useClient, useQuery } from "@vtt/substrate/client";
import { Character } from "@vtt/characters/shared";
import {
  definePageProvider,
  RetargetTab,
} from "@vtt/shell-workbench/shared";
import { kit } from "@vtt/characters/client";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import {
  CreateBlankMonster,
  CreateMonsterFromCatalog,
  RemoveMonster,
  TB_MONSTER_TEMPLATES,
} from "../shared/monsters.js";
import { MonsterCreated } from "../shared/monster-events.js";
import { TbMonster } from "../shared/monster-traits.js";
import {
  BestiaryRack,
  BestiarySearchInput,
  filterCatalogByQuery,
} from "./bestiary-picker.js";
import { MonsterSheet } from "./monster-sheet.js";

const BESTIARY_KIND = "@vtt/system-torchbearer/bestiary";

/**
 * Bestiary page provider — lists every monster entity in the world
 * (entities carrying both `Character` and `TbMonster`) and renders
 * the scrolling monster sheet. Lives on its own workbench tab so the
 * Characters tab stays focused on PCs (and, future, NPCs get their
 * own page provider too).
 *
 * GM-only spawn: `CreateMonsterFromCatalog` validates `role === "gm"`,
 * so the create form below appears only for GMs. Players who can read
 * the entity (per Permissions) can still see it on this tab once a GM
 * reveals it.
 */
export const BestiaryPageProvider = definePageProvider({
  kind: BESTIARY_KIND,
  icon: "bug",
  label: "Bestiary",
  reads: [Character, TbMonster],
  list: ({ world }) => {
    return world.query([Character, TbMonster]).map((row) => {
      const c = row.values.Character as { name: string };
      const m = row.values.TbMonster as { type: string };
      return {
        id: row.id,
        label: c.name,
        hint: m.type,
      };
    });
  },
  defaultEntity: ({ world }) => {
    const first = world.query([Character, TbMonster])[0];
    return first?.id ?? null;
  },
  render: ({ tabId, entityId }) => {
    return <BestiaryPage tabId={tabId} entityId={entityId} />;
  },
});

function BestiaryPage(props: {
  tabId: string;
  entityId: string | null;
}): JSX.Element {
  return (
    <Show
      when={props.entityId}
      fallback={<BestiaryHub tabId={props.tabId} />}
    >
      {(idAcc) => <MonsterSheet characterId={idAcc()} />}
    </Show>
  );
}

/**
 * Empty-state hub. Lists every existing monster and offers a catalog
 * picker for spawning a new one. GM only — the picker renders empty
 * and disabled for non-GMs (the command would fail validation anyway,
 * but mirroring the gate in the UI avoids surprise rejections).
 */
function BestiaryHub(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const me = kit.useMe();
  const monsterRows = useQuery([Character, TbMonster]);

  const monsters = createMemo(() =>
    monsterRows()
      .map((row) => ({
        id: row.id,
        name: (row.values.Character as { name: string }).name,
        type: (row.values.TbMonster as { type: string }).type,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  const isGm = createMemo(() => me()?.role === "gm");

  const open = (monsterId: string) => {
    client.dispatch(
      RetargetTab({
        tabId: props.tabId,
        pageKind: BESTIARY_KIND,
        entityId: monsterId,
      }) as CommandInstance,
    );
  };

  const remove = (monsterId: string, name: string) => {
    if (!window.confirm(`Remove "${name}"?`)) return;
    client.dispatch(RemoveMonster({ monsterId }) as CommandInstance);
  };

  return (
    <div class="flex h-full items-start justify-center overflow-y-auto py-10">
      <div class="flex w-full max-w-lg flex-col gap-6 px-5">
        <Show
          when={monsters().length > 0}
          fallback={
            <div class="flex flex-col items-center gap-5 text-center">
              <p
                class="font-display text-2xl tracking-tight text-fg-muted"
                style={{ "font-family": "var(--font-display)" }}
              >
                No monsters yet — spawn one from the bestiary below.
              </p>
              <Show
                when={isGm()}
                fallback={
                  <p class="text-xs text-fg-subtle">
                    only the GM can spawn monsters.
                  </p>
                }
              >
                <CatalogPicker tabId={props.tabId} />
              </Show>
            </div>
          }
        >
          <header class="flex items-baseline justify-between">
            <h2
              class="font-display text-xl tracking-tight text-fg"
              style={{ "font-family": "var(--font-display)" }}
            >
              Bestiary
            </h2>
            <span class="font-display text-[0.62rem] uppercase tracking-[0.16em] text-fg-subtle">
              {monsters().length} total
            </span>
          </header>
          <ul class="flex flex-col gap-1">
            <For each={monsters()}>
              {(m) => (
                <li class="group flex items-center gap-3 rounded-(--radius-control) border border-border-muted bg-surface-elevated px-3 py-2">
                  <button
                    type="button"
                    onClick={() => open(m.id)}
                    class="flex-1 truncate text-left text-sm text-fg hover:text-accent transition"
                    title="Open this monster"
                  >
                    {m.name}
                  </button>
                  <span class="font-mono text-[0.6rem] text-fg-subtle">
                    {m.type}
                  </span>
                  <button
                    type="button"
                    onClick={() => open(m.id)}
                    class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition"
                  >
                    Open
                  </button>
                  <Show when={isGm()}>
                    <button
                      type="button"
                      onClick={() => remove(m.id, m.name)}
                      class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-[0.65rem] text-fg-subtle hover:border-danger hover:text-danger transition"
                      title={`Remove "${m.name}"`}
                    >
                      Remove
                    </button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <Show when={isGm()}>
            <div class="mt-2 flex flex-col gap-3 border-t border-border-muted pt-5">
              <h3 class="font-display text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle">
                Spawn from catalog
              </h3>
              <CatalogPicker tabId={props.tabId} />
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

/**
 * Catalog picker — fuzzy-search rack listing every `TbMonsterTemplate`
 * plus an inline blank-monster affordance below. The Spawn button
 * dispatches either `CreateMonsterFromCatalog` (for the picked
 * template) or `CreateBlankMonster` (for the homebrew name). Either
 * way the picker subscribes to `MonsterCreated` once before dispatch,
 * diffs the monster list on the event, and retargets this tab onto
 * the freshly-spawned entity.
 *
 * Uses the same `BestiaryRack` + fuzzy matcher as the conflict-declare
 * inline picker — typing filters in place, ↑/↓ moves the highlight,
 * Enter spawns. Shares the `bestiary-picker` module so a future
 * catalog change shows up in both places without drift.
 */
function CatalogPicker(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal<string | null>(
    TB_MONSTER_TEMPLATES[0]?.id ?? null,
  );
  const [blankName, setBlankName] = createSignal("New Monster");
  const [busy, setBusy] = createSignal(false);

  const candidates = createMemo(() => filterCatalogByQuery(query()));

  // Selection auto-heals when the search trims it out — without this
  // the user can type a query that excludes the current selection and
  // the spawn button stays "armed" with a creature they can't see.
  // Mirrors the conflict-page rack's heal pattern.
  createMemo(() => {
    const list = candidates();
    const cur = selected();
    if (list.length === 0) return;
    if (cur && list.some((t) => t.id === cur)) return;
    setSelected(list[0]!.id);
  });

  const selectedTemplate = createMemo(() =>
    TB_MONSTER_TEMPLATES.find((t) => t.id === selected()) ?? null,
  );

  const subscribeAndRetarget = () => {
    const beforeIds = new Set(
      client.world.query([Character, TbMonster]).map((r) => r.id),
    );
    const off = client.bus.on(MonsterCreated.name, () => {
      off();
      const fresh = client.world
        .query([Character, TbMonster])
        .find((r) => !beforeIds.has(r.id));
      if (fresh) {
        client.dispatch(
          RetargetTab({
            tabId: props.tabId,
            pageKind: BESTIARY_KIND,
            entityId: fresh.id,
          }) as CommandInstance,
        );
      }
      setBusy(false);
    });
  };

  const spawnFromCatalog = () => {
    if (busy()) return;
    const tmplId = selected();
    if (!tmplId) return;
    setBusy(true);
    subscribeAndRetarget();
    client.dispatch(
      CreateMonsterFromCatalog({ templateId: tmplId }) as CommandInstance,
    );
  };

  const spawnBlank = () => {
    if (busy()) return;
    const name = blankName().trim();
    if (name.length === 0) return;
    setBusy(true);
    subscribeAndRetarget();
    client.dispatch(CreateBlankMonster({ name }) as CommandInstance);
  };

  return (
    <div
      class="flex w-full flex-col gap-3"
      data-testid="bestiary-catalog-picker"
    >
      <BestiarySearchInput
        query={query}
        setQuery={setQuery}
        selected={selected}
        setSelected={setSelected}
        candidates={candidates}
        onCommit={spawnFromCatalog}
        busy={busy}
        testid="monster-template-search"
      />
      <Show
        when={candidates().length > 0}
        fallback={
          <div
            class="flex items-center justify-center text-center py-4"
            style={{
              border: "1px dashed var(--color-border-muted)",
              "border-radius": "var(--radius-control)",
              "background-color":
                "var(--color-surface-sunken, var(--color-surface))",
            }}
            data-testid="monster-template-empty"
          >
            <span
              style={{
                "font-family": "var(--font-display)",
                "font-size": "0.78rem",
                color: "var(--color-fg-subtle)",
                "font-style": "italic",
              }}
            >
              no creature matches “{query()}”
            </span>
          </div>
        }
      >
        <BestiaryRack
          candidates={candidates}
          selected={selected}
          setSelected={setSelected}
          query={query}
          testid="monster-template-options"
          rowTestidPrefix="monster-template-option"
        />
      </Show>
      <button
        type="button"
        onClick={spawnFromCatalog}
        disabled={busy() || !selected() || candidates().length === 0}
        class="rounded-(--radius-control) bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover transition disabled:opacity-50"
        data-testid="monster-spawn-submit"
      >
        <Show when={!busy()} fallback={<span>Spawning…</span>}>
          <Show
            when={selectedTemplate() && candidates().length > 0}
            fallback={<span>Pick a creature</span>}
          >
            <span>Spawn {selectedTemplate()!.name}</span>
          </Show>
        </Show>
      </button>
      <details class="mt-1">
        <summary class="cursor-pointer font-display text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle hover:text-fg transition">
          or spawn a blank homebrew monster
        </summary>
        <div
          class="mt-2 flex flex-col gap-2"
          data-testid="monster-blank-form"
        >
          <input
            type="text"
            name="blank-monster-name"
            value={blankName()}
            onInput={(e) => setBlankName(e.currentTarget.value)}
            placeholder="e.g. Cinderclaw"
            maxLength={120}
            autocomplete="off"
            spellcheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 font-display text-base text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            data-testid="monster-blank-name-input"
          />
          <button
            type="button"
            onClick={spawnBlank}
            disabled={busy() || blankName().trim().length === 0}
            class="rounded-(--radius-control) border border-border bg-surface px-4 py-2 text-sm text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-50"
            data-testid="monster-blank-submit"
          >
            {busy() ? "Spawning…" : "Spawn blank monster"}
          </button>
        </div>
      </details>
    </div>
  );
}
