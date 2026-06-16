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
import { cleanup } from "@solidjs/testing-library";
import { defineSurface, definePlugin, defineView, RootSurface, z } from "./index.js";
import { Surface } from "./client.js";
import { buildTestClient, mountWithClient } from "./client-testing.js";

beforeEach(() => cleanup());

const TestSurface = defineSurface({
  name: "@vtt/_test-surface/Root",
  kind: "single",
  context: z.object({}),
  description: "Test single surface for fallthrough behavior",
});

describe("Surface (single kind, fallthrough)", () => {
  it("uses the highest-priority view when it renders", () => {
    const Hi = defineView({
      name: "Hi",
      surface: TestSurface,
      priority: 200,
      render: () => <div data-testid="hi">hi</div>,
    });
    const Lo = defineView({
      name: "Lo",
      surface: TestSurface,
      priority: 100,
      render: () => <div data-testid="lo">lo</div>,
    });
    const plugin = definePlugin({
      name: "@vtt/_test-surface",
      version: "0.0.0",
      surfaces: [TestSurface],
      views: [Hi, Lo],
    });
    const h = buildTestClient({ plugins: [plugin] });
    const { container } = mountWithClient(h, () => <Surface name={TestSurface.name} />);
    expect(container.querySelector("[data-testid='hi']")).not.toBeNull();
    expect(container.querySelector("[data-testid='lo']")).toBeNull();
  });

  it("falls through to the next view when the higher-priority view returns null", () => {
    const HiGate = defineView({
      name: "HiGate",
      surface: TestSurface,
      priority: 200,
      render: () => null,
    });
    const Lo = defineView({
      name: "Lo",
      surface: TestSurface,
      priority: 100,
      render: () => <div data-testid="lo">lo</div>,
    });
    const plugin = definePlugin({
      name: "@vtt/_test-surface",
      version: "0.0.0",
      surfaces: [TestSurface],
      views: [HiGate, Lo],
    });
    const h = buildTestClient({ plugins: [plugin] });
    const { container } = mountWithClient(h, () => <Surface name={TestSurface.name} />);
    expect(container.querySelector("[data-testid='lo']")).not.toBeNull();
  });

  it("renders nothing when every view declines", () => {
    const HiGate = defineView({
      name: "HiGate",
      surface: TestSurface,
      priority: 200,
      render: () => null,
    });
    const LoGate = defineView({
      name: "LoGate",
      surface: TestSurface,
      priority: 100,
      render: () => null,
    });
    const plugin = definePlugin({
      name: "@vtt/_test-surface",
      version: "0.0.0",
      surfaces: [TestSurface],
      views: [HiGate, LoGate],
    });
    const h = buildTestClient({ plugins: [plugin] });
    const { container } = mountWithClient(h, () => <Surface name={TestSurface.name} />);
    // Surface root exists but has no view-rendered children.
    expect(container.querySelector("[data-testid='lo']")).toBeNull();
    expect(container.querySelector("[data-testid='hi']")).toBeNull();
  });

  it("RootSurface fallthrough — shell-mobile-style gate works for desktop", () => {
    // Reproduces the original regression: a higher-priority view gates
    // itself off (mobile shell on desktop) and the lower-priority view
    // (workbench) must fill RootSurface.
    const MobileGate = defineView({
      name: "MobileGate",
      surface: RootSurface,
      priority: 200,
      render: () => null,
    });
    const Workbench = defineView({
      name: "Workbench",
      surface: RootSurface,
      priority: 100,
      render: () => <div data-testid="workbench">workbench</div>,
    });
    const plugin = definePlugin({
      name: "@vtt/_test-shell",
      version: "0.0.0",
      views: [MobileGate, Workbench],
    });
    const h = buildTestClient({ plugins: [plugin] });
    const { container } = mountWithClient(h, () => <Surface name={RootSurface.name} />);
    expect(container.querySelector("[data-testid='workbench']")).not.toBeNull();
  });
});
