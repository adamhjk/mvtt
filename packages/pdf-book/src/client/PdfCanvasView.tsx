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
  defineView,
  clientOnly,
} from "@vtt/substrate";
import { useClient, useTrait } from "@vtt/substrate/client";
import { lazy, Show, Suspense, createMemo, type JSX } from "solid-js";
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
 * fallback). Empty state when no PDF is bound yet — the upload section
 * inside the Book's Config tab is the way in.
 *
 * The asset URL is derived from the bound assetId via the assets
 * plugin's content-addressed fetch path; the URL is permanently
 * stable (immutable post-upload) so the browser can cache it forever.
 * Replacing the PDF means rebinding the Book to a different assetId,
 * which produces a different URL and a clean re-load.
 */
export const PdfCanvasView = defineView<{ bookId: string; tabId: string }>({
  name: "PdfCanvas",
  surface: BookCanvasSurface,
  priority: 0,
  render: clientOnly((ctx: { bookId: string; tabId: string }): JSX.Element => {
    const client = useClient();
    const doc = useTrait(ctx.bookId, PdfDocument);
    const url = createMemo(() => {
      const d = doc();
      const worldId = client.worldId();
      if (!d || !worldId) return null;
      return `/plugin-data/${encodeURIComponent(worldId)}/assets/${encodeURIComponent(d.assetId)}`;
    });
    return (
      <Show
        when={url()}
        fallback={
          <div class="flex h-full items-center justify-center bg-surface-sunken px-6 text-center">
            <p class="font-display text-sm text-fg-subtle">
              no PDF uploaded yet — open the Upload tab below to add one.
            </p>
          </div>
        }
      >
        {(u) => (
          <Suspense
            fallback={
              <div class="flex h-full items-center justify-center bg-surface-sunken">
                <p class="font-display text-xs uppercase tracking-[0.2em] text-fg-subtle">
                  loading viewer…
                </p>
              </div>
            }
          >
            <LazyPdfReader url={u()} bookId={ctx.bookId} tabId={ctx.tabId} />
          </Suspense>
        )}
      </Show>
    );
  }),
});
