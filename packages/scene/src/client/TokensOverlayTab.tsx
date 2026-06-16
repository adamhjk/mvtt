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

import { qualifiedName, type CommandInstance } from "@vtt/substrate";
import { useClient, useQuery } from "@vtt/substrate/client";
import { createMemo, createResource, createSignal, For, Show, type JSX } from "solid-js";
import { Position, Scene } from "../shared/traits.js";
import { CreateToken } from "../shared/commands.js";
import { type SceneOverlayTab, type SceneOverlayTabRenderArgs } from "../shared/slot.js";
import { TOKEN_DND_MIME, encodeTokenDnd } from "./dnd.js";
import { useMe } from "./use-me.js";

interface IconEntry {
  slug: string;
  artist: string;
  name: string;
}

interface ManifestResponse {
  icons: IconEntry[];
}

/**
 * Tokens dock tab. Refactored from the old `TokenPickerView` (which
 * filled a now-removed `SceneToolbarSurface`) into a slot fill so the
 * scene's bottom dock can host it alongside Config and any future
 * plugin contributions.
 *
 * Two ways to place a token:
 *   - drag the icon onto the canvas → the canvas's drop handler reads
 *     `application/x-vtt-token` from the dataTransfer, computes world
 *     coords from the cursor, and dispatches CreateToken there.
 *   - click the icon → places at the next free cell starting from
 *     scene centre and spiraling out, so repeated clicks don't stack.
 *
 * Players see an empty state (CreateToken is GM-only); the picker is
 * GM-gated to avoid surprise failed acks.
 */
export const TokensOverlayTab: SceneOverlayTab = {
  id: qualifiedName("@vtt/scene/dock-tokens"),
  label: "Tokens",
  icon: "▣",
  priority: 80,
  render: (args: SceneOverlayTabRenderArgs): JSX.Element => {
    return <TokensTabBody sceneId={args.sceneId} />;
  },
};

