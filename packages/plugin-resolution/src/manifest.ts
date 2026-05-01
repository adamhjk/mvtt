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
import { Formula, RollResult, RolledBy } from "./shared/traits.js";
import { RollResolved } from "./shared/events.js";
import { RequestRoll } from "./shared/commands.js";
import { RollChatFills } from "./shared/chat-handler.js";
import { RollRecordingSystem } from "./server/systems.js";
import { RollTimelineFills } from "./client/index.js";

/**
 * The dice-rolling plugin. No standalone UI — input lives in the chat
 * composer's `/r` slash handler (filled into comms's chat-input slot)
 * and output lives in the chat timeline (filled into comms's
 * chat-timeline-contributors slot). Plugins that want a 3D tray
 * animation continue to subscribe to RollResolved (see @vtt/dice-tray).
 */
export const resolution = definePlugin({
  name: "@vtt/resolution",
  version: "0.6.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/characters@^0",
    "@vtt/comms@^0",
    "@vtt/identity@^0",
    "@vtt/permissions@^0",
    "@vtt/shell-workbench@^0",
  ],
  traits: [Formula, RollResult, RolledBy],
  events: [RollResolved],
  commands: [RequestRoll],
  systems: [RollRecordingSystem],
  fills: { ...RollChatFills, ...RollTimelineFills },
});

export default resolution;
