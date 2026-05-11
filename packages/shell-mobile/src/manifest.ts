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

import { definePlugin } from "@vtt/substrate";
import { MobileShellView } from "./client/MobileShell.js";
import { SwitchToMobileButtonView } from "./client/SwitchToMobileButton.js";

/**
 * Mobile shell plugin — a touch-optimised layout that replaces the
 * desktop workbench on phones and tablets. Reuses all surfaces and
 * slots from @vtt/shell-workbench; no server-side code.
 *
 * Detection: `(pointer: coarse) and (hover: none)` checked once at
 * mount. User can override via localStorage (`mvtt-shell-preference`).
 * Priority 200 on RootSurface ensures MobileShellView is tried before
 * WorkbenchView (100) — when the gate returns null, the substrate
 * falls through.
 */
export const shellMobile = definePlugin({
  name: "@vtt/shell-mobile",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/shell-workbench@^0",
    "@vtt/characters@^0",
    "@vtt/identity@^0",
    "@vtt/resolution@^0",
  ],
  traits: [],
  events: [],
  commands: [],
  systems: [],
  surfaces: [],
  slots: [],
  views: [MobileShellView, SwitchToMobileButtonView],
});

export default shellMobile;
