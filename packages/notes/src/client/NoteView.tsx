import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
  For,
  type JSX,
  type Accessor,
} from "solid-js";
import {
  createOptimisticTrait,
  useClient,
  useQuery,
  useTrait,
} from "@vtt/substrate/client";
import {
  type CommandInstance,
  type EntityId,
} from "@vtt/substrate";
import { OwnedBy } from "@vtt/permissions/shared";
import {
  AddPage,
  BelongsToNote,
  BeginEdit,
  EditorLock,
  EndEdit,
  Note,
  NotesUiState,
  Page,
  PageDraft,
  PageHistory,
  PageOrdering,
  RemovePage,
  RenamePage,
  SetNotesUiState,
  buildLinkKindIndex,
  type WikiLinkRef,
} from "../shared/index.js";
import {
  OpenPage,
  OpenPageInNewTab,
  RetargetTab,
} from "@vtt/shell-workbench/shared";
import { useTabSentinel } from "@vtt/shell-workbench/client";
import { NOTES_KIND } from "./NotesPage.jsx";
import { useMe } from "./use-me.js";
import { useBacklinks } from "./use-backlinks.js";
import { MarkdownView } from "./markdown.jsx";
import { NoteEditor } from "./NoteEditor.jsx";
import { pendingScroll, setPendingScroll } from "./scroll-target.js";

/**
 * The note view: collapsible page rail on the left, read- or edit-mode
 * content on the right. Owner/GM gets the Edit button; other users see
 * "Alice is editing" when the lock is live.
 *
 * v1 keeps it minimal — no drag-reorder, no visibility picker yet.
 * Both layer in cleanly with the existing dnd helper + a popover.
 */
