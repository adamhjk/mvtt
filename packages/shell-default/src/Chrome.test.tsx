// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, cleanup } from "@solidjs/testing-library";
import {
  buildTestClient,
  mountWithClient,
} from "@vtt/substrate/client-testing";
import { defineView, clientOnly } from "@vtt/substrate";
import { shellDefault } from "./manifest.js";
import {
  HeaderSurface,
  MainSurface,
  SidebarSurface,
  FooterSurface,
} from "./shared/surfaces.js";
import { ChromeView } from "./client/Chrome.js";
import { definePlugin } from "@vtt/substrate";

beforeEach(() => cleanup());

describe("shell-default ChromeView", () => {
  it("renders the four surface regions even with no fills", () => {
    const h = buildTestClient({ plugins: [shellDefault] });
    const { container } = mountWithClient(h, () => ChromeView.render({}) as never);
    expect(container.querySelector("header")).not.toBeNull();
    expect(container.querySelector("main")).not.toBeNull();
    expect(container.querySelector("aside")).not.toBeNull();
    expect(container.querySelector("footer")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("mvtt");
  });

  it("mounts plugin-contributed views into their target surfaces", () => {
    // Build small contributed views, one per surface, so we can verify
    // each region renders its filler.
    const HeaderFill = defineView({
      name: "HeaderFill",
      surface: HeaderSurface,
      render: clientOnly(() => <span data-testid="header-fill">HEADER</span>),
    });
    const MainFill = defineView({
      name: "MainFill",
      surface: MainSurface,
      render: clientOnly(() => <span data-testid="main-fill">MAIN</span>),
    });
    const SidebarFill = defineView({
      name: "SidebarFill",
      surface: SidebarSurface,
      render: clientOnly(() => <span data-testid="sidebar-fill">SIDEBAR</span>),
    });
    const FooterFill = defineView({
      name: "FooterFill",
      surface: FooterSurface,
      render: clientOnly(() => <span data-testid="footer-fill">FOOTER</span>),
    });
    const fillsPlugin = definePlugin({
      name: "@vtt/test-fills",
      version: "0.0.0",
      views: [HeaderFill, MainFill, SidebarFill, FooterFill],
    });
    const h = buildTestClient({ plugins: [shellDefault, fillsPlugin] });
    mountWithClient(h, () => ChromeView.render({}) as never);
    expect(screen.getByTestId("header-fill")).toBeInTheDocument();
    expect(screen.getByTestId("main-fill")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-fill")).toBeInTheDocument();
    expect(screen.getByTestId("footer-fill")).toBeInTheDocument();
  });
});
