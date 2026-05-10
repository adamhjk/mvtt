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
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { screen, cleanup, fireEvent } from "@solidjs/testing-library";
import {
  buildTestClient,
  mountWithClient,
} from "@vtt/substrate/client-testing";
import { shellMobile } from "./manifest.js";
import { shellWorkbench } from "@vtt/shell-workbench";
import { MobileShellView } from "./client/MobileShell.js";
import * as detect from "./client/detect.js";

// jsdom doesn't provide window.matchMedia — polyfill it so
// detectMobileDevice() doesn't throw. Default: desktop (matches=false).
let matchMediaResult = false;
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: matchMediaResult,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

beforeEach(() => {
  cleanup();
  localStorage.clear();
  matchMediaResult = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shell-mobile detect", () => {
  it("respects explicit 'mobile' preference", () => {
    localStorage.setItem("mvtt-shell-preference", "mobile");
    expect(detect.shouldUseMobileShell()).toBe(true);
  });

  it("respects explicit 'desktop' preference", () => {
    localStorage.setItem("mvtt-shell-preference", "desktop");
    expect(detect.shouldUseMobileShell()).toBe(false);
  });

  it("falls back to matchMedia when no preference set", () => {
    // jsdom matchMedia always returns false by default
    expect(detect.shouldUseMobileShell()).toBe(false);
  });

  it("setShellPreference persists and getShellPreference reads it", () => {
    detect.setShellPreference("mobile");
    expect(detect.getShellPreference()).toBe("mobile");
    detect.setShellPreference(null);
    expect(detect.getShellPreference()).toBe(null);
  });
});

describe("MobileShellView", () => {
  it("returns null when shouldUseMobileShell is false (desktop fallthrough)", () => {
    // jsdom reports pointer:fine/hover:hover by default, and no localStorage
    // pref is set, so shouldUseMobileShell() returns false.
    const h = buildTestClient({ plugins: [shellWorkbench, shellMobile] });
    const { container } = mountWithClient(h, () =>
      MobileShellView.render({}) as never,
    );
    // The view should render nothing (null return from clientOnly gate).
    expect(container.querySelector("[data-testid='mobile-shell']")).toBeNull();
  });

  it("renders the mobile shell when preference is 'mobile'", () => {
    localStorage.setItem("mvtt-shell-preference", "mobile");
    const h = buildTestClient({
      plugins: [shellWorkbench, shellMobile],
      session: {
        userId: "me",
        email: "me@test.dev",
        name: "Me",
        role: "player",
      },
    });
    const { container } = mountWithClient(h, () =>
      MobileShellView.render({}) as never,
    );
    expect(
      container.querySelector("[data-testid='mobile-shell']"),
    ).not.toBeNull();
    // Heading should show mvtt
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "mvtt",
    );
  });

  it("shows Character mode by default and can switch to Chat", () => {
    localStorage.setItem("mvtt-shell-preference", "mobile");
    const h = buildTestClient({
      plugins: [shellWorkbench, shellMobile],
      session: {
        userId: "me",
        email: "me@test.dev",
        name: "Me",
        role: "player",
      },
    });
    mountWithClient(h, () => MobileShellView.render({}) as never);

    // Character button should be active
    const charBtn = screen.getByRole("button", { name: /character/i });
    expect(charBtn).toHaveAttribute("aria-pressed", "true");

    // Switch to chat
    const chatBtn = screen.getByRole("button", { name: /chat/i });
    fireEvent.click(chatBtn);
    expect(chatBtn).toHaveAttribute("aria-pressed", "true");
    expect(charBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the hamburger menu when tapped", () => {
    localStorage.setItem("mvtt-shell-preference", "mobile");
    const h = buildTestClient({
      plugins: [shellWorkbench, shellMobile],
      session: {
        userId: "me",
        email: "me@test.dev",
        name: "Me",
        role: "player",
      },
    });
    mountWithClient(h, () => MobileShellView.render({}) as never);

    const menuBtn = screen.getByRole("button", { name: /open menu/i });
    fireEvent.click(menuBtn);

    // The menu should now show "Switch to desktop layout"
    expect(
      screen.getByRole("button", { name: /switch to desktop/i }),
    ).toBeInTheDocument();
  });
});