export function NoteView(props: {
  noteId: EntityId;
  /** Workbench tab id — needed for RetargetTab + sentinel-bound UI state. */
  tabId: string;
}): JSX.Element {
  const client = useClient();
  const me = useMe();
  const note = useTrait(props.noteId, Note);
  const allPagesRows = useQuery([Page, BelongsToNote, PageOrdering]);
  const owner = useTrait(props.noteId, OwnedBy);

  // Per-tab UI state lives on the tab sentinel as `NotesUiState`, written
  // optimistically through `createOptimisticTrait`. The store survives
  // the sub-tree (via the workbench Pane re-key boundary) but not a
  // sentinel change — and the sentinel id is derived from `tabId`,
  // which is stable across note retargets.
  const sentinelId = useTabSentinel(props.tabId);
  const [ui, setUi] = createOptimisticTrait(sentinelId, NotesUiState, {
    write: (value) => SetNotesUiState({ entityId: sentinelId, value }),
  });

  const myPages = createMemo(() =>
    allPagesRows()
      .filter(
        (r) =>
          (r.values.BelongsToNote as { noteId: EntityId }).noteId ===
          props.noteId,
      )
      .map((r) => ({
        id: r.id,
        title: (r.values.Page as { title: string }).title,
        ordinal: (r.values.PageOrdering as { ordinal: number }).ordinal,
      }))
      .sort((a, b) => a.ordinal - b.ordinal),
  );

  const setActivePageId = (pid: EntityId | null) => {
    setUi("activePageId", pid);
  };
  /**
   * Atomic "switch page (and optionally scroll to a heading)" used by
   * link clicks within the same note. The page change is the persistent
   * write; the anchor lives in the module-level `pendingScroll` signal
   * so it survives any PageContent remount and gets cleared on a
   * stability timer instead of through trait writes.
   */
  const navigateInNote = (pid: EntityId, anchor: string | null) => {
    if (anchor) armScroll(pid, anchor);
    setUi("activePageId", pid);
  };
  const effectiveActive = createMemo(() => {
    const ids = myPages().map((p) => p.id);
    const a = ui.activePageId;
    if (a && ids.includes(a)) return a as EntityId;
    return ids[0] ?? null;
  });

  // ---- pending scroll target ----------------------------------------
  //
  // Backed by a MODULE-LEVEL signal in `./scroll-target.ts` so it
  // survives any remount of NotesPage / NoteView / PageContent. The
  // workbench refactor reduces the common-case cascade, but reactive
  // sources we don't fully control (server-driven trait replays,
  // cross-tab broadcasts, etc.) can still tear down the subtree.
  // Module-level survives unconditionally.
  //
  // `armScroll` writes the target. `onPageScrolled` doesn't clear
  // immediately — it resets a 600ms stability timer so any further
  // remount in the cascade gets a chance to re-fire its scroll on its
  // fresh scroller. After 600ms of no further scrolls, we clear.
  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  const armScroll = (pageId: EntityId, anchor: string) => {
    if (clearTimer) clearTimeout(clearTimer);
    setPendingScroll({
      worldId: client.worldId() ?? "",
      noteId: props.noteId,
      pageId,
      anchor,
    });
  };
  const onPageScrolled = () => {
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      setPendingScroll(null);
      clearTimer = null;
    }, 600);
  };
  onCleanup(() => {
    if (clearTimer) clearTimeout(clearTimer);
  });

  // Inbound `pendingHeadingId` from the trait (the cross-note path:
  // the outgoing NoteView wrote it BEFORE retargeting the tab so the
  // destination side sees it on first mount). Capture into the
  // module-level pendingScroll, then clear from the trait so it
  // doesn't re-fire on rehydration / unrelated reactivity.
  createEffect(() => {
    const anchor = ui.pendingHeadingId;
    const pageId = ui.activePageId;
    if (!anchor || !pageId) return;
    armScroll(pageId as EntityId, anchor);
    queueMicrotask(() => {
      if (ui.pendingHeadingId !== anchor) return;
      setUi("pendingHeadingId", null);
    });
  });

  const canEdit = createMemo(() => {
    const m = me();
    if (!m) return false;
    if (m.role === "gm") return true;
    const o = owner() as { userId: string } | undefined;
    return o?.userId === m.userId;
  });

  const dispatch = (cmd: CommandInstance) => client.dispatch(cmd as CommandInstance);

  const addPage = () => {
    const title = window.prompt("New page title:", "Untitled");
    if (!title || title.trim().length === 0) return;
    dispatch(AddPage({ noteId: props.noteId, title: title.trim() }));
  };
  const removePage = (pageId: EntityId, title: string) => {
    if (!window.confirm(`Remove page "${title}"?`)) return;
    dispatch(RemovePage({ pageId }));
  };

  const noteTitle = () =>
    (note() as { title: string } | undefined)?.title ?? "(deleted note)";

  return (
    <section class="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <header class="flex items-baseline justify-between border-b border-border-muted pb-2">
        <h2
          class="font-display text-2xl tracking-tight text-fg"
          style={{ "font-family": "var(--font-display)" }}
        >
          {noteTitle()}
        </h2>
        <span class="font-mono text-[0.62rem] text-fg-subtle">
          {props.noteId}
        </span>
      </header>
      <div class="flex flex-1 min-h-0 gap-4">
        <PageRail
          pages={myPages()}
          activeId={effectiveActive()}
          onSelect={(id) => setActivePageId(id)}
          onAdd={canEdit() ? addPage : null}
          onRemove={
            canEdit()
              ? (id, t) => {
                  if (myPages().length === 1) {
                    window.alert("Can't remove the last page.");
                    return;
                  }
                  removePage(id, t);
                }
              : null
          }
        />
        <div class="flex flex-1 min-w-0 min-h-0 flex-col gap-2">
          <Show
            keyed
            when={effectiveActive()}
            fallback={
              <p class="text-fg-subtle italic">No pages — add one to start.</p>
            }
          >
            {(id) => (
              <PageContent
                pageId={id}
                noteId={props.noteId}
                tabId={props.tabId}
                sentinelId={sentinelId}
                canEdit={canEdit()}
                meUserId={me()?.userId ?? null}
                onSelectPage={(pid, anchor) =>
                  navigateInNote(pid, anchor ?? null)
                }
                pendingAnchor={() => {
                  const ps = pendingScroll();
                  if (!ps) return null;
                  if (ps.worldId !== (client.worldId() ?? "")) return null;
                  if (ps.noteId !== props.noteId) return null;
                  if (ps.pageId !== id) return null;
                  return ps.anchor;
                }}
                onScrolled={onPageScrolled}
                armScroll={armScroll}
              />
            )}
          </Show>
          <BacklinksFooter noteId={props.noteId} />
        </div>
      </div>
    </section>
  );
}

