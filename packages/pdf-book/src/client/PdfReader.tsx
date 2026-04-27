import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
// We import from `pdfjs-dist/legacy/...` rather than the package's
// default entry. The default build (`build/pdf.mjs`) targets the
// most-recent browsers and uses TC39 stage-3 features — most
// notably `Math.sumPrecise` — that only landed in Chrome 137 /
// Firefox 142 / Safari 26 in mid-to-late 2025. Older browsers throw
// at runtime when pdfjs's font/text-positioning code hits those
// calls, which surfaces as missing characters and wrong glyph
// widths (the canonical "broken-looking PDF" symptom). The legacy
// build is transpiled for a wider baseline and ships the same APIs
// minus the brand-new feature dependencies.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/legacy/web/pdf_viewer.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
// pdfjs-dist's viewer styles. Imports the page/canvas/text-layer/
// annotation-layer baseline; without this the pages render as raw
// stacked canvases. Side-effect import — Vite bundles it into the
// dynamic chunk for this module so it only ships when a Book is
// actually opened.
import "pdfjs-dist/legacy/web/pdf_viewer.css";

// One-time worker URL hook. `new URL(..., import.meta.url)` is the
// standard ESM idiom Vite (and other bundlers) special-case to emit a
// fingerprinted asset URL that survives the build. GlobalWorkerOptions
// is process-global so doing it inside the component would just rewrite
// the same value every mount. Pointed at the legacy worker for the
// same reason as the main library import above.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url,
).toString();

interface MatchesCount {
  current: number;
  total: number;
}

/**
 * One node in the PDF's outline tree (a.k.a. document outline,
 * bookmarks, or table of contents). Mirrors the shape `getOutline()`
 * returns from pdfjs's PDFDocumentProxy. `dest` is what we hand to
 * `linkService.goToDestination(...)` to navigate; `url` is for
 * outline entries that are external links (we render them as
 * non-clickable in v0 — opening external links from a player-visible
 * book is a future permissions decision, not a default).
 */
interface OutlineNode {
  title: string;
  bold: boolean;
  italic: boolean;
  dest: string | unknown[] | null;
  url: string | null;
  items: OutlineNode[];
}

/**
 * Persisted reader state per-document. Keyed by the PDF's public URL
 * (which already includes a `?v=<bytes>` cache-bust suffix from the
 * upload endpoint, so a replaced PDF gets a fresh slot — exactly what
 * we want, since page numbers don't carry across replacements).
 *
 * Stored in `sessionStorage` rather than a substrate trait because:
 *   - it's per-tab, per-user UI state — not part of the shared world
 *   - it survives the dev-time HMR remount and any future component
 *     remount path (the Solid analysis says PdfReader is stable today,
 *     but persisting cheaply here is the belt-and-braces against any
 *     future regression that does cause a remount)
 *   - sessionStorage scopes naturally to a single tab — opening the
 *     same book in two windows doesn't cross-contaminate spots.
 */
interface PersistedReaderState {
  page: number;
  /** PDFViewer scaleValue (preset or numeric string). */
  scale: string;
  /** Pixel scroll offset within the container, used to restore mid-page positioning. */
  scrollTop: number;
  query: string;
  /** Whether the outline sidebar is visible. */
  outlineOpen?: boolean;
}

const STORAGE_PREFIX = "vtt:pdf-book:reader:";

function loadPersistedState(url: string): PersistedReaderState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + url);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedReaderState>;
    if (
      typeof parsed.page !== "number" ||
      typeof parsed.scale !== "string" ||
      typeof parsed.scrollTop !== "number" ||
      typeof parsed.query !== "string"
    ) {
      return null;
    }
    return {
      page: parsed.page,
      scale: parsed.scale,
      scrollTop: parsed.scrollTop,
      query: parsed.query,
      outlineOpen:
        typeof parsed.outlineOpen === "boolean" ? parsed.outlineOpen : false,
    };
  } catch {
    // sessionStorage can throw (private mode, quota, JSON parse) — a
    // failed restore is a non-event, just start fresh.
    return null;
  }
}

function savePersistedState(url: string, state: PersistedReaderState): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + url, JSON.stringify(state));
  } catch {
    /* see loadPersistedState — quota/private-mode failures are fine to swallow */
  }
}