function TokensTabBody(props: { sceneId: string }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const isGm = createMemo(() => me()?.role === "gm");

  const scenes = useQuery([Scene]);
  const positions = useQuery([Position]);
  const sceneRow = createMemo(() => scenes().find((row) => row.id === props.sceneId));

  const [manifest] = createResource(async () => {
    const res = await fetch("/api/icons/manifest");
    if (!res.ok) throw new Error(`icons manifest ${res.status}`);
    return ((await res.json()) as ManifestResponse).icons;
  });

  const [query, setQuery] = createSignal("");
  const filtered = createMemo<IconEntry[]>(() => {
    const all = manifest();
    if (!all) return [];
    const q = query().trim().toLowerCase();
    const out =
      q.length === 0
        ? all
        : all.filter((i) => i.slug.toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
    // Cap render: 4k SVGs in the DOM kills paint. The picker is for
    // browse-and-search, not exhaustive scroll.
    return out.slice(0, 200);
  });

  const dropOnClick = (icon: IconEntry) => {
    const sc = sceneRow();
    if (!sc) return;
    const s = sc.values.Scene as {
      gridSize: number;
      widthPx: number;
      heightPx: number;
    };
    // Cell counts derived from the playable extent + grid stride.
    // The last partial cell (if widthPx isn't an integer multiple of
    // gridSize) is excluded — tokens always land at full-cell centers.
    const cols = Math.floor(s.widthPx / s.gridSize);
    const rows = Math.floor(s.heightPx / s.gridSize);
    // Only consider tokens that live on *this* scene as occupants of
    // the spiral search; a token in another scene shouldn't push our
    // new drop into a different cell.
    const occupied = new Set<string>();
    for (const row of positions()) {
      const p = row.values.Position as {
        sceneId: string;
        x: number;
        y: number;
      };
      if (p.sceneId !== props.sceneId) continue;
      occupied.add(cellKey(p.x, p.y, s.gridSize));
    }
    const [gx, gy] = nextFreeCell(
      Math.floor(cols / 2),
      Math.floor(rows / 2),
      cols,
      rows,
      s.gridSize,
      occupied,
    );
    const x = gx * s.gridSize + s.gridSize / 2;
    const y = gy * s.gridSize + s.gridSize / 2;
    client.dispatch(
      CreateToken({
        sceneId: props.sceneId,
        iconSlug: icon.slug,
        tint: 0xffffff,
        size: s.gridSize,
        label: icon.name,
        kind: "creature",
        x,
        y,
      }) as CommandInstance,
    );
  };

  return (
    <Show
      when={isGm()}
      fallback={
        <div class="flex h-full items-center justify-center text-xs text-fg-subtle">
          only the GM can place tokens
        </div>
      }
    >
      <div class="flex h-full min-h-0 flex-col gap-3">
        {/* search row + count */}
        <div class="flex shrink-0 items-center gap-3">
          <input
            type="search"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="search icons…"
            autocomplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            class="flex-1 rounded-(--radius-control) border border-border bg-surface px-3 py-1.5 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
          <p class="hidden text-[0.7rem] text-fg-subtle md:block">
            drag to canvas, or click to drop into the next free cell
          </p>
          <span class="font-display text-[0.62rem] uppercase tracking-[0.16em] text-fg-subtle">
            {manifest.loading ? "loading…" : `${filtered().length} shown`}
          </span>
        </div>

        {/* wide grid — much wider than the old right-rail layout. The
            dock is horizontal real estate, so we can fit ~8–14 columns
            depending on pane width. `auto-fill` lets the browser pick
            the column count from the min cell size. */}
        <div
          class="grid min-h-0 flex-1 gap-1 overflow-y-auto pr-1"
          style={{
            "grid-template-columns": "repeat(auto-fill, minmax(3rem, 1fr))",
          }}
        >
          <For each={filtered()}>
            {(icon) => (
              <button
                type="button"
                title={`${icon.name} — ${icon.artist}`}
                draggable={true}
                onDragStart={(e) => {
                  if (!e.dataTransfer) return;
                  e.dataTransfer.setData(
                    TOKEN_DND_MIME,
                    encodeTokenDnd({ slug: icon.slug, label: icon.name }),
                  );
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => dropOnClick(icon)}
                class="flex aspect-square cursor-grab items-center justify-center rounded-(--radius-control) border border-border-muted bg-surface-sunken p-1 hover:border-accent hover:bg-surface transition active:cursor-grabbing"
              >
                <img
                  src={`/icons/${icon.slug}.svg`}
                  alt={icon.name}
                  loading="lazy"
                  draggable={false}
                  class="h-full w-full pointer-events-none"
                  style={{ filter: "var(--icon-filter)" }}
                />
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

function cellKey(x: number, y: number, grid: number): string {
  return `${Math.round((x - grid / 2) / grid)},${Math.round((y - grid / 2) / grid)}`;
}

/**
 * Outward Manhattan-spiral search starting from (cx, cy). Returns the
 * first cell within scene bounds that isn't in `occupied`, or the
 * starting cell if everything is full (graceful fallback — stacking
 * is preferable to dropping nothing).
 */
function nextFreeCell(
  cx: number,
  cy: number,
  width: number,
  height: number,
  grid: number,
  occupied: Set<string>,
): [number, number] {
  const isFree = (gx: number, gy: number) => {
    if (gx < 0 || gy < 0 || gx >= width || gy >= height) return false;
    const x = gx * grid + grid / 2;
    const y = gy * grid + grid / 2;
    return !occupied.has(cellKey(x, y, grid));
  };
  if (isFree(cx, cy)) return [cx, cy];
  const maxR = Math.max(width, height);
  for (let r = 1; r <= maxR; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isFree(cx + dx, cy + dy)) return [cx + dx, cy + dy];
      }
    }
  }
  return [cx, cy];
}
