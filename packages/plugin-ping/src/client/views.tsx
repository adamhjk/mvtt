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

import { defineView, clientOnly } from "@vtt/substrate";
import { useClient, useQuery } from "@vtt/substrate/client";
import { MainSurface, SidebarSurface } from "@vtt/shell-default/shared";
import { createSignal, For, Show } from "solid-js";
import { Ping } from "../shared/commands.js";
import { Pong } from "../shared/traits.js";

type PongValue = { message: string; pingedAt: number; pongedAt: number };

export const PingButtonView = defineView({
  name: "PingButton",
  surface: MainSurface,
  render: clientOnly(() => {
    const client = useClient();
    const [count, setCount] = createSignal(0);
    return (
      <div class="flex flex-col gap-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-fg-muted">
          ping
        </h2>
        <button
          type="button"
          class="self-start rounded-(--radius-control) bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover transition"
          onClick={() => {
            const n = count() + 1;
            setCount(n);
            client.dispatch(Ping({ message: `ping #${n}`, issuedAt: Date.now() }));
          }}
        >
          Send Ping
          <span class="ml-2 text-xs opacity-70">({count()})</span>
        </button>
      </div>
    );
  }),
});

export const PongLogView = defineView({
  name: "PongLog",
  surface: SidebarSurface,
  render: clientOnly(() => {
    const rows = useQuery([Pong]);
    return (
      <div class="flex flex-col gap-2">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-fg-muted">
          pong log
        </h2>
        <Show
          when={rows().length > 0}
          fallback={<p class="text-xs text-fg-subtle">no pongs yet — send a ping</p>}
        >
          <ul class="flex flex-col gap-1 font-mono text-xs">
            <For each={rows()}>
              {(row) => {
                const v = row.values.Pong as PongValue;
                return (
                  <li class="flex justify-between gap-3 border-b border-border-muted pb-1 last:border-b-0">
                    <code class="text-accent">{v.message}</code>
                    <span class="text-fg-subtle">{v.pongedAt - v.pingedAt}ms</span>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </div>
    );
  }),
});
