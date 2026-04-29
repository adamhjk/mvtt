import { createSignal } from "solid-js";
import type { EntityId } from "@vtt/substrate";

/**
 * Module-level signal holding the heading the user wants to scroll to
 * next. Lifted outside the component tree because *any* surviving
 * remount of NotesPage / NoteView / PageContent during the
 * cross-note retarget flow will destroy a component-local signal —
 * and there are several reactive sources we don't fully control
 * (server-driven trait replays, cross-tab broadcasts, etc.) that can
 * cause those remounts even after the workbench refactor reduces the
 * common case.
 *
 * Each fresh `PageContent` mount reads the module-level signal: if
 * its `pageId + worldId + noteId` match, it forwards the anchor to
 * `MarkdownView`. After the cascade settles, NoteView's stability
 * timer clears it.
 */
export interface ScrollTarget {
  readonly worldId: string;
  readonly noteId: EntityId;
  readonly pageId: EntityId;
  readonly anchor: string;
}

const [pendingScroll, setPendingScroll] = createSignal<ScrollTarget | null>(
  null,
);

export { pendingScroll, setPendingScroll };
