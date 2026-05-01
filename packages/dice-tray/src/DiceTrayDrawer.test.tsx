// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { DiceTrayDrawer, DICE_TRAY_DRAWER_ID } from "./client/DiceTrayDrawer.js";
import { RollResolved } from "@vtt/resolution/shared";

/**
 * DiceTrayDrawer renders a Babylon.js 3D scene inside its body. jsdom
 * doesn't ship a working WebGL/Canvas context, so the body itself
 * isn't mounted in test — calling `render` would crash when Babylon
 * touches `canvas.getContext("webgl2")`.
 *
 * Instead we assert the descriptor's metadata: the drawer is wired to
 * the right auto-open event, has the right id/label/edge/priority,
 * and reasonable sizing/timing defaults. The actual 3D rendering is
 * verified by manual play-testing in the browser.
 */
describe("dice-tray DiceTrayDrawer descriptor", () => {
  it("has the canonical id and label", () => {
    expect(DiceTrayDrawer.id).toBe(DICE_TRAY_DRAWER_ID);
    expect(DiceTrayDrawer.id).toBe("@vtt/dice-tray/tray");
    expect(DiceTrayDrawer.label).toBe("Dice tray");
    expect(DiceTrayDrawer.icon).toBe("⚂");
  });

  it("docks to the bottom edge", () => {
    expect(DiceTrayDrawer.edge).toBe("bottom");
  });

  it("auto-opens on a RollResolved event", () => {
    expect(DiceTrayDrawer.autoOpenOn).toBe(RollResolved.name);
  });

  it("auto-closes after a sensible dwell window", () => {
    expect(DiceTrayDrawer.autoCloseAfterMs).toBe(4500);
  });

  it("has a default size that gives the 3D view room to breathe", () => {
    expect(DiceTrayDrawer.defaultSize).toBeGreaterThanOrEqual(400);
  });

  it("has a priority that places it among dock fills predictably", () => {
    expect(typeof DiceTrayDrawer.priority).toBe("number");
  });
});
