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

import { createMemo, createSignal, For, Show, type JSX, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { useClient } from "@vtt/substrate/client";
import {
  OpenPage,
  RetargetTab,
} from "../shared/commands.js";
import {
  usePageProviders,
  useProviderTraitsVersion,
} from "./use-providers.js";
import type { PageProvider, PageEntity } from "../shared/slots.js";
import type { WorkspaceTab } from "../shared/traits.js";
import { useMe } from "./use-me.js";
import type { ProviderRunContext } from "./provider-context.js";

/**
 * Inline two-step picker — the workbench's defining piece of chrome.
 * First disclosure picks a content TYPE (kind); second picks an entity
 * of that type. Used both as the tab header (re-targets in place via
 * RetargetTab) and as the "+ new tab" affordance (dispatches OpenPage).
 *
 * Visual model:
 *   ▼ Characters  ▸  Brunhilda the Bold        (active state)
 *   ▼ Pick a type ▸                            (empty state)
 *
 * The chevron + middle separator are typographically anchored — they're
 * the picker's visual signature. Hovering anywhere on the row surfaces
 * the kind dropdown; clicking the entity slot opens its dropdown.
 *
 * Both dropdowns render inside a `<Portal>` anchored to the trigger
 * button's bounding rect — the picker is often used inside the tab
 * strip header, which has `overflow-hidden` to suppress browser tab
 * scrollbars; without the portal, the dropdowns would be clipped.
 */
export function TabPicker(props: {
  tab?: WorkspaceTab;
  /** Render context for providers' list/defaultEntity. */
  ctx: ProviderRunContext;
  /** Called instead of the default OpenPage / RetargetTab dispatch. */
  onPick?: (kind: string, entityId: string | null) => void;
  /** Compact mode: smaller padding for tab strips. */
  compact?: boolean;
}): JSX.Element {
  const client = useClient();
  const providers = usePageProviders();
  const me = useMe();
  // PageProvider.list reads world.query directly without subscribing.
  // useProviderTraitsVersion bumps when any trait declared in any
  // registered provider's `reads` actually changes — fine-grained
  // enough that unrelated mutations (chat messages, presence) don't
  // re-run our memos.
  const worldVersion = useProviderTraitsVersion();

  const orderedKinds = createMemo<PageProvider[]>(() => {
    const list = [...providers().values()];
    list.sort((a, b) => a.label.localeCompare(b.label));
    return list;
  });
  const currentProvider = createMemo<PageProvider | null>(() => {
    if (!props.tab) return null;
    return providers().get(props.tab.pageKind) ?? null;
  });
  // Reactive label for the active entity. Tracks worldVersion so the
  // tab title updates when the underlying entity's trait changes (e.g.
  // GM renames the scene → every tab pointing at it relabels live).
  const currentEntityLabel = createMemo<string>(() => {
    worldVersion();
    const p = currentProvider();
    if (!p) return "—";
    const tab = props.tab;
    if (!tab || tab.entityId === null) return "pick…";
    const found = p.list(props.ctx).find((e: PageEntity) => e.id === tab.entityId);
    return found?.label ?? "missing";
  });

  const [kindOpen, setKindOpen] = createSignal(false);
  const [entityOpen, setEntityOpen] = createSignal(false);
  // Anchor positions for the portaled dropdowns. Top is set from the
  // trigger button's bottom; left is set from its left. Recomputed on
  // each open + on viewport resize.
  const [kindPos, setKindPos] = createSignal<{ top: number; left: number } | null>(null);
  const [entityPos, setEntityPos] = createSignal<{ top: number; left: number } | null>(null);

  let root: HTMLDivElement | undefined;
  let kindBtn: HTMLButtonElement | undefined;
  let entityBtn: HTMLButtonElement | undefined;
  let kindMenu: HTMLUListElement | undefined;
  let entityMenu: HTMLUListElement | undefined;

  const closeBoth = () => {
    setKindOpen(false);
    setEntityOpen(false);
  };

  // Close on outside-click. The portaled menus live at document.body so
  // we have to check both the trigger root AND each menu's ref before
  // declaring a click "outside."
  const onDoc = (e: MouseEvent) => {
    if (root?.contains(e.target as Node)) return;
    if (kindMenu?.contains(e.target as Node)) return;
    if (entityMenu?.contains(e.target as Node)) return;
    closeBoth();
  };
  document.addEventListener("mousedown", onDoc);
  onCleanup(() => document.removeEventListener("mousedown", onDoc));

  const onResize = () => {
    if (kindOpen() && kindBtn) computeKindPos();
    if (entityOpen() && entityBtn) computeEntityPos();
  };
  window.addEventListener("resize", onResize);
  onCleanup(() => window.removeEventListener("resize", onResize));

  const computeKindPos = () => {
    if (!kindBtn) return;
    const r = kindBtn.getBoundingClientRect();
    setKindPos({ top: r.bottom + 4, left: r.left });
  };
  const computeEntityPos = () => {
    if (!entityBtn) return;
    const r = entityBtn.getBoundingClientRect();
    setEntityPos({ top: r.bottom + 4, left: r.left });
  };

  const choose = (kind: string, entityId: string | null) => {
    closeBoth();
    if (props.onPick) {
      props.onPick(kind, entityId);
      return;
    }
    if (props.tab) {
      client.dispatch(
        RetargetTab({
          tabId: props.tab.id,
          pageKind: kind,
          entityId,
        }) as never,
      );
    } else {
      client.dispatch(OpenPage({ pageKind: kind, entityId }) as never);
    }
  };

  const pad = () => (props.compact ? "px-2 py-1" : "px-3 py-1.5");

  return (
    <div ref={root} class="relative inline-flex items-center gap-1.5 text-xs">
      {/* kind disclosure */}
      <button
        ref={kindBtn}
        type="button"
        class={`group inline-flex items-center gap-1 rounded-(--radius-control) ${pad()} font-display font-medium uppercase tracking-[0.14em] text-[0.68rem] text-fg-muted hover:text-fg hover:bg-surface-elevated transition`}
        onClick={() => {
          setEntityOpen(false);
          if (!kindOpen()) computeKindPos();
          setKindOpen((v) => !v);
        }}
      >
        <span aria-hidden class="text-fg-subtle group-hover:text-accent transition text-[0.55rem]">
          ▼
        </span>
        <span>{currentProvider()?.label ?? "Pick a type"}</span>
      </button>

      <span aria-hidden class="text-fg-subtle text-[0.7rem] select-none">▸</span>

      {/* entity disclosure */}
      <button
        ref={entityBtn}
        type="button"
        disabled={!currentProvider()}
        class={`inline-flex items-center gap-1 rounded-(--radius-control) ${pad()} text-fg hover:bg-surface-elevated disabled:text-fg-subtle disabled:cursor-not-allowed transition`}
        onClick={() => {
          if (!currentProvider()) return;
          setKindOpen(false);
          if (!entityOpen()) computeEntityPos();
          setEntityOpen((v) => !v);
        }}
      >
        <span class="max-w-[16rem] truncate">{currentEntityLabel()}</span>
      </button>

      <Show when={kindOpen() && kindPos()}>
        <Portal>
          <ul
            ref={kindMenu}
            role="listbox"
            class="fixed z-50 max-h-72 min-w-[14rem] overflow-y-auto rounded-(--radius-card) border border-border bg-surface-elevated shadow-2xl ring-1 ring-black/10"
            style={{
              top: `${kindPos()!.top}px`,
              left: `${kindPos()!.left}px`,
            }}
          >
            <For each={orderedKinds()}>
              {(p) => (
                <li
                  role="option"
                  tabindex={0}
                  class="cursor-pointer px-3 py-2 text-xs hover:bg-surface flex items-baseline justify-between gap-3"
                  onClick={() => {
                    // Picking a kind without an entity opens an empty tab
                    // of that kind — the entity dropdown opens next so the
                    // user can pick (or browse).
                    choose(p.kind, null);
                    // Defer the entity-dropdown open until after the
                    // entity button has rendered/repositioned with the
                    // newly-chosen kind, so its rect is fresh.
                    queueMicrotask(() => {
                      computeEntityPos();
                      setEntityOpen(true);
                    });
                  }}
                >
                  <span class="font-display font-medium text-fg uppercase tracking-[0.12em] text-[0.7rem]">
                    {p.label}
                  </span>
                  <code class="font-mono text-[0.62rem] text-fg-subtle truncate">
                    {p.kind.split("/").slice(0, 2).join("/")}
                  </code>
                </li>
              )}
            </For>
            <Show when={orderedKinds().length === 0}>
              <li class="px-3 py-2 text-xs text-fg-subtle">no page kinds registered yet</li>
            </Show>
          </ul>
        </Portal>
      </Show>

      <Show when={entityOpen() && entityPos()}>
        <Show when={currentProvider()}>
          {(provider) => {
            const entries = createMemo<readonly PageEntity[]>(() => {
              worldVersion();
              return provider().list(props.ctx);
            });
            return (
              <Portal>
                <ul
                  ref={entityMenu}
                  role="listbox"
                  class="fixed z-50 max-h-72 min-w-[18rem] overflow-y-auto rounded-(--radius-card) border border-border bg-surface-elevated shadow-2xl ring-1 ring-black/10"
                  style={{
                    top: `${entityPos()!.top}px`,
                    left: `${entityPos()!.left}px`,
                  }}
                >
                  <For each={entries()}>
                    {(e) => (
                      <li
                        role="option"
                        tabindex={0}
                        class="cursor-pointer px-3 py-2 text-xs hover:bg-surface"
                        onClick={() => choose(provider().kind, e.id)}
                      >
                        <div class="flex items-baseline justify-between gap-3">
                          <span class="text-fg truncate">{e.label}</span>
                          <Show when={e.hint}>
                            <span class="text-[0.6rem] text-fg-subtle truncate">{e.hint}</span>
                          </Show>
                        </div>
                      </li>
                    )}
                  </For>
                  <Show when={entries().length === 0}>
                    <li class="px-3 py-2 text-xs text-fg-subtle">
                      <Show when={me()?.role === "gm"} fallback="no entries visible to you yet">
                        nothing to pick — use the GM controls to create one
                      </Show>
                    </li>
                  </Show>
                </ul>
              </Portal>
            );
          }}
        </Show>
      </Show>
    </div>
  );
}
