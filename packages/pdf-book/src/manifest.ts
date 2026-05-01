import { definePlugin } from "@vtt/substrate";
import { BookConfigSectionsSlot } from "@vtt/books/shared";
import { PdfDocument } from "./shared/traits.js";
import { PdfDocumentSet } from "./shared/events.js";
import { SetPdfDocument } from "./shared/commands.js";
import {
  PdfReaderState,
  PdfReaderStateChanged,
  PdfReaderStateMirror,
  SetPdfReaderState,
} from "./shared/ui-state.js";
import { PdfDocumentSetSystem } from "./server/systems.js";
import { PdfCanvasView, PdfConfigSection } from "./client/index.js";

export const pdfBook = definePlugin({
  name: "@vtt/pdf-book",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/identity@^0",
    "@vtt/permissions@^0",
    "@vtt/books@^0",
    "@vtt/shell-workbench@^0",
  ],
  traits: [PdfDocument, PdfReaderState],
  events: [PdfDocumentSet, PdfReaderStateChanged],
  commands: [SetPdfDocument, SetPdfReaderState],
  systems: [PdfDocumentSetSystem, PdfReaderStateMirror],
  views: [PdfCanvasView],
  fills: {
    // PDF upload lives inside the Book's built-in Config tab (matches
    // @vtt/scene's Config tab, which houses background-image upload
    // alongside name/grid/colors). No standalone Upload tab — all
    // per-book settings stay in one place.
    [BookConfigSectionsSlot.name]: [PdfConfigSection],
  },
});

export default pdfBook;
