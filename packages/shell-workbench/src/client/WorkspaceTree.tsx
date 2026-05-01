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

import { createMemo, createSignal, Index, onCleanup, Show, type JSX } from "solid-js";
import { useClient } from "@vtt/substrate/client";
import { Pane } from "./Pane.js";
import { SetSplitProportions } from "../shared/commands.js";
import type {
  WorkspacePane,
  WorkspaceTree as TreeShape,
} from "../shared/traits.js";

/**
 * Smallest fraction of a split a pane can be dragged to during resize.
 * Without this clamp, dragging past the edge would set a 0-or-negative
 * proportion (the schema rejects ≤ 0) and would visually swallow the
 * neighbouring pane. 8% leaves a usable handle to drag back.
 */
const MIN_PROPORTION_FRACTION = 0.08;

/**
 * Recursive renderer for the workspace's split tree. Internal `split`
 * nodes flex along the named axis with weights from `proportions`;
 * leaves render a `Pane`. The renderer only knows about layout — focus,
 * tab strips, and content all live in `Pane`.
 *
 * Splits are draggable: each divider attaches a mousedown handler that
 * tracks the cursor with window-level mousemove/mouseup, updates a
 * local "draft" proportions signal for instant visual feedback, and
 * dispatches `SetSplitProportions` on release. The dispatched event
 * replicates to the user's other connections via the workbench's
 * standard per-user broadcast scope.
 *
 * If `zenPaneId` is set, render only that pane and skip the rest of the
 * tree — zen mode trades layout for focus.
 */
export function WorkspaceTreeView(props: {
  tree: TreeShape;
  paneById: Record<string, WorkspacePane>;
  zenPaneId: string | null;
}): JSX.Element {
  return (
    <Show
      when={props.zenPaneId === null}
      fallback={
        (() => {
          const pane = props.paneById[props.zenPaneId!];
          return pane ? <Pane pane={pane} /> : null;
        }) as unknown as JSX.Element
      }
    >
      <Node
        node={props.tree}
        path={[]}
        paneById={props.paneById}
        zenPaneId={props.zenPaneId}
      />
    </Show>
  );
}

function Node(props: {
  node: TreeShape;
  path: ReadonlyArray<number>;
  paneById: Record<string, WorkspacePane>;
  zenPaneId: string | null;
}): JSX.Element {
  // Both branches go through a small wrapper component rather than an
  // inline IIFE. The IIFE form reads props.node / props.paneById inside
  // Show's reactive computation — when those change (every FocusPane
  // dispatch clones the whole state, so paneById is a fresh dict), the
  // computation re-runs and `createComponent(Pane, …)` is called again,
  // unmounting and remounting the Pane subtree. PdfReader's URL effect
  // then re-fires `pdfjs.getDocument(...)` and snaps the viewer back to
  // page 1. Wrapping the per-branch JSX in a component scopes the
  // reactive reads to the child's own body, which updates internal
  // signals without re-mounting.
  return (
    <Show
      when={props.node.kind === "split"}
      fallback={
        <PaneLeaf node={props.node} paneById={props.paneById} />
      }
    >
      <SplitBranch
        node={props.node}
        path={props.path}
        paneById={props.paneById}
        zenPaneId={props.zenPaneId}
      />
    </Show>
  );
}

function PaneLeaf(props: {
  node: TreeShape;
  paneById: Record<string, WorkspacePane>;
}): JSX.Element {
  const pane = createMemo(() => {
    if (props.node.kind !== "pane") return null;
    return props.paneById[props.node.paneId] ?? null;
  });
  return (
    <Show when={pane()}>{(p) => <Pane pane={p()} />}</Show>
  );
}

function SplitBranch(props: {
  node: TreeShape;
  path: ReadonlyArray<number>;
  paneById: Record<string, WorkspacePane>;
  zenPaneId: string | null;
}): JSX.Element {
  return (
    <Show when={props.node.kind === "split" ? props.node : null}>
      {(splitAcc) => (
        <SplitNode
          split={splitAcc() as Extract<TreeShape, { kind: "split" }>}
          path={props.path}
          paneById={props.paneById}
          zenPaneId={props.zenPaneId}
        />
      )}
    </Show>
  );
}

