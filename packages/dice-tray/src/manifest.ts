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
