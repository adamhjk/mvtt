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
  defineView,
  clientOnly,
  type EntityId,
  type CommandInstance,
} from "@vtt/substrate";
import { useClient, useTrait } from "@vtt/substrate/client";
import {
  onCleanup,
  onMount,
  createMemo,
  createEffect,
  Show,
  getOwner,
  runWithOwner,
} from "solid-js";
import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite as PixiSprite,
  Texture,
  type FederatedPointerEvent,
} from "pixi.js";
import {
  Position,
  Scene,
  Sprite,
  Token,
  TokenImage,
} from "../shared/traits.js";
import {
  CreateToken,
  MoveToken,
  PlaceCharacterToken,
  RemoveToken,
} from "../shared/commands.js";
import { SceneCanvasSurface } from "../shared/surfaces.js";
import { TokenUnderlaysSlot, type TokenUnderlay } from "../shared/slot.js";
import {
  CHARACTER_DND_MIME,
  TOKEN_DND_MIME,
  decodeCharacterDnd,
  decodeTokenDnd,
} from "./dnd.js";
import { useMe } from "./use-me.js";

/**
 * The Pixi v8 renderer. v0 responsibilities:
 *   - mount one Application sized to its container
 *   - paint the grid background sized from the active Scene
 *   - keep a live map of token entityId → PixiSprite synced with the
 *     World (Sprite + Position + Token traits)
 *   - drag-to-move on tokens, dispatching MoveToken with a CAS check
 *   - mouse-wheel zoom + empty-area pan
 *   - fit-to-viewport so a freshly-created scene is fully visible
 *     regardless of how big the Scene's grid is relative to the canvas
 *
 * Drag ghosts via the presence channel will land in v1; for v0 the
 * sprite snaps to the cursor locally and reconciles when the
 * authoritative TokenMoved comes back.
 */
