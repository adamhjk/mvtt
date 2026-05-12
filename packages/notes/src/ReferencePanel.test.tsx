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

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@solidjs/testing-library";
import { ClientProvider } from "@vtt/substrate/client";
import { buildTestClient } from "@vtt/substrate/client-testing";
import { definePlugin, z } from "@vtt/substrate";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { notes } from "./manifest.js";
import { ReferencePanel } from "./client/ReferencePanel.jsx";
import {
  NotesReferenceSlot,
  type ReferenceProvider,
} from "./shared/index.js";

beforeEach(() => cleanup());

/**
 * Stub reference provider so the test isn't coupled to the adventures
 * plugin (which would create a circular dep: adventures depends on
 * notes). Mirrors what `@vtt/adventures` actually contributes.
 */
const stubProvider: ReferenceProvider = {
  name: "stub-blocks",
  build: () => [
    {
      id: "block:demo",
      group: "Fenced blocks",
      title: "demo",
      summary: "Demo fenced block for tests",
      example: "```demo example\nname: thing\n```",
      fields: [
        {
          path: "name",
          type: "string",
          required: true,
          description: "Display name",
        },
        {
          path: "type",
          type: "enum: weapon | armor | supply",
          required: false,
          default: '"weapon"',
        },
      ],
    },
  ],
};

const stubPlugin = definePlugin({
  name: "@vtt/test-stub-block-reference",
  version: "0",
  dependsOn: ["@vtt/notes@^0"],
  traits: [],
  fills: {
    [NotesReferenceSlot.name]: [stubProvider as never],
  },
});

function harnessWithStub() {
  return buildTestClient({
    plugins: [shellWorkbench, identity, permissions, notes, stubPlugin],
  });
}

function notesOnlyHarness() {
  return buildTestClient({
    plugins: [shellWorkbench, identity, permissions, notes],
  });
}

describe("ReferencePanel", () => {
  it("renders sections from registered providers", () => {
    const h = harnessWithStub();
    render(() => (
      <ClientProvider value={h.client}>
        <ReferencePanel />
      </ClientProvider>
    ));

    const section = document.querySelector(
      `[data-testid="reference-section-block:demo"]`,
    );
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain("demo");
    expect(section?.textContent).toContain("Demo fenced block for tests");
  });

  it("renders the notes-built-in wiki-link sections without other providers", () => {
    const h = notesOnlyHarness();
    render(() => (
      <ClientProvider value={h.client}>
        <ReferencePanel />
      </ClientProvider>
    ));

    expect(
      document.querySelector(
        `[data-testid="reference-section-notes:wiki-link-syntax"]`,
      ),
    ).not.toBeNull();
    expect(
      document.querySelector(
        `[data-testid="reference-section-notes:link-kinds"]`,
      ),
    ).not.toBeNull();
  });

  it("filters sections by the search input", () => {
    const h = harnessWithStub();
    render(() => (
      <ClientProvider value={h.client}>
        <ReferencePanel />
      </ClientProvider>
    ));

    const input = screen.getByPlaceholderText("Filter…") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "demo" } });

    // demo block still matches.
    expect(
      document.querySelector(`[data-testid="reference-section-block:demo"]`),
    ).not.toBeNull();
    // The wiki-link sections don't mention "demo" — they should drop out.
    expect(
      document.querySelector(
        `[data-testid="reference-section-notes:wiki-link-syntax"]`,
      ),
    ).toBeNull();
  });

  it("invokes onInsert with the example body when Insert is clicked", () => {
    const h = harnessWithStub();
    const inserted: string[] = [];
    render(() => (
      <ClientProvider value={h.client}>
        <ReferencePanel onInsert={(text) => inserted.push(text)} />
      </ClientProvider>
    ));
    const demoSection = document.querySelector(
      `[data-testid="reference-section-block:demo"]`,
    ) as HTMLElement;
    fireEvent.click(
      within(demoSection).getByRole("button", { name: /insert at cursor/i }),
    );
    expect(inserted.length).toBe(1);
    expect(inserted[0]).toMatch(/^```demo example/);
  });

  it("expands a section's field table on click", () => {
    const h = harnessWithStub();
    render(() => (
      <ClientProvider value={h.client}>
        <ReferencePanel />
      </ClientProvider>
    ));
    const section = document.querySelector(
      `[data-testid="reference-section-block:demo"]`,
    ) as HTMLElement;
    fireEvent.click(
      within(section).getByRole("button", { name: /show fields/i }),
    );
    // After expansion the field list renders as a <ul>. We assert the
    // path codes, type strings, and the enum option both appear; layout
    // (table vs. list) isn't part of the contract.
    const list = section.querySelector("ul");
    expect(list).not.toBeNull();
    expect(list!.textContent).toContain("name");
    expect(list!.textContent).toContain("type");
    expect(list!.textContent).toContain("enum: weapon | armor | supply");
  });

  it("calls onClose when the Close button is clicked", () => {
    const h = notesOnlyHarness();
    const closed = vi.fn();
    render(() => (
      <ClientProvider value={h.client}>
        <ReferencePanel onClose={closed} />
      </ClientProvider>
    ));
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(closed).toHaveBeenCalledOnce();
  });
});

// Silence unused-import warning if Zod ever drops out of the test surface.
void z;
