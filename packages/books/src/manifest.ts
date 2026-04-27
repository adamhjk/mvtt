import { definePlugin } from "@vtt/substrate";
import { PagesSlot } from "@vtt/shell-workbench/shared";
import { Book } from "./shared/traits.js";
import {
  BookCreated,
  BookRemoved,
  BookUpdated,
} from "./shared/events.js";
import {
  CreateBook,
  RemoveBook,
  UpdateBook,
} from "./shared/commands.js";
import { BookCanvasSurface } from "./shared/surfaces.js";
import { BookConfigSectionsSlot, BookOverlayTabsSlot } from "./shared/slot.js";
import {
  BookSpawningSystem,
  BookRemovalSystem,
  BookUpdateSystem,
} from "./server/systems.js";
import {
  BooksPageProvider,
  ConfigOverlayTab,
  BookCanvasFallbackView,
} from "./client/index.js";

export const books = definePlugin({
  name: "@vtt/books",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/identity@^0",
    "@vtt/permissions@^0",
    "@vtt/shell-workbench@^0",
  ],
  traits: [Book],
  events: [BookCreated, BookRemoved, BookUpdated],
  commands: [CreateBook, RemoveBook, UpdateBook],
  systems: [BookSpawningSystem, BookRemovalSystem, BookUpdateSystem],
  surfaces: [BookCanvasSurface],
  slots: [BookOverlayTabsSlot, BookConfigSectionsSlot],
  views: [BookCanvasFallbackView],
  fills: {
    [PagesSlot.name]: [BooksPageProvider],
    [BookOverlayTabsSlot.name]: [ConfigOverlayTab],
  },
});

export default books;
