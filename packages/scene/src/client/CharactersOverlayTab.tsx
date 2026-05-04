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
import { canWrite, Permissions } from "@vtt/permissions/shared";
import { Character, CharacterToken } from "@vtt/characters/shared";
import { createMemo, For, Show, type JSX } from "solid-js";
import { LinkedCharacter, Position, Scene } from "../shared/traits.js";
import { PlaceCharacterToken } from "../shared/commands.js";
import {
  type SceneOverlayTab,
  type SceneOverlayTabRenderArgs,
} from "../shared/slot.js";
import { CHARACTER_DND_MIME, encodeCharacterDnd } from "./dnd.js";
import { useMe } from "./use-me.js";

/**
 * Slug of the icon used when a character has no uploaded portrait —
 * picked because it reads as a generic player figure on the map
 * without implying a specific class or weapon, and matches the icon
 * shown next to the character in the dock's "no image" placeholder
 * slot. Lives under `assets/icons/.../delapouite/3d-meeple.svg`.
 */
const DEFAULT_CHARACTER_ICON_SLUG = "delapouite/3d-meeple";

/**
 * Characters dock tab. Lists every character in the world with its
 * uploaded portrait (or a placeholder), and a "Place" button that drops
 * the character onto the active scene as a linked token. The button
 * disables when this character already has a token on this scene —
 * "place once per scene" is enforced server-side too, but the UI hides
 * the doomed dispatch.
 *
 * Permission mirrors `PlaceCharacterToken`'s validator: the GM can
 * place anyone; players can only place characters they own. Read-only
 * characters still appear in the list (so a player can see what's
 * placeable by others) but their button is disabled.
 *
 * No drag-to-place yet — the existing tokens-tab drag flow uses an
 * iconSlug and we'd need a separate dnd MIME for character drops.
 * Click-to-place lands the character at the next free cell starting
 * from scene centre, same spiral the icon picker uses.
 */
export const CharactersOverlayTab: SceneOverlayTab = {
  id: qualifiedName("@vtt/scene/dock-characters"),
  label: "Characters",
  icon: "☻",
  priority: 70,
  render: (args: SceneOverlayTabRenderArgs): JSX.Element => {
    return <CharactersTabBody sceneId={args.sceneId} />;
  },
};

