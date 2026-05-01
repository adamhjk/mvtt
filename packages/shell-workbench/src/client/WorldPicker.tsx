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

import {
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
  type JSX,
} from "solid-js";
import { useClient } from "@vtt/substrate/client";

interface WorldSummary {
  id: string;
  name: string;
  gameSystemPlugin: string;
  ownerUserId: string;
  createdAt: number;
  isOwner: boolean;
}

interface GameSystemSummary {
  name: string;
  version: string;
}

async function fetchWorlds(): Promise<WorldSummary[]> {
  const res = await fetch("/api/worlds", { credentials: "same-origin" });
  if (!res.ok) return [];
  const body = (await res.json()) as { worlds: WorldSummary[] };
  return body.worlds;
}

async function fetchGameSystems(): Promise<GameSystemSummary[]> {
  const res = await fetch("/api/game-systems", { credentials: "same-origin" });
  if (!res.ok) return [];
  const body = (await res.json()) as { gameSystems: GameSystemSummary[] };
  return body.gameSystems;
}

function switchToWorld(worldId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("worldId", worldId);
  window.location.assign(url.toString());
}

/**
 * Header-mounted world picker. Shows the current world's name as a
 * button; click opens a dropdown listing every world the user can
 * access. The global GM also sees a "Create new world…" entry; the
 * world's owner sees Archive / Delete actions for it.
 *
 * Switching is implemented as a full reload (`window.location.assign`)
 * with the new `?worldId=`. That keeps the WS reconnect path identical
 * to the initial load — no mid-session teardown of the substrate's
 * client + Solid root.
 */
export function WorldPicker(): JSX.Element {
  const client = useClient();
  const [worlds, { refetch: refetchWorlds }] = createResource(fetchWorlds);
  const [systems] = createResource(fetchGameSystems);
  const [open, setOpen] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [managing, setManaging] = createSignal(false);

  const currentWorld = createMemo<WorldSummary | null>(() => {
    const id = client.worldId();
    if (!id) return null;
    return (worlds() ?? []).find((w) => w.id === id) ?? null;
  });

  // Global GM check — only the global GM may create worlds. Pulled
  // from `/api/has-gm` would tell us *whether* a GM exists, not who; a
  // dedicated endpoint exists in the better-auth-managed user record.
  // For v1 the proxy is "isOwner of any world I can see" PLUS being
  // able to fetch the create button; the API will reject a non-GM POST.
  // Always show the button — server's 403 will surface as an error.
  const canCreate = () => true;

  const close = () => setOpen(false);

  return (
    <div class="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class="inline-flex items-center gap-2 rounded-(--radius-control) border border-border bg-surface-elevated px-3 py-1 text-sm text-fg hover:border-accent transition"
        aria-haspopup="listbox"
        aria-expanded={open()}
      >
        <span class="font-display text-sm font-semibold tracking-tight">
          <Show when={currentWorld()} fallback={<span class="text-fg-muted">no world</span>}>
            {(w) => w().name}
          </Show>
        </span>
        <span class="text-fg-subtle text-xs" aria-hidden>
          ▾
        </span>
      </button>

      <Show when={open()}>
        <div
          class="absolute left-0 z-30 mt-1 w-72 rounded-(--radius-card) border border-border bg-surface-elevated p-1 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <Show
            when={(worlds() ?? []).length > 0}
            fallback={
              <p class="px-3 py-2 text-xs text-fg-muted">
                No worlds available.
              </p>
            }
          >
            <ul class="flex flex-col">
              <For each={worlds()}>
                {(w) => {
                  const isCurrent = w.id === client.worldId();
                  return (
                    <li>
                      <button
                        type="button"
                        disabled={isCurrent}
                        onClick={() => {
                          close();
                          switchToWorld(w.id);
                        }}
                        class={
                          "flex w-full flex-col items-start gap-0 rounded-(--radius-control) px-3 py-2 text-left text-xs transition " +
                          (isCurrent
                            ? "bg-accent/10 text-fg cursor-default"
                            : "text-fg-muted hover:bg-surface hover:text-fg")
                        }
                      >
                        <span class="text-sm font-medium text-fg">{w.name}</span>
                        <span class="text-[10px] text-fg-subtle">
                          {w.gameSystemPlugin}
                          <Show when={w.isOwner}>
                            <span class="ml-2 rounded-(--radius-control) border border-accent/40 bg-accent/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">
                              owned
                            </span>
                          </Show>
                        </span>
                      </button>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>

          <Show when={canCreate()}>
            <div class="mt-1 border-t border-border-muted pt-1">
              <button
                type="button"
                onClick={() => {
                  close();
                  setCreating(true);
                }}
                class="flex w-full items-center gap-2 rounded-(--radius-control) px-3 py-2 text-left text-xs text-fg-muted hover:bg-surface hover:text-fg transition"
              >
                + Create new world…
              </button>
            </div>
          </Show>

          <Show when={currentWorld()?.isOwner}>
            <div class="mt-1 border-t border-border-muted pt-1">
              <button
                type="button"
                onClick={() => {
                  close();
                  setManaging(true);
                }}
                class="flex w-full items-center gap-2 rounded-(--radius-control) px-3 py-2 text-left text-xs text-fg-muted hover:bg-surface hover:text-fg transition"
              >
                Members…
              </button>
              <ArchiveAction
                world={currentWorld()!}
                onDone={() => {
                  close();
                  refetchWorlds();
                  // Navigate away from the now-archived world.
                  const url = new URL(window.location.href);
                  url.searchParams.delete("worldId");
                  window.location.assign(url.toString());
                }}
              />
              <DeleteAction
                world={currentWorld()!}
                onDone={() => {
                  close();
                  const url = new URL(window.location.href);
                  url.searchParams.delete("worldId");
                  window.location.assign(url.toString());
                }}
              />
            </div>
          </Show>
        </div>
      </Show>

      <Show when={creating()}>
        <CreateWorldModal
          systems={systems() ?? []}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            switchToWorld(id);
          }}
        />
      </Show>

      <Show when={managing() && currentWorld()}>
        <MembersModal
          world={currentWorld()!}
          onClose={() => setManaging(false)}
        />
      </Show>
    </div>
  );
}

function ArchiveAction(props: {
  world: WorldSummary;
  onDone: () => void;
}): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const archive = async () => {
    if (busy()) return;
    if (!confirm(`Archive "${props.world.name}"? You can restore it later.`)) return;
    setBusy(true);
    const res = await fetch(`/api/worlds/${encodeURIComponent(props.world.id)}/archive`, {
      method: "POST",
      credentials: "same-origin",
    });
    setBusy(false);
    if (res.ok) props.onDone();
    else alert(`archive failed (${res.status})`);
  };
  return (
    <button
      type="button"
      onClick={archive}
      disabled={busy()}
      class="flex w-full items-center gap-2 rounded-(--radius-control) px-3 py-2 text-left text-xs text-fg-muted hover:bg-surface hover:text-fg transition"
    >
      Archive this world
    </button>
  );
}

