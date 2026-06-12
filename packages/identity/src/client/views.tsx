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

import { defineView, clientOnly, surfaceName } from "@vtt/substrate";
import { useClient, useQuery } from "@vtt/substrate/client";

// Identity targets the workbench's surfaces by qualified name only — no
// value import from `@vtt/shell-workbench` so we don't form a workspace
// cycle (the workbench's bootstrap-on-join system depends on identity's
// PlayerJoined event def). The substrate accepts a SurfaceName string
// directly in `defineView({ surface })`.
const WorkbenchHeaderSurfaceName = surfaceName("@vtt/shell-workbench/header");
const WorkbenchChatRailSurfaceName = surfaceName(
  "@vtt/shell-workbench/chat-rail",
);
import { createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js";
import { Identity, Name, Online } from "../shared/traits.js";

/* -------------------------------------------------------------------------
 * Theme switcher — three-state cycle: system → light → dark → system
 * ----------------------------------------------------------------------- */

type ThemeMode = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "vtt-theme";

function readStoredTheme(): ThemeMode {
  if (typeof localStorage === "undefined") return "system";
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", mode);
  }
}

function persistTheme(mode: ThemeMode): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (mode === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // localStorage disabled (private mode, quota): theme still applies
    // for the session — just won't survive a reload.
  }
}

/**
 * Cycle button in the header that toggles light / dark / system. Glyph
 * reflects the currently-selected mode (☀ light, ☾ dark, ◐ system). The
 * boot script in index.html applies the persisted choice before any
 * JS-driven render so reload doesn't flash the wrong theme.
 */
function ThemeSwitcher(): JSX.Element {
  const [mode, setMode] = createSignal<ThemeMode>(readStoredTheme());

  // Re-apply on mount in case the document was already mounted with a
  // different state (HMR, late hydration). Idempotent — no flicker.
  onMount(() => applyTheme(mode()));

  const cycle = () => {
    const next: ThemeMode =
      mode() === "system" ? "light" : mode() === "light" ? "dark" : "system";
    setMode(next);
    applyTheme(next);
    persistTheme(next);
  };

  const glyph = createMemo(() =>
    mode() === "light" ? "☀" : mode() === "dark" ? "☾" : "◐",
  );
  const label = createMemo(() =>
    mode() === "light"
      ? "light theme"
      : mode() === "dark"
        ? "dark theme"
        : "follow system theme",
  );

  return (
    <button
      type="button"
      onClick={cycle}
      title={`${label()} — click to cycle`}
      aria-label={label()}
      data-theme-mode={mode()}
      class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-sm text-fg hover:border-accent hover:bg-surface-elevated transition"
    >
      <span aria-hidden="true">{glyph()}</span>
    </button>
  );
}

interface PlayerRow {
  userId: string;
  name: string;
  role: "gm" | "player";
  /** How many connections (browser tabs/windows) this user has open. */
  tabs: number;
}