function CharactersTabBody(props: { sceneId: string }): JSX.Element {
  const client = useClient();
  const me = useMe();

  const characters = useQuery([Character, Permissions]);
  const tokenImages = useQuery([CharacterToken]);
  const sceneRow = createMemo(() => {
    return client.world.get(props.sceneId, [Scene]) as
      | { Scene: { gridSize: number; widthPx: number; heightPx: number } }
      | undefined;
  });
  const placedRows = useQuery([LinkedCharacter, Position]);

  const tokenImageByCharacter = createMemo(() => {
    const map = new Map<string, string | null>();
    for (const row of tokenImages()) {
      const t = row.values.CharacterToken as { imageUrl: string | null };
      map.set(row.id, t.imageUrl);
    }
    return map;
  });

  const placedOnThisScene = createMemo(() => {
    const set = new Set<string>();
    for (const row of placedRows()) {
      const lc = row.values.LinkedCharacter as { characterId: string };
      const pos = row.values.Position as { sceneId: string };
      if (pos.sceneId === props.sceneId) set.add(lc.characterId);
    }
    return set;
  });

  const sortedCharacters = createMemo(() => {
    return characters()
      .map((row) => ({
        id: row.id,
        name: (row.values.Character as { name: string }).name,
        permissions: row.values.Permissions as
          | Parameters<typeof canWrite>[1]
          | undefined,
        imageUrl: tokenImageByCharacter().get(row.id) ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const canPlace = (c: { permissions?: Parameters<typeof canWrite>[1] }) =>
    canWrite(me(), c.permissions);

  const place = (c: {
    id: string;
    name: string;
    imageUrl: string | null;
  }) => {
    const sc = sceneRow();
    if (!sc) return;
    const grid = sc.Scene.gridSize;
    const cols = Math.floor(sc.Scene.widthPx / grid);
    const rows = Math.floor(sc.Scene.heightPx / grid);
    // Reuse the same spiral-from-centre layout as the icon picker so
    // repeated placements don't stack on top of each other.
    const occupied = new Set<string>();
    for (const row of client.world.query([Position])) {
      const p = row.values.Position as { sceneId: string; x: number; y: number };
      if (p.sceneId !== props.sceneId) continue;
      occupied.add(cellKey(p.x, p.y, grid));
    }
    const [gx, gy] = nextFreeCell(
      Math.floor(cols / 2),
      Math.floor(rows / 2),
      cols,
      rows,
      grid,
      occupied,
    );
    const x = gx * grid + grid / 2;
    const y = gy * grid + grid / 2;
    client.dispatch(
      PlaceCharacterToken({
        sceneId: props.sceneId,
        characterId: c.id,
        // Default fallback icon when no portrait was uploaded — the
        // 3d-meeple icon reads as a player figure on the map without
        // implying a specific class/role. The canvas prefers
        // TokenImage over iconSlug whenever a portrait was uploaded,
        // so this only paints for character tokens with no image yet.
        iconSlug: DEFAULT_CHARACTER_ICON_SLUG,
        imageUrl: c.imageUrl,
        tint: 0xffffff,
        size: grid,
        label: c.name,
        x,
        y,
      }) as CommandInstance,
    );
  };

  return (
    <div class="flex h-full min-h-0 flex-col gap-3">
      <p class="hidden text-[0.7rem] text-fg-subtle md:block">
        drag to the canvas, or click to drop into the next free cell —
        each character can only be placed once per scene.
      </p>
      <Show
        when={sortedCharacters().length > 0}
        fallback={
          <div class="flex h-full items-center justify-center text-xs text-fg-subtle">
            no characters yet — create one in the Characters page first
          </div>
        }
      >
        {/*
          Compact grid: each card is just the thumbnail + name. The
          old layout stacked thumbnail / name / "place" label in a
          tall box; with the place/placed label dropped (the disabled
          + accent-border states already convey it visually) and the
          thumbnail tightened to a small square, we fit roughly twice
          as many characters per row at the same dock height.
        */}
        <div
          // `auto-rows-max` keeps each row at its content height so
          // sparse rows don't get stretched to fill the dock — without
          // it the grid's `flex-1` height inflates the implicit rows
          // to span the whole pane and the cards visibly grow on hover.
          class="grid min-h-0 flex-1 auto-rows-max gap-1 overflow-y-auto pr-1"
          style={{
            "grid-template-columns": "repeat(auto-fill, minmax(4.5rem, 1fr))",
          }}
        >
          <For each={sortedCharacters()}>
            {(c) => {
              const placed = createMemo(() => placedOnThisScene().has(c.id));
              const allowed = createMemo(() => canPlace(c));
              const disabled = createMemo(() => placed() || !allowed());
              const title = () => {
                if (placed()) return `${c.name} is already on this scene`;
                if (!allowed()) return `you don't own ${c.name}`;
                return `place ${c.name} on the scene`;
              };
              return (
                <button
                  type="button"
                  title={title()}
                  disabled={disabled()}
                  onClick={() => place(c)}
                  // Disabled buttons (already-placed or not-owned)
                  // shouldn't initiate a drag — `draggable=false` keeps
                  // the cursor from appearing draggable, and the
                  // canvas-side dropzone wouldn't accept the payload
                  // anyway because the place-once / ownership checks
                  // re-validate server-side.
                  draggable={!disabled()}
                  onDragStart={(e) => {
                    if (!e.dataTransfer) return;
                    if (disabled()) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.setData(
                      CHARACTER_DND_MIME,
                      encodeCharacterDnd({
                        characterId: c.id,
                        label: c.name,
                        iconSlug: DEFAULT_CHARACTER_ICON_SLUG,
                        imageUrl: c.imageUrl,
                      }),
                    );
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  class="flex flex-col items-center gap-1 rounded-(--radius-control) border border-transparent p-1 hover:border-accent hover:bg-surface transition disabled:cursor-not-allowed disabled:opacity-50"
                  classList={{
                    "border-accent": placed(),
                    "cursor-grab active:cursor-grabbing": !disabled(),
                  }}
                >
                  <div class="flex aspect-square w-full items-center justify-center overflow-hidden rounded-(--radius-control) border border-border-muted bg-surface-sunken">
                    <Show
                      when={c.imageUrl}
                      fallback={
                        // Placeholder = the 3d-meeple silhouette the
                        // canvas will paint when this character is
                        // placed without a portrait. Keeps the dock
                        // thumbnail consistent with what lands on the
                        // map.
                        <img
                          src={`/icons/${DEFAULT_CHARACTER_ICON_SLUG}.svg`}
                          alt={c.name}
                          class="h-3/4 w-3/4 pointer-events-none"
                          style={{ filter: "var(--icon-filter)" }}
                          loading="lazy"
                          draggable={false}
                        />
                      }
                    >
                      {(url) => (
                        <img
                          src={url()}
                          alt={c.name}
                          class="h-full w-full object-cover"
                          loading="lazy"
                          draggable={false}
                        />
                      )}
                    </Show>
                  </div>
                  <span class="w-full truncate text-center text-[0.7rem] leading-tight text-fg">
                    {c.name}
                  </span>
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

function cellKey(x: number, y: number, grid: number): string {
  return `${Math.round((x - grid / 2) / grid)},${Math.round((y - grid / 2) / grid)}`;
}

/**
 * Outward Manhattan-spiral search starting from (cx, cy). Mirrors the
 * tokens-tab implementation so repeated placements (icon-picker drops,
 * character placements, mixed) all land on the same shared grid.
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
