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

import { qualifiedName, type CommandInstance, type EntityId } from "@vtt/substrate";
import { useClient, useTrait } from "@vtt/substrate/client";
import { uploadAssetForWorld } from "@vtt/assets/client";
import { createEffect, createSignal, Show, type JSX } from "solid-js";
import { Scene } from "../shared/traits.js";
import { resolveSceneBackgroundUrl } from "../shared/background.js";
import { UpdateScene } from "../shared/commands.js";
import { type SceneOverlayTab, type SceneOverlayTabRenderArgs } from "../shared/slot.js";
import { useMe } from "./use-me.js";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Config dock tab. Rename + resize + recolor the active scene. Each
 * field auto-saves on blur (or, for the color picker, on input — so
 * the canvas updates live as you scrub through colors).
 *
 * Reactive sync: every field uses a local signal for the input's
 * displayed value (so typing is responsive) AND a `createEffect` that
 * tracks the prop and re-seeds the local when the trait changes from
 * elsewhere — multi-device sync, another GM tab, an undo. The "editing"
 * flag prevents the prop sync from clobbering the user's in-progress
 * edit.
 *
 * Players see a read-only view (UpdateScene is GM-only on the server,
 * so the inputs are disabled — a non-GM dispatch would be rejected).
 */
export const ConfigOverlayTab: SceneOverlayTab = {
  id: qualifiedName("@vtt/scene/dock-config"),
  label: "Config",
  icon: "⚙",
  priority: 100,
  render: (args: SceneOverlayTabRenderArgs): JSX.Element => {
    return <ConfigTabBody sceneId={args.sceneId} />;
  },
};

function ConfigTabBody(props: { sceneId: string }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const isGm = () => me()?.role === "gm";
  const scene = useTrait(props.sceneId, Scene);

  const update = (
    patch: Partial<{
      name: string;
      gridSize: number;
      widthPx: number;
      heightPx: number;
      backgroundColor: string;
      gridColor: string;
      backgroundAssetId: EntityId | null;
      backgroundImage: string | null;
    }>,
  ) => {
    client.dispatch(
      UpdateScene({
        sceneId: props.sceneId,
        ...patch,
      }) as CommandInstance,
    );
  };

  return (
    <Show when={scene()} fallback={<div class="text-xs text-fg-subtle">no scene loaded</div>}>
      {(s) => (
        <div class="flex h-full flex-col gap-5 overflow-y-auto">
          <Section label="Name">
            <NameField value={s().name} disabled={!isGm()} onCommit={(name) => update({ name })} />
          </Section>

          <div class="grid gap-5 sm:grid-cols-3">
            <Section label="Grid">
              <NumberField
                value={s().gridSize}
                min={1}
                max={512}
                disabled={!isGm()}
                onCommit={(gridSize) => update({ gridSize })}
                suffix="px / cell"
              />
            </Section>
            <Section label="Width">
              <NumberField
                value={s().widthPx}
                min={1}
                max={16384}
                disabled={!isGm()}
                onCommit={(widthPx) => update({ widthPx })}
                suffix="px"
              />
            </Section>
            <Section label="Height">
              <NumberField
                value={s().heightPx}
                min={1}
                max={16384}
                disabled={!isGm()}
                onCommit={(heightPx) => update({ heightPx })}
                suffix="px"
              />
            </Section>
          </div>
          {/* Derived cell count — read-only hint so the GM can sanity-check
              that gridSize divides cleanly into the playable extent. */}
          <p class="-mt-3 text-[0.7rem] text-fg-subtle">
            ≈ {Math.floor(s().widthPx / s().gridSize)} × {Math.floor(s().heightPx / s().gridSize)}{" "}
            cells
            <Show when={s().widthPx % s().gridSize !== 0 || s().heightPx % s().gridSize !== 0}>
              {" "}
              (last column/row is partial)
            </Show>
          </p>

          <div class="grid gap-5 sm:grid-cols-2">
            <Section label="Background">
              <ColorField
                value={s().backgroundColor}
                disabled={!isGm()}
                onChange={(backgroundColor) => update({ backgroundColor })}
              />
            </Section>
            <Section label="Grid lines">
              <ColorField
                value={s().gridColor}
                disabled={!isGm()}
                onChange={(gridColor) => update({ gridColor })}
              />
            </Section>
          </div>

          <Section label="Background image">
            <BackgroundImageField
              sceneId={props.sceneId}
              worldId={client.worldId() ?? ""}
              value={resolveSceneBackgroundUrl(s(), client.worldId())}
              disabled={!isGm() || !client.worldId()}
              onUpload={(backgroundAssetId, dims) =>
                update({
                  // Asset-first write — clear the legacy URL in the same
                  // dispatch so the trait can't end up with both shapes.
                  backgroundAssetId: backgroundAssetId as EntityId,
                  backgroundImage: null,
                  // Auto-fit the playable extent to the uploaded image so
                  // the canvas surface = image surface by default. The
                  // GM can still override Width/Height afterwards.
                  widthPx: dims.width,
                  heightPx: dims.height,
                })
              }
              onClear={() => update({ backgroundAssetId: null, backgroundImage: null })}
            />
          </Section>
        </div>
      )}
    </Show>
  );
}

