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

import { onCleanup } from "solid-js";
import { useClient } from "@vtt/substrate/client";
import {
  CloseTab,
  FocusPane,
  OpenPageAsSplit,
  ToggleZen,
} from "../shared/commands.js";
import { useWorkspace } from "./use-workspace.js";
import type { WorkspaceTree } from "../shared/traits.js";

/**
 * Linearise the workspace tree into pane ids in tree order. Used by the
 * ⌘1..⌘4 quick-focus shortcuts so number-keys map predictably to the
 * panes the user sees from left → right, top → bottom.
 */
function linearisePanes(tree: WorkspaceTree, out: string[] = []): string[] {
  if (tree.kind === "pane") {
    out.push(tree.paneId);
    return out;
  }
  for (const c of tree.children) linearisePanes(c, out);
  return out;
}

/**
 * The workbench's global keymap. Mounted once at WorkbenchView. All
 * shortcuts dispatch into the substrate so the resulting state change
 * replicates to the user's other devices.
 *
 * Bindings:
 *   ⌘K / Ctrl-K           open palette       (handled by callback)
 *   ⌘. / Ctrl-.           toggle zen
 *   ⌘1..⌘4 / Ctrl-1..4    focus pane N (tree order)
 *   ⌘\\ / Ctrl-\\          split active pane right (uses active tab)
 *   ⌘- / Ctrl- _          split active pane below
 *   ⌘⌫ / Ctrl-Backspace   close active tab in the active pane
 *
 * The palette has its own intra-overlay keymap; this one stays out of
 * the way while the palette is open (the caller flips `enabled` off).
 *
 * IMPORTANT: avoid intercepting these when the user is typing into a
 * form control. The simplest filter is to look at e.target — text inputs
 * and textareas keep their default behaviour for ⌘1, ⌘\\, etc.
 */
export function useWorkbenchKeybindings(opts: {
  onPalette: () => void;
  enabled: () => boolean;
}): void {
  const client = useClient();
  const ws = useWorkspace();

  const handler = (e: KeyboardEvent): void => {
    if (!opts.enabled()) return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    const inField =
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      target?.isContentEditable === true;
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;

    // ⌘K — palette. Even allowed inside form fields (so the user can
    // jump from anywhere). The palette handles its own typing.
    if (e.key === "k" || e.key === "K") {
      e.preventDefault();
      opts.onPalette();
      return;
    }

    // The rest are ignored when the user is typing.
    if (inField) return;

    if (e.key === ".") {
      e.preventDefault();
      client.dispatch(ToggleZen({}) as never);
      return;
    }

    if (e.key === "\\") {
      e.preventDefault();
      const state = ws.state();
      if (!state) return;
      const pane = state.panes[state.activePaneId];
      if (!pane?.activeTabId) return;
      const tab = state.tabs[pane.activeTabId];
      if (!tab) return;
      client.dispatch(
        OpenPageAsSplit({
          pageKind: tab.pageKind,
          entityId: tab.entityId,
          direction: "right",
        }) as never,
      );
      return;
    }

    if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      const state = ws.state();
      if (!state) return;
      const pane = state.panes[state.activePaneId];
      if (!pane?.activeTabId) return;
      const tab = state.tabs[pane.activeTabId];
      if (!tab) return;
      client.dispatch(
        OpenPageAsSplit({
          pageKind: tab.pageKind,
          entityId: tab.entityId,
          direction: "bottom",
        }) as never,
      );
      return;
    }

    // ⌘⌫ — close the active tab. (⌘W is reserved by the browser and
    // can't be preventDefault'd from a webpage; ⌘⌫ is the macOS-natural
    // "remove this" gesture, kept off normal text fields by the inField
    // guard above so it doesn't steal Cmd-Backspace word-delete.)
    if (e.key === "Backspace") {
      e.preventDefault();
      const state = ws.state();
      if (!state) return;
      const pane = state.panes[state.activePaneId];
      if (!pane?.activeTabId) return;
      client.dispatch(
        CloseTab({
          paneId: pane.paneId,
          tabId: pane.activeTabId,
        }) as never,
      );
      return;
    }

    // ⌘1..⌘4 — focus pane
    if (/^[1-4]$/.test(e.key)) {
      e.preventDefault();
      const state = ws.state();
      if (!state) return;
      const order = linearisePanes(state.tree);
      const target = order[Number(e.key) - 1];
      if (!target) return;
      client.dispatch(FocusPane({ paneId: target }) as never);
      return;
    }
  };

  document.addEventListener("keydown", handler);
  onCleanup(() => document.removeEventListener("keydown", handler));
}
