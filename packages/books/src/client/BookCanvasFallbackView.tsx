import {
  defineView,
  clientOnly,
} from "@vtt/substrate";
import { type JSX } from "solid-js";
import { BookCanvasSurface } from "../shared/surfaces.js";

/**
 * Low-priority placeholder for the BookCanvasSurface — shown when no
 * projection plugin (pdf-book, etc.) is loaded or when the registered
 * projection has no content set for this book yet. Projection plugins
 * MUST register a view at priority > 0; this fallback claims priority
 * -100 so it always loses to a real renderer.
 *
 * Rendered as the "single" surface's only filler when the user has a
 * Book selected but no projection has produced a renderer view —
 * gives them a hint about what to do (load a projection plugin) rather
 * than an unexplained blank pane.
 */
export const BookCanvasFallbackView = defineView<{ bookId: string }>({
  name: "BookCanvasFallback",
  surface: BookCanvasSurface,
  priority: -100,
  render: clientOnly((_ctx: { bookId: string }): JSX.Element => {
    return (
      <div class="flex h-full items-center justify-center bg-surface-sunken px-6 text-center">
        <p class="font-display text-sm text-fg-subtle">
          no projection plugin registered for this book — install
          <span class="mx-1 font-mono text-fg-muted">@vtt/pdf-book</span>
          (or another projection) to render content here.
        </p>
      </div>
    );
  }),
});