function BacklinksFooter(props: { noteId: EntityId }): JSX.Element {
  const client = useClient();
  const links = useBacklinks({ kind: "note", noteId: props.noteId });
  return (
    <Show when={links().length > 0}>
      <footer class="border-t border-border-muted pt-2 text-xs text-fg-subtle">
        <span class="font-display tracking-[0.18em] uppercase">
          Backlinks · {links().length}
        </span>
        <ul class="mt-1 flex flex-wrap gap-2">
          <For each={links()}>
            {(b) => (
              <li>
                <button
                  type="button"
                  onClick={() =>
                    client.dispatch(
                      // We don't know the workbench tab id from here,
                      // so we open in a hub-style: the user can click
                      // through. v1 placeholder — full navigation lands
                      // when peek/navigate handlers are wired by the
                      // shell.
                      // eslint-disable-next-line
                      ({} as never) as CommandInstance,
                    )
                  }
                  class="rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 text-fg-muted hover:border-accent hover:text-fg transition"
                  title={`From ${b.sourceNoteTitle} › ${b.sourcePageTitle}`}
                >
                  {b.sourceNoteTitle} › {b.sourcePageTitle}
                </button>
              </li>
            )}
          </For>
        </ul>
      </footer>
    </Show>
  );
}

function PageRail(props: {
  pages: ReadonlyArray<{ id: EntityId; title: string; ordinal: number }>;
  activeId: EntityId | null;
  onSelect: (id: EntityId) => void;
  onAdd: (() => void) | null;
  onRemove: ((id: EntityId, title: string) => void) | null;
}): JSX.Element {
  return (
    <aside class="w-48 shrink-0 flex flex-col gap-1 border-r border-border-muted pr-3">
      <h3 class="font-display text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle pb-1">
        Pages
      </h3>
      <ul class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-px">
        <For each={props.pages}>
          {(p) => (
            <li>
              <button
                type="button"
                onClick={() => props.onSelect(p.id)}
                class={[
                  "w-full text-left px-2 py-1 rounded-(--radius-control) text-sm flex items-center gap-2 group",
                  p.id === props.activeId
                    ? "bg-accent text-accent-fg"
                    : "text-fg hover:bg-surface-elevated",
                ].join(" ")}
              >
                <span class="flex-1 truncate">{p.title}</span>
                <Show when={props.onRemove && p.id === props.activeId}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onRemove?.(p.id, p.title);
                    }}
                    class="opacity-0 group-hover:opacity-100 text-[0.7rem] hover:text-danger transition"
                    title="Remove page"
                  >
                    ✕
                  </button>
                </Show>
              </button>
            </li>
          )}
        </For>
      </ul>
      <Show when={props.onAdd}>
        <button
          type="button"
          onClick={() => props.onAdd?.()}
          class="text-left px-2 py-1 rounded-(--radius-control) text-xs text-fg-subtle border border-dashed border-border-muted hover:border-accent hover:text-fg transition"
        >
          + Add page
        </button>
      </Show>
    </aside>
  );
}

