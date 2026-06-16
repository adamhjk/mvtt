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

import { type CommandInstance, type Visibility } from "@vtt/substrate";
import { useClient, useTrait } from "@vtt/substrate/client";
import {
  Permissions,
  SetPermissions,
  canWrite,
  type VisibilityShape,
} from "@vtt/permissions/shared";
import { createMemo, createResource, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import type { WorkspaceTab } from "../shared/traits.js";
import { useMe } from "./use-me.js";

/**
 * Universal per-tab permissions affordance — a small button that opens
 * a popover for changing the bound entity's read/write Permissions.
 * Lives next to ShareMenu in every tab's chrome so plugins don't each
 * implement their own ownership UI.
 *
 * Hides when:
 *   - the tab has no bound entity (e.g. "Notes" hub with no note picked)
 *   - the entity has no `Permissions` trait (some entities are
 *     world-public by design and not gate-able)
 *   - the user can't write the entity (button still appears for read,
 *     but the controls disable — viewing your access is fine)
 *
 * The popover offers three presets per axis (read / write):
 *   - Everyone — visible/editable for all users in the world
 *   - GM only  — only the GM
 *   - Selected — a multi-select against the world's membership list
 *
 * Dispatches the universal `SetPermissions` command. The substrate's
 * GM read+write bypass means GMs always pass regardless of what's
 * selected, so "Selected: nobody" is "GM-only by accident" rather than
 * a deny-all footgun.
 */
export function PermissionsMenu(props: { tab: WorkspaceTab }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const entityId = createMemo(() => props.tab.entityId);

  return (
    <Show when={entityId()}>{(idAcc) => <PermissionsMenuForEntity entityId={idAcc()} />}</Show>
  );
}

function PermissionsMenuForEntity(props: { entityId: string }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const permissions = useTrait(props.entityId, Permissions);
  const [members] = useWorldMembers();

  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal<{ top: number; left: number } | null>(null);
  let buttonEl: HTMLButtonElement | undefined;
  let menuEl: HTMLDivElement | undefined;

  const onDocClick = (e: MouseEvent) => {
    if (buttonEl?.contains(e.target as Node)) return;
    if (menuEl?.contains(e.target as Node)) return;
    setOpen(false);
  };
  document.addEventListener("mousedown", onDocClick);
  onCleanup(() => document.removeEventListener("mousedown", onDocClick));

  const computePos = () => {
    if (!buttonEl) return;
    const rect = buttonEl.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - 296, rect.right - 288));
    setPos({ top: rect.bottom + 4, left });
  };

  const dispatchSet = (next: { read?: Visibility; write?: Visibility }) => {
    client.dispatch(
      SetPermissions({
        entityId: props.entityId,
        ...next,
      }) as CommandInstance,
    );
  };

  const isWriter = createMemo(() =>
    canWrite(me(), permissions() as Parameters<typeof canWrite>[1]),
  );

  return (
    <Show when={permissions()}>
      {(permAcc) => (
        <>
          <button
            ref={buttonEl}
            type="button"
            title="Permissions"
            aria-label="permissions"
            class="ml-1 rounded-(--radius-control) px-1 text-[0.7rem] text-fg-subtle opacity-0 hover:bg-surface-elevated hover:text-fg group-hover:opacity-100 transition"
            classList={{ "opacity-100 text-fg-muted": open() }}
            onClick={(e) => {
              e.stopPropagation();
              if (!open()) computePos();
              setOpen(!open());
            }}
          >
            🔒︎
          </button>
          <Show when={open() && pos()}>
            <Portal>
              <div
                ref={menuEl}
                class="fixed z-50 w-72 rounded-(--radius-control) border border-border bg-surface-elevated shadow-lg"
                style={{ top: `${pos()!.top}px`, left: `${pos()!.left}px` }}
              >
                <div class="flex flex-col gap-3 p-3 text-xs">
                  <header class="font-display text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle">
                    Permissions
                  </header>
                  <AxisControl
                    label="Read"
                    value={permAcc().read as Visibility}
                    members={members()}
                    disabled={!isWriter()}
                    onChange={(read) => dispatchSet({ read })}
                  />
                  <AxisControl
                    label="Write"
                    value={permAcc().write as Visibility}
                    members={members()}
                    disabled={!isWriter()}
                    onChange={(write) => dispatchSet({ write })}
                  />
                  <p class="text-[0.65rem] text-fg-subtle">
                    GMs always read and write, regardless of these settings.
                  </p>
                </div>
              </div>
            </Portal>
          </Show>
        </>
      )}
    </Show>
  );
}