/**
 * Upload + preview + clear for the scene's background image. Uses the
 * per-world asset upload route (`/api/worlds/<wid>/assets/upload`), so
 * the bytes are content-addressed, deduped, and reachable from the
 * unified asset library — the bundle exporter picks them up
 * automatically. The returned assetId is dispatched as
 * `UpdateScene.backgroundAssetId`.
 *
 * GM-only — the upload endpoint enforces world membership server-side;
 * the inputs are also disabled here so non-GMs see the current image
 * without attempting a doomed write.
 */
function BackgroundImageField(props: {
  sceneId: string;
  worldId: string;
  value: string | null;
  disabled: boolean;
  /**
   * Called after a successful upload. Receives the new asset id plus
   * the image's natural pixel dimensions, so the parent can dispatch
   * UpdateScene with both `backgroundAssetId` AND `widthPx`/`heightPx`
   * in one shot — the playable extent auto-fits the image by default.
   */
  onUpload: (assetId: string, dims: { width: number; height: number }) => void;
  onClear: () => void;
}): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let fileInput: HTMLInputElement | undefined;

  const upload = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      // Read the image's natural dimensions in parallel with the
      // upload — same File object, no extra network round-trip. We
      // need width/height anyway to size the playable extent, and the
      // browser is already going to decode this image to render the
      // preview, so the extra cost is negligible.
      const dimsPromise = readImageDimensions(file);
      const result = await uploadAssetForWorld(props.worldId, file);
      const dims = await dimsPromise;
      props.onUpload(result.assetId, dims);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileInput) fileInput.value = "";
    }
  };

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-start gap-3">
        {/* Preview thumb. Renders directly from the public URL — same
            path the canvas loads, so what the GM sees here is what
            actually paints behind the grid. */}
        <div
          class="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-(--radius-control) border border-border bg-surface"
          aria-label="current background image preview"
        >
          <Show
            when={props.value}
            fallback={
              <span class="font-display text-[0.55rem] uppercase tracking-[0.18em] text-fg-subtle">
                no image
              </span>
            }
          >
            {(url) => (
              <img
                src={url()}
                alt="scene background"
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
            PNG, JPG, GIF, WebP, AVIF, or SVG. Max 250 MB. Width/Height auto-fit to the image's
            natural size on upload — adjust them below if you want a different playable extent.
            Transparent regions show the background color underneath.
          </p>
          <Show when={error()}>
            <p class="rounded-(--radius-control) border border-danger/40 bg-danger/10 px-2 py-1 text-[0.7rem] text-danger">
              {error()}
            </p>
          </Show>
        </div>
      </div>
      {/* Hidden native input — triggered by the Upload button. */}
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

/**
 * Read the natural pixel dimensions of an image File without uploading
 * it, by decoding into an off-DOM <img>. Uses a blob URL so the browser
 * decodes from RAM instead of the network — fast even for huge files.
 * The blob URL is revoked once decode resolves so we don't leak memory.
 *
 * SVG files have no meaningful "natural" pixel size (they're vector);
 * the browser falls back to the SVG's declared width/height attributes
 * or to 300×150 if neither is set. Acceptable as a default — the GM
 * can override Width/Height afterward.
 */
async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Section(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <label class="flex flex-col gap-2">
      <span class="font-display text-[0.6rem] uppercase tracking-[0.2em] text-fg-subtle">
        {props.label}
      </span>
      {props.children}
    </label>
  );
}

/**
 * Two-way bound text field with auto-commit on blur.
 *
 * Reactive flow:
 *   - `local` signal — the input's displayed value.
 *   - `createEffect` — tracks `props.value` (the trait, the authoritative
 *     source) and resyncs `local` when it changes from elsewhere
 *     (multi-device, another GM tab). Skipped while `editing()` so the
 *     user's in-progress text isn't clobbered. This is one of the
 *     documented exceptions to "don't write signals from effects" —
 *     synchronizing an external mutable source into a local signal.
 *   - `lastDispatched` — a plain (non-tracked) variable holding the
 *     value we just committed. While set, the effect doesn't push the
 *     prop into local — eliminates the brief commit-time flash where
 *     local would otherwise revert to the old prop during the
 *     ~50-100ms server round-trip. Cleared once props catches up.
 */
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

function NumberField(props: {
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onCommit: (next: number) => void;
  suffix?: string;
}): JSX.Element {
  const [local, setLocal] = createSignal(String(props.value));
  const [editing, setEditing] = createSignal(false);
  let lastDispatched: number | null = null;

  createEffect(() => {
    const next = props.value;
    if (editing()) return;
    if (lastDispatched !== null) {
      if (next === lastDispatched) lastDispatched = null;
      return;
    }
    setLocal(String(next));
  });

  const commit = () => {
    const n = Number.parseInt(local(), 10);
    if (Number.isNaN(n) || !Number.isInteger(n) || n < props.min || n > props.max) {
      setLocal(String(props.value));
      setEditing(false);
      return;
    }
    if (n === props.value) {
      setEditing(false);
      return;
    }
    lastDispatched = n;
    props.onCommit(n);
    setEditing(false);
  };

  return (
    <div class="flex items-center gap-2">
      <input
        type="number"
        inputmode="numeric"
        min={props.min}
        max={props.max}
        value={local()}
        disabled={props.disabled}
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
            setLocal(String(props.value));
            setEditing(false);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        class="w-24 rounded-(--radius-control) border border-border bg-surface px-3 py-2 font-mono text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
      />
      <Show when={props.suffix}>
        <span class="text-xs text-fg-subtle">{props.suffix}</span>
      </Show>
    </div>
  );
}

/**
 * Color picker + hex text input. The picker fires on input so the
 * canvas updates live as the user scrubs through colors; the text
 * input commits on blur (or Enter) like the other fields.
 *
 * Same `lastDispatched` trick as the other fields: each picker tick
 * sets it to the dispatched value, so the prop-sync effect waits for
 * the server to confirm before letting external updates re-take.
 */
function ColorField(props: {
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
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

  const onPick = (next: string) => {
    setLocal(next);
    if (next !== props.value && HEX_RE.test(next)) {
      lastDispatched = next;
      props.onChange(next);
    }
  };

  const commitHex = () => {
    const next = local().trim();
    if (!HEX_RE.test(next)) {
      setLocal(props.value);
      setEditing(false);
      return;
    }
    if (next === props.value) {
      setEditing(false);
      return;
    }
    lastDispatched = next;
    props.onChange(next);
    setEditing(false);
  };

  return (
    <div class="flex items-center gap-3">
      <input
        type="color"
        value={local()}
        disabled={props.disabled}
        onInput={(e) => onPick(e.currentTarget.value)}
        class="h-9 w-12 cursor-pointer rounded-(--radius-control) border border-border bg-surface disabled:cursor-not-allowed disabled:opacity-60"
      />
      <input
        type="text"
        value={local()}
        maxLength={7}
        disabled={props.disabled}
        autocomplete="off"
        spellcheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
        data-bwignore="true"
        onFocus={() => setEditing(true)}
        onInput={(e) => setLocal(e.currentTarget.value)}
        onBlur={commitHex}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitHex();
            (e.currentTarget as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setLocal(props.value);
            setEditing(false);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        class="w-28 rounded-(--radius-control) border border-border bg-surface px-3 py-2 font-mono text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
      />
      <span
        aria-hidden
        class="h-9 w-9 rounded-(--radius-control) border border-border-muted"
        style={{ "background-color": local() }}
      />
    </div>
  );
}