function PageContent(props: {
  pageId: EntityId;
  noteId: EntityId;
  tabId: string;
  /**
   * The per-tab sentinel entity id — same value `useTabSentinel(tabId)`
   * returns. Passed in (rather than recomputed) so the cross-note link
   * path can write `NotesUiState` on this sentinel before retargeting
   * without recomputing the sentinel id from the tab id.
   */
  sentinelId: EntityId;
  canEdit: boolean;
  meUserId: string | null;
  /**
   * Switch the active page in this note. `anchor` (when set) is the
   * heading id to scroll to once the new page is rendered. Same-note
   * navigation only — cross-note goes through SetNotesUiState +
   * RetargetTab in the click handler below.
   */
  onSelectPage: (pageId: EntityId, anchor?: string | null) => void;
  /**
   * Reactive accessor returning the heading anchor we should scroll
   * to right now (or null). Lifted to NoteView so it survives any
   * PageContent remount.
   */
  pendingAnchor: Accessor<string | null>;
  /** Notify NoteView that a scroll just landed (resets stability timer). */
  onScrolled: () => void;
  /** Arm a fresh anchor (used by same-page link clicks). */
  armScroll: (pageId: EntityId, anchor: string) => void;
}): JSX.Element {
  const client = useClient();
  const page = useTrait(props.pageId, Page);
  const draft = useTrait(props.pageId, PageDraft);
  const lock = useTrait(props.pageId, EditorLock);

  const [editing, setEditing] = createSignal(false);

  /**
   * Click on a wiki-link chip in read-mode markdown. For the note kind,
   * intra-note (Note > Page) clicks just switch the active page; cross-
   * note clicks RetargetTab the workbench tab so the user stays in
   * their reading flow. Heading anchors flow through `pendingHeadingId`
   * (uiState for cross-mount cases, local signal for same-page).
   *
   * For other kinds (character, scene, asset, …), a `navigate`
   * activation dispatches `OpenPage`: focuses an already-open tab
   * pointed at the same `(pageKind, entityId)`, or opens a new tab in
   * the active pane if none exists. Cmd/Ctrl-click forces a new tab.
   * The notes tab is left alone — cross-kind links should not clobber
   * the user's place in the note.
   *
   * v1: peek activations are a no-op (no peek infrastructure yet).
   */
  const onLink = (ref: WikiLinkRef, e: MouseEvent) => {
    const idx = buildLinkKindIndex(client.registry);
    const kind = idx.byName.get(ref.kind);
    if (!kind) return;
    let resolved: unknown;
    try {
      resolved = kind.parse(ref.body, ref.anchor, client.world);
    } catch {
      resolved = null;
    }
    if (resolved === null) return;

    if (ref.kind === "note") {
      const r = resolved as {
        noteId: EntityId;
        pageId: EntityId | null;
        anchor: string | null;
      };
      if (r.noteId === props.noteId) {
        // Same note. Different page → atomic uiState update via
        // navigateInNote (page + anchor land together). Same page +
        // anchor → just arm the NoteView-level pendingScroll directly.
        e.preventDefault();
        if (r.pageId && r.pageId !== props.pageId) {
          props.onSelectPage(r.pageId, r.anchor);
        } else if (r.anchor) {
          props.armScroll(props.pageId, r.anchor);
        }
        return;
      }
      // Different note — write the page+anchor hint to the sentinel's
      // NotesUiState BEFORE retargeting so the new NoteView mounts
      // directly on the requested page and scrolls to the heading.
      // The sentinel survives retarget (its id derives from tabId,
      // which is stable across `RetargetTab`).
      e.preventDefault();
      client.dispatch(
        SetNotesUiState({
          entityId: props.sentinelId,
          value: {
            activePageId: r.pageId ?? null,
            pendingHeadingId: r.anchor ?? null,
          },
        }) as CommandInstance,
      );
      client.dispatch(
        RetargetTab({
          tabId: props.tabId,
          pageKind: NOTES_KIND,
          entityId: r.noteId,
        }) as CommandInstance,
      );
      return;
    }

    const meta = e.metaKey || e.ctrlKey;
    const activation = kind.activate(resolved, {
      modifiers: {
        meta,
        shift: e.shiftKey,
        alt: e.altKey,
      },
    });
    if (activation.type === "navigate") {
      e.preventDefault();
      const payload = {
        pageKind: activation.pageKind,
        entityId: activation.entityId,
      };
      const cmd = meta ? OpenPageInNewTab(payload) : OpenPage(payload);
      client.dispatch(cmd as CommandInstance);
    }
  };

  const lockHolderUserId = createMemo(() => {
    const l = lock() as
      | { userId: string; clientId: string; expires: number }
      | undefined;
    if (!l) return null;
    if (l.expires <= Date.now()) return null;
    if (!l.userId || l.userId === "-") return null;
    return l.userId;
  });
  const isLockedByMe = createMemo(() => {
    const u = lockHolderUserId();
    return u !== null && u === props.meUserId;
  });
  const isLockedByOther = createMemo(() => {
    const u = lockHolderUserId();
    return u !== null && u !== props.meUserId;
  });

  // Effective body — show draft if present (someone is mid-edit) and we
  // don't yet have the durable body for that draft state.
  const effectiveBody = createMemo(() => {
    if (editing()) {
      return null; // editor renders directly
    }
    const d = draft() as { body: string } | undefined;
    if (d && d.body && lockHolderUserId()) return d.body;
    const p = page() as { body: string } | undefined;
    return p?.body ?? "";
  });

  const startEdit = async () => {
    const handle = client.dispatch(
      BeginEdit({ pageId: props.pageId }) as CommandInstance,
    );
    const ack = await handle.ack;
    if (ack.ok) {
      setEditing(true);
    } else {
      window.alert(`Couldn't start editing: ${ack.reason}`);
    }
  };
  const stopEdit = () => {
    client.dispatch(EndEdit({ pageId: props.pageId }) as CommandInstance);
    setEditing(false);
  };

  return (
    <div class="flex h-full min-h-0 flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <PageTitleField pageId={props.pageId} canEdit={props.canEdit} />
        <div class="flex items-center gap-2">
          <Show when={isLockedByOther()}>
            <span class="text-xs text-fg-muted italic">
              ● {lockHolderUserId()} is editing
            </span>
          </Show>
          <Show when={!editing() && props.canEdit && !isLockedByOther()}>
            <button
              type="button"
              onClick={startEdit}
              class="rounded-(--radius-control) border border-border bg-surface px-3 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg transition"
            >
              Edit
            </button>
          </Show>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <Show
          when={editing()}
          fallback={
            <MarkdownView
              body={effectiveBody() ?? ""}
              world={client.world}
              registry={client.registry}
              worldId={client.worldId() ?? ""}
              onLink={onLink}
              scrollToAnchor={props.pendingAnchor()}
              onScrolled={props.onScrolled}
            />
          }
        >
          <NoteEditor pageId={props.pageId} onDone={stopEdit} />
        </Show>
      </div>
      <Show when={!editing()}>
        <PageHistoryFooter pageId={props.pageId} />
      </Show>
    </div>
  );
}

