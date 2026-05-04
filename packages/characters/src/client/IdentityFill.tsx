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

import { type CommandInstance } from "@vtt/substrate";
import { useClient, useTrait } from "@vtt/substrate/client";
import { canWrite, Permissions } from "@vtt/permissions/shared";
import {
  createEffect,
  createMemo,
  createSignal,
  Show,
  type JSX,
} from "solid-js";
import { Character, CharacterToken } from "../shared/traits.js";
import {
  RenameCharacter,
  SetCharacterTokenImage,
} from "../shared/commands.js";
import { useMe } from "./use-me.js";

/**
 * Default fill for `CharacterSheetIdentitySlot`. Renders the editable
 * name + token portrait. Player-assignment is no longer a sheet field —
 * it lives on the workbench tab's `PermissionsMenu`, since "who can
 * write this character" is the universal permissions concern across
 * every plugin.
 *
 * Edit gating delegates to `canWrite(me, Permissions)`: GMs always edit,
 * users in `Permissions.write` always edit, everyone else gets
 * read-only.
 */
export function IdentityFill(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const character = useTrait(props.characterId, Character);
  const permissions = useTrait(props.characterId, Permissions);
  const tokenImage = useTrait(props.characterId, CharacterToken);

  const canEdit = createMemo(() =>
    canWrite(me(), permissions() as Parameters<typeof canWrite>[1]),
  );

  const rename = (next: string) => {
    client.dispatch(
      RenameCharacter({
        characterId: props.characterId,
        name: next,
      }) as CommandInstance,
    );
  };

  const setTokenImage = (imageUrl: string | null) => {
    client.dispatch(
      SetCharacterTokenImage({
        characterId: props.characterId,
        imageUrl,
      }) as CommandInstance,
    );
  };

  return (
    <div class="flex flex-col gap-2">
      <div class="flex flex-col gap-1">
        <span class="font-display text-[0.6rem] uppercase tracking-[0.2em] text-fg-subtle">
          Token
        </span>
        <TokenImageField
          characterId={props.characterId}
          worldId={client.worldId() ?? ""}
          value={tokenImage()?.imageUrl ?? null}
          disabled={!canEdit() || !character() || !client.worldId()}
          onUpload={(url) => setTokenImage(url)}
          onClear={() => setTokenImage(null)}
        />
      </div>
      <div class="flex flex-col gap-1">
        <span class="font-display text-[0.6rem] uppercase tracking-[0.2em] text-fg-subtle">
          Name
        </span>
        <NameField
          value={character()?.name ?? ""}
          disabled={!canEdit() || !character()}
          onCommit={rename}
        />
      </div>
    </div>
  );
}

/**
 * Upload + preview + clear for the character's token portrait. Mirrors
 * the scene plugin's BackgroundImageField — the upload POSTs the raw
 * file body to
 * `/api/plugin-data/<worldId>/@vtt/characters/characters/<characterId>/token.<ext>`,
 * scoped to this character's plugin-data prefix within this world. On
 * success the response carries the public URL (with a cache-bust
 * suffix); we dispatch SetCharacterTokenImage so every client picks up
 * the change.
 *
 * GM-or-owner: the upload endpoint enforces GM-only world-data writes
 * server-side, so non-GM-non-owners see a disabled control. Inside
 * `data-1p-ignore` etc. so the file picker doesn't get suggested as a
 * password input by extensions.
 */
function TokenImageField(props: {
  characterId: string;
  worldId: string;
  value: string | null;
  disabled: boolean;
  onUpload: (next: string) => void;
  onClear: () => void;
}): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let fileInput: HTMLInputElement | undefined;

  const upload = async (file: File) => {
    setError(null);
    const ext =
      extensionFromName(file.name) ??
      extensionFromMime(file.type) ??
      ".bin";
    const url =
      `/api/plugin-data/${encodeURIComponent(props.worldId)}` +
      `/@vtt/characters/characters/${encodeURIComponent(props.characterId)}` +
      `/token${ext}`;
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        body: file,
        credentials: "same-origin",
        headers: file.type ? { "content-type": file.type } : {},
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `upload failed (${res.status})`);
      }
      const body = (await res.json()) as { path: string };
      props.onUpload(body.path);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileInput) fileInput.value = "";
    }
  };

  return (
    <div class="flex items-start gap-3">
      <div
        class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-(--radius-control) border border-border bg-surface"
        aria-label="current token image preview"
      >
        <Show
          when={props.value}
          fallback={
            // Mirror the scene-side default: when no portrait is
            // uploaded, the placed token paints the 3d-meeple icon, so
            // the sheet's preview shows the same silhouette rather
            // than a vague "none" label.
            <img
              src="/icons/delapouite/3d-meeple.svg"
              alt="default character token"
              class="h-3/4 w-3/4 pointer-events-none"
              style={{ filter: "var(--icon-filter)" }}
              draggable={false}
            />
          }
        >
          {(url) => (
            <img
              src={url()}
              alt="character token"
              class="h-full w-full object-cover"
              draggable={false}
            />
          )}
        </Show>
      </div>
      <div class="flex flex-1 flex-col gap-2">
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={props.disabled || busy()}
            onClick={() => fileInput?.click()}
            class="rounded-(--radius-control) bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover transition disabled:opacity-50"
          >
            {busy() ? "Uploading…" : props.value ? "Replace…" : "Upload…"}
          </button>
          <Show when={props.value}>
            <button
              type="button"
              disabled={props.disabled || busy()}
              onClick={() => props.onClear()}
              class="rounded-(--radius-control) border border-border bg-surface px-3 py-1.5 text-xs text-fg-muted hover:border-danger hover:text-danger transition disabled:opacity-50"
            >
              Remove
            </button>
          </Show>
        </div>
        <p class="text-[0.7rem] text-fg-subtle">
          PNG, JPG, GIF, WebP, AVIF, or SVG. Max 250 MB.
        </p>
        <Show when={error()}>
          <p class="rounded-(--radius-control) border border-danger/40 bg-danger/10 px-2 py-1 text-[0.7rem] text-danger">
            {error()}
          </p>
        </Show>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml"
        class="hidden"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) void upload(file);
        }}
      />
    </div>
  );
}

function extensionFromName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return null;
  return name.slice(dot).toLowerCase();
}

function extensionFromMime(mime: string): string | null {
  switch (mime) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/avif":
      return ".avif";
    case "image/svg+xml":
      return ".svg";
    default:
      return null;
  }
}

function NameField(props: {
  value: string;
  disabled: boolean;
  onCommit: (next: string) => void;
}): JSX.Element {
  const [local, setLocal] = createSignal(props.value);
  const [editing, setEditing] = createSignal(false);
  let lastDispatched: string | null = null;

  createEffect(() => {
    const next = props.value;
    if (editing()) return;
    if (lastDispatched !== null) {
      if (next === lastDispatched) lastDispatched = null;
      return;
    }
    setLocal(next);
  });

  const commit = () => {
    const trimmed = local().trim();
    if (trimmed.length === 0) {
      setLocal(props.value);
      setEditing(false);
      return;
    }
    if (trimmed === props.value) {
      setEditing(false);
      return;
    }
    lastDispatched = trimmed;
    props.onCommit(trimmed);
    setEditing(false);
  };

  return (
    <input
      type="text"
      value={local()}
      maxLength={120}
      disabled={props.disabled}
      autocomplete="off"
      spellcheck={false}
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      onFocus={() => setEditing(true)}
      onInput={(e) => setLocal(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.currentTarget as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setLocal(props.value);
          setEditing(false);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 font-display text-base text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}