function SplitNode(props: {
  split: Extract<TreeShape, { kind: "split" }>;
  path: ReadonlyArray<number>;
  paneById: Record<string, WorkspacePane>;
  zenPaneId: string | null;
}): JSX.Element {
  const client = useClient();
  // Draft proportions: set during a drag, cleared on commit. When set,
  // they shadow `props.split.proportions` so the layout follows the
  // cursor smoothly without a substrate roundtrip.
  const [draft, setDraft] = createSignal<number[] | null>(null);
  const proportions = (): ReadonlyArray<number> =>
    draft() ?? props.split.proportions;

  let containerEl: HTMLDivElement | undefined;

  const beginDrag = (dividerIdx: number, ev: MouseEvent) => {
    if (!containerEl) return;
    ev.preventDefault();
    const rect = containerEl.getBoundingClientRect();
    const axisSize =
      props.split.axis === "row" ? rect.width : rect.height;
    if (axisSize <= 0) return;

    const startCoord =
      props.split.axis === "row" ? ev.clientX : ev.clientY;
    const base = [...proportions()];
    const total = base.reduce((a, b) => a + b, 0);
    const minPortion = total * MIN_PROPORTION_FRACTION;

    const onMove = (e: MouseEvent) => {
      const cur = props.split.axis === "row" ? e.clientX : e.clientY;
      const dxPx = cur - startCoord;
      // Convert pixel delta to weight delta along the same axis.
      const dWeight = (dxPx / axisSize) * total;
      // Adjacent panes: child `dividerIdx - 1` shrinks/grows, child
      // `dividerIdx` does the opposite. Other children are untouched.
      const left = base[dividerIdx - 1] ?? 0;
      const right = base[dividerIdx] ?? 0;
      let nextLeft = left + dWeight;
      let nextRight = right - dWeight;
      // Clamp so neither side collapses past MIN_PROPORTION_FRACTION.
      if (nextLeft < minPortion) {
        const corr = minPortion - nextLeft;
        nextLeft = minPortion;
        nextRight -= corr;
      }
      if (nextRight < minPortion) {
        const corr = minPortion - nextRight;
        nextRight = minPortion;
        nextLeft -= corr;
      }
      const updated = [...base];
      updated[dividerIdx - 1] = nextLeft;
      updated[dividerIdx] = nextRight;
      setDraft(updated);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const final = draft();
      setDraft(null);
      if (final) {
        client.dispatch(
          SetSplitProportions({
            path: [...props.path],
            proportions: final,
          }) as never,
        );
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    onCleanup(() => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    });
  };

  const flexAxis = props.split.axis === "row" ? "flex-row" : "flex-col";
  const dividerClass =
    props.split.axis === "row"
      ? "w-1 cursor-col-resize"
      : "h-1 cursor-row-resize";

  return (
    <div
      ref={containerEl}
      class={`flex min-h-0 min-w-0 flex-1 ${flexAxis}`}
    >
      {/*
        `<Index>` not `<For>`. For keys children by reference, so every
        substrate state clone (FocusPane, OpenPage, even bumpInteracted)
        produces fresh `children` array entries and unmounts every pane.
        That tears down PdfReader and snaps pdfjs back to page 1 every
        time the user clicks a different pane. Index keys by position —
        as long as the tree's shape is stable (same axis, same number of
        children), the wrapper divs and Node instances stay mounted; the
        per-child node is exposed as a reactive accessor so its content
        still updates on tree changes.
      */}
      <Index each={props.split.children}>
        {(child, i) => {
          const total = () =>
            proportions().reduce((a, b) => a + b, 0);
          return (
            <>
              <Show when={i > 0}>
                <div
                  role="separator"
                  aria-orientation={
                    props.split.axis === "row" ? "vertical" : "horizontal"
                  }
                  class={`group relative shrink-0 bg-border-muted hover:bg-border transition-colors ${dividerClass}`}
                  classList={{
                    "bg-border": draft() !== null,
                  }}
                  onMouseDown={(e) => beginDrag(i, e)}
                >
                  {/* a slightly-wider invisible hit target so the divider
                      is grabbable without being a chunky 1px target */}
                  <span
                    aria-hidden
                    class={`absolute ${
                      props.split.axis === "row"
                        ? "inset-y-0 -inset-x-1.5"
                        : "inset-x-0 -inset-y-1.5"
                    }`}
                  />
                </div>
              </Show>
              <div
                class="flex min-h-0 min-w-0 flex-col"
                style={{
                  flex: `${(proportions()[i] ?? 1) / total()} 1 0`,
                }}
              >
                <Node
                  node={child()}
                  path={[...props.path, i]}
                  paneById={props.paneById}
                  zenPaneId={props.zenPaneId}
                />
              </div>
            </>
          );
        }}
      </Index>
    </div>
  );
}
