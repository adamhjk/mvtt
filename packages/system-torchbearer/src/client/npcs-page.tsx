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
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { Active, Character, isActive } from "@vtt/characters/shared";
import { definePageProvider, RetargetTab } from "@vtt/shell-workbench/shared";
import { BookCitation } from "@vtt/books/client";
import { ActiveToggle, kit } from "@vtt/characters/client";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import {
  CreateBlankNpc,
  CreateNpcFromCatalog,
  RemoveNpc,
  TB_NPC_TEMPLATES,
} from "../shared/npcs.js";
import { NpcCreated } from "../shared/npc-events.js";
import { TbNpc } from "../shared/npc-traits.js";
import { NpcSheet } from "./npc-sheet.js";
import { NpcRack, NpcSearchInput, filterNpcCatalogByQuery } from "./npc-picker.js";
import { fuzzyMatch } from "./monsters-picker.js";
import { tbCanonicalBookAbbreviation } from "../data/seed.js";

const NPCS_KIND = "@vtt/system-torchbearer/npcs";

/**
 * NPCs page provider — lists every NPC entity in the world (entities
 * carrying both `Character` and `TbNpc`) and renders the simplified
 * NPC sheet. Lives on its own workbench tab so the Characters tab
 * stays focused on PCs and the Monsters tab stays focused on monsters.
 *
 * GM-only spawn: `CreateNpcFromCatalog` validates `role === "gm"`,
 * so the create form below appears only for GMs. Players who can read
 * the entity (per Permissions) can still see it on this tab once a GM
 * reveals it.
 */
export const NpcsPageProvider = definePageProvider({
  kind: NPCS_KIND,
  icon: "users",
  label: "NPCs",
  reads: [Character, TbNpc],
  list: ({ world }) => {
    return world.query([Character, TbNpc]).map((row) => {
      const c = row.values.Character as { name: string };
      const n = row.values.TbNpc as { role: string };
      return {
        id: row.id,
        label: c.name,
        hint: n.role,
      };
    });
  },
  defaultEntity: ({ world }) => {
    const first = world.query([Character, TbNpc])[0];
    return first?.id ?? null;
  },
  render: ({ tabId, entityId }) => {
    return <NpcsPage tabId={tabId} entityId={entityId} />;
  },
});

function NpcsPage(props: { tabId: string; entityId: string | null }): JSX.Element {
  return (
    <Show when={props.entityId} fallback={<NpcsHub tabId={props.tabId} />}>
      {(idAcc) => <NpcSheet characterId={idAcc()} />}
    </Show>
  );
}

/**
 * Empty-state hub. Lists every existing NPC and offers a catalog
 * picker for spawning a new one. GM only — for non-GMs the picker
 * stays hidden (the command would fail validation anyway).
 */
interface NpcRowData {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly active: boolean;
}

