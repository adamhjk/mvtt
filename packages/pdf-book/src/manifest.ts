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
    "@vtt/assets@^0",
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
