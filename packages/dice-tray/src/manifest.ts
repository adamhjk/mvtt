import { definePlugin } from "@vtt/substrate";
import { WorkbenchDrawersSlot } from "@vtt/shell-workbench/shared";
import { DiceTrayDrawer } from "./client/DiceTrayDrawer.js";

/**
 * The dice-tray plugin contributes a single drawer fill — a 3D tray
 * that auto-opens on `RollResolved` and animates each die in the
 * event's payload onto its server-authoritative face. No traits,
 * events, commands, or systems of its own; the resolution plugin
 * is the source of truth for outcomes.
 */
export const diceTray = definePlugin({
  name: "@vtt/dice-tray",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/shell-workbench@^0",
    "@vtt/resolution@^0",
  ],
  fills: {
    [WorkbenchDrawersSlot.name]: [DiceTrayDrawer],
  },
});

export default diceTray;
