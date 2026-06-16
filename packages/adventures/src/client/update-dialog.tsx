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

import { createSignal, For, Show, type JSX } from "solid-js";

/**
 * Re-typed shape of the server-side diff payload — this client
 * component doesn't import from `@vtt/adventures/server` (which would
 * pull `node:http` etc.). The shape mirrors `UpdateDiff` from
 * `update-diff.ts`.
 */
export interface UpdateDiffNote {
  readonly bundlePath: string;
  readonly title: string;
  readonly kind: "new" | "unchanged" | "fast-forward" | "conflict" | "removed-upstream";
  readonly worldNoteId?: string;
  readonly newBody?: string;
  readonly blocks: ReadonlyArray<{
    readonly kind: "block-new" | "block-removed" | "block-unchanged" | "block-changed";
    readonly blockKey: string;
    readonly newBlockBody?: string;
    readonly currentBlockBody?: string;
  }>;
}

export interface UpdateDiffPayload {
  readonly bundleId: string;
  readonly currentVersion?: string;
  readonly newVersion: string;
  readonly notes: ReadonlyArray<UpdateDiffNote>;
}

/**
 * One resolution choice the GM picks per note. Per-block resolution
 * lands in T3.2; v1 is note-level.
 */
export type ResolutionAction = "take-theirs" | "keep-mine" | "skip" | "import-new";

/**
 * Default action for each diff classification. The dialog seeds its
 * state from this so the GM can submit straight through with sensible
 * defaults.
 */
function defaultActionFor(kind: UpdateDiffNote["kind"]): ResolutionAction {
  switch (kind) {
    case "new":
      return "import-new";
    case "unchanged":
      return "skip";
    case "fast-forward":
      return "take-theirs";
    case "conflict":
      return "keep-mine"; // safe default — don't overwrite GM edits
    case "removed-upstream":
      return "skip";
  }
}

const KIND_LABEL: Record<UpdateDiffNote["kind"], string> = {
  new: "New (not yet imported)",
  unchanged: "Unchanged",
  "fast-forward": "Updated upstream (you haven't edited)",
  conflict: "Conflict — both you and the bundle changed this note",
  "removed-upstream": "Removed upstream",
};

const ACTION_LABEL: Record<ResolutionAction, string> = {
  "take-theirs": "Take theirs",
  "keep-mine": "Keep mine",
  skip: "Skip",
  "import-new": "Import new",
};

const ALLOWED_ACTIONS: Record<UpdateDiffNote["kind"], ReadonlyArray<ResolutionAction>> = {
  new: ["import-new", "skip"],
  unchanged: ["skip"],
  "fast-forward": ["take-theirs", "keep-mine", "skip"],
  conflict: ["take-theirs", "keep-mine", "skip"],
  "removed-upstream": ["skip", "keep-mine"],
};

/**
 * Update / diff dialog. Renders the per-note classification with a
 * radio-style action picker per row, and an Apply button that hands
 * the chosen resolutions back to the caller via `onApply`.
 */