/**
 * Inline-editable page title above the editor. Owner / GM edits in
 * place; everyone else sees a plain heading. Dispatches `RenamePage`
 * on blur or Enter when the value changed; remote renames sync into
 * the input as long as it isn't currently focused (so a teammate's
 * rename doesn't clobber your in-progress edit).
 */
function PageTitleField(props: {
  pageId: EntityId;
  canEdit: boolean;
}): JSX.Element {
  const client = useClient();
  const page = useTrait(props.pageId, Page);
  const remoteTitle = createMemo(
    () => (page() as { title: string } | undefined)?.title ?? "",
  );
  const [local, setLocal] = createSignal(remoteTitle());
  const [focused, setFocused] = createSignal(false);

  // Sync remote → local on every trait change, but only when the input
  // isn't currently focused (so a teammate's rename doesn't clobber
  // your in-progress edit). `on(remoteTitle, ...)` deliberately leaves
  // `focused` untracked: otherwise blurring the input flips `focused`
  // → false and synchronously runs this effect *before* `commit()`
  // reads `local()`, resetting the user's typed value back to the
  // remote title, which makes `commit` bail on the no-change check.
  createEffect(
    on(remoteTitle, (t) => {
      if (!focused()) setLocal(t);
    }),
  );

  const commit = () => {
    const next = local().trim();
    if (next.length === 0) {
      // Reject empty; revert to the canonical title.
      setLocal(remoteTitle());
      return;
    }
    if (next === remoteTitle()) return;
    client.dispatch(
      RenamePage({ pageId: props.pageId, title: next }) as CommandInstance,
    );
  };

  if (!props.canEdit) {
    return (
      <h3
        class="font-display text-4xl leading-tight tracking-tight text-fg truncate"
        style={{ "font-family": "var(--font-display)" }}
      >
        {remoteTitle()}
      </h3>
    );
  }

  return (
    <input
      type="text"
      value={local()}
      onInput={(e) => setLocal(e.currentTarget.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setLocal(remoteTitle());
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      maxLength={200}
      autocomplete="off"
      spellcheck={false}
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      data-form-type="other"
      class="flex-1 min-w-0 rounded-(--radius-control) border border-transparent bg-transparent px-2 py-1 font-display text-4xl leading-tight tracking-tight text-fg outline-none focus:border-border focus:bg-surface hover:border-border-muted transition"
      style={{ "font-family": "var(--font-display)" }}
      placeholder="Page title…"
      title="Click to rename this page"
    />
  );
}

function PageHistoryFooter(props: { pageId: EntityId }): JSX.Element {
  const history = useTrait(props.pageId, PageHistory);
  const [open, setOpen] = createSignal(false);
  const entries = createMemo(() => {
    const h = history() as
      | { entries: Array<{ rev: number; savedAt: number; savedByUserId: string }> }
      | undefined;
    if (!h) return [];
    return [...h.entries].reverse();
  });
  return (
    <Show when={entries().length > 0}>
      <details
        class="border-t border-border-muted pt-2 text-xs text-fg-subtle"
        open={open()}
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary class="cursor-pointer font-display tracking-[0.18em] uppercase">
          History · {entries().length}
        </summary>
        <ul class="mt-1 flex flex-col gap-px">
          <For each={entries()}>
            {(entry) => (
              <li class="flex items-center justify-between gap-2 rounded-(--radius-control) px-2 py-1 hover:bg-surface-elevated">
                <span class="font-mono text-[0.62rem]">rev {entry.rev}</span>
                <span class="flex-1 truncate">{entry.savedByUserId}</span>
                <span class="text-fg-subtle">
                  {formatRelative(entry.savedAt)}
                </span>
              </li>
            )}
          </For>
        </ul>
      </details>
    </Show>
  );
}

function formatRelative(epochMs: number): string {
  const secs = Math.floor((Date.now() - epochMs) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}
