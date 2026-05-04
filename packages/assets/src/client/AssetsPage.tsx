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
  createSignal,
  For,
  Show,
  type JSX,
} from "solid-js";
import {
  type CommandInstance,
  type EntityId,
} from "@vtt/substrate";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import {
  definePageProvider,
  RetargetTab,
} from "@vtt/shell-workbench/shared";
import { Asset } from "../shared/traits.js";
import { DeleteAsset } from "../shared/commands.js";

const ASSETS_KIND = "@vtt/assets/assets";

/**
 * Asset library page provider. Empty branch is the management hub —
 * grid of every asset in the world with previews, mime, size, and
 * delete-by-owner-or-GM. Selected asset shows the full preview.
 */
export const AssetsPageProvider = definePageProvider({
  kind: ASSETS_KIND,
  icon: "image",
  label: "Assets",
  reads: [Asset],
  list: ({ world }) => {
    return world.query([Asset]).map((row) => {
      const a = row.values.Asset as { filename: string | null; mime: string };
      return {
        id: row.id,
        label: a.filename ?? `${a.mime} asset`,
        hint: a.mime,
      };
    });
  },
  defaultEntity: () => null,
  render: ({ tabId, entityId }) => {
    return <AssetsPage tabId={tabId} entityId={entityId} />;
  },
});

function AssetsPage(props: {
  tabId: string;
  entityId: string | null;
}): JSX.Element {
  return (
    <Show
      when={props.entityId}
      fallback={<AssetsHub tabId={props.tabId} />}
    >
      {(idAcc) => <AssetPreview assetId={idAcc() as EntityId} />}
    </Show>
  );
}