export function AdventureUpdateDialog(props: {
  diff: UpdateDiffPayload;
  onApply: (resolutions: ReadonlyArray<{ bundlePath: string; action: ResolutionAction }>) => void;
  onCancel?: () => void;
}): JSX.Element {
  const [choices, setChoices] = createSignal<Record<string, ResolutionAction>>(
    Object.fromEntries(props.diff.notes.map((n) => [n.bundlePath, defaultActionFor(n.kind)])),
  );

  function setChoice(bundlePath: string, action: ResolutionAction): void {
    setChoices((c) => ({ ...c, [bundlePath]: action }));
  }

  function apply(): void {
    const out = props.diff.notes.map((n) => ({
      bundlePath: n.bundlePath,
      action: choices()[n.bundlePath] ?? defaultActionFor(n.kind),
    }));
    props.onApply(out);
  }

  return (
    <div
      class="advt-update-dialog"
      style={{
        border: "1px solid var(--color-border, #ccc)",
        "border-radius": "8px",
        padding: "16px",
        background: "var(--color-surface, #fff)",
        "max-width": "720px",
      }}
    >
      <header class="advt-update-header" style={{ "margin-bottom": "12px" }}>
        <div style={{ "font-weight": "600", "font-size": "1.1em" }}>Adventure update</div>
        <div style={{ "font-size": "0.9em", color: "var(--color-fg-muted, #888)" }}>
          Bundle <code>{props.diff.bundleId}</code>
          {props.diff.currentVersion
            ? ` v${props.diff.currentVersion} → v${props.diff.newVersion}`
            : ` v${props.diff.newVersion}`}
        </div>
      </header>
      <For each={props.diff.notes}>
        {(note) => (
          <div
            class="advt-update-note"
            data-kind={note.kind}
            data-bundle-path={note.bundlePath}
            style={{
              border: "1px solid var(--color-border-muted, #eee)",
              "border-radius": "6px",
              padding: "8px 12px",
              "margin-bottom": "8px",
            }}
          >
            <div
              class="advt-update-note-header"
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                gap: "8px",
              }}
            >
              <div>
                <div style={{ "font-weight": "600" }}>{note.title}</div>
                <div style={{ "font-size": "0.85em", color: "var(--color-fg-muted, #888)" }}>
                  {KIND_LABEL[note.kind]}
                </div>
              </div>
              <div class="advt-update-actions" style={{ display: "flex", gap: "4px" }}>
                <For each={ALLOWED_ACTIONS[note.kind]}>
                  {(act) => (
                    <button
                      type="button"
                      class="advt-update-action-btn"
                      data-action={act}
                      data-selected={choices()[note.bundlePath] === act ? "true" : "false"}
                      onClick={() => setChoice(note.bundlePath, act)}
                      style={{
                        padding: "4px 8px",
                        "border-radius": "4px",
                        border:
                          choices()[note.bundlePath] === act
                            ? "2px solid var(--color-accent, #3b82f6)"
                            : "1px solid var(--color-border, #ccc)",
                        background:
                          choices()[note.bundlePath] === act
                            ? "var(--color-accent-bg, #eff6ff)"
                            : "var(--color-surface, #fff)",
                        cursor: "pointer",
                      }}
                    >
                      {ACTION_LABEL[act]}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <Show when={note.blocks.length > 0 && note.kind === "conflict"}>
              <details style={{ "margin-top": "6px" }}>
                <summary style={{ cursor: "pointer", "font-size": "0.85em" }}>
                  {note.blocks.filter((b) => b.kind !== "block-unchanged").length} block-level
                  change(s)
                </summary>
                <ul style={{ "margin-top": "4px", "padding-left": "20px", "font-size": "0.85em" }}>
                  <For each={note.blocks.filter((b) => b.kind !== "block-unchanged")}>
                    {(b) => (
                      <li>
                        <code>{b.blockKey}</code> — {b.kind.replace("block-", "")}
                      </li>
                    )}
                  </For>
                </ul>
              </details>
            </Show>
          </div>
        )}
      </For>
      <footer
        class="advt-update-footer"
        style={{
          display: "flex",
          "justify-content": "flex-end",
          gap: "8px",
          "margin-top": "12px",
        }}
      >
        <Show when={props.onCancel}>
          <button
            type="button"
            class="advt-update-cancel"
            onClick={() => props.onCancel?.()}
            style={{
              padding: "6px 12px",
              "border-radius": "4px",
              border: "1px solid var(--color-border, #ccc)",
              background: "var(--color-surface, #fff)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </Show>
        <button
          type="button"
          class="advt-update-apply"
          onClick={apply}
          style={{
            padding: "6px 12px",
            "border-radius": "4px",
            border: "1px solid var(--color-accent, #3b82f6)",
            background: "var(--color-accent, #3b82f6)",
            color: "white",
            cursor: "pointer",
          }}
        >
          Apply
        </button>
      </footer>
    </div>
  );
}