/**
 * Full PDF reader powered by pdfjs-dist's `PDFViewer` — the same
 * component the official Mozilla viewer uses. Fixes two problems with
 * the v0 hand-rolled per-page renderer:
 *
 *   1. **Virtualisation.** PDFViewer only renders pages near the
 *      viewport; scrolling pulls more in and recycles distant ones.
 *      The previous implementation rendered every page on mount AND
 *      re-rendered every page on every resize. A 300-page PDF was
 *      effectively unusable.
 *   2. **Reader scaffolding.** Page X/Y, prev/next, jump-to-page,
 *      zoom (in/out/fit-page/fit-width/percent), and full-text find
 *      with prev/next match navigation. All wired through pdfjs's
 *      EventBus + PDFFindController so we get the same semantics the
 *      Firefox / Chrome viewer ships.
 *
 * Layout: vertical stack of `[toolbar | scrollable viewport]`. The
 * scrollable viewport is the `container` PDFViewer scrolls; the inner
 * `viewer` div is the one PDFViewer mutates with page elements.
 *
 * Lifecycle: PDFViewer + PDFFindController are mounted once on first
 * render. A separate effect tracks `props.url` and re-loads via
 * `pdfjs.getDocument(...)` whenever the URL changes (e.g. GM uploads a
 * replacement). Cleanup on unmount destroys the loading task, the
 * document, and calls `viewer.cleanup()` to free per-page caches.
 */