function AssetsHub(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const [filter, setFilter] = createSignal("");
  const assetRows = useQuery([Asset]);

  const items = createMemo(() => {
    const needle = filter().trim().toLowerCase();
    return assetRows()
      .map((row) => {
        const a = row.values.Asset as {
          filename: string | null;
          mime: string;
          sizeBytes: number;
          uploadedAt: number;
        };
        return {
          id: row.id,
          filename: a.filename ?? `${a.mime} asset`,
          mime: a.mime,
          sizeBytes: a.sizeBytes,
          uploadedAt: a.uploadedAt,
        };
      })
      .filter(
        (a) =>
          needle.length === 0 ||
          a.filename.toLowerCase().includes(needle) ||
          a.mime.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.uploadedAt - a.uploadedAt);
  });

  const open = (assetId: string) => {
    client.dispatch(
      RetargetTab({
        tabId: props.tabId,
        pageKind: ASSETS_KIND,
        entityId: assetId,
      }) as CommandInstance,
    );
  };

  const remove = (assetId: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    client.dispatch(DeleteAsset({ assetId }) as CommandInstance);
  };

  return (
    <div class="flex h-full flex-col gap-3 px-5 py-4 overflow-y-auto">
      <header class="flex items-baseline justify-between">
        <h2
          class="font-display text-xl tracking-tight text-fg"
          style={{ "font-family": "var(--font-display)" }}
        >
          Assets
        </h2>
        <span class="font-display text-[0.62rem] uppercase tracking-[0.16em] text-fg-subtle">
          {items().length} {filter() ? "match" : "total"}
        </span>
      </header>
      <input
        type="search"
        value={filter()}
        onInput={(e) => setFilter(e.currentTarget.value)}
        placeholder="Filter by filename or mime…"
        class="w-full rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        autocomplete="off"
        spellcheck={false}
      />
      <Show
        when={items().length > 0}
        fallback={
          <p class="text-fg-subtle italic">
            {filter() ? "No matches." : "No assets yet — paste an image into a note to upload one."}
          </p>
        }
      >
        <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          <For each={items()}>
            {(a) => (
              <AssetCard
                id={a.id as EntityId}
                filename={a.filename}
                mime={a.mime}
                sizeBytes={a.sizeBytes}
                onOpen={() => open(a.id)}
                onRemove={() => remove(a.id, a.filename)}
              />
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function AssetCard(props: {
  id: EntityId;
  filename: string;
  mime: string;
  sizeBytes: number;
  onOpen: () => void;
  onRemove: () => void;
}): JSX.Element {
  const client = useClient();
  const url = createMemo(() => {
    const wid = client.worldId() ?? "";
    return `/plugin-data/${wid}/assets/${props.id}`;
  });

  return (
    <li class="group relative flex flex-col gap-1 rounded-(--radius-control) border border-border-muted bg-surface-elevated overflow-hidden">
      <button
        type="button"
        onClick={props.onOpen}
        class="aspect-square w-full bg-surface flex items-center justify-center hover:opacity-90 transition"
      >
        <Show
          when={props.mime.startsWith("image/")}
          fallback={
            <span class="text-2xl text-fg-subtle">
              {iconForMime(props.mime)}
            </span>
          }
        >
          <img
            src={url()}
            alt={props.filename}
            class="h-full w-full object-cover"
            loading="lazy"
          />
        </Show>
      </button>
      <div class="flex flex-col gap-0.5 px-2 py-1">
        <span class="truncate text-xs text-fg" title={props.filename}>
          {props.filename}
        </span>
        <span class="text-[0.6rem] text-fg-subtle">
          {formatBytes(props.sizeBytes)} · {props.mime.split("/")[1]}
        </span>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          props.onRemove();
        }}
        class="absolute top-1 right-1 rounded-(--radius-control) border border-border bg-surface px-1.5 py-px text-[0.65rem] text-fg-subtle opacity-0 group-hover:opacity-100 hover:border-danger hover:text-danger transition"
        title="Delete asset"
      >
        ✕
      </button>
    </li>
  );
}

function AssetPreview(props: { assetId: EntityId }): JSX.Element {
  const client = useClient();
  const asset = useTrait(props.assetId, Asset);
  const url = createMemo(() => {
    const wid = client.worldId() ?? "";
    return `/plugin-data/${wid}/assets/${props.assetId}`;
  });
  return (
    <Show
      when={asset()}
      fallback={
        <p class="text-fg-subtle italic p-5">Asset not found or no longer visible.</p>
      }
    >
      {(a) => (
        <div class="flex h-full flex-col gap-3 px-5 py-4 overflow-y-auto">
          <header class="flex items-baseline justify-between">
            <h2
              class="font-display text-xl tracking-tight text-fg"
              style={{ "font-family": "var(--font-display)" }}
            >
              {(a() as { filename: string | null }).filename ?? "Asset"}
            </h2>
            <span class="font-mono text-[0.62rem] text-fg-subtle">
              {props.assetId}
            </span>
          </header>
          <Show when={(a() as { mime: string }).mime.startsWith("image/")}>
            <img
              src={url()}
              alt={(a() as { filename: string | null }).filename ?? "asset"}
              class="max-h-[70vh] max-w-full self-center rounded-(--radius-control) border border-border-muted"
            />
          </Show>
          <Show when={(a() as { mime: string }).mime.startsWith("video/")}>
            <video src={url()} controls class="max-h-[70vh] max-w-full self-center" />
          </Show>
          <Show when={(a() as { mime: string }).mime.startsWith("audio/")}>
            <audio src={url()} controls class="w-full" />
          </Show>
          <dl class="grid grid-cols-2 gap-2 text-xs text-fg-subtle">
            <dt>Mime</dt>
            <dd class="font-mono">{(a() as { mime: string }).mime}</dd>
            <dt>Size</dt>
            <dd>{formatBytes((a() as { sizeBytes: number }).sizeBytes)}</dd>
            <dt>SHA-256</dt>
            <dd class="font-mono truncate">{(a() as { sha256: string }).sha256}</dd>
            <dt>Uploaded</dt>
            <dd>
              {new Date(
                (a() as { uploadedAt: number }).uploadedAt,
              ).toLocaleString()}
            </dd>
          </dl>
        </div>
      )}
    </Show>
  );
}

function iconForMime(mime: string): string {
  const top = mime.split("/")[0];
  switch (top) {
    case "image":
      return "🖼";
    case "video":
      return "▶";
    case "audio":
      return "♪";
    case "application":
      return "📄";
    default:
      return "•";
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
