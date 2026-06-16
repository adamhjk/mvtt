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

import { createMemo, createSignal, For, Show, type Accessor, type JSX } from "solid-js";
import { useClient, useQuery } from "@vtt/substrate/client";
import type { CommandInstance } from "@vtt/substrate";
import {
  NotificationsSlot,
  type NotificationEntry,
  type NotificationFeed,
} from "../shared/slots.js";
import { DismissNotification, NotificationDismissals } from "../shared/notifications-dismiss.js";

/**
 * Floating notifications overlay — top-right, above the workspace. Hosts
 * the actionable table-event cards (light burnout, grind toll, skill
 * advancement) that used to scroll past in chat. Each card is
 * entity-backed and removes itself when acted on, so the stack is a live
 * projection that empties as the table handles each event.
 *
 * Dismissing a card (×) is **per-player and permanent**: it records the
 * id in the user's `NotificationDismissals` (server-side), so the card
 * stays gone for them across refreshes while other players still see
 * their own copy. We also hide it locally on click for instant feedback.
 *
 * The container is `pointer-events-none` so empty gaps don't block the
 * canvas underneath; individual cards re-enable pointer events for their
 * buttons.
 */
export function NotificationsOverlay(): JSX.Element {
  const client = useClient();

  // Snapshot the feeds once — slot fills are immutable after registry
  // validation, so the number of `useEntries` hook calls stays stable
  // across renders (Solid's hook-count constraint).
  const feeds = client.registry.fillsForSlot(NotificationsSlot) as NotificationFeed[];
  const accessors: Accessor<NotificationEntry[]>[] = feeds.map(
    (f) => f.useEntries() as Accessor<NotificationEntry[]>,
  );

  // Persisted per-user dismissals. Only this user's dismissals entity is
  // visible to them (it's owner-scoped), so the query returns just theirs.
  const dismissalRows = useQuery([NotificationDismissals]);
  // Session-local hide for instant feedback while the dispatch round-trips.
  const [justHidden, setJustHidden] = createSignal<ReadonlySet<string>>(new Set());
  const dismiss = (entryId: string): void => {
    client.dispatch(DismissNotification({ entityId: entryId }) as CommandInstance);
    setJustHidden((prev) => {
      const next = new Set(prev);
      next.add(entryId);
      return next;
    });
  };

  const hiddenIds = createMemo<ReadonlySet<string>>(() => {
    const s = new Set(justHidden());
    for (const r of dismissalRows()) {
      const v = r.values.NotificationDismissals as { ids: string[] };
      for (const id of v.ids) s.add(id);
    }
    return s;
  });

  const entries = createMemo<NotificationEntry[]>(() => {
    const hidden = hiddenIds();
    const out: NotificationEntry[] = [];
    for (const acc of accessors) {
      for (const e of acc()) if (!hidden.has(e.id)) out.push(e);
    }
    // Newest first.
    out.sort((a, b) => b.sortKey - a.sortKey);
    return out;
  });

  return (
    <Show when={entries().length > 0}>
      <div
        class="pointer-events-none fixed right-3 top-16 z-40 flex max-h-[70vh] w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="notifications-overlay"
      >
        <For each={entries()}>
          {(e) => (
            <div class="pointer-events-auto relative">
              {e.render() as unknown as JSX.Element}
              <button
                type="button"
                onClick={() => dismiss(e.id)}
                class="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-[0.7rem] leading-none text-fg-subtle transition hover:border-danger hover:text-danger"
                aria-label="Dismiss notification"
                title="Dismiss"
                data-testid={`notification-dismiss-${e.id}`}
              >
                ×
              </button>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
