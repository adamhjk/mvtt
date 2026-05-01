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

import { definePlugin } from "@vtt/substrate";
import { Ping } from "./shared/commands.js";
import { PingReceived } from "./shared/events.js";
import { Pong } from "./shared/traits.js";
import { PongRecordingSystem } from "./server/systems.js";
import { PingButtonView, PongLogView } from "./client/index.js";

export const ping = definePlugin({
  name: "@vtt/ping",
  version: "0.2.0",
  dependsOn: ["@vtt/substrate@^0", "@vtt/shell-default@^0"],
  traits: [Pong],
  events: [PingReceived],
  commands: [Ping],
  systems: [PongRecordingSystem],
  views: [PingButtonView, PongLogView],
});

export default ping;