export const PlayerListView = defineView({
  name: "PlayerList",
  surface: WorkbenchChatRailSurfaceName,
  priority: 100, // sit above the chat composer / stream
  render: clientOnly(() => {
    const connections = useQuery([Identity, Name, Online]);
    // Multi-session: each tab has its own Connection entity. Group by
    // `userId` for display so one user with three windows shows one row,
    // optionally annotated with the tab count.
    const players = createMemo<PlayerRow[]>(() => {
      const seen = new Map<string, PlayerRow>();
      for (const row of connections()) {
        const id = row.values.Identity as { userId: string; role: "gm" | "player" };
        const name = (row.values.Name as { value: string }).value;
        const cur = seen.get(id.userId);
        if (cur) cur.tabs += 1;
        else seen.set(id.userId, { userId: id.userId, name, role: id.role, tabs: 1 });
      }
      return [...seen.values()];
    });

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
              {(p) => (
                <li class="flex items-center justify-between text-xs">
                  <span class="flex items-center gap-2">
                    <span class="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                    <span class="text-fg">{p.name}</span>
                    <Show when={p.tabs > 1}>
                      <span class="text-[10px] text-fg-subtle">
                        · {p.tabs} tabs
                      </span>
                    </Show>
                  </span>
                  <span
                    class={
                      p.role === "gm"
                        ? "rounded-(--radius-control) border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent"
                        : "text-[10px] uppercase tracking-wider text-fg-subtle"
                    }
                  >
                    {p.role}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    );
  }),
});

/**
 * Compact connected-players indicator for the top bar. The full
 * `PlayerListView` lived on the chat rail; with the rail retired, this
 * gives an always-visible at-a-glance roster in the header — a chip per
 * connected user (status dot + name, GMs accented). Hidden on the
 * narrowest viewports to leave room for the world picker + user menu.
 */
export const PresenceHeaderView = defineView({
  name: "PresenceHeader",
  surface: WorkbenchHeaderSurfaceName,
  priority: 10, // left of the UserMenu (priority 0)
  render: clientOnly(() => {
    const connections = useQuery([Identity, Name, Online]);
    const players = createMemo<PlayerRow[]>(() => {
      const seen = new Map<string, PlayerRow>();
      for (const row of connections()) {
        const id = row.values.Identity as { userId: string; role: "gm" | "player" };
        const name = (row.values.Name as { value: string }).value;
        const cur = seen.get(id.userId);
        if (cur) cur.tabs += 1;
        else seen.set(id.userId, { userId: id.userId, name, role: id.role, tabs: 1 });
      }
      return [...seen.values()];
    });
    return (
      <Show when={players().length > 0}>
        <div
          class="hidden items-center gap-1.5 md:flex"
          data-testid="header-presence"
          aria-label="Connected players"
        >
          <For each={players()}>
            {(p) => (
              <span
                class="inline-flex items-center gap-1 rounded-(--radius-control) border px-1.5 py-0.5 text-[0.7rem]"
                classList={{
                  "border-accent/40 bg-accent/10 text-accent": p.role === "gm",
                  "border-border bg-surface text-fg-muted": p.role !== "gm",
                }}
                data-testid={`header-presence-${p.userId}`}
                title={`${p.name}${p.role === "gm" ? " (GM)" : ""}${
                  p.tabs > 1 ? ` · ${p.tabs} tabs` : ""
                }`}
              >
                <span
                  class="h-1.5 w-1.5 rounded-full bg-accent"
                  aria-hidden
                />
                <span class="max-w-[7rem] truncate">{p.name}</span>
              </span>
            )}
          </For>
        </div>
      </Show>
    );
  }),
});

/**
 * Header-mounted "you are signed in as …" + logout button. Replaces the
 * old client-N indicator: the connection counter is process-wide and
 * resets only on server restart, so it grew unboundedly across refreshes
 * and was uninformative anyway. We show the user's display name (from
 * the Player entity matching this connection's clientId) and a logout
 * action that POSTs to better-auth's sign-out route then reloads to the
 * auth gate.
 */
export const UserMenuView = defineView({
  name: "UserMenu",
  surface: WorkbenchHeaderSurfaceName,
  priority: 0,
  render: clientOnly(() => {
    const client = useClient();
    const players = useQuery([Identity, Name, Online]);
    const [busy, setBusy] = createSignal(false);

    const me = createMemo(() => {
      const list = players();
      const cid = client.clientId();
      if (!cid) return null;
      const found = list.find(
        (p) => (p.values.Online as { clientId: string }).clientId === cid,
      );
      if (!found) return null;
      return {
        name: (found.values.Name as { value: string }).value,
        role: (found.values.Identity as { role: "gm" | "player" }).role,
      };
    });

    const logout = async () => {
      if (busy()) return;
      setBusy(true);
      try {
        await fetch("/api/auth/sign-out", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
      } catch {
        // Network blip — fall through to reload anyway. The auth gate
        // will resolve the (still-valid or now-invalid) session.
      }
      window.location.reload();
    };

    return (
      <div class="flex items-center gap-3 text-xs text-fg-muted">
        <Show when={me()} fallback={<span>connecting…</span>}>
          {(info) => (
            <>
              <span>
                signed in as{" "}
                <span class="font-medium text-fg">{info().name}</span>
              </span>
              <span
                class={
                  info().role === "gm"
                    ? "rounded-(--radius-control) border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent"
                    : "text-[10px] uppercase tracking-wider text-fg-subtle"
                }
              >
                {info().role}
              </span>
            </>
          )}
        </Show>
        <ThemeSwitcher />
        <button
          type="button"
          onClick={logout}
          disabled={busy()}
          class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-xs text-fg hover:border-accent hover:bg-surface-elevated transition disabled:opacity-50"
        >
          {busy() ? "signing out…" : "log out"}
        </button>
      </div>
    );
  }),
});