export function PdfReader(props: { url: string }): JSX.Element {
  const [pageNumber, setPageNumber] = createSignal(1);
  const [pageCount, setPageCount] = createSignal(0);
  // Default scale is "page-width" rather than "auto": auto recomputes
  // against both dimensions, so opening the bottom dock (which only
  // changes the canvas pane's *height*) would re-fit every visible
  // page and look to the user like the PDF reset. page-width only
  // depends on width — height changes leave the scale alone, and the
  // current scroll position keeps the user on the same page.
  const [scaleValue, setScaleValue] = createSignal<string>("page-width");
  const [scalePct, setScalePct] = createSignal(100);
  const [findQuery, setFindQuery] = createSignal("");
  const [matches, setMatches] = createSignal<MatchesCount>({
    current: 0,
    total: 0,
  });
  const [error, setError] = createSignal<string | null>(null);
  // Outline (TOC / bookmarks). Loaded once per document via
  // `pdf.getOutline()` after `pagesinit`. `null` = not loaded yet,
  // `[]` = the document has no outline embedded.
  const [outline, setOutline] = createSignal<OutlineNode[] | null>(null);
  const [outlineOpen, setOutlineOpen] = createSignal(false);

  let containerEl: HTMLDivElement | undefined;
  let viewerEl: HTMLDivElement | undefined;
  let viewer: PDFViewer | null = null;
  let eventBus: EventBus | null = null;
  let linkService: PDFLinkService | null = null;
  let findController: PDFFindController | null = null;
  let pageInputEl: HTMLInputElement | undefined;

  // Snapshot of the persisted state for the current URL — set by the
  // load effect from sessionStorage and consumed by the pagesinit
  // handler when the doc is ready to be addressed. Captured outside
  // pagesinit so the URL we restore against is the URL we just loaded
  // (not whatever urlMemo is at the moment pagesinit fires, which
  // could have moved on if a replace happened mid-load).
  let pendingRestore: PersistedReaderState | null = null;

  // Save state imperatively rather than via createEffect so the writes
  // happen exactly when pdfjs reports a change — no extra reactive
  // round-trip and no risk of saving stale snapshots during the
  // initial restore.
  const persist = () => {
    if (!viewer) return;
    const url = props.url;
    if (!url) return;
    savePersistedState(url, {
      page: viewer.currentPageNumber,
      scale: viewer.currentScaleValue ?? scaleValue(),
      scrollTop: containerEl?.scrollTop ?? 0,
      query: findQuery(),
      outlineOpen: outlineOpen(),
    });
  };

  onMount(() => {
    if (!containerEl || !viewerEl) return;
    eventBus = new EventBus();
    linkService = new PDFLinkService({ eventBus });
    findController = new PDFFindController({ linkService, eventBus });
    viewer = new PDFViewer({
      container: containerEl,
      viewer: viewerEl,
      eventBus,
      linkService,
      findController,
    });
    linkService.setViewer(viewer);

    // pagesinit: first time pages are rendered for the just-loaded
    // doc. Restore persisted state if we have any, otherwise apply
    // the toolbar's current scale preset for the initial fit.
    //
    // Order matters: scale FIRST (changes page sizes → scroll math),
    // then page number, then scroll offset for mid-page restoration.
    // Without the scale-first ordering, a saved scrollTop computed
    // under one scale wouldn't land on the same content under a
    // different scale.
    eventBus.on("pagesinit", () => {
      if (!viewer) return;
      const restore = pendingRestore;
      pendingRestore = null;
      if (restore) {
        setScaleValue(restore.scale);
        viewer.currentScaleValue = restore.scale;
        if (restore.page >= 1) {
          viewer.currentPageNumber = restore.page;
        }
        // scrollTop is applied after the next frame so pdfjs has
        // settled the page heights at the new scale. A direct
        // assignment here would race with pdfjs's own scroll-to-page
        // call from currentPageNumber and end up clobbered.
        if (restore.scrollTop > 0 && containerEl) {
          requestAnimationFrame(() => {
            if (containerEl) containerEl.scrollTop = restore.scrollTop;
          });
        }
        if (restore.query) {
          setFindQuery(restore.query);
          // Re-issue the find dispatch so the highlight overlay shows.
          // Wait for the next tick — find needs the text layer ready
          // for at least the current page.
          queueMicrotask(() => {
            if (!eventBus) return;
            eventBus.dispatch("find", {
              source: window,
              type: "",
              query: restore.query,
              caseSensitive: false,
              entireWord: false,
              highlightAll: true,
              findPrevious: false,
              matchDiacritics: false,
            });
          });
        }
      } else {
        viewer.currentScaleValue = scaleValue();
      }
    });
    // pagechanging: scroll-driven page change. Update the toolbar's
    // page number display, and persist so the spot survives a
    // remount/HMR/tab switch.
    eventBus.on("pagechanging", (evt: { pageNumber: number }) => {
      setPageNumber(evt.pageNumber);
      persist();
    });
    // scalechanging: zoom-driven scale change. Show the percent and
    // persist so the user's preferred zoom is remembered.
    eventBus.on(
      "scalechanging",
      (evt: { scale: number; presetValue?: string }) => {
        setScalePct(Math.round(evt.scale * 100));
        if (evt.presetValue) setScaleValue(evt.presetValue);
        persist();
      },
    );
    // updatefindmatchescount fires while pdf.js is searching all
    // pages; updatefindcontrolstate fires when a navigation action
    // (next/prev) lands on a match. Both carry the latest count.
    const onFindUpdate = (evt: { matchesCount?: MatchesCount }) => {
      if (evt.matchesCount) setMatches(evt.matchesCount);
    };
    eventBus.on("updatefindmatchescount", onFindUpdate);
    eventBus.on("updatefindcontrolstate", onFindUpdate);

    // Persist scroll offset on user-driven scroll. Throttled via rAF
    // so the write fires at most once per frame even under fast
    // wheel scrolls. pagechanging already persists when the page
    // changes; this catches mid-page scrolling between page boundaries.
    let scrollRaf = 0;
    const onScroll = () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        persist();
      });
    };
    containerEl.addEventListener("scroll", onScroll, { passive: true });
    onCleanup(() => {
      containerEl?.removeEventListener("scroll", onScroll);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
    });
  });

  // Memoise the URL with `===` equality (Solid's default) so a parent
  // re-render that passes the same string doesn't retrigger the load
  // effect. Without this guard, any parent reactive update — e.g. the
  // workbench rebuilding `args` when uiState changes — would call
  // setDocument again and lose the user's current page/zoom/find.
  const urlMemo = createMemo(() => props.url);

  // Load (or reload) the document whenever the URL actually changes.
  // This is the only place we touch pdfjs.getDocument — the toolbar
  // mutates the existing viewer instance in place.
  createEffect(() => {
    const url = urlMemo();
    if (!viewer || !linkService) return;
    setError(null);
    setPageNumber(1);
    setPageCount(0);
    setMatches({ current: 0, total: 0 });
    setOutline(null);

    // Capture any persisted state for THIS URL before kicking off the
    // load. The pagesinit handler will consume it once pdfjs is ready
    // to address pages — see the handler's restore block.
    pendingRestore = loadPersistedState(url);
    if (pendingRestore?.outlineOpen) setOutlineOpen(true);

    // The four "support file" options below dramatically improve
    // rendering fidelity. Without them, pdfjs falls back to canvas
    // font substitution (wrong metrics for any PDF that doesn't
    // embed its fonts), can't decode CJK text, and can't decode
    // JBIG2/JPEG2000 images or honour ICC color profiles. The files
    // ship inside pdfjs-dist; the server mounts them at /pdfjs/...
    // via pdfBookAssetRoots().
    //
    // `cMapPacked: true` selects the binary `.bcmap` format that
    // ships with pdfjs-dist (vs. the legacy text format).
    //
    // We deliberately let `useSystemFonts` default. The web default
    // is `true` (matches Firefox's built-in viewer); flipping it to
    // `false` to "fix" a one-off dingbat issue broke far more text
    // than it fixed — the embedded-font decode path drops glyphs
    // and produces wrong widths in many otherwise-fine PDFs. Some
    // PDFs with custom ornament fonts will still show pdfjs's
    // missing-glyph placeholders (U+001F → "[us]" boxes etc.); that
    // is an inherent limitation of pdfjs's font sanitizer with
    // private-codepoint mappings, not something this option toggles.
    //
    // `verbosity: WARNINGS` lifts the default ERRORS-only level so
    // font-decode failures and worker fallbacks surface in the
    // browser console — the right place to start when a specific
    // PDF renders oddly.
    const loadingTask = pdfjs.getDocument({
      url,
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
      iccUrl: "/pdfjs/iccs/",
      verbosity: pdfjs.VerbosityLevel.WARNINGS,
    });
    let destroyed = false;
    let loaded: PDFDocumentProxy | null = null;

    loadingTask.promise
      .then((doc) => {
        if (destroyed || !viewer || !linkService) {
          doc.destroy();
          return;
        }
        loaded = doc;
        viewer.setDocument(doc);
        linkService.setDocument(doc);
        setPageCount(doc.numPages);
        // Fetch the outline in parallel with rendering. Many PDFs
        // ship no outline at all (returns null) — we coerce to []
        // so the toolbar's "show outline" button can still tell the
        // difference between "still loading" (null) and "no outline
        // available" ([]).
        void doc
          .getOutline()
          .then((nodes) => {
            if (destroyed) return;
            setOutline((nodes as OutlineNode[] | null) ?? []);
          })
          .catch(() => {
            if (destroyed) return;
            setOutline([]);
          });
      })
      .catch((err: unknown) => {
        if (destroyed) return;
        const msg = err instanceof Error ? err.message : String(err);
        // pdfjs throws a cancellation error when destroyed mid-load; not
        // a user-facing error.
        if (!msg.toLowerCase().includes("cancel")) setError(msg);
      });

    onCleanup(() => {
      destroyed = true;
      void loadingTask.destroy();
      if (loaded) loaded.destroy();
    });
  });

  // Final teardown: free per-page caches PDFViewer holds on. Without
  // this, switching books between mounts grows memory unboundedly.
  onCleanup(() => {
    if (viewer) viewer.cleanup();
    viewer = null;
    eventBus = null;
    linkService = null;
    findController = null;
  });

  // — toolbar handlers ———————————————————————————————————————

  const goToPage = (n: number) => {
    if (!viewer) return;
    const clamped = Math.max(1, Math.min(pageCount(), Math.floor(n)));
    viewer.currentPageNumber = clamped;
  };
  const prevPage = () => goToPage(pageNumber() - 1);
  const nextPage = () => goToPage(pageNumber() + 1);

  const setPreset = (preset: string) => {
    if (!viewer) return;
    setScaleValue(preset);
    viewer.currentScaleValue = preset;
  };
  const zoomIn = () => {
    if (!viewer) return;
    viewer.currentScale = Math.min(viewer.currentScale * 1.1, 10);
  };
  const zoomOut = () => {
    if (!viewer) return;
    viewer.currentScale = Math.max(viewer.currentScale / 1.1, 0.1);
  };

  // pdfjs's find pipeline takes a `find` event with `type` either
  // empty (new search) or "again" (next/prev match). Issuing "again"
  // with `findPrevious: true` jumps to the previous match.
  const dispatchFind = (
    type: "" | "again",
    opts: { findPrevious?: boolean } = {},
  ) => {
    if (!eventBus) return;
    eventBus.dispatch("find", {
      source: window,
      type,
      query: findQuery(),
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: opts.findPrevious ?? false,
      matchDiacritics: false,
    });
  };
  const onFindInput = (q: string) => {
    setFindQuery(q);
    persist();
    if (q.length === 0) {
      // Clear matches by issuing an empty search — pdfjs treats
      // empty query as "stop highlighting."
      dispatchFind("");
      return;
    }
    dispatchFind("");
  };
  const findNext = () => {
    if (findQuery().length === 0) return;
    dispatchFind("again", { findPrevious: false });
  };
  const findPrev = () => {
    if (findQuery().length === 0) return;
    dispatchFind("again", { findPrevious: true });
  };

  // Outline-driven navigation. linkService.goToDestination handles
  // both name-string and explicit-array destinations (the two forms
  // PDF spec allows for outline entries). External-URL outline
  // entries are ignored in v0 — opening external links from a
  // player-shared book is a future permissions decision.
  const goToOutlineEntry = (node: OutlineNode) => {
    if (!linkService) return;
    if (node.dest != null) {
      void linkService.goToDestination(
        // pdfjs's signature is `string | any[]`; we model `dest` as
        // `string | unknown[]` for type safety on our side.
        node.dest as string | unknown[] as Parameters<
          PDFLinkService["goToDestination"]
        >[0],
      );
    }
  };

  const toggleOutline = () => {
    setOutlineOpen(!outlineOpen());
    persist();
  };

  // Outline state for the toolbar button: tri-state so the button can
  // distinguish "still loading" (null) from "no outline embedded" ([])
  // from "have nodes" (length > 0).
  const outlineState = createMemo<"loading" | "empty" | "ready">(() => {
    const o = outline();
    if (o === null) return "loading";
    if (o.length === 0) return "empty";
    return "ready";
  });

  return (
    <div class="flex h-full min-h-0 flex-col bg-surface-sunken">
      <Toolbar
        pageNumber={pageNumber()}
        pageCount={pageCount()}
        scalePct={scalePct()}
        scaleValue={scaleValue()}
        findQuery={findQuery()}
        matches={matches()}
        outlineOpen={outlineOpen()}
        outlineState={outlineState()}
        onToggleOutline={toggleOutline}
        onPrevPage={prevPage}
        onNextPage={nextPage}
        onJumpPage={(n) => goToPage(n)}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onSetPreset={setPreset}
        onFindInput={onFindInput}
        onFindNext={findNext}
        onFindPrev={findPrev}
        bindPageInput={(el) => (pageInputEl = el)}
      />
      <Show when={error()}>
        <div class="m-3 rounded-(--radius-control) border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          failed to load PDF: {error()}
        </div>
      </Show>
      {/* Body: optional outline sidebar + viewer pane. Flex-row so the
          sidebar shrinks/grows on toggle without forcing a viewer
          relayout that pdfjs would interpret as a width change.
          (page-width scale recomputes on width changes, so the
          sidebar's width DOES re-fit pages — that's expected and
          desired: the user opens the outline to navigate, the
          viewer narrows, and pages fit the smaller width. Different
          from a height-only change like the bottom dock.) */}
      <div class="flex min-h-0 flex-1">
        <Show when={outlineOpen() && outlineState() === "ready"}>
          <OutlineSidebar
            nodes={outline() ?? []}
            onPick={goToOutlineEntry}
          />
        </Show>
        {/* PDFViewer requires an `overflow:auto` container with a
            definite size. The inner `pdfViewer` is the element it
            mutates with page DOM. `position:absolute; inset:0` on
            the container makes pdfjs's coordinate math work — see
            the official viewer.css. */}
        <div class="relative min-h-0 min-w-0 flex-1">
          <div
            ref={(el) => (containerEl = el)}
            class="absolute inset-0 overflow-auto"
          >
            <div ref={(el) => (viewerEl = el)} class="pdfViewer" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Recursive outline tree. Each entry with children gets a disclosure
 * caret so deep nesting (typical of full books with chapters →
 * sections → subsections) is collapsible. Plain entries with no
 * children indent under their parent at the same depth-driven
 * padding.
 *
 * Uses local-only signal state for expand/collapse (not persisted).
 * The expanded set resets per-mount; remembering it across remounts
 * felt like overkill given how cheap the toggle is.
 */
function OutlineSidebar(props: {
  nodes: OutlineNode[];
  onPick: (node: OutlineNode) => void;
}): JSX.Element {
  return (
    <aside class="flex h-full w-60 shrink-0 flex-col overflow-y-auto border-r border-border-muted bg-surface px-2 py-2">
      <h3 class="mb-1 px-2 font-display text-[0.6rem] uppercase tracking-[0.2em] text-fg-subtle">
        Outline
      </h3>
      <ul class="flex flex-col gap-px">
        <For each={props.nodes}>
          {(node) => (
            <OutlineRow node={node} depth={0} onPick={props.onPick} />
          )}
        </For>
      </ul>
    </aside>
  );
}

function OutlineRow(props: {
  node: OutlineNode;
  depth: number;
  onPick: (node: OutlineNode) => void;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(props.depth < 1);
  const hasChildren = () => props.node.items.length > 0;
  const indent = () => `${0.5 + props.depth * 0.75}rem`;

  return (
    <li class="flex flex-col">
      <div
        class="group flex items-start gap-1 rounded-(--radius-control) px-1 py-0.5 hover:bg-surface-elevated"
        style={{ "padding-left": indent() }}
      >
        <Show
          when={hasChildren()}
          fallback={<span aria-hidden class="w-3 shrink-0" />}
        >
          <button
            type="button"
            onClick={() => setExpanded(!expanded())}
            class="w-3 shrink-0 font-mono text-[0.6rem] text-fg-subtle hover:text-fg"
            aria-label={expanded() ? "collapse" : "expand"}
            title={expanded() ? "collapse" : "expand"}
          >
            {expanded() ? "▾" : "▸"}
          </button>
        </Show>
        <button
          type="button"
          onClick={() => props.onPick(props.node)}
          disabled={props.node.dest == null}
          title={props.node.title}
          class="flex-1 truncate text-left text-xs text-fg-muted hover:text-fg disabled:cursor-default disabled:opacity-50"
          classList={{
            "font-semibold": props.node.bold,
            italic: props.node.italic,
          }}
        >
          {props.node.title}
        </button>
      </div>
      <Show when={hasChildren() && expanded()}>
        <ul class="flex flex-col gap-px">
          <For each={props.node.items}>
            {(child) => (
              <OutlineRow
                node={child}
                depth={props.depth + 1}
                onPick={props.onPick}
              />
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
}

interface ToolbarProps {
  pageNumber: number;
  pageCount: number;
  scalePct: number;
  scaleValue: string;
  findQuery: string;
  matches: MatchesCount;
  outlineOpen: boolean;
  /** loading: still resolving getOutline(); empty: no outline embedded; ready: have nodes. */
  outlineState: "loading" | "empty" | "ready";
  onToggleOutline: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onJumpPage: (n: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetPreset: (preset: string) => void;
  onFindInput: (q: string) => void;
  onFindNext: () => void;
  onFindPrev: () => void;
  bindPageInput: (el: HTMLInputElement) => void;
}

function Toolbar(props: ToolbarProps): JSX.Element {
  return (
    <div
      class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-muted bg-surface-elevated px-3 py-1.5 text-xs"
      // Password managers see the toolbar's <input> elements and try
      // to autofill — same defensive sweep the dock forms use.
      // (autocomplete only applies to <input>; the per-input attrs
      // below carry the rest of the protection.)
      data-form-type="other"
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
    >
      {/* outline toggle */}
      <button
        type="button"
        onClick={props.onToggleOutline}
        disabled={props.outlineState !== "ready"}
        title={
          props.outlineState === "loading"
            ? "loading outline…"
            : props.outlineState === "empty"
              ? "this PDF has no embedded outline"
              : props.outlineOpen
                ? "hide outline"
                : "show outline"
        }
        aria-pressed={props.outlineOpen}
        class="rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 font-mono text-xs text-fg-muted hover:border-accent hover:text-fg transition disabled:cursor-not-allowed disabled:opacity-40"
        classList={{
          "!border-accent !text-fg":
            props.outlineOpen && props.outlineState === "ready",
        }}
      >
        ☰
      </button>

      <span aria-hidden class="mx-1 h-5 w-px bg-border-muted" />

      {/* page navigation */}
      <div class="flex items-center gap-1">
        <ToolbarButton
          onClick={props.onPrevPage}
          disabled={props.pageNumber <= 1 || props.pageCount === 0}
          title="previous page"
          label="◀"
        />
        <span class="font-mono text-fg-muted">
          <input
            ref={props.bindPageInput}
            type="number"
            min={1}
            max={Math.max(1, props.pageCount)}
            value={props.pageNumber}
            onChange={(e) => {
              const n = Number.parseInt(e.currentTarget.value, 10);
              if (Number.isFinite(n)) props.onJumpPage(n);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const n = Number.parseInt(
                  (e.currentTarget as HTMLInputElement).value,
                  10,
                );
                if (Number.isFinite(n)) props.onJumpPage(n);
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            autocomplete="off"
            spellcheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            class="w-12 rounded-(--radius-control) border border-border bg-surface px-1.5 py-0.5 text-center font-mono text-xs text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
          <span class="ml-1 text-fg-subtle">/ {props.pageCount || "—"}</span>
        </span>
        <ToolbarButton
          onClick={props.onNextPage}
          disabled={
            props.pageNumber >= props.pageCount || props.pageCount === 0
          }
          title="next page"
          label="▶"
        />
      </div>

      <span aria-hidden class="mx-1 h-5 w-px bg-border-muted" />

      {/* zoom */}
      <div class="flex items-center gap-1">
        <ToolbarButton
          onClick={props.onZoomOut}
          disabled={props.pageCount === 0}
          title="zoom out"
          label="−"
        />
        <select
          value={props.scaleValue}
          onChange={(e) => props.onSetPreset(e.currentTarget.value)}
          disabled={props.pageCount === 0}
          class="rounded-(--radius-control) border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
          title={`current zoom: ${props.scalePct}%`}
        >
          <option value="auto">auto</option>
          <option value="page-actual">100%</option>
          <option value="page-fit">fit page</option>
          <option value="page-width">fit width</option>
          <option value="0.5">50%</option>
          <option value="0.75">75%</option>
          <option value="1">100%</option>
          <option value="1.25">125%</option>
          <option value="1.5">150%</option>
          <option value="2">200%</option>
          <option value="3">300%</option>
        </select>
        <ToolbarButton
          onClick={props.onZoomIn}
          disabled={props.pageCount === 0}
          title="zoom in"
          label="+"
        />
        <span class="ml-1 font-mono text-[0.65rem] text-fg-subtle">
          {props.scalePct}%
        </span>
      </div>

      <span aria-hidden class="mx-1 h-5 w-px bg-border-muted" />

      {/* search */}
      <div class="flex flex-1 items-center gap-1">
        <input
          type="search"
          name="pdf-find"
          placeholder="find in document"
          value={props.findQuery}
          onInput={(e) => props.onFindInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (e.shiftKey) props.onFindPrev();
              else props.onFindNext();
            }
          }}
          autocomplete="off"
          spellcheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          class="w-48 rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 font-mono text-xs text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
        <ToolbarButton
          onClick={props.onFindPrev}
          disabled={!props.findQuery || props.matches.total === 0}
          title="previous match (shift-enter)"
          label="↑"
        />
        <ToolbarButton
          onClick={props.onFindNext}
          disabled={!props.findQuery || props.matches.total === 0}
          title="next match (enter)"
          label="↓"
        />
        <Show when={props.findQuery}>
          <span class="ml-1 font-mono text-[0.65rem] text-fg-subtle">
            <Show
              when={props.matches.total > 0}
              fallback={<span class="text-danger/70">no matches</span>}
            >
              {props.matches.current} / {props.matches.total}
            </Show>
          </span>
        </Show>
      </div>
    </div>
  );
}

function ToolbarButton(props: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      aria-label={props.title}
      class="rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 font-mono text-xs text-fg-muted hover:border-accent hover:text-fg transition disabled:cursor-not-allowed disabled:opacity-40"
    >
      {props.label}
    </button>
  );
}
