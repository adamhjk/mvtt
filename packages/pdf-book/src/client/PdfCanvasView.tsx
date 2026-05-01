import {
  defineView,
  clientOnly,
} from "@vtt/substrate";
import { useTrait } from "@vtt/substrate/client";
import { lazy, Show, Suspense, type JSX } from "solid-js";
import { BookCanvasSurface } from "@vtt/books/shared";
import { PdfDocument } from "../shared/traits.js";

/**
 * `lazy()` gives us a component with **stable identity** across the
 * parent's re-renders. Plain `import("./PdfReader.js").then(...)` (or
 * the previous `m().PdfReader(args)` pattern) creates a fresh
 * component instance every time the surrounding tracking scope
 * re-runs — and the workbench's Pane re-runs the page render whenever
 * `WorkspaceState` changes (e.g. the GM toggles the bottom dock open
 * to upload a replacement). With `lazy()`, the component is created
 * once and Solid preserves its lifecycle across reactive parent
 * updates, so the viewer keeps its scroll position, zoom, and find
 * state when the user opens the Upload tab.
 *
 * The dynamic import is also where pdfjs-dist (~700 KB JS + 277 KB
 * CSS) and its worker get pulled in, so the cost only lands when a
 * Book is actually opened.
 */
const LazyPdfReader = lazy(async () => {
  const m = await import("./PdfReader.js");
  return { default: m.PdfReader };
});

/**
 * Fills BookCanvasSurface at priority 0 (above @vtt/books's -100
 * fallback). Empty state when no PDF is uploaded yet — the upload
 * tab in the bottom dock is the way in.
 *
 * The reader subscribes to `pendingBookNav` from `@vtt/books/shared`
 * for `[[book:Name#42]]` wiki-link navigation; `bookId` is forwarded
 * so it can filter requests for the book it's currently rendering.
 */
export const PdfCanvasView = defineView<{ bookId: string; tabId: string }>({
  name: "PdfCanvas",
  surface: BookCanvasSurface,
  priority: 0,
  render: clientOnly((ctx: { bookId: string; tabId: string }): JSX.Element => {
    const doc = useTrait(ctx.bookId, PdfDocument);
    return (
      <Show
        when={doc()?.url}
        fallback={
          <div class="flex h-full items-center justify-center bg-surface-sunken px-6 text-center">
            <p class="font-display text-sm text-fg-subtle">
              no PDF uploaded yet — open the Upload tab below to add one.
            </p>
          </div>
        }
      >
        {(url) => (
          <Suspense
            fallback={
              <div class="flex h-full items-center justify-center bg-surface-sunken">
                <p class="font-display text-xs uppercase tracking-[0.2em] text-fg-subtle">
                  loading viewer…
                </p>
              </div>
            }
          >
            <LazyPdfReader url={url()} bookId={ctx.bookId} tabId={ctx.tabId} />
          </Suspense>
        )}
      </Show>
    );
  }),
});
