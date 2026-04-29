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
