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
  createSignal,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import {
  useClient,
  useTrait,
} from "@vtt/substrate/client";
import { type CommandInstance, type EntityId } from "@vtt/substrate";
import {
  EDITOR_LOCK_TTL_MS,
  ExtendEditLock,
  Page,
  SetDraftBody,
  SetPageBody,
} from "../shared/index.js";
import { CodeMirrorEditor, type CodeMirrorHandle } from "./CodeMirrorEditor.js";
import { ReferencePanel } from "./ReferencePanel.jsx";

/**
 * Edit-mode editor (lock holder's view). CodeMirror 6 markdown editor
 * with `[[` autocomplete and paste-image upload. Debounces
 * `SetDraftBody` for in-flight readers; runs a 30s checkpoint timer
 * that durably saves via `SetPageBody` when the body has changed; runs
 * a 10s heartbeat to extend the lock; on Done, dispatches a final
 * `SetPageBody` if dirty.
 */
export function NoteEditor(props: {
  pageId: EntityId;
  /** Triggered when the user wants to leave edit mode. */
  onDone?: () => void;
}): JSX.Element {
  const client = useClient();
  const page = useTrait(props.pageId, Page);

  const initialBody = (() => {
    const p = page() as { body: string } | undefined;
    return p?.body ?? "";
  })();

  const [body, setBody] = createSignal(initialBody);
  const [savedAgo, setSavedAgo] = createSignal<number | null>(null);
  const [showReference, setShowReference] = createSignal(false);
  let lastDurableBody = initialBody;
  let lastSavedAt = Date.now();
  let dirty = false;
  let cmHandle: CodeMirrorHandle | null = null;

  let draftDebounce: ReturnType<typeof setTimeout> | null = null;
  let checkpointTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let savedAgoTimer: ReturnType<typeof setInterval> | null = null;

  const dispatch = (cmd: CommandInstance) => client.dispatch(cmd);

  const flushDraft = () => {
    if (draftDebounce) {
      clearTimeout(draftDebounce);
      draftDebounce = null;
    }
    dispatch(SetDraftBody({ pageId: props.pageId, body: body() }));
  };

  const queueDraft = () => {
    if (draftDebounce) clearTimeout(draftDebounce);
    draftDebounce = setTimeout(flushDraft, 800);
  };

  const checkpoint = (force: boolean) => {
    if (!force && !dirty) return;
    if (body() === lastDurableBody) return;
    flushDraft();
    dispatch(SetPageBody({ pageId: props.pageId, body: body() }));
    lastDurableBody = body();
    dirty = false;
    lastSavedAt = Date.now();
    setSavedAgo(0);
  };

  const onChange = (next: string) => {
    setBody(next);
    dirty = true;
    queueDraft();
  };

  // 30s checkpoint timer (only saves if dirty + changed)
  checkpointTimer = setInterval(() => checkpoint(false), 30_000);
  // 10s heartbeat to extend the lock
  heartbeatTimer = setInterval(() => {
    dispatch(ExtendEditLock({ pageId: props.pageId }));
  }, 10_000);
  // Saved-ago tick — UI hint
  savedAgoTimer = setInterval(() => {
    setSavedAgo(Math.floor((Date.now() - lastSavedAt) / 1000));
  }, 1_000);

  onCleanup(() => {
    if (draftDebounce) clearTimeout(draftDebounce);
    if (checkpointTimer) clearInterval(checkpointTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (savedAgoTimer) clearInterval(savedAgoTimer);
  });

  const onDone = () => {
    // Pull the latest body from the editor (in case a draft is still
    // queued) and force a final save.
    if (cmHandle) {
      const latest = cmHandle.getValue();
      if (latest !== body()) {
        setBody(latest);
        dirty = true;
      }
    }
    checkpoint(true);
    props.onDone?.();
  };

  return (
    <div class="flex h-full min-h-0 flex-col gap-2">
      <div class="flex items-center justify-between text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle">
        <span>
          Editing — auto-saves every 30s
          {savedAgo() !== null && savedAgo()! >= 0
            ? ` · last save ${savedAgo()}s ago`
            : ""}
        </span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowReference(!showReference())}
            aria-pressed={showReference()}
            aria-label="Toggle syntax reference panel"
            class="rounded-(--radius-control) border border-border bg-surface px-3 py-1 text-[0.7rem] uppercase tracking-wider text-fg-muted hover:border-accent hover:text-fg transition"
          >
            {showReference() ? "Hide reference" : "Reference"}
          </button>
          <button
            type="button"
            onClick={onDone}
            class="rounded-(--radius-control) border border-accent bg-accent px-3 py-1 text-[0.7rem] uppercase tracking-wider text-accent-fg hover:bg-accent-hover transition"
          >
            Done
          </button>
        </div>
      </div>
      {/* Flex-row split: editor stretches; optional reference panel on the
          right. The editor wrapper is `flex flex-col` so CodeMirrorEditor's
          own `flex-1 min-h-0` resolves against a flex parent (otherwise it
          collapses to content height and the page scrolls instead of the
          editor). */}
      <div class="flex flex-1 min-h-0 gap-2">
        <div class="flex flex-col flex-1 min-h-0 min-w-0">
          <CodeMirrorEditor
            initial={initialBody}
            onChange={onChange}
            world={client.world}
            registry={client.registry}
            worldId={client.worldId() ?? ""}
            ref={(h) => {
              cmHandle = h;
            }}
          />
        </div>
        <Show when={showReference()}>
          <ReferencePanel
            onInsert={(text) => cmHandle?.insertAtCursor(text)}
            onClose={() => setShowReference(false)}
          />
        </Show>
      </div>
    </div>
  );
}

void EDITOR_LOCK_TTL_MS;