export const SceneCanvasView = defineView<{ sceneId: string }>({
  name: "SceneCanvas",
  surface: SceneCanvasSurface,
  priority: 0,
  render: clientOnly((ctx: { sceneId: string }) => {
    const client = useClient();
    const me = useMe();

    // Bind to *this* scene by id. The previous `useQuery([Scene])[0]`
    // approach silently rendered "the first scene in the world" — fine
    // when there's only one, broken the moment a second exists. The
    // sceneId is provided by the SceneCanvasSurface context, set by
    // ScenePage / SceneBody from the workbench tab's entityId.
    const sceneTrait = useTrait(ctx.sceneId, Scene);

    // Field-level memos so each downstream effect re-runs only when its
    // own input changed. Both return primitive types so Solid's default
    // `===` equality on memos suppresses re-emission when only an
    // unrelated field (e.g. `name`) mutated. This is what keeps a scene
    // rename or color edit from yanking the user's pan/zoom — the
    // fitToViewport effect only depends on `dimsKey`, which is unchanged.
    const dimsKey = createMemo<string>(() => {
      const sc = sceneTrait();
      if (!sc) return "";
      return `${sc.widthPx}x${sc.heightPx}@${sc.gridSize}`;
    });
    const bgColor = createMemo<string | undefined>(() => sceneTrait()?.backgroundColor);
    const bgImageUrl = createMemo<string | null>(
      () => sceneTrait()?.backgroundImage ?? null,
    );

    let host: HTMLDivElement | undefined;

    onMount(async () => {
      if (!host) return;
      // Capture the synchronous reactive owner before the first await.
      // Solid's `onMount` callback runs synchronously up to its first
      // await; after that the reactive owner is gone, so a later
      // `onCleanup(...)` would register outside any tracking scope and
      // never fire (which on the workbench leaks Pixi Applications and
      // window-level event listeners across pane mounts/unmounts).
      // `runWithOwner` re-enters the captured owner just for the
      // cleanup registration.
      const owner = getOwner();

      // Seed the renderer's background from the active scene's
      // backgroundColor trait so the canvas matches the saved theme on
      // first paint. Falls back to the historical default if the scene
      // hasn't loaded yet — `createEffect` below picks up the trait
      // value as soon as it arrives.
      const initialBg = parseHexColor(sceneTrait()?.backgroundColor);

      const app = new Application();
      await app.init({
        background: initialBg,
        resizeTo: host,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });

      // Reactivity to scene trait changes. Three separate effects so
      // each one only re-runs when its own input changes:
      //   - background  → renderer clear color (visible outside grid extent)
      //   - drawGrid    → grid lines + bg-fill rect (visible inside extent)
      //   - fitToViewport → only on dimension/gridSize change, NOT on
      //     rename or recolor (which would yank the user's pan/zoom)
      // All three live inside `runWithOwner(owner, ...)` because we're
      // past the first await — see the owner capture comment above.
      // The drawGrid + fitToViewport functions themselves are defined
      // further down (they need `world`, `grid`, `app.screen`); the
      // effects that drive them are registered down there too. This
      // block only handles the renderer background; everything else
      // lands once those locals exist.

      // Pixi v8 mounts via app.canvas (replacing v7's app.view). Append
      // here rather than passing { canvas } above so the Application owns
      // its own canvas element — easier to swap renderers later without
      // hand-rolling DOM.
      host.appendChild(app.canvas);
      app.canvas.style.display = "block";
      app.canvas.style.width = "100%";
      app.canvas.style.height = "100%";

      const world = new Container();
      world.eventMode = "static";
      app.stage.addChild(world);

      // World z-order, bottom to top:
      //   bgFill   — solid backgroundColor rect at scene extent
      //   bgImage  — uploaded image (PNG/JPG/etc), shown over the fill
      //              so transparent regions of the image let the
      //              backgroundColor show through
      //   grid     — grid lines only (no fill — that's bgFill's job)
      //   tokens   — sprites
      //   selection — selection outlines
      // Each layer ignores pointer events so hits fall through to the
      // interactive world container (drag/pan/marquee).
      const bgFill = new Graphics();
      bgFill.eventMode = "none";
      world.addChild(bgFill);

      const bgImage = new PixiSprite(Texture.EMPTY);
      bgImage.eventMode = "none";
      bgImage.visible = false;
      world.addChild(bgImage);

      const grid = new Graphics();
      grid.eventMode = "none";
      world.addChild(grid);
      const tokenLayer = new Container();
      world.addChild(tokenLayer);
      // Selection outlines paint in world-space so they pan/zoom with
      // tokens. Marquee paints on the stage so it stays at screen scale
      // regardless of zoom.
      const selectionOverlay = new Graphics();
      selectionOverlay.eventMode = "none";
      world.addChild(selectionOverlay);
      const marqueeOverlay = new Graphics();
      marqueeOverlay.eventMode = "none";
      app.stage.addChild(marqueeOverlay);

      app.stage.eventMode = "static";
      app.stage.hitArea = app.screen;

      // — selection ————————————————————————————————————————————
      const selected = new Set<EntityId>();
      const setSelection = (next: Iterable<EntityId>) => {
        selected.clear();
        for (const id of next) selected.add(id);
        redrawSelection();
      };
      const toggleSelection = (id: EntityId) => {
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        redrawSelection();
      };
      const clearSelection = () => {
        if (selected.size === 0) return;
        selected.clear();
        redrawSelection();
      };
      const redrawSelection = () => {
        selectionOverlay.clear();
        if (selected.size === 0) return;
        // Stroke width compensates for world.scale so the outline stays
        // ~2px on screen regardless of zoom.
        const screenWidth = 2;
        const w = screenWidth / Math.max(world.scale.x, 0.01);
        selectionOverlay.setStrokeStyle({
          width: w,
          color: 0x2ea043,
          alpha: 0.95,
        });
        for (const id of selected) {
          const entry = sprites.get(id);
          if (!entry) continue;
          const half = entry.size / 2;
          selectionOverlay.rect(
            entry.sprite.x - half - w,
            entry.sprite.y - half - w,
            entry.size + 2 * w,
            entry.size + 2 * w,
          );
        }
        selectionOverlay.stroke();
      };

      // — interaction state ——————————————————————————————————————
      // Per-sprite stage listeners would leak; one shared `active`
      // tracks the in-flight drag (which may be multi-token).
      type Entry = {
        sprite: PixiSprite;
        slug: string;
        size: number;
        tint: number;
        movedAt: number;
        dragging: boolean;
      };
      type Drag = {
        id: EntityId;
        entry: Entry;
        offset: { x: number; y: number };
        lastSeenMovedAt: number;
      };
      let active: { drags: Drag[] } | null = null;
      let panning = false;
      let panStart = { x: 0, y: 0, wx: 0, wy: 0 };
      let marquee:
        | { startScreen: { x: number; y: number }; addToSelection: boolean }
        | null = null;

      // Begin a drag: if `seedId` is in the selection, drag the whole
      // selection together; otherwise drag just that sprite (and
      // selection has already been replaced with {seedId} by the caller).
      const beginDrag = (seedId: EntityId, globalX: number, globalY: number) => {
        const ids = selected.has(seedId) ? [...selected] : [seedId];
        const drags: Drag[] = [];
        const cursor = world.toLocal({ x: globalX, y: globalY });
        for (const id of ids) {
          const entry = sprites.get(id);
          if (!entry) continue;
          entry.dragging = true;
          entry.sprite.cursor = "grabbing";
          drags.push({
            id,
            entry,
            offset: { x: cursor.x - entry.sprite.x, y: cursor.y - entry.sprite.y },
            lastSeenMovedAt: entry.movedAt,
          });
        }
        if (drags.length === 0) return;
        active = { drags };
      };

      app.stage.on("pointerdown", (e: FederatedPointerEvent) => {
        if (e.button !== 0 && e.button !== 1) return;
        // Sprites stop-propagate left-clicks on themselves, so this only
        // fires when the click missed every token. Shift+left-empty = marquee;
        // plain-left-empty = pan (also clears selection); middle = pan.
        if (e.button === 0 && e.shiftKey) {
          marquee = {
            startScreen: { x: e.global.x, y: e.global.y },
            addToSelection: false,
          };
          return;
        }
        if (e.button === 0) clearSelection();
        panning = true;
        panStart = { x: e.global.x, y: e.global.y, wx: world.x, wy: world.y };
        if (host) host.style.cursor = "grabbing";
      });
      // `globalpointermove` (NOT `pointermove`) is required for drag
      // tracking in Pixi v8: regular `pointermove` only fires while the
      // cursor is over the listening object's hit area, so a fast drag
      // outside the canvas would stop receiving move events and the
      // sprite would "stick" until the cursor came back. The global
      // variant fires on every pointer movement the renderer sees.
      app.stage.on("globalpointermove", (e: FederatedPointerEvent) => {
        if (active) {
          const local = world.toLocal(e.global);
          for (const d of active.drags) {
            d.entry.sprite.x = local.x - d.offset.x;
            d.entry.sprite.y = local.y - d.offset.y;
          }
          redrawSelection();
          return;
        }
        if (marquee) {
          drawMarquee(e.global.x, e.global.y);
          return;
        }
        if (panning) {
          world.x = panStart.wx + (e.global.x - panStart.x);
          world.y = panStart.wy + (e.global.y - panStart.y);
          // Outline thickness depends on zoom; pan doesn't change zoom
          // but we redraw cheaply.
          redrawSelection();
          // Persist on every pan tick — the inner save is debounced
          // to ~150ms so we don't spam sessionStorage with every
          // pixel of movement.
          saveViewport();
        }
      });

      const drawMarquee = (gx: number, gy: number) => {
        if (!marquee) return;
        const x0 = Math.min(marquee.startScreen.x, gx);
        const y0 = Math.min(marquee.startScreen.y, gy);
        const x1 = Math.max(marquee.startScreen.x, gx);
        const y1 = Math.max(marquee.startScreen.y, gy);
        marqueeOverlay.clear();
        marqueeOverlay
          .rect(x0, y0, x1 - x0, y1 - y0)
          .fill({ color: 0x2ea043, alpha: 0.1 });
        marqueeOverlay.setStrokeStyle({ width: 1, color: 0x2ea043, alpha: 0.95 });
        marqueeOverlay.rect(x0, y0, x1 - x0, y1 - y0).stroke();
      };

      const endInteraction = (e: FederatedPointerEvent) => {
        if (panning && host) host.style.cursor = "grab";
        panning = false;
        if (marquee) {
          // Convert marquee screen rect → world rect, collect tokens whose
          // centre falls inside, set as selection.
          const sx0 = Math.min(marquee.startScreen.x, e.global.x);
          const sy0 = Math.min(marquee.startScreen.y, e.global.y);
          const sx1 = Math.max(marquee.startScreen.x, e.global.x);
          const sy1 = Math.max(marquee.startScreen.y, e.global.y);
          const wx0 = (sx0 - world.x) / world.scale.x;
          const wy0 = (sy0 - world.y) / world.scale.y;
          const wx1 = (sx1 - world.x) / world.scale.x;
          const wy1 = (sy1 - world.y) / world.scale.y;
          const next: EntityId[] = [];
          for (const [id, entry] of sprites) {
            const x = entry.sprite.x;
            const y = entry.sprite.y;
            if (x >= wx0 && x <= wx1 && y >= wy0 && y <= wy1) next.push(id);
          }
          marquee = null;
          marqueeOverlay.clear();
          setSelection(next);
          return;
        }
        if (!active) return;
        const dragsToCommit = active.drags;
        active = null;
        const sc = client.world.get(ctx.sceneId, [Scene]) as
          | { Scene: { gridSize: number } }
          | undefined;
        const grid = sc?.Scene.gridSize ?? 70;
        for (const d of dragsToCommit) {
          d.entry.dragging = false;
          d.entry.sprite.cursor = "grab";
          const sx =
            Math.round((d.entry.sprite.x - grid / 2) / grid) * grid + grid / 2;
          const sy =
            Math.round((d.entry.sprite.y - grid / 2) / grid) * grid + grid / 2;
          d.entry.sprite.x = sx;
          d.entry.sprite.y = sy;
          client.dispatch(
            MoveToken({ tokenId: d.id, x: sx, y: sy }) as CommandInstance,
            { causalState: { lastSeenMovedAt: d.lastSeenMovedAt } },
          );
        }
        redrawSelection();
      };
      app.stage.on("pointerup", endInteraction);
      app.stage.on("pointerupoutside", endInteraction);

      const onWheel = (ev: WheelEvent) => {
        ev.preventDefault();
        const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
        const next = clamp(world.scale.x * factor, 0.1, 4);
        const ratio = next / world.scale.x;
        // Zoom toward the cursor: keep the cursor's world position fixed.
        const rect = app.canvas.getBoundingClientRect();
        const cx = ev.clientX - rect.left;
        const cy = ev.clientY - rect.top;
        world.x = cx - (cx - world.x) * ratio;
        world.y = cy - (cy - world.y) * ratio;
        world.scale.set(next);
        // Outline thickness is normalised to screen pixels, so it has
        // to be redrawn at every zoom step.
        redrawSelection();
        saveViewport();
      };
      app.canvas.addEventListener("wheel", onWheel, { passive: false });

      // Suppress middle-button autoscroll (Windows) / paste-to-cursor
      // (Linux X11). Without this preventDefault the OS/browser hijacks
      // the gesture before Pixi sees it.
      const onMouseDown = (ev: MouseEvent) => {
        if (ev.button === 1) ev.preventDefault();
      };
      host.addEventListener("mousedown", onMouseDown);

      // — drag-and-drop from the picker ——————————————————————————
      // The Tokens tab writes a TOKEN_DND_MIME payload; the Characters
      // tab writes a CHARACTER_DND_MIME payload. Both flow into the
      // same drop handler here, which decodes whichever MIME is on
      // the dataTransfer and dispatches the matching command
      // (CreateToken vs PlaceCharacterToken). Listening on the host
      // (not the canvas) so the dataTransfer types check sees the
      // payload — Pixi's canvas is inside the host but doesn't itself
      // receive HTML5 drag events from outside the iframe consistently.
      const onDragOver = (ev: DragEvent) => {
        const types = ev.dataTransfer?.types;
        if (!types) return;
        const list = Array.from(types);
        if (
          !list.includes(TOKEN_DND_MIME) &&
          !list.includes(CHARACTER_DND_MIME)
        ) {
          return;
        }
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
      };
      /**
       * Project the drop's client-coordinate cursor onto the scene
       * grid, snapping to the centre of the cell underneath. Returns
       * `null` if the scene's grid info isn't available.
       */
      const dropTarget = (
        ev: DragEvent,
      ): { x: number; y: number; grid: number } | null => {
        const sc = client.world.get(ctx.sceneId, [Scene]) as
          | { Scene: { gridSize: number } }
          | undefined;
        if (!sc) return null;
        const grid = sc.Scene.gridSize;
        const rect = host!.getBoundingClientRect();
        const screenX = ev.clientX - rect.left;
        const screenY = ev.clientY - rect.top;
        const wx = (screenX - world.x) / world.scale.x;
        const wy = (screenY - world.y) / world.scale.y;
        const x = Math.floor(wx / grid) * grid + grid / 2;
        const y = Math.floor(wy / grid) * grid + grid / 2;
        return { x, y, grid };
      };
      const onDrop = (ev: DragEvent) => {
        if (!ev.dataTransfer) return;
        const charRaw = ev.dataTransfer.getData(CHARACTER_DND_MIME);
        if (charRaw) {
          ev.preventDefault();
          const payload = decodeCharacterDnd(charRaw);
          if (!payload) return;
          const tgt = dropTarget(ev);
          if (!tgt) return;
          client.dispatch(
            PlaceCharacterToken({
              sceneId: ctx.sceneId,
              characterId: payload.characterId,
              iconSlug: payload.iconSlug,
              imageUrl: payload.imageUrl,
              tint: 0xffffff,
              size: tgt.grid,
              label: payload.label,
              x: tgt.x,
              y: tgt.y,
              ownerUserId: payload.ownerUserId,
            }) as CommandInstance,
          );
          return;
        }
        const tokenRaw = ev.dataTransfer.getData(TOKEN_DND_MIME);
        if (tokenRaw) {
          ev.preventDefault();
          const payload = decodeTokenDnd(tokenRaw);
          if (!payload) return;
          const tgt = dropTarget(ev);
          if (!tgt) return;
          client.dispatch(
            CreateToken({
              sceneId: ctx.sceneId,
              iconSlug: payload.slug,
              tint: 0xffffff,
              size: tgt.grid,
              label: payload.label,
              kind: "creature",
              x: tgt.x,
              y: tgt.y,
            }) as CommandInstance,
          );
        }
      };
      host.addEventListener("dragover", onDragOver);
      host.addEventListener("drop", onDrop);

      // — fit & grid redraw, driven by Solid effects ——————————————
      // Each concern is its own effect. drawGrid re-runs when *any*
      // Scene field changes (it touches all of them); fitToViewport
      // re-runs only on dimension/gridSize changes (so renaming or
      // recoloring doesn't yank the user's pan/zoom); the renderer's
      // background.color is updated independently from a third effect
      // so the canvas-clear matches the grid's bg-fill rect even when
      // the camera is zoomed out beyond the grid extent.
      //
      // Viewport persistence: pan + zoom is mutable Pixi state on
      // `world.x/y/scale` and would otherwise be lost any time the
      // canvas remounts (workbench tab switch, hot-module reload,
      // pane focus change in older substrates). We mirror it into
      // sessionStorage keyed by `(worldId, sceneId)` so restoring is
      // free even when something *does* unmount us, and so dock-tab
      // switches or window resizes can't quietly snap the camera.
      const viewportKey = (() => {
        const wid = client.worldId() ?? "default-world";
        return `vtt:scene-viewport:${wid}:${ctx.sceneId}`;
      })();
      const loadSavedViewport = ():
        | { x: number; y: number; scale: number }
        | null => {
        try {
          const raw = sessionStorage.getItem(viewportKey);
          if (!raw) return null;
          const parsed = JSON.parse(raw) as {
            x?: unknown;
            y?: unknown;
            scale?: unknown;
          };
          if (
            typeof parsed.x === "number" &&
            typeof parsed.y === "number" &&
            typeof parsed.scale === "number" &&
            Number.isFinite(parsed.x) &&
            Number.isFinite(parsed.y) &&
            Number.isFinite(parsed.scale) &&
            parsed.scale > 0
          ) {
            return { x: parsed.x, y: parsed.y, scale: parsed.scale };
          }
        } catch {
          /* malformed entry — ignore and fit fresh */
        }
        return null;
      };
      let saveTimer: number | null = null;
      const saveViewport = () => {
        if (saveTimer !== null) return;
        saveTimer = window.setTimeout(() => {
          saveTimer = null;
          try {
            sessionStorage.setItem(
              viewportKey,
              JSON.stringify({
                x: world.x,
                y: world.y,
                scale: world.scale.x,
              }),
            );
          } catch {
            /* quota or disabled — silently drop, viewport just won't
               survive remount */
          }
        }, 150);
      };

      // `fitted` flips true the first time we successfully install
      // *some* viewport — either restored from sessionStorage or
      // freshly auto-fit to the scene extent. The "successfully"
      // qualifier matters: if `sceneTrait()` is still null on the
      // first effect run (trait hasn't replicated from snapshot/
      // catchup yet), we must NOT mark ourselves fitted, or the
      // delayed trait arrival won't trigger the fit.
      let fitted = false;
      const fitToViewport = (): boolean => {
        const s = sceneTrait();
        if (!s) return false;
        const w = s.widthPx;
        const h = s.heightPx;
        const pad = 0.95;
        const sx = app.screen.width / w;
        const sy = app.screen.height / h;
        const scale = clamp(Math.min(sx, sy) * pad, 0.1, 4);
        world.scale.set(scale);
        world.x = (app.screen.width - w * scale) / 2;
        world.y = (app.screen.height - h * scale) / 2;
        fitted = true;
        saveViewport();
        return true;
      };
      /**
       * Try to restore a saved viewport for this scene. Returns true
       * if the viewport was applied — caller skips the auto-fit so we
       * don't yank the user's last pan/zoom.
       */
      const restoreSavedViewport = (): boolean => {
        const saved = loadSavedViewport();
        if (!saved) return false;
        world.scale.set(saved.scale);
        world.x = saved.x;
        world.y = saved.y;
        fitted = true;
        return true;
      };

      const drawBgFill = () => {
        const s = sceneTrait();
        bgFill.clear();
        if (!s) return;
        // Always paint — the image (if any) overlays this fill so any
        // transparent pixels in the image still show the GM's chosen
        // backgroundColor underneath. Without an image, the fill IS the
        // visible background.
        bgFill
          .rect(0, 0, s.widthPx, s.heightPx)
          .fill({ color: parseHexColor(s.backgroundColor) });
      };

      const drawGrid = () => {
        const s = sceneTrait();
        grid.clear();
        if (!s) return;
        // Lines stride by gridSize across the playable extent. Cell
        // counts are derived (no longer stored on the trait) — the
        // last partial cell, if any, gets a final line at exactly
        // widthPx / heightPx so the boundary matches the bg fill and
        // image extent.
        const w = s.widthPx;
        const h = s.heightPx;
        const cols = Math.floor(w / s.gridSize);
        const rows = Math.floor(h / s.gridSize);
        grid.setStrokeStyle({
          width: 1,
          color: parseHexColor(s.gridColor),
          alpha: 1,
        });
        for (let x = 0; x <= cols; x++) {
          const px = Math.min(x * s.gridSize, w);
          grid.moveTo(px, 0).lineTo(px, h);
        }
        if (cols * s.gridSize < w) {
          grid.moveTo(w, 0).lineTo(w, h);
        }
        for (let y = 0; y <= rows; y++) {
          const py = Math.min(y * s.gridSize, h);
          grid.moveTo(0, py).lineTo(w, py);
        }
        if (rows * s.gridSize < h) {
          grid.moveTo(0, h).lineTo(w, h);
        }
        grid.stroke();
      };

      runWithOwner(owner, () => {
        // Renderer clear color → bgColor memo. Memo emits only when
        // the hex string actually changes (===), so unrelated mutations
        // don't re-set Pixi's color.
        createEffect(() => {
          const bg = bgColor();
          if (bg === undefined) return;
          app.renderer.background.color = parseHexColor(bg);
        });
        // Background fill rect (solid color at scene extent) and grid
        // lines. Two effects so each redraws independently — both are
        // cheap and bgFill changes only with bgColor or dims.
        createEffect(() => {
          bgColor();
          dimsKey();
          drawBgFill();
        });
        createEffect(() => {
          dimsKey();
          drawGrid();
        });
        // Viewport setup → install the camera once per mount, the
        // first time the scene trait is actually available. We prefer
        // a previously persisted viewport (sessionStorage, keyed by
        // world+scene) so dock-tab switches, pane focus changes, and
        // HMR reloads all preserve where the user was looking;
        // falling through to fitToViewport gives a sensible default
        // for a brand-new scene with no saved viewport.
        //
        // Tracked deps include `dimsKey()` so this effect re-runs
        // when the trait first loads — `dimsKey` returns "" while
        // sceneTrait() is null and switches to "WxH@G" once the
        // snapshot/catchup applies. We bail out early on the empty
        // string so we don't mark ourselves fitted prematurely.
        // Once fitted, subsequent dim changes (a GM resizing the
        // scene mid-session) deliberately don't refit — the user may
        // have framed a specific area and a forced refit would yank
        // it away.
        createEffect(() => {
          if (fitted) return;
          if (dimsKey() === "") return;
          if (restoreSavedViewport()) return;
          fitToViewport();
        });
        // Background image → load Pixi texture from the URL when set,
        // size the sprite to the scene extent, hide when null. Pixi's
        // Assets cache dedups repeat loads of the same URL — including
        // the cache-bust suffix the upload endpoint stamps so a
        // replaced image actually re-downloads.
        createEffect(() => {
          const url = bgImageUrl();
          const s = sceneTrait();
          if (!url || !s) {
            bgImage.visible = false;
            bgImage.texture = Texture.EMPTY;
            return;
          }
          const w = s.widthPx;
          const h = s.heightPx;
          // Size first so the sprite has the right footprint even
          // before the texture resolves (avoids a one-frame flash at
          // the wrong scale).
          bgImage.width = w;
          bgImage.height = h;
          bgImage.x = 0;
          bgImage.y = 0;
          let cancelled = false;
          Assets.load<Texture>(url)
            .then((tex) => {
              if (cancelled) return;
              bgImage.texture = tex;
              bgImage.width = w;
              bgImage.height = h;
              bgImage.visible = true;
            })
            .catch((err) => {
              if (cancelled) return;
              bgImage.visible = false;
              console.warn(`failed to load scene background ${url}`, err);
            });
          onCleanup(() => {
            cancelled = true;
          });
        });
      });

      // Resize the renderer if the host's CSS box changes (window
      // resize, panel reflow such as a dock open/close). Pixi's
      // `resizeTo` plugin only listens for the window `resize` event,
      // so a container reflow (dice-tray drawer expanding, scene
      // dock toggling) doesn't update `app.screen` on its own —
      // without `app.resize()` here the canvas DOM element shrinks
      // via CSS while the WebGL framebuffer stays its old size, and
      // the rendered image gets stretched/squashed.
      //
      // We deliberately do NOT call `fitToViewport()` here. The old
      // behaviour was "refit on every resize after the initial fit,"
      // which meant opening the dock or switching to a Characters
      // tab quietly snapped the camera back to default — losing the
      // user's pan/zoom on every workbench interaction. Rendering
      // adapts to the new screen extent automatically; the camera
      // (world.x/y/scale) is the user's, not the layout's, to set.
      const ro = new ResizeObserver(() => {
        app.resize();
      });
      ro.observe(host);

      // — token sprites synced from World ——————————————————————
      // `Entry` augmented with an `underlayContainer` (kept beneath the
      // sprite so game-system decorators draw underneath) plus the
      // cleanup callbacks each decorator returned at mount. Sprite x/y
      // is mirrored onto the container every time `syncEntry` runs.
      type TokenEntry = Entry & {
        underlayContainer: Container;
        underlayCleanups: Array<() => void>;
        imageUrl: string | null;
      };
      const sprites = new Map<EntityId, TokenEntry>();

      // Underlay decorators registered by other plugins (e.g. system-simple's
      // HP bar). Materialised once per canvas mount; the slot's contents
      // are stable for the runtime's lifetime.
      const underlays = (client.registry.fillsForSlot(
        TokenUnderlaysSlot,
      ) as TokenUnderlay[])
        .slice()
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

      const ensureSprite = (id: EntityId): void => {
        const got = client.world.get(id, [Sprite, Position, Token]) as
          | {
              Sprite: { iconSlug: string; tint: number; size: number };
              Position: { sceneId: string; x: number; y: number; movedAt: number };
              Token: { kind: string };
            }
          | undefined;
        if (!got) return;
        // Scope: this canvas only renders tokens that belong to its
        // own scene. Position.sceneId is set at CreateToken time and
        // doesn't currently change, but if a future command moves a
        // token between scenes the `sprites.has(id)` branch handles
        // that — the sprite is removed from this canvas the first
        // time we see Position.sceneId no longer match.
        if (got.Position.sceneId !== ctx.sceneId) {
          if (sprites.has(id)) removeSprite(id);
          return;
        }
        // The optional TokenImage trait overrides the iconSlug for
        // characters placed via `PlaceCharacterToken`. Read separately
        // so the inner `world.get([Sprite, Position, Token])` doesn't
        // narrow to undefined when an unrelated token lacks it.
        const tokenImage = client.world.get(id, [TokenImage]) as
          | { TokenImage: { url: string } }
          | undefined;
        const imageUrl = tokenImage?.TokenImage.url ?? null;

        const existing = sprites.get(id);
        if (existing) {
          syncEntry(existing, id, got, imageUrl);
          return;
        }
        // Spawn the sprite synchronously with a placeholder texture so the
        // entity is visible immediately, even if SVG rasterisation is slow
        // or fails. The placeholder is a tinted white square that gets
        // replaced when the real texture resolves.
        const sprite = new PixiSprite(Texture.WHITE);
        sprite.anchor.set(0.5);
        sprite.eventMode = "static";
        sprite.cursor = "grab";

        // Underlay container — added to the token layer BEFORE the
        // sprite so it z-orders underneath. The container's local
        // origin tracks the sprite's centre; decorators draw in
        // container-local coords.
        const underlayContainer = new Container();
        underlayContainer.eventMode = "none";
        tokenLayer.addChild(underlayContainer);

        const entry: TokenEntry = {
          sprite,
          slug: got.Sprite.iconSlug,
          size: got.Sprite.size,
          tint: got.Sprite.tint,
          movedAt: got.Position.movedAt,
          dragging: false,
          underlayContainer,
          underlayCleanups: [],
          imageUrl,
        };
        sprite.on("pointerdown", (e: FederatedPointerEvent) => {
          // Let middle-button bubble to the stage so force-pan works
          // even when the cursor starts over a token. Right-button is
          // reserved for future context menus and also bubbles.
          if (e.button !== 0) return;
          e.stopPropagation();
          if (e.shiftKey) {
            // Shift-click: toggle membership, no drag.
            toggleSelection(id);
            return;
          }
          // Plain click: if not in selection, replace with just this
          // sprite. If already selected, leave selection intact so the
          // upcoming drag moves the whole group.
          if (!selected.has(id)) setSelection([id]);
          beginDrag(id, e.global.x, e.global.y);
        });
        sprites.set(id, entry);
        tokenLayer.addChild(sprite);
        syncEntry(entry, id, got, imageUrl);
        // Mount the underlay decorators once per token. They own their
        // own world.subscribe lifetime and return cleanups we invoke
        // when the token despawns.
        for (const u of underlays) {
          try {
            const off = u.mount({
              tokenId: id,
              container: underlayContainer,
              world: client.world,
              initialSize: entry.size,
            });
            entry.underlayCleanups.push(off);
          } catch (err) {
            console.warn(`token underlay ${u.id} mount failed`, err);
          }
        }
        // Kick off the texture load now; swap in when it lands. When
        // a TokenImage is present, prefer it over the iconSlug.
        loadTokenTexture(imageUrl, got.Sprite.iconSlug)
          .then((tex) => {
            if (sprites.get(id) !== entry) return;
            entry.sprite.texture = tex;
            entry.sprite.width = entry.size;
            entry.sprite.height = entry.size;
          })
          .catch((err) => {
            console.warn(
              `failed to load token texture (image=${imageUrl ?? "—"} slug=${got.Sprite.iconSlug})`,
              err,
            );
          });
      };

      const syncEntry = (
        entry: TokenEntry,
        id: EntityId,
        got: {
          Sprite: { iconSlug: string; tint: number; size: number };
          Position: { x: number; y: number; movedAt: number };
        },
        imageUrl: string | null,
      ): void => {
        const textureKeyChanged =
          got.Sprite.iconSlug !== entry.slug || imageUrl !== entry.imageUrl;
        if (textureKeyChanged) {
          // Texture identity changed (slug edit, or TokenImage attached/
          // replaced/cleared). Swap texture asynchronously; entity
          // identity preserved so the underlay container survives.
          entry.slug = got.Sprite.iconSlug;
          entry.imageUrl = imageUrl;
          loadTokenTexture(imageUrl, got.Sprite.iconSlug)
            .then((tex) => {
              if (sprites.get(id) === entry) entry.sprite.texture = tex;
            })
            .catch((err) => {
              console.warn(`failed to swap token texture for ${id}`, err);
            });
        }
        entry.sprite.tint = got.Sprite.tint;
        entry.size = got.Sprite.size;
        entry.sprite.width = got.Sprite.size;
        entry.sprite.height = got.Sprite.size;
        if (!entry.dragging) {
          entry.sprite.x = got.Position.x;
          entry.sprite.y = got.Position.y;
        }
        // Mirror the sprite's centre onto the underlay container so
        // decorators using container-local coords stay glued to the
        // token through movement, drag, and zoom.
        entry.underlayContainer.x = entry.sprite.x;
        entry.underlayContainer.y = entry.sprite.y;
        entry.movedAt = got.Position.movedAt;
      };

      const removeSprite = (id: EntityId) => {
        const entry = sprites.get(id);
        if (!entry) return;
        if (active) {
          active.drags = active.drags.filter((d) => d.id !== id);
          if (active.drags.length === 0) active = null;
        }
        if (selected.has(id)) {
          selected.delete(id);
          redrawSelection();
        }
        sprites.delete(id);
        // Run each decorator's cleanup before destroying its container
        // — decorators may be holding world.subscribe handles.
        for (const off of entry.underlayCleanups) {
          try {
            off();
          } catch (err) {
            console.warn("underlay cleanup failed", err);
          }
        }
        tokenLayer.removeChild(entry.sprite);
        tokenLayer.removeChild(entry.underlayContainer);
        entry.sprite.destroy();
        entry.underlayContainer.destroy({ children: true });
      };

      // initial sweep + subscription. Subscribe to TokenImage as well
      // so the canvas re-syncs the texture when the GM uploads or
      // replaces a character portrait.
      const seedQuery = client.world.query([Sprite, Position, Token]);
      for (const row of seedQuery) ensureSprite(row.id);
      const offWorld = client.world.subscribe((id, name) => {
        if (
          name !== Sprite.name &&
          name !== Position.name &&
          name !== Token.name &&
          name !== TokenImage.name
        ) {
          return;
        }
        if (!client.world.has(id)) {
          removeSprite(id);
          return;
        }
        ensureSprite(id);
        // Position updates from the server can move a selected token; the
        // outline lives in world coords keyed off sprite.x/y, so we have
        // to redraw whenever a tracked sprite changes.
        if (selected.has(id)) redrawSelection();
      });

      // — keyboard: delete selection ——————————————————————————————
      // RemoveToken is GM-only. Gating on role here avoids surprise
      // failed acks for players. Skipped while the user is typing in
      // a normal input/textarea so chat backspace doesn't nuke tokens.
      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key !== "Delete" && ev.key !== "Backspace") return;
        if (selected.size === 0) return;
        const t = ev.target as HTMLElement | null;
        if (t) {
          const tag = t.tagName;
          if (
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            t.isContentEditable
          ) {
            return;
          }
        }
        if (me()?.role !== "gm") return;
        ev.preventDefault();
        const ids = [...selected];
        clearSelection();
        for (const id of ids) {
          client.dispatch(RemoveToken({ tokenId: id }) as CommandInstance);
        }
      };
      window.addEventListener("keydown", onKeyDown);

      runWithOwner(owner, () => {
        onCleanup(() => {
          ro.disconnect();
          offWorld();
          if (saveTimer !== null) {
            window.clearTimeout(saveTimer);
            saveTimer = null;
            // Flush a final write so the very last viewport edit
            // before unmount survives.
            try {
              sessionStorage.setItem(
                viewportKey,
                JSON.stringify({
                  x: world.x,
                  y: world.y,
                  scale: world.scale.x,
                }),
              );
            } catch {
              /* see saveViewport() */
            }
          }
          app.canvas.removeEventListener("wheel", onWheel);
          host?.removeEventListener("mousedown", onMouseDown);
          host?.removeEventListener("dragover", onDragOver);
          host?.removeEventListener("drop", onDrop);
          window.removeEventListener("keydown", onKeyDown);
          for (const [, e] of sprites) {
            for (const off of e.underlayCleanups) {
              try {
                off();
              } catch (err) {
                console.warn("underlay cleanup failed", err);
              }
            }
            e.sprite.destroy();
            e.underlayContainer.destroy({ children: true });
          }
          sprites.clear();
          // `releaseGlobalResources: true` drains Pixi's process-wide
          // pools (batches, texture caches). Without it, Solid HMR
          // remounts leak stale pooled state into the new Application,
          // causing flickering or stale-texture artifacts on the next
          // mount.
          app.destroy(
            { removeView: true, releaseGlobalResources: true },
            { children: true },
          );
        });
      });
    });

    return (
      <Show
        when={sceneTrait()}
        fallback={
          <div class="flex h-full items-center justify-center text-fg-muted text-sm">
            no scene yet
          </div>
        }
      >
        <div
          ref={(el) => {
            host = el;
          }}
          class="relative h-full w-full cursor-grab overflow-hidden bg-surface-sunken"
          // Disable native context menu so right-click can be repurposed
          // for ruler / measure tools later without surprise.
          oncontextmenu={(e: Event) => e.preventDefault()}
        />
      </Show>
    );
  }),
});

