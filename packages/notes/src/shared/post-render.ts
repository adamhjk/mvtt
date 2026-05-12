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

import { defineSlot, z, type Registry, type World } from "@vtt/substrate";

/**
 * Plugins fill `MarkdownPostRenderSlot` with a function that runs
 * after `MarkdownView` has rewritten the container's `innerHTML`.
 * They can walk the DOM, find placeholders (e.g. `<pre><code>`
 * elements representing fenced blocks), and mount Solid components
 * into them.
 *
 * The notes plugin makes no assumption about what fills do — they're
 * given the container element and a context object and run on every
 * render. Owners are responsible for cleaning up their previously-
 * mounted Solid roots if the same container re-renders. (Mount onto
 * a fresh element you create yourself; the next render replaces the
 * container's innerHTML, which detaches everything cleanly.)
 *
 * This is the load-bearing extension point for the adventures plugin's
 * "fenced block becomes interactive widget" UX. Without it, every
 * `\`\`\`item Sword\n…\`\`\`` would render as an inert code block.
 */
export interface MarkdownPostRender {
  /** Stable name — for telemetry / debugging. */
  readonly name: string;
  /**
   * Run after `MarkdownView` updates `innerHTML`. Container is the
   * mounted div; ctx carries the live world + registry + worldId so
   * fills can dispatch commands and read trait state.
   */
  readonly run: (
    container: HTMLElement,
    ctx: MarkdownPostRenderContext,
  ) => void;
}

export interface MarkdownPostRenderContext {
  readonly world: World;
  readonly registry: Registry;
  readonly worldId: string;
  /**
   * Dispatch a command via the active client pipeline. Optional —
   * callers without a live client (e.g. read-only previews) leave it
   * undefined; widgets that need to fire commands gracefully degrade.
   * Typed as `unknown` here so this shared module doesn't pull in a
   * client-side type. The widget cast it back at the call site.
   */
  readonly dispatch?: (cmd: unknown) => unknown;
  /**
   * Active session, if any. Used by widgets to permission-gate
   * action buttons (GM-only actions hide for non-GMs). `null` when
   * the renderer doesn't know the session role.
   */
  readonly session?: { role: "gm" | "player" } | null;
}

export const MarkdownPostRenderSlot = defineSlot({
  name: "@vtt/notes/markdown-post-render",
  schema: z.object({
    name: z.string().min(1),
    run: z.any(),
  }),
  description:
    "Plugins contribute post-render hooks invoked after MarkdownView updates innerHTML. Used by adventures to mount block widgets in place of fenced code blocks.",
});
