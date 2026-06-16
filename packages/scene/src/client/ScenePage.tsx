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
import { Surface, useClient, useQuery } from "@vtt/substrate/client";
import { definePageProvider, RetargetTab } from "@vtt/shell-workbench/shared";
import { createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js";
import { Scene } from "../shared/index.js";
import { CreateScene, RemoveScene } from "../shared/commands.js";
import { SceneCreated } from "../shared/events.js";
import { SceneCanvasSurface } from "../shared/surfaces.js";
import { SceneDock } from "./SceneDock.js";
import { useMe } from "./use-me.js";

const SCENES_KIND = "@vtt/scene/scenes";

/**
 * The Scenes PageProvider. Each Scene entity becomes one selectable Page;
 * `render()` mounts the canvas full-bleed inside the workbench's pane,
 * with a collapsible bottom dock for Tokens / Config / future plugin
 * tabs. The dock is the new "options panel" — the old right-rail
 * toolbar layout is gone.
 *
 * Empty-entity branch (`entityId === null`): show the GM a small create
 * form (name input + submit). After CreateScene fires, the form
 * retargets its own tab to the freshly-spawned Scene so the user lands
 * directly on the new map without leaving an empty tab behind.
 */
export const ScenesPageProvider = definePageProvider({
  kind: SCENES_KIND,
  icon: "map",
  label: "Scenes",
  // Both `list` and `defaultEntity` query the Scene trait — the
  // workbench subscribes to changes on it so tab labels, the picker
  // dropdown, and the palette all relabel when a scene is renamed.
  reads: [Scene],
  list: ({ world }) => {
    return world.query([Scene]).map((row) => {
      const sc = row.values.Scene as { name: string };
      return {
        id: row.id,
        label: sc.name,
      };
    });
  },
  defaultEntity: ({ world }) => {
    const first = world.query([Scene])[0];
    return first?.id ?? null;
  },
  render: ({ tabId, entityId }) => {
    return <ScenePage tabId={tabId} entityId={entityId} />;
  },
});

function ScenePage(props: { tabId: string; entityId: string | null }): JSX.Element {
  return (
    <Show
      when={props.entityId}
      fallback={
        <section class="flex h-full flex-col gap-3 px-5 py-4">
          <EmptyState tabId={props.tabId} />
        </section>
      }
    >
      {(idAcc) => <SceneBody sceneId={idAcc()} tabId={props.tabId} />}
    </Show>
  );
}

function SceneBody(props: { sceneId: string; tabId: string }): JSX.Element {
  // Layout: canvas takes the entire available height minus the dock.
  // No inner header — the workbench's tab strip already shows the
  // scene name. The Pixi canvas's `resizeTo: host` adapts to the
  // remainder when the dock opens or closes.
  //
  // We pass `sceneId` in the Surface context so SceneCanvasView binds
  // to *this tab's* scene rather than always defaulting to the first
  // Scene in the world.
  return (
    <section class="flex h-full min-h-0 flex-col">
      <div class="relative min-h-0 flex-1 overflow-hidden">
        <Surface name={SceneCanvasSurface.name} context={{ sceneId: props.sceneId }} />
      </div>
      <SceneDock sceneId={props.sceneId} tabId={props.tabId} />
    </section>
  );
}

/**
 * Scene-management hub shown when the tab has no entityId. Lists every
 * existing scene with Open + (GM-only) Remove controls, plus the
 * GM-only create form below. Players land here when they close all
 * scene tabs and open a fresh one — they can pick from existing scenes
 * but not create or delete.
 *
 * Empty world (no scenes yet): GMs see just the create form with the
 * historical "No scene yet — drop a fresh map" headline; players see
 * the "waiting for the GM" message.
 */
function EmptyState(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const isGm = () => me()?.role === "gm";
  const sceneRows = useQuery([Scene]);
  const scenes = createMemo(() =>
    sceneRows()
      .map((row) => ({
        id: row.id,
        name: (row.values.Scene as { name: string }).name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  const open = (sceneId: string) => {
    client.dispatch(
      RetargetTab({
        tabId: props.tabId,
        pageKind: SCENES_KIND,
        entityId: sceneId,
      }) as CommandInstance,
    );
  };

  const remove = (sceneId: string, name: string) => {
    if (!window.confirm(`Remove "${name}"? Every token on this scene will also be removed.`)) {
      return;
    }
    client.dispatch(RemoveScene({ sceneId }) as CommandInstance);
  };

  return (
    <div class="flex h-full items-start justify-center overflow-y-auto py-10">
      <div class="flex w-full max-w-lg flex-col gap-6">
        <Show
          when={scenes().length > 0}
          fallback={
            <div class="flex flex-col items-center gap-5 text-center">
              <p
                class="font-display text-2xl tracking-tight text-fg-muted"
                style={{ "font-family": "var(--font-display)" }}
              >
                <Show when={isGm()} fallback="No scene yet">
                  No scene yet — drop a fresh map.
                </Show>
              </p>
              <Show
                when={isGm()}
                fallback={
                  <p class="text-xs text-fg-subtle">waiting for the GM to set up the scene…</p>
                }
              >
                <CreateSceneForm tabId={props.tabId} />
              </Show>
            </div>
          }
        >
          <header class="flex items-baseline justify-between">
            <h2
              class="font-display text-xl tracking-tight text-fg"
              style={{ "font-family": "var(--font-display)" }}
            >
              Scenes
            </h2>
            <span class="font-display text-[0.62rem] uppercase tracking-[0.16em] text-fg-subtle">
              {scenes().length} total
            </span>
          </header>
          <ul class="flex flex-col gap-1">
            <For each={scenes()}>
              {(s) => (
                <li class="group flex items-center gap-3 rounded-(--radius-control) border border-border-muted bg-surface-elevated px-3 py-2">
                  <button
                    type="button"
                    onClick={() => open(s.id)}
                    class="flex-1 truncate text-left text-sm text-fg hover:text-accent transition"
                    title="Open this scene in the current tab"
                  >
                    {s.name}
                  </button>
                  <span class="font-mono text-[0.6rem] text-fg-subtle">{s.id}</span>
                  <button
                    type="button"
                    onClick={() => open(s.id)}
                    class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition"
                  >
                    Open
                  </button>
                  <Show when={isGm()}>
                    <button
                      type="button"
                      onClick={() => remove(s.id, s.name)}
                      class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-[0.65rem] text-fg-subtle hover:border-danger hover:text-danger transition"
                      title={`Remove "${s.name}" and its tokens`}
                    >
                      Remove
                    </button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <Show when={isGm()}>
            <div class="mt-2 flex flex-col gap-3 border-t border-border-muted pt-5">
              <h3 class="font-display text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle">
                Create new scene
              </h3>
              <CreateSceneForm tabId={props.tabId} />
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

/**
 * Inline create form. Subscribes to SceneCreated once before dispatch,
 * captures the existing Scene-entity ids, and on the first matching
 * event diffs the world's Scene query to identify the new entity. Then
 * dispatches RetargetTab so this same tab points at the fresh scene.
 */
function CreateSceneForm(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let inputEl: HTMLInputElement | undefined;

  onMount(() => {
    inputEl?.focus();
  });

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (busy()) return;
    const trimmed = name().trim() || "untitled scene";
    setError(null);
    setBusy(true);

    const beforeIds = new Set(client.world.query([Scene]).map((r) => r.id));

    const off = client.bus.on(SceneCreated.name, () => {
      off();
      const fresh = client.world.query([Scene]).find((r) => !beforeIds.has(r.id));
      if (fresh) {
        client.dispatch(
          RetargetTab({
            tabId: props.tabId,
            pageKind: SCENES_KIND,
            entityId: fresh.id,
          }) as CommandInstance,
        );
      }
      setName("");
      setBusy(false);
    });

    const handle = client.dispatch(
      CreateScene({
        name: trimmed,
        gridSize: 70,
        widthPx: 2100,
        heightPx: 1400,
        backgroundColor: "#1a1a1a",
      }) as CommandInstance,
    );
    // The bus subscription only fires on the success path. If the
    // server nacks (validation, unknown command, disconnect)
    // SceneCreated never arrives — clear busy and surface the reason.
    void handle.ack.then((ack) => {
      if (!ack.ok) {
        off();
        setBusy(false);
        setError(ack.reason ?? "create failed");
      }
    });
  };

  return (
    <form
      onSubmit={submit}
      class="flex w-full flex-col gap-3"
      autocomplete="off"
      data-form-type="other"
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
    >
      <label class="flex flex-col gap-1 text-left">
        <span class="font-display text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle">
          Name
        </span>
        <input
          ref={inputEl}
          type="text"
          name="scene-name"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          placeholder="e.g. Tomb of the Forgotten Gods"
          maxLength={120}
          autocomplete="off"
          spellcheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 font-display text-base text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
      </label>
      <button
        type="submit"
        disabled={busy()}
        class="rounded-(--radius-control) bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover transition disabled:opacity-50"
      >
        {busy() ? "Creating…" : "Create scene"}
      </button>
      <Show when={error()}>
        <p class="rounded-(--radius-control) border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">
          {error()}
        </p>
      </Show>
    </form>
  );
}
