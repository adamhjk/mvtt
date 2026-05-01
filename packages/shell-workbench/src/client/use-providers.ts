// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor,
} from "solid-js";
import type { TraitName } from "@vtt/substrate";
import { useClient } from "@vtt/substrate/client";
import {
  PagesSlot,
  PaletteCommandsSlot,
  ChatRailWidgetsSlot,
  type PageProvider,
  type PaletteCommand,
  type ChatRailWidget,
} from "../shared/slots.js";

/**
 * A monotonically-increasing counter that bumps when any trait declared
 * in the union of registered PageProviders' `reads` mutates. Reading
 * this inside a `createMemo` is the canonical way to make a memo that
 * delegates to `provider.list(...)` re-run only when the data actually
 * changed.
 *
 * Why this and not `useQuery` directly: the consumers (TabPicker,
 * Palette, OverflowMenu) don't know which provider's `list` they're
 * about to call until reactive evaluation time, and `useQuery` requires
 * a static trait list at hook-call time. This helper subscribes to the
 * substrate's existing per-trait pub/sub via `world.subscribe`, filters
 * by the union of reads from currently-registered providers, and bumps
 * a single signal — so every consumer that reads it gets the same
 * fine-grained "a relevant trait changed" signal without each having
 * to hand-build a subscription. When new providers register, the
 * subscription rebuilds to widen the watched set.
 *
 * For ad-hoc plugin code that doesn't fit the provider pattern,
 * `useTrait` and `useQuery` remain the right tools.
 */
export function useProviderTraitsVersion(): Accessor<number> {
  const client = useClient();
  const providers = usePageProviders();
  const [v, setV] = createSignal(0);

  // Re-subscribe whenever the set of providers changes — `onCleanup`
  // inside `createEffect` runs before each re-run, tearing down the
  // previous world subscription. See `solid-effects` for this pattern.
  createEffect(() => {
    const watched = new Set<TraitName>();
    for (const p of providers().values()) {
      for (const t of p.reads) watched.add(t.name);
    }
    if (watched.size === 0) return;
    const off = client.world.subscribe((_id, name) => {
      if (watched.has(name)) setV((prev) => prev + 1);
    });
    onCleanup(off);
  });

  return v;
}

/**
 * Index of registered PageProviders, keyed by their `kind`. Multiple
 * providers per kind = highest-priority wins (mirrors view priority).
 * Memoised on the registry contents — fills don't change at runtime today,
 * so this resolves once at first read.
 */
export function usePageProviders(): Accessor<Map<string, PageProvider>> {
  const client = useClient();
  return createMemo(() => {
    const fills = client.registry.fillsForSlot(PagesSlot) as PageProvider[];
    const winners = new Map<string, PageProvider>();
    for (const p of fills) {
      const cur = winners.get(p.kind);
      if (!cur || (p.priority ?? 0) > (cur.priority ?? 0)) {
        winners.set(p.kind, p);
      }
    }
    return winners;
  });
}

/**
 * Sorted list of palette commands, highest priority first. The command
 * palette searches across these and across page entities.
 */
export function usePaletteCommands(): Accessor<PaletteCommand[]> {
  const client = useClient();
  return createMemo(() => {
    const fills = client.registry.fillsForSlot(PaletteCommandsSlot) as PaletteCommand[];
    return [...fills].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  });
}

/**
 * Sorted list of chat-rail widgets, highest priority first.
 */
export function useChatRailWidgets(): Accessor<ChatRailWidget[]> {
  const client = useClient();
  return createMemo(() => {
    const fills = client.registry.fillsForSlot(ChatRailWidgetsSlot) as ChatRailWidget[];
    return [...fills].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  });
}
