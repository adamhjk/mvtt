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

import { type CommandInstance, type EntityId } from "@vtt/substrate";
import { Surface, useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { definePageProvider, RetargetTab } from "@vtt/shell-workbench/shared";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import {
  CreateItem,
  CustomizeItem,
  DestroyItem,
  EditItemField,
  ItemCatalogIndex,
  ItemDerivedFrom,
  ItemEconomics,
  ItemIdentity,
  LockItemField,
  RevertItemField,
  type ItemDetailSection,
} from "../shared/index.js";
import { ItemDetailSectionsSlot } from "../shared/slots.js";
import { ItemIcon } from "./ItemIcon.js";

export const ITEMS_KIND = "@vtt/items/items";

/**
 * "Items" workbench page — list every item entity, click to open a
 * detail editor.
 *
 * Empty branch (`entityId === null`): hub view — searchable list
 * grouped by category (catalog / forked / deprecated), plus a "+ New
 * Item" button (GMs).
 *
 * Selected branch: detail view with editable ItemIdentity +
 * ItemEconomics, plus any game-system-contributed subtype sections
 * (TbWeapon editor, TbArmor editor, etc.) via ItemDetailSectionsSlot,
 * plus an origin/overrides panel for catalog-derived items.
 */
export const ItemsPageProvider = definePageProvider({
  kind: ITEMS_KIND,
  icon: "package",
  label: "Items",
  reads: [ItemIdentity, ItemDerivedFrom],
  list: ({ world }) => {
    return world.query([ItemIdentity]).map((row) => {
      const ident = row.values.ItemIdentity as { name: string };
      return {
        id: row.id,
        label: ident.name,
      };
    });
  },
  defaultEntity: () => null,
  render: ({ tabId, entityId }) => {
    return <ItemsPage tabId={tabId} entityId={entityId} />;
  },
});

function ItemsPage(props: { tabId: string; entityId: string | null }): JSX.Element {
  return (
    <Show when={props.entityId} fallback={<ItemsHub tabId={props.tabId} />}>
      {(idAcc) => <ItemDetail itemId={idAcc() as EntityId} tabId={props.tabId} />}
    </Show>
  );
}

interface ItemRow {
  id: EntityId;
  name: string;
  category: string;
  origin: "catalog" | "fork" | "ad-hoc" | "deprecated";
  templateId: string | null;
}

function ItemsHub(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const [filter, setFilter] = createSignal("");
  const [origin, setOrigin] = createSignal<"all" | "catalog" | "fork" | "ad-hoc" | "deprecated">(
    "all",
  );
  const [category, setCategory] = createSignal<string>("all");

  const idents = useQuery([ItemIdentity]);
  const indexes = useQuery([ItemCatalogIndex]);

  const indexedIds = createMemo<Set<EntityId>>(() => {
    const out = new Set<EntityId>();
    for (const idx of indexes()) {
      const v = idx.values.ItemCatalogIndex as {
        entries: Record<string, string>;
      };
      for (const id of Object.values(v.entries)) {
        out.add(id as EntityId);
      }
    }
    return out;
  });

  const items = createMemo<ItemRow[]>(() => {
    const set = indexedIds();
    const rows: ItemRow[] = [];
    for (const row of idents()) {
      const ident = row.values.ItemIdentity as { name: string };
      const derived = client.world.get(row.id, [ItemDerivedFrom]) as
        | {
            ItemDerivedFrom: {
              templateId: string;
              deprecated?: boolean;
            };
          }
        | undefined;
      const isCatalog = set.has(row.id);
      const templateId = derived?.ItemDerivedFrom.templateId ?? null;
      let originKind: ItemRow["origin"];
      if (derived?.ItemDerivedFrom.deprecated) originKind = "deprecated";
      else if (isCatalog) originKind = "catalog";
      else if (derived) originKind = "fork";
      else originKind = "ad-hoc";
      rows.push({
        id: row.id,
        name: ident.name,
        category: deriveCategory(templateId),
        origin: originKind,
        templateId,
      });
    }
    return rows;
  });

  const categories = createMemo<string[]>(() => {
    const set = new Set<string>();
    for (const r of items()) set.add(r.category);
    return ["all", ...Array.from(set).sort()];
  });

  const filtered = createMemo(() => {
    const needle = filter().trim().toLowerCase();
    const o = origin();
    const c = category();
    return items()
      .filter((r) => {
        if (o !== "all" && r.origin !== o) return false;
        if (c !== "all" && r.category !== c) return false;
        if (needle && !r.name.toLowerCase().includes(needle)) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const open = (itemId: EntityId): void => {
    client.dispatch(
      RetargetTab({
        tabId: props.tabId,
        pageKind: ITEMS_KIND,
        entityId: itemId,
      }) as CommandInstance,
    );
  };

  const createNew = async (): Promise<void> => {
    const name = window.prompt("Name for the new item?");
    if (!name) return;
    // Capture the existing item-id set so we can identify the
    // freshly-spawned entity once the dispatch ack lands. After
    // landing, retarget the current tab to the new item's detail
    // so the user can fill in subtypes and slot options without
    // having to find the row in the hub.
    const before = new Set(client.world.query([ItemIdentity]).map((r) => r.id as string));
    const handle = client.dispatch(
      CreateItem({
        traits: { ItemIdentity: { name } },
      }) as CommandInstance,
    );
    await handle.ack;
    const newId = client.world
      .query([ItemIdentity])
      .map((r) => r.id as string)
      .find((id) => !before.has(id));
    if (newId) {
      client.dispatch(
        RetargetTab({
          tabId: props.tabId,
          pageKind: ITEMS_KIND,
          entityId: newId,
        }) as CommandInstance,
      );
    }
  };

  return (
    <div class="flex h-full flex-col gap-3 px-5 py-4 overflow-y-auto">
      <header class="flex items-baseline justify-between">
        <h2
          class="font-display text-xl tracking-tight text-fg"
          style={{ "font-family": "var(--font-display)" }}
        >
          Items
        </h2>
        <span class="font-display text-[0.62rem] uppercase tracking-[0.16em] text-fg-subtle">
          {filtered().length}
          {filter() || origin() !== "all" || category() !== "all" ? " match" : " total"}
        </span>
      </header>

      <div class="flex flex-wrap gap-2 items-center">
        <input
          type="search"
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
          placeholder="filter by name…"
          class="flex-1 min-w-[12rem] rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          autocomplete="off"
          spellcheck={false}
          name="items-filter"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
        />
        <select
          value={origin()}
          onChange={(e) => setOrigin(e.currentTarget.value as ReturnType<typeof origin>)}
          class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-sm"
          aria-label="Origin filter"
        >
          <option value="all">all origins</option>
          <option value="catalog">catalog</option>
          <option value="fork">forked</option>
          <option value="ad-hoc">ad-hoc</option>
          <option value="deprecated">deprecated</option>
        </select>
        <select
          value={category()}
          onChange={(e) => setCategory(e.currentTarget.value)}
          class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-sm"
          aria-label="Category filter"
        >
          <For each={categories()}>{(c) => <option value={c}>{c}</option>}</For>
        </select>
        <button
          type="button"
          onClick={createNew}
          class="rounded-(--radius-control) border border-border bg-surface-elevated px-3 py-1.5 text-sm hover:border-accent"
        >
          + New Item
        </button>
      </div>

      <Show
        when={filtered().length > 0}
        fallback={
          <p class="text-fg-subtle italic">
            {filter() || origin() !== "all" || category() !== "all"
              ? "No matches."
              : "No items yet."}
          </p>
        }
      >
        <ul class="grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-3">
          <For each={filtered()}>
            {(r) => (
              <li>
                <button
                  type="button"
                  onClick={() => open(r.id)}
                  data-testid={`open-item-${r.id}`}
                  class="w-full text-left rounded-(--radius-control) border border-border-muted bg-surface-elevated px-3 py-2 hover:border-accent transition flex items-center gap-2"
                >
                  <ItemImg itemId={r.id} />
                  <span class="flex-1 min-w-0">
                    <span class="block truncate text-sm text-fg">{r.name}</span>
                    <span class="block text-[0.65rem] text-fg-subtle">
                      {r.category} · {r.origin}
                    </span>
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function ItemImg(props: { itemId: EntityId }): JSX.Element {
  const ident = useTrait(props.itemId, ItemIdentity) as () =>
    | { name: string; img: string }
    | undefined;
  return <ItemIcon src={ident()?.img ?? ""} size={20} title={ident()?.name} />;
}

function deriveCategory(templateId: string | null): string {
  if (!templateId) return "ad-hoc";
  const parts = templateId.split("/");
  return parts[1] ?? "other";
}

/* -------------------------------------------------------------------------
 * Detail view
 * ----------------------------------------------------------------------- */

function ItemDetail(props: { itemId: EntityId; tabId: string }): JSX.Element {
  const client = useClient();
  const ident = useTrait(props.itemId, ItemIdentity) as () =>
    | { name: string; description: string; img: string }
    | undefined;
  const econ = useTrait(props.itemId, ItemEconomics) as () =>
    | {
        cost?: number;
        value?: { dice: number; negotiated: boolean };
      }
    | undefined;
  const derived = useTrait(props.itemId, ItemDerivedFrom) as () =>
    | {
        templateId: string;
        pluginName: string;
        overrides: string[];
        deprecated?: boolean;
      }
    | undefined;

  // Slot fills (game-system-contributed sections).
  const sectionFills = createMemo<ItemDetailSection[]>(() => {
    const raw = client.registry.fills.get(ItemDetailSectionsSlot.name) ?? [];
    return [...(raw as ItemDetailSection[])].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  });

  const traitsOnItem = createMemo(() => {
    const set = new Set<string>();
    for (const [name] of client.world.traitsOn(props.itemId)) {
      set.add(name);
    }
    return set;
  });

  const applicableSections = createMemo(() =>
    sectionFills().filter((s) =>
      s.appliesWhen({ itemId: props.itemId, traitsOnItem: traitsOnItem() }),
    ),
  );

  const editField = (path: string, value: unknown): void => {
    client.dispatch(EditItemField({ itemId: props.itemId, path, value }) as CommandInstance);
  };
  const revertField = (path: string): void => {
    client.dispatch(RevertItemField({ itemId: props.itemId, path }) as CommandInstance);
  };
  const lockField = (path: string): void => {
    client.dispatch(LockItemField({ itemId: props.itemId, path }) as CommandInstance);
  };
  const customize = (): void => {
    client.dispatch(CustomizeItem({ sourceItemId: props.itemId }) as CommandInstance);
  };
  const destroy = (): void => {
    if (!window.confirm(`Destroy "${ident()?.name ?? "item"}"?`)) return;
    client.dispatch(DestroyItem({ itemId: props.itemId }) as CommandInstance);
    // Send the user back to the hub.
    client.dispatch(
      RetargetTab({
        tabId: props.tabId,
        pageKind: ITEMS_KIND,
        entityId: null,
      }) as CommandInstance,
    );
  };

  const back = (): void => {
    client.dispatch(
      RetargetTab({
        tabId: props.tabId,
        pageKind: ITEMS_KIND,
        entityId: null,
      }) as CommandInstance,
    );
  };

  return (
    <Show
      when={ident()}
      fallback={<p class="text-fg-subtle italic p-5">Item not found or no longer visible.</p>}
    >
      <div class="flex h-full flex-col gap-4 px-5 py-4 overflow-y-auto">
        <header class="flex items-center justify-between gap-3">
          <button type="button" onClick={back} class="text-xs text-fg-subtle hover:text-fg">
            ← All items
          </button>
          <span class="font-mono text-[0.62rem] text-fg-subtle">{props.itemId}</span>
        </header>

        <Show when={derived()?.deprecated}>
          <div class="rounded-(--radius-control) border border-warning bg-warning/10 px-3 py-2 text-sm text-warning">
            This item's catalog template has been removed upstream. The entity persists; future
            template changes will not flow into it.
          </div>
        </Show>

        <IdentityEditor
          itemId={props.itemId}
          ident={ident}
          overrides={derived()?.overrides ?? []}
          editField={editField}
          revertField={revertField}
          lockField={lockField}
          isCatalog={derived !== undefined}
        />

        <EconomicsEditor
          econ={econ}
          overrides={derived()?.overrides ?? []}
          editField={editField}
          revertField={revertField}
          isCatalog={derived !== undefined}
        />

        <For each={applicableSections()}>
          {(section) => (
            <section class="rounded-(--radius-control) border border-border-muted bg-surface-elevated p-3">
              <h3 class="text-xs uppercase tracking-wider text-fg-subtle mb-2">{section.label}</h3>
              {
                section.render({
                  itemId: props.itemId,
                  canEdit: true,
                }) as JSX.Element
              }
            </section>
          )}
        </For>

        <Show when={derived()}>
          {(d) => (
            <section class="rounded-(--radius-control) border border-border-muted bg-surface-elevated p-3 text-xs">
              <h3 class="uppercase tracking-wider text-fg-subtle mb-1.5">Origin</h3>
              <dl class="grid grid-cols-[max-content,1fr] gap-x-3 gap-y-1">
                <dt class="text-fg-subtle">Template</dt>
                <dd class="font-mono">{d().templateId}</dd>
                <dt class="text-fg-subtle">Plugin</dt>
                <dd>{d().pluginName}</dd>
                <dt class="text-fg-subtle">Local edits</dt>
                <dd>
                  <Show when={d().overrides.length > 0} fallback={<em>none</em>}>
                    <For each={d().overrides}>
                      {(p) => (
                        <span class="inline-block rounded border border-border-muted bg-surface px-1.5 py-0.5 text-[0.7rem] mr-1 mb-1">
                          {p}
                        </span>
                      )}
                    </For>
                  </Show>
                </dd>
              </dl>
            </section>
          )}
        </Show>

        <footer class="flex flex-wrap gap-2 pt-2 border-t border-border-muted">
          <button
            type="button"
            onClick={() => {
              customize();
              // The fork allocates a new id but the dispatch chain
              // doesn't surface it cleanly; the user goes back to the
              // hub where they can pick out the new entry.
              back();
            }}
            class="rounded-(--radius-control) border border-border bg-surface-elevated px-3 py-1.5 text-sm hover:border-accent"
            data-testid="customize-item"
          >
            Customize (fork)
          </button>
          <button
            type="button"
            onClick={destroy}
            class="rounded-(--radius-control) border border-danger/50 bg-surface-elevated px-3 py-1.5 text-sm text-danger hover:border-danger"
            data-testid="destroy-item"
          >
            Destroy
          </button>
        </footer>
      </div>
    </Show>
  );
}

/* -------------------------------------------------------------------------
 * Field editors
 * ----------------------------------------------------------------------- */

function IdentityEditor(props: {
  itemId: EntityId;
  ident: () => { name: string; description: string; img: string } | undefined;
  overrides: string[];
  editField: (path: string, value: unknown) => void;
  revertField: (path: string) => void;
  lockField: (path: string) => void;
  isCatalog: boolean;
}): JSX.Element {
  return (
    <section class="rounded-(--radius-control) border border-border-muted bg-surface-elevated p-3">
      <h3 class="text-xs uppercase tracking-wider text-fg-subtle mb-2">Identity</h3>
      <FieldRow
        label="Name"
        path="ItemIdentity.name"
        value={props.ident()?.name ?? ""}
        overrides={props.overrides}
        edit={props.editField}
        revert={props.revertField}
        lock={props.lockField}
        isCatalog={props.isCatalog}
      />
      <FieldRow
        label="Description"
        path="ItemIdentity.description"
        value={props.ident()?.description ?? ""}
        overrides={props.overrides}
        edit={props.editField}
        revert={props.revertField}
        lock={props.lockField}
        isCatalog={props.isCatalog}
        multiline
      />
      <FieldRow
        label="Icon"
        path="ItemIdentity.img"
        value={props.ident()?.img ?? ""}
        overrides={props.overrides}
        edit={props.editField}
        revert={props.revertField}
        lock={props.lockField}
        isCatalog={props.isCatalog}
        placeholder="/icons/<author>/<name>.svg"
      />
    </section>
  );
}

function EconomicsEditor(props: {
  econ: () =>
    | {
        cost?: number;
        value?: { dice: number; negotiated: boolean };
      }
    | undefined;
  overrides: string[];
  editField: (path: string, value: unknown) => void;
  revertField: (path: string) => void;
  isCatalog: boolean;
}): JSX.Element {
  return (
    <section class="rounded-(--radius-control) border border-border-muted bg-surface-elevated p-3">
      <h3 class="text-xs uppercase tracking-wider text-fg-subtle mb-2">Economics</h3>
      <NumberRow
        label="Cost (Ob)"
        path="ItemEconomics.cost"
        value={props.econ()?.cost}
        overrides={props.overrides}
        edit={props.editField}
        revert={props.revertField}
        isCatalog={props.isCatalog}
      />
      <NumberRow
        label="Treasure (D)"
        path="ItemEconomics.value.dice"
        value={props.econ()?.value?.dice}
        overrides={props.overrides}
        edit={props.editField}
        revert={props.revertField}
        isCatalog={props.isCatalog}
      />
    </section>
  );
}

function FieldRow(props: {
  label: string;
  path: string;
  value: string;
  overrides: string[];
  edit: (path: string, value: unknown) => void;
  revert: (path: string) => void;
  lock: (path: string) => void;
  isCatalog: boolean;
  multiline?: boolean;
  placeholder?: string;
}): JSX.Element {
  const isOverridden = createMemo(() => props.overrides.includes(props.path));
  const [draft, setDraft] = createSignal(props.value);
  // Reset draft when external value changes (e.g. on revert).
  let lastSeen = props.value;
  const sync = (): void => {
    if (props.value !== lastSeen) {
      setDraft(props.value);
      lastSeen = props.value;
    }
  };
  sync();
  const commit = (): void => {
    if (draft() !== lastSeen) {
      props.edit(props.path, draft());
      lastSeen = draft();
    }
  };
  return (
    <div class="grid grid-cols-[7rem,1fr,auto] gap-2 items-center mb-2 last:mb-0">
      <label class="text-xs text-fg-subtle">{props.label}</label>
      <Show
        when={!props.multiline}
        fallback={
          <textarea
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onBlur={commit}
            placeholder={props.placeholder}
            class="rounded border border-border bg-surface px-2 py-1 text-sm font-mono"
            rows={3}
            spellcheck={false}
          />
        }
      >
        <input
          type="text"
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          placeholder={props.placeholder}
          class="rounded border border-border bg-surface px-2 py-1 text-sm"
          autocomplete="off"
          spellcheck={false}
          data-testid={`field-${props.path}`}
        />
      </Show>
      <FieldActions
        path={props.path}
        isOverridden={isOverridden()}
        revert={props.revert}
        lock={props.lock}
        isCatalog={props.isCatalog}
      />
    </div>
  );
}

function NumberRow(props: {
  label: string;
  path: string;
  value: number | undefined;
  overrides: string[];
  edit: (path: string, value: unknown) => void;
  revert: (path: string) => void;
  isCatalog: boolean;
}): JSX.Element {
  const isOverridden = createMemo(() => props.overrides.includes(props.path));
  const [draft, setDraft] = createSignal(props.value === undefined ? "" : String(props.value));
  let lastSeen = props.value;
  if (props.value !== lastSeen) {
    setDraft(props.value === undefined ? "" : String(props.value));
    lastSeen = props.value;
  }
  const commit = (): void => {
    const v = draft().trim();
    if (v === "") {
      props.edit(props.path, undefined);
      return;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    props.edit(props.path, n);
  };
  return (
    <div class="grid grid-cols-[7rem,1fr,auto] gap-2 items-center mb-2 last:mb-0">
      <label class="text-xs text-fg-subtle">{props.label}</label>
      <input
        type="number"
        value={draft()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        class="rounded border border-border bg-surface px-2 py-1 text-sm w-24"
        data-testid={`field-${props.path}`}
      />
      <FieldActions
        path={props.path}
        isOverridden={isOverridden()}
        revert={props.revert}
        lock={() => {}}
        isCatalog={props.isCatalog}
      />
    </div>
  );
}

function FieldActions(props: {
  path: string;
  isOverridden: boolean;
  revert: (path: string) => void;
  lock: (path: string) => void;
  isCatalog: boolean;
}): JSX.Element {
  return (
    <Show when={props.isCatalog}>
      <span class="flex gap-1">
        <Show when={props.isOverridden}>
          <button
            type="button"
            onClick={() => props.revert(props.path)}
            class="text-[0.62rem] uppercase tracking-wider rounded border border-border-muted px-1.5 py-0.5 text-fg-subtle hover:text-fg"
            title="Revert to template default"
            data-testid={`revert-${props.path}`}
          >
            revert
          </button>
        </Show>
        <Show when={!props.isOverridden}>
          <button
            type="button"
            onClick={() => props.lock(props.path)}
            class="text-[0.62rem] uppercase tracking-wider rounded border border-border-muted px-1.5 py-0.5 text-fg-subtle hover:text-fg"
            title="Lock to current value (catalog updates won't overwrite)"
            data-testid={`lock-${props.path}`}
          >
            lock
          </button>
        </Show>
      </span>
    </Show>
  );
}

// Suppress unused warning for Surface helper that future expansions
// (per-item canvas previews) may consume.
void Surface;
