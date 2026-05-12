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
import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@solidjs/testing-library";
import {
  AdventureUpdateDialog,
  type UpdateDiffPayload,
} from "./client/update-dialog.js";

beforeEach(() => cleanup());

const sampleDiff: UpdateDiffPayload = {
  bundleId: "uuid-1",
  currentVersion: "1.0.0",
  newVersion: "2.0.0",
  notes: [
    { bundlePath: "notes/a.md", title: "A", kind: "fast-forward", blocks: [] },
    { bundlePath: "notes/b.md", title: "B", kind: "conflict", blocks: [
      { kind: "block-changed", blockKey: "foo" },
    ] },
    { bundlePath: "notes/c.md", title: "C", kind: "new", blocks: [] },
    { bundlePath: "notes/d.md", title: "D", kind: "unchanged", blocks: [] },
    { bundlePath: "notes/e.md", title: "E", kind: "removed-upstream", blocks: [] },
  ],
};

describe("AdventureUpdateDialog", () => {
  it("renders one row per note with the correct kind label", () => {
    const { container } = render(() => (
      <AdventureUpdateDialog diff={sampleDiff} onApply={() => {}} />
    ));
    const rows = container.querySelectorAll(".advt-update-note");
    expect(rows).toHaveLength(5);
    expect(rows[0]!.textContent).toContain("Updated upstream");
    expect(rows[1]!.textContent).toContain("Conflict");
    expect(rows[2]!.textContent).toContain("New");
    expect(rows[3]!.textContent).toContain("Unchanged");
    expect(rows[4]!.textContent).toContain("Removed upstream");
  });

  it("seeds defaults: fast-forward → take-theirs, conflict → keep-mine, new → import-new, unchanged → skip", () => {
    let received: ReadonlyArray<{ bundlePath: string; action: string }> | null = null;
    const { getByText } = render(() => (
      <AdventureUpdateDialog
        diff={sampleDiff}
        onApply={(r) => {
          received = r;
        }}
      />
    ));
    fireEvent.click(getByText("Apply"));
    expect(received).not.toBeNull();
    const byPath = Object.fromEntries(received!.map((r) => [r.bundlePath, r.action]));
    expect(byPath["notes/a.md"]).toBe("take-theirs");
    expect(byPath["notes/b.md"]).toBe("keep-mine");
    expect(byPath["notes/c.md"]).toBe("import-new");
    expect(byPath["notes/d.md"]).toBe("skip");
    expect(byPath["notes/e.md"]).toBe("skip");
  });

  it("clicking a different action button updates the choice", () => {
    let received: ReadonlyArray<{ bundlePath: string; action: string }> | null = null;
    const { container, getByText } = render(() => (
      <AdventureUpdateDialog
        diff={sampleDiff}
        onApply={(r) => {
          received = r;
        }}
      />
    ));
    // Find the conflict row's "Take theirs" button
    const conflictRow = container.querySelector(
      '.advt-update-note[data-bundle-path="notes/b.md"]',
    );
    expect(conflictRow).not.toBeNull();
    const takeTheirs = conflictRow!.querySelector(
      '[data-action="take-theirs"]',
    ) as HTMLButtonElement;
    expect(takeTheirs).not.toBeNull();
    fireEvent.click(takeTheirs);
    fireEvent.click(getByText("Apply"));
    const byPath = Object.fromEntries(received!.map((r) => [r.bundlePath, r.action]));
    expect(byPath["notes/b.md"]).toBe("take-theirs");
  });

  it("conflict rows expose a per-block change list in <details>", () => {
    const { container } = render(() => (
      <AdventureUpdateDialog diff={sampleDiff} onApply={() => {}} />
    ));
    const conflictRow = container.querySelector(
      '.advt-update-note[data-bundle-path="notes/b.md"]',
    );
    expect(conflictRow!.querySelector("details")).not.toBeNull();
    expect(conflictRow!.textContent).toContain("foo");
  });

  it("clicking Cancel invokes onCancel when provided", () => {
    let cancelled = false;
    const { getByText } = render(() => (
      <AdventureUpdateDialog
        diff={sampleDiff}
        onApply={() => {}}
        onCancel={() => {
          cancelled = true;
        }}
      />
    ));
    fireEvent.click(getByText("Cancel"));
    expect(cancelled).toBe(true);
  });
});
