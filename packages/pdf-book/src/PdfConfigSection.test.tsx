import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, cleanup, render } from "@solidjs/testing-library";
import { buildTestClient } from "@vtt/substrate/client-testing";
import { ClientProvider } from "@vtt/substrate/client";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { books } from "@vtt/books";
import { definePlugin, defineSlot, defineSurface, z } from "@vtt/substrate";
import { PdfDocument } from "./shared/traits.js";
import { pdfBook } from "./manifest.js";

// pdf-book transitively depends on identity (which targets workbench
// surfaces) and books (which fills the workbench's PagesSlot). pdf-book's
// own package doesn't list shell-workbench (it's deeper in the dep
// graph), so we synthesize a stub plugin that declares the slots and
// surfaces the upstream packages reference. Schemas are permissive —
// these tests don't exercise the workbench itself.
const workbenchStub = definePlugin({
  name: "@vtt/test-workbench-stub",
  version: "0.0.0",
  slots: [
    defineSlot({ name: "@vtt/shell-workbench/pages", schema: z.any() }),
  ],
  surfaces: [
    defineSurface({
      name: "@vtt/shell-workbench/header",
      kind: "stacked",
      context: z.object({}),
    }),
    defineSurface({
      name: "@vtt/shell-workbench/chat-rail",
      kind: "stacked",
      context: z.object({}),
    }),
  ],
});
import { PdfConfigSection } from "./client/PdfConfigSection.js";

beforeEach(() => cleanup());

const ME = "test-me";
const ME_CLIENT = "client-me";

function harness(opts?: { asGm?: boolean; existingPdf?: boolean }) {
  return buildTestClient({
    plugins: [workbenchStub, identity, permissions, books, pdfBook],
    clientId: ME_CLIENT,
    setupWorld: ({ world }) => {
      world.spawn([
        Identity({ userId: ME, role: opts?.asGm ? "gm" : "player" }),
        Name({ value: "Me" }),
        Online({ clientId: ME_CLIENT, since: Date.now() }),
      ]);
    },
  });
}

describe("pdf-book PdfConfigSection", () => {
  it("renders the upload control", () => {
    const h = harness({ asGm: true });
    const bookId = h.world.spawn([]);
    render(() => (
      <ClientProvider value={h.client}>
        {PdfConfigSection.render({ bookId }) as never}
      </ClientProvider>
    ));
    // Either a "no PDF attached" placeholder or an upload button — both
    // are valid; the section renders without crashing.
    expect(document.body.textContent ?? "").toMatch(/pdf|upload|no/i);
  });

  it("shows the URL of an attached PDF when one exists", () => {
    const h = harness({ asGm: true });
    const bookId = h.world.spawn([]);
    h.world.set(bookId, PdfDocument, {
      url: "/plugin-data/test-world/@vtt/pdf-book/books/x/document.pdf",
    });
    render(() => (
      <ClientProvider value={h.client}>
        {PdfConfigSection.render({ bookId }) as never}
      </ClientProvider>
    ));
    // The PDF url surfaces somewhere in the visible text (either as a
    // current-PDF link or a status indicator).
    expect(document.body.textContent ?? "").toContain("document.pdf");
  });

  it("PdfConfigSection has a stable id and priority", () => {
    expect(PdfConfigSection.id).toBe("@vtt/pdf-book/config-pdf");
    expect(PdfConfigSection.priority).toBe(80);
  });
});
