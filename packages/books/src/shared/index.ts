export { Book } from "./traits.js";
export {
  BookCreated,
  BookRemoved,
  BookUpdated,
} from "./events.js";
export {
  CreateBook,
  RemoveBook,
  UpdateBook,
} from "./commands.js";
export {
  BooksUiState,
  BooksUiStateChanged,
  BooksUiStateMirror,
  SetBooksUiState,
} from "./ui-state.js";
export { BookCanvasSurface } from "./surfaces.js";
export {
  BookOverlayTabsSlot,
  type BookOverlayTab,
  type BookOverlayTabRenderArgs,
  BookConfigSectionsSlot,
  type BookConfigSection,
  type BookConfigSectionRenderArgs,
} from "./slot.js";
export { bookLinkKind } from "./book-link-kind.js";
export {
  pendingBookNav,
  publishBookNav,
  clearBookNav,
  type PendingBookNav,
  __resetPendingBookNavForTests,
} from "./pending-nav.js";
