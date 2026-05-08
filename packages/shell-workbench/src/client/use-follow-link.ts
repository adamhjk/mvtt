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

import type { CommandInstance, EntityId, QualifiedName } from "@vtt/substrate";
import { useClient } from "@vtt/substrate/client";
import {
  OpenPage,
  OpenPageAsSplit,
  OpenPageInNewTab,
} from "../shared/index.js";

/**
 * The verb a click resolves to. Picked from keyboard modifiers by
 * `useFollowLink` (or passed explicitly when the call site has its
 * own UI affordance).
 *
 *   - "smart"   — `OpenPage`. Focus an exact-match tab if one exists,
 *                 else retarget the best same-kind tab, else open new.
 *                 The default for a plain click — feels like a wikilink
 *                 navigation.
 *   - "newTab"  — `OpenPageInNewTab`. Always opens a fresh tab in the
 *                 active pane. The Cmd/Ctrl/middle-click verb.
 *   - "newSplit"— `OpenPageAsSplit` with a chosen direction. The Shift-
 *                 click verb when the user wants the target side-by-side.
 */
export type FollowLinkMode = "smart" | "newTab" | "newSplit";

export interface FollowLinkTarget {
  readonly pageKind: QualifiedName;
  readonly entityId: EntityId | null;
}

export interface FollowLinkOptions {
  /**
   * Override the mode the helper would otherwise infer from the
   * MouseEvent's modifiers. Pass this when the call site has its own
   * UI affordance (a context-menu "Open in split" item, a keyboard
   * shortcut, etc.).
   */
  readonly mode?: FollowLinkMode;
  /**
   * Direction for the split when mode resolves to `"newSplit"`.
   * Defaults to `"right"` — vertical split, target lands beside the
   * source pane. Reads naturally for most "show me this beside what
   * I'm reading" intents.
   */
  readonly splitDirection?: "left" | "right" | "top" | "bottom";
}

/**
 * Pick the `FollowLinkMode` from a click's modifier keys. Browser-
 * convention defaults:
 *
 *   - Shift     → newSplit (side-by-side intent)
 *   - Cmd/Ctrl  → newTab   (force-new, like browser link middle-click)
 *   - middle    → newTab   (button === 1)
 *   - otherwise → smart    (the wikilink default)
 *
 * Shift wins over Cmd/Ctrl when both are held — split is the more
 * decisive intent.
 */
export function modeFromMouseEvent(e: MouseEvent | KeyboardEvent): FollowLinkMode {
  if ("shiftKey" in e && e.shiftKey) return "newSplit";
  if ("metaKey" in e && (e.metaKey || e.ctrlKey)) return "newTab";
  // MouseEvent has button + buttons; KeyboardEvent doesn't.
  if ("button" in e && (e as MouseEvent).button === 1) return "newTab";
  return "smart";
}

export type FollowLinkHandler = (
  target: FollowLinkTarget,
  e?: MouseEvent | KeyboardEvent,
  opts?: FollowLinkOptions,
) => void;

/**
 * The canonical wikilink / deep-link click handler. Returns a function
 * that takes the target page (kind + entity) and the click event,
 * picks the right verb based on modifiers, and dispatches it.
 *
 *   const follow = useFollowLink();
 *   <button onClick={(e) => follow({ pageKind, entityId }, e)}>…</button>
 *
 * For a fixed target the call site can curry it once at render:
 *
 *   const follow = useFollowLink();
 *   const open = (e: MouseEvent) => follow({ pageKind, entityId }, e);
 *
 * Pass `opts.mode` to bypass modifier inference (e.g. a context-menu
 * "Open in split" item should always be `"newSplit"`).
 *
 * Use this anywhere a name, citation, wikilink, or other deep-link UI
 * navigates the workbench to another page. It is the standard
 * pattern — plugins should not roll their own routing.
 */
export function useFollowLink(): FollowLinkHandler {
  const client = useClient();
  return (target, e, opts) => {
    const mode = opts?.mode ?? (e ? modeFromMouseEvent(e) : "smart");
    if (mode === "newTab") {
      client.dispatch(
        OpenPageInNewTab({
          pageKind: target.pageKind,
          entityId: target.entityId,
        }) as CommandInstance,
      );
      return;
    }
    if (mode === "newSplit") {
      client.dispatch(
        OpenPageAsSplit({
          pageKind: target.pageKind,
          entityId: target.entityId,
          direction: opts?.splitDirection ?? "right",
        }) as CommandInstance,
      );
      return;
    }
    client.dispatch(
      OpenPage({
        pageKind: target.pageKind,
        entityId: target.entityId,
      }) as CommandInstance,
    );
  };
}
