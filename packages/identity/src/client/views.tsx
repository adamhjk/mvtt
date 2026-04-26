import { defineView, clientOnly } from "@vtt/substrate";
import { useQuery } from "@vtt/substrate/client";
import { SidebarSurface } from "@vtt/shell-default/shared";
import { For, Show } from "solid-js";
import { Identity, Name, Online } from "../shared/traits.js";

export const PlayerListView = defineView({
  name: "PlayerList",
  surface: SidebarSurface,
  priority: 100, // sit above the roll tray
  render: clientOnly(() => {
    const players = useQuery([Identity, Name, Online]);
    return (
      <div class="flex flex-col gap-2 border-b border-border-muted pb-4">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-fg-muted">
          players
        </h2>
        <Show
          when={players().length > 0}
          fallback={<p class="text-xs text-fg-subtle">no one connected</p>}
        >
          <ul class="flex flex-col gap-1">
            <For each={players()}>
              {(row) => {
                const id = row.values.Identity as { role: "gm" | "player" };
                const name = row.values.Name as { value: string };
                return (
                  <li class="flex items-center justify-between text-xs">
                    <span class="flex items-center gap-2">
                      <span class="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                      <span class="text-fg">{name.value}</span>
                    </span>
                    <span
                      class={
                        id.role === "gm"
                          ? "rounded-(--radius-control) border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent"
                          : "text-[10px] uppercase tracking-wider text-fg-subtle"
                      }
                    >
                      {id.role}
                    </span>
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