/**
 * One axis of the permissions form (read or write). Three presets
 * mirror `Permissions`'s Visibility union: everyone / gm-only / users.
 * The users-list multi-select renders only when "Selected" is active.
 *
 * `onChange` always emits a complete Visibility — either a preset or
 * a `users` list with the current checkboxes — so the parent doesn't
 * have to merge partial values back onto the trait.
 */
function AxisControl(props: {
  label: string;
  value: Visibility;
  members: WorldMembers | null | undefined;
  disabled: boolean;
  onChange: (next: Visibility) => void;
}): JSX.Element {
  const kindOf = (v: Visibility): "everyone" | "gm" | "users" => {
    if (v.kind === "everyone") return "everyone";
    if (v.kind === "role" && v.role === "gm") return "gm";
    return "users";
  };
  const selectedUsers = (): ReadonlySet<string> => {
    const v = props.value;
    if (v.kind !== "users") return new Set();
    return new Set(v.userIds);
  };

  const setKind = (kind: "everyone" | "gm" | "users") => {
    if (kind === "everyone") props.onChange({ kind: "everyone" });
    else if (kind === "gm") props.onChange({ kind: "role", role: "gm" });
    else
      props.onChange({
        kind: "users",
        userIds: Array.from(selectedUsers()),
      });
  };

  const toggleUser = (userId: string) => {
    const next = new Set(selectedUsers());
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    props.onChange({ kind: "users", userIds: Array.from(next) });
  };

  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <span class="font-display w-12 text-[0.6rem] uppercase tracking-[0.18em] text-fg-subtle">
          {props.label}
        </span>
        <select
          disabled={props.disabled}
          value={kindOf(props.value)}
          onChange={(e) => setKind(e.currentTarget.value as "everyone" | "gm" | "users")}
          class="flex-1 rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="everyone">Everyone</option>
          <option value="gm">GM only</option>
          <option value="users">Selected users</option>
        </select>
      </div>
      <Show when={kindOf(props.value) === "users" && props.members}>
        <ul class="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-(--radius-control) border border-border-muted bg-surface px-2 py-1.5">
          <For each={props.members?.members ?? []}>
            {(m) => (
              <li class="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={props.disabled}
                  checked={selectedUsers().has(m.userId)}
                  onChange={() => toggleUser(m.userId)}
                  class="cursor-pointer disabled:cursor-not-allowed"
                />
                <span class="truncate text-fg">{m.name}</span>
                <span class="ml-auto font-display text-[0.55rem] uppercase tracking-[0.16em] text-fg-subtle">
                  {m.role}
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

/* --------------------------------------------------------------------
 * Membership listing
 * ------------------------------------------------------------------ */

interface WorldMember {
  userId: string;
  name: string;
  email: string;
  role: "gm" | "player";
}

interface WorldMembers {
  owner: WorldMember;
  members: WorldMember[];
}

interface MembershipsResponse {
  owner: { userId: string; name: string; email: string };
  members: Array<{
    userId: string;
    name: string;
    email: string;
    role: "gm" | "player";
    addedAt: number;
  }>;
}

/**
 * Lazy fetch of the world's membership list (owner + invited members).
 * Used as the basis for the "Selected users" multi-select. Sourced
 * from the substrate's `/api/worlds/:id/memberships` HTTP route — these
 * rows outlive WebSocket connections, so they're the right basis for
 * "who can the dispatcher hand permissions to" rather than "who's
 * online right now."
 */
function useWorldMembers() {
  const client = useClient();
  return createResource(
    () => client.worldId(),
    async (worldId) => {
      if (!worldId) return null;
      const res = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/memberships`, {
        credentials: "same-origin",
      });
      if (!res.ok) return null;
      const body = (await res.json()) as MembershipsResponse;
      return {
        owner: { ...body.owner, role: "gm" as const },
        members: body.members,
      } satisfies WorldMembers;
    },
  );
}
