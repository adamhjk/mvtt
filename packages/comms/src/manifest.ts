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
import { ChatMessage } from "./shared/traits.js";
import { MessageSent } from "./shared/events.js";
import { SendMessage } from "./shared/commands.js";
import {
  ChatInputHandlerSlot,
  ChatTimelineContributorSlot,
} from "./shared/slot.js";
import { MessageRecordingSystem } from "./server/systems.js";
import {
  ChatComposerView,
  ChatStreamView,
} from "./client/index.js";

export const comms = definePlugin({
  name: "@vtt/comms",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/characters@^0",
    "@vtt/identity@^0",
    "@vtt/permissions@^0",
    "@vtt/shell-workbench@^0",
  ],
  traits: [ChatMessage],
  events: [MessageSent],
  commands: [SendMessage],
  systems: [MessageRecordingSystem],
  slots: [ChatInputHandlerSlot, ChatTimelineContributorSlot],
  views: [ChatComposerView, ChatStreamView],
});

export default comms;