function DeleteAction(props: {
  world: WorldSummary;
  onDone: () => void;
}): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const del = async () => {
    if (busy()) return;
    const ok = confirm(
      `Permanently DELETE "${props.world.name}"?\n\nThis wipes events, snapshots, and uploaded assets. Cannot be undone.`,
    );
    if (!ok) return;
    setBusy(true);
    const res = await fetch(
      `/api/worlds/${encodeURIComponent(props.world.id)}?confirm=true`,
      { method: "DELETE", credentials: "same-origin" },
    );
    setBusy(false);
    if (res.ok) props.onDone();
    else alert(`delete failed (${res.status})`);
  };
  return (
    <button
      type="button"
      onClick={del}
      disabled={busy()}
      class="flex w-full items-center gap-2 rounded-(--radius-control) px-3 py-2 text-left text-xs text-danger hover:bg-danger/10 transition"
    >
      Delete this world…
    </button>
  );
}

interface MemberRow {
  userId: string;
  name: string;
  email: string;
  role: "gm" | "player";
  addedAt: number;
}
interface MembersResponse {
  owner: { userId: string; name: string; email: string };
  members: MemberRow[];
}

function MembersModal(props: {
  world: WorldSummary;
  onClose: () => void;
}): JSX.Element {
  const fetchMembers = async (): Promise<MembersResponse> => {
    const res = await fetch(
      `/api/worlds/${encodeURIComponent(props.world.id)}/memberships`,
      { credentials: "same-origin" },
    );
    if (!res.ok) throw new Error(`fetch failed (${res.status})`);
    return (await res.json()) as MembersResponse;
  };
  const [data, { refetch }] = createResource(fetchMembers);
  const [email, setEmail] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const invite = async (e: SubmitEvent) => {
    e.preventDefault();
    setError(null);
    if (!email().trim()) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/worlds/${encodeURIComponent(props.world.id)}/memberships`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: email().trim() }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `add failed (${res.status})`);
      }
      setEmail("");
      await refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId: string) => {
    if (!confirm("Remove this member?")) return;
    const res = await fetch(
      `/api/worlds/${encodeURIComponent(props.world.id)}/memberships/${encodeURIComponent(userId)}`,
      { method: "DELETE", credentials: "same-origin" },
    );
    if (res.ok) refetch();
    else alert(`remove failed (${res.status})`);
  };

  return (
    <div
      class="fixed inset-0 z-40 grid place-items-center bg-black/40 px-4"
      onClick={props.onClose}
    >
      <div
        class="w-full max-w-md rounded-(--radius-card) border border-border bg-surface-elevated p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header class="mb-3 flex items-baseline justify-between">
          <h2 class="text-base font-semibold tracking-tight text-fg">
            Members of {props.world.name}
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            class="text-xs text-fg-subtle hover:text-fg"
          >
            ✕
          </button>
        </header>

        <Show
          when={data.state === "ready" && data()}
          fallback={<p class="text-xs text-fg-muted">loading…</p>}
        >
          {(d) => (
            <>
              <ul class="mb-4 flex flex-col gap-1">
                <li class="flex items-center justify-between rounded-(--radius-control) bg-surface px-3 py-2 text-xs">
                  <div class="flex flex-col">
                    <span class="text-sm text-fg">{d().owner.name}</span>
                    <span class="text-[10px] text-fg-subtle">{d().owner.email}</span>
                  </div>
                  <span class="rounded-(--radius-control) border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                    owner
                  </span>
                </li>
                <For each={d().members}>
                  {(m) => (
                    <li class="flex items-center justify-between rounded-(--radius-control) bg-surface px-3 py-2 text-xs">
                      <div class="flex flex-col">
                        <span class="text-sm text-fg">{m.name}</span>
                        <span class="text-[10px] text-fg-subtle">{m.email}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="text-[10px] uppercase tracking-wider text-fg-subtle">
                          {m.role}
                        </span>
                        <button
                          type="button"
                          onClick={() => remove(m.userId)}
                          class="rounded-(--radius-control) border border-border px-1.5 py-0.5 text-[10px] text-fg-muted hover:border-danger hover:text-danger transition"
                        >
                          remove
                        </button>
                      </div>
                    </li>
                  )}
                </For>
                <Show when={d().members.length === 0}>
                  <li class="px-3 py-2 text-xs text-fg-subtle">
                    No additional members yet.
                  </li>
                </Show>
              </ul>

              <form onSubmit={invite} class="flex gap-2">
                <input
                  type="email"
                  value={email()}
                  onInput={(e) => setEmail(e.currentTarget.value)}
                  placeholder="email@example.com"
                  required
                  class="flex-1 rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
                <button
                  type="submit"
                  disabled={busy()}
                  class="rounded-(--radius-control) bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover transition disabled:opacity-50"
                >
                  {busy() ? "Adding…" : "Add"}
                </button>
              </form>
              <p class="mt-2 text-[10px] text-fg-subtle">
                The user must already have an account on this server.
              </p>
              <Show when={error()}>
                <p class="mt-2 rounded-(--radius-control) border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">
                  {error()}
                </p>
              </Show>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}

function CreateWorldModal(props: {
  systems: GameSystemSummary[];
  onClose: () => void;
  onCreated: (worldId: string) => void;
}): JSX.Element {
  const [name, setName] = createSignal("New table");
  const [gameSystem, setGameSystem] = createSignal(
    props.systems[0]?.name ?? "",
  );
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/worlds", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name().trim(), gameSystem: gameSystem() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `create failed (${res.status})`);
      }
      const body = (await res.json()) as { world: { id: string } };
      props.onCreated(body.world.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      class="fixed inset-0 z-40 grid place-items-center bg-black/40 px-4"
      onClick={props.onClose}
    >
      <div
        class="w-full max-w-md rounded-(--radius-card) border border-border bg-surface-elevated p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header class="mb-3">
          <h2 class="text-base font-semibold tracking-tight text-fg">
            Create a new world
          </h2>
          <p class="mt-1 text-xs text-fg-muted">
            The game system is immutable once the world is created.
          </p>
        </header>
        <form onSubmit={submit} class="flex flex-col gap-3">
          <label class="flex flex-col gap-1 text-xs text-fg-muted">
            <span>Name</span>
            <input
              type="text"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              required
              class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </label>
          <label class="flex flex-col gap-1 text-xs text-fg-muted">
            <span>Game system</span>
            <select
              value={gameSystem()}
              onChange={(e) => setGameSystem(e.currentTarget.value)}
              class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            >
              <Show
                when={props.systems.length > 0}
                fallback={<option value="">(no game systems available)</option>}
              >
                <For each={props.systems}>
                  {(s) => <option value={s.name}>{s.name}</option>}
                </For>
              </Show>
            </select>
          </label>
          <Show when={error()}>
            <p class="rounded-(--radius-control) border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">
              {error()}
            </p>
          </Show>
          <div class="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={props.onClose}
              class="rounded-(--radius-control) border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-surface transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy() || props.systems.length === 0}
              class="rounded-(--radius-control) bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover transition disabled:opacity-50"
            >
              {busy() ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