function NpcsHub(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const me = kit.useMe();
  const npcRows = useQuery([Character, TbNpc]);
  // Subscribe to Active writes so the active/inactive groups
  // re-render when the GM flips a toggle.
  const activeRows = useQuery([Active]);

  const npcs = createMemo<NpcRowData[]>(() => {
    activeRows();
    return npcRows()
      .map((row) => ({
        id: row.id as string,
        name: (row.values.Character as { name: string }).name,
        role: (row.values.TbNpc as { role: string }).role,
        active: isActive(client.world, row.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  // Fuzzy filter — same subsequence matcher the conflict-declare NPC
  // picker uses.
  const [query, setQuery] = createSignal("");
  const filtered = createMemo<NpcRowData[]>(() => {
    const q = query().trim();
    if (q.length === 0) return npcs();
    return npcs().filter((n) => fuzzyMatch(n.name, q));
  });
  const activeNpcs = createMemo(() => filtered().filter((n) => n.active));
  const inactiveNpcs = createMemo(() => filtered().filter((n) => !n.active));

  const isGm = createMemo(() => me()?.role === "gm");

  const open = (npcId: string) => {
    client.dispatch(
      RetargetTab({
        tabId: props.tabId,
        pageKind: NPCS_KIND,
        entityId: npcId,
      }) as CommandInstance,
    );
  };

  const remove = (npcId: string, name: string) => {
    if (!window.confirm(`Remove "${name}"?`)) return;
    client.dispatch(RemoveNpc({ npcId }) as CommandInstance);
  };

  const renderRow = (n: NpcRowData): JSX.Element => (
    <NpcListRow
      npc={n}
      isGm={isGm()}
      onOpen={() => open(n.id)}
      onRemove={() => remove(n.id, n.name)}
    />
  );

  return (
    <div class="flex h-full items-start justify-center overflow-y-auto py-10">
      <div class="flex w-full max-w-2xl flex-col gap-6 px-5">
        <Show
          when={npcs().length > 0}
          fallback={
            <div class="flex flex-col items-center gap-5 text-center">
              <p
                class="font-display text-2xl tracking-tight text-fg-muted"
                style={{ "font-family": "var(--font-display)" }}
              >
                No NPCs yet — spawn one from the catalog below.
              </p>
              <Show
                when={isGm()}
                fallback={<p class="text-xs text-fg-subtle">only the GM can spawn NPCs.</p>}
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
              NPCs
            </h2>
            <span class="font-display text-[0.62rem] uppercase tracking-[0.16em] text-fg-subtle">
              {activeNpcs().length} active · {inactiveNpcs().length} inactive
            </span>
          </header>

          <NpcsFilterInput query={query} setQuery={setQuery} />

          <Show
            when={filtered().length > 0}
            fallback={
              <p class="text-center text-xs text-fg-subtle italic" data-testid="npcs-empty">
                No NPCs match "{query()}".
              </p>
            }
          >
            <Show when={activeNpcs().length > 0}>
              <section class="flex flex-col gap-2">
                <SectionHeader label="Active" count={activeNpcs().length} />
                <ul class="flex flex-col gap-2" data-testid="npcs-active-list">
                  <For each={activeNpcs()}>{renderRow}</For>
                </ul>
              </section>
            </Show>
            <Show when={inactiveNpcs().length > 0}>
              <section class="flex flex-col gap-2">
                <SectionHeader label="Inactive" count={inactiveNpcs().length} />
                <ul class="flex flex-col gap-2" data-testid="npcs-inactive-list">
                  <For each={inactiveNpcs()}>{renderRow}</For>
                </ul>
              </section>
            </Show>
          </Show>

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

function SectionHeader(props: { label: string; count: number }): JSX.Element {
  return (
    <header class="flex items-baseline justify-between">
      <h3 class="font-display text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle">
        {props.label}
      </h3>
      <span class="font-mono text-[0.6rem] text-fg-subtle tabular-nums">{props.count}</span>
    </header>
  );
}

function NpcsFilterInput(props: {
  query: () => string;
  setQuery: (next: string) => void;
}): JSX.Element {
  return (
    <input
      type="text"
      value={props.query()}
      placeholder="filter by name…"
      onInput={(e) => props.setQuery(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") props.setQuery("");
      }}
      data-testid="npcs-filter"
      autocomplete="off"
      spellcheck={false}
      name="npcs-filter"
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      data-form-type="other"
      class="w-full rounded-(--radius-control) border border-border-muted bg-surface px-3 py-1.5 text-sm text-fg outline-none focus:border-accent transition-colors"
    />
  );
}

/**
 * One row in the existing-NPCs list. Layout mirrors the monsters
 * hub's roomier rows but adds a `<BookCitation>` chip when the NPC
 * carries a `pageRef` (i.e. canon catalog entries) so the GM can
 * click straight to the printed stat block.
 */
function NpcListRow(props: {
  npc: { id: string; name: string; role: string };
  isGm: boolean;
  onOpen: () => void;
  onRemove: () => void;
}): JSX.Element {
  const npcTrait = useTrait(props.npc.id, TbNpc);
  return (
    <li
      class="group flex items-center gap-3 rounded-(--radius-control) border border-border-muted bg-surface-elevated px-4 py-3"
      data-testid={`npc-row-${props.npc.id}`}
    >
      <button
        type="button"
        onClick={props.onOpen}
        class="flex flex-1 flex-col gap-0.5 truncate text-left text-fg hover:text-accent transition"
        title="Open this NPC"
        data-testid={`npc-row-open-${props.npc.id}`}
      >
        <span class="font-display text-base">{props.npc.name}</span>
        <span class="font-display text-[0.7rem] uppercase tracking-[0.14em] text-fg-subtle">
          {props.npc.role}
        </span>
      </button>
      <Show when={npcTrait()?.pageRef}>
        {(ref) => (
          <BookCitation
            canonicalId={ref().canonicalId}
            page={ref().page}
            label={citationLabel(ref().canonicalId, ref().page)}
            ariaLabel={`open ${props.npc.name} entry in ${ref().canonicalId} at page ${ref().page}`}
          />
        )}
      </Show>
      <Show when={props.isGm}>
        <ActiveToggle characterId={props.npc.id} />
      </Show>
      <button
        type="button"
        onClick={props.onOpen}
        class="rounded-(--radius-control) border border-border bg-surface px-3 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-fg transition"
      >
        Open
      </button>
      <Show when={props.isGm}>
        <button
          type="button"
          onClick={props.onRemove}
          class="rounded-(--radius-control) border border-border bg-surface px-3 py-1.5 text-xs text-fg-subtle hover:border-danger hover:text-danger transition"
          title={`Remove "${props.npc.name}"`}
          data-testid={`npc-row-remove-${props.npc.id}`}
        >
          Remove
        </button>
      </Show>
    </li>
  );
}

/**
 * Render label for a `<BookCitation>`. Resolves the canonicalId to a
 * TB abbreviation when known (`"SG p.201"`); falls back to a generic
 * `"p.<page>"` for unknown books.
 */
function citationLabel(canonicalId: string, page: number): string {
  const abbrev = tbCanonicalBookAbbreviation(canonicalId);
  return abbrev !== null ? `${abbrev} p.${page}` : `p.${page}`;
}

/**
 * Catalog picker — fuzzy-search rack listing every `TbNpcTemplate`
 * plus an inline blank-NPC affordance below. Mirrors the monsters
 * `CatalogPicker` shape so the two surfaces stay patternable.
 *
 * The Spawn button dispatches either `CreateNpcFromCatalog` (for the
 * picked template) or `CreateBlankNpc` (for the homebrew name).
 * Either way the picker subscribes to `NpcCreated` once before
 * dispatch, diffs the NPC list on the event, and retargets this tab
 * onto the freshly-spawned entity.
 */
function CatalogPicker(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal<string | null>(TB_NPC_TEMPLATES[0]?.id ?? null);
  const [blankName, setBlankName] = createSignal("New NPC");
  const [busy, setBusy] = createSignal(false);

  const candidates = createMemo(() => filterNpcCatalogByQuery(query()));

  // Selection auto-heals when the search trims it out — same heal
  // pattern as the monsters picker's CatalogPicker.
  createMemo(() => {
    const list = candidates();
    const cur = selected();
    if (list.length === 0) return;
    if (cur && list.some((t) => t.id === cur)) return;
    setSelected(list[0]!.id);
  });

  const selectedTemplate = createMemo(
    () => TB_NPC_TEMPLATES.find((t) => t.id === selected()) ?? null,
  );

  const subscribeAndRetarget = () => {
    const beforeIds = new Set(client.world.query([Character, TbNpc]).map((r) => r.id));
    const off = client.bus.on(NpcCreated.name, () => {
      off();
      const fresh = client.world.query([Character, TbNpc]).find((r) => !beforeIds.has(r.id));
      if (fresh) {
        client.dispatch(
          RetargetTab({
            tabId: props.tabId,
            pageKind: NPCS_KIND,
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
    client.dispatch(CreateNpcFromCatalog({ templateId: tmplId }) as CommandInstance);
  };

  const spawnBlank = () => {
    if (busy()) return;
    const name = blankName().trim();
    if (name.length === 0) return;
    setBusy(true);
    subscribeAndRetarget();
    client.dispatch(CreateBlankNpc({ name }) as CommandInstance);
  };

  return (
    <div class="flex w-full flex-col gap-3" data-testid="npc-catalog-picker">
      <NpcSearchInput
        query={query}
        setQuery={setQuery}
        selected={selected}
        setSelected={setSelected}
        candidates={candidates}
        onCommit={spawnFromCatalog}
        busy={busy}
        testid="npc-template-search"
      />
      <Show
        when={candidates().length > 0}
        fallback={
          <div
            class="flex items-center justify-center text-center py-4"
            style={{
              border: "1px dashed var(--color-border-muted)",
              "border-radius": "var(--radius-control)",
              "background-color": "var(--color-surface-sunken, var(--color-surface))",
            }}
            data-testid="npc-template-empty"
          >
            <span
              style={{
                "font-family": "var(--font-display)",
                "font-size": "0.78rem",
                color: "var(--color-fg-subtle)",
                "font-style": "italic",
              }}
            >
              no NPC matches “{query()}”
            </span>
          </div>
        }
      >
        <NpcRack
          candidates={candidates}
          selected={selected}
          setSelected={setSelected}
          query={query}
          testid="npc-template-options"
          rowTestidPrefix="npc-template-option"
        />
      </Show>
      <button
        type="button"
        onClick={spawnFromCatalog}
        disabled={busy() || !selected() || candidates().length === 0}
        class="rounded-(--radius-control) bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover transition disabled:opacity-50"
        data-testid="npc-spawn-submit"
      >
        <Show when={!busy()} fallback={<span>Spawning…</span>}>
          <Show
            when={selectedTemplate() && candidates().length > 0}
            fallback={<span>Pick an NPC</span>}
          >
            <span>Spawn {selectedTemplate()!.name}</span>
          </Show>
        </Show>
      </button>
      <details class="mt-1">
        <summary class="cursor-pointer font-display text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle hover:text-fg transition">
          or spawn a blank NPC
        </summary>
        <div class="mt-2 flex flex-col gap-2" data-testid="npc-blank-form">
          <input
            type="text"
            name="blank-npc-name"
            value={blankName()}
            onInput={(e) => setBlankName(e.currentTarget.value)}
            placeholder="e.g. Old Bran"
            maxLength={120}
            autocomplete="off"
            spellcheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 font-display text-base text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            data-testid="npc-blank-name-input"
          />
          <button
            type="button"
            onClick={spawnBlank}
            disabled={busy() || blankName().trim().length === 0}
            class="rounded-(--radius-control) border border-border bg-surface px-4 py-2 text-sm text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-50"
            data-testid="npc-blank-submit"
          >
            {busy() ? "Spawning…" : "Spawn blank NPC"}
          </button>
        </div>
      </details>
    </div>
  );
}
