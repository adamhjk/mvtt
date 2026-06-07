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

import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { useClient } from "@vtt/substrate/client";

/**
 * Connection state surface — the substrate client auto-reconnects (see
 * substrate/src/connection.ts), but a player whose socket dropped must
 * SEE that their changes aren't reaching the table until it's back.
 * Before this banner existed, a Safari tab whose socket was silently
 * killed looked completely healthy while persisting nothing and
 * receiving nobody — the worst possible failure mode for a live game.
 *
 * Two visible states, gated on having completed at least one sync so
 * the initial page-load handshake never flashes a banner:
 *
 * - reconnecting: no live socket; dispatches fail fast right now.
 * - resyncing:    socket re-established, snapshot replay in flight.
 */
export function ConnectionBanner() {
  const client = useClient();
  // Latches true on the first completed sync and never resets — the
  // banner is for interruptions of an established session only.
  const [everSynced, setEverSynced] = createSignal(false);
  createEffect(() => {
    if (client.synced()) setEverSynced(true);
  });

  const state = createMemo<"hidden" | "reconnecting" | "resyncing">(() => {
    if (!everSynced()) return "hidden";
    if (!client.connected()) return "reconnecting";
    if (!client.synced()) return "resyncing";
    return "hidden";
  });

  return (
    <Show when={state() !== "hidden"}>
      <div
        role="status"
        aria-live="assertive"
        class="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-warning px-4 py-1.5 text-center text-xs font-medium text-surface"
      >
        <span
          class="inline-block size-2 animate-pulse rounded-full bg-surface"
          aria-hidden="true"
        />
        {state() === "reconnecting"
          ? "Connection lost — reconnecting… changes won't be saved until you're back."
          : "Reconnected — catching up…"}
      </div>
    </Show>
  );
}