// — module-local helpers ———————————————————————————————————————

const textureCache = new Map<string, Promise<Texture>>();
function loadIcon(slug: string): Promise<Texture> {
  let p = textureCache.get(slug);
  if (p) return p;
  p = Assets.load<Texture>(`/icons/${slug}.svg`);
  textureCache.set(slug, p);
  return p;
}

/**
 * Load whichever texture should back a token. When `imageUrl` is set
 * (e.g. from a `TokenImage` trait attached by `PlaceCharacterToken`),
 * load that — it points at `/plugin-data/<worldId>/...` and Pixi's
 * Assets cache dedups repeats of the same URL including its
 * `?v=<bytes>` cache-bust suffix. Otherwise fall back to the icon
 * manifest.
 */
function loadTokenTexture(
  imageUrl: string | null,
  iconSlug: string,
): Promise<Texture> {
  if (imageUrl !== null) {
    const cached = textureCache.get(imageUrl);
    if (cached) return cached;
    const p = Assets.load<Texture>(imageUrl);
    textureCache.set(imageUrl, p);
    return p;
  }
  return loadIcon(iconSlug);
}

/**
 * `#RRGGBB` → 0xRRGGBB. Used both for sprite tints and the renderer
 * background. Falls back to the historical default (`0x1a1a1a`) when
 * the field is missing or malformed — better to render than to crash
 * if a bad value sneaks in.
 */
function parseHexColor(hex: string | undefined | null): number {
  if (!hex) return 0x1a1a1a;
  const n = parseInt(hex.replace("#", ""), 16);
  return Number.isFinite(n) ? n : 0x1a1a1a;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
