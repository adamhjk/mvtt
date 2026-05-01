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

import { defineSystem } from "@vtt/substrate";
import { Pong } from "../shared/traits.js";
import { PingReceived } from "../shared/events.js";

export const PongRecordingSystem = defineSystem({
  name: "PongRecording",
  on: PingReceived,
  reads: [],
  writes: [Pong],
  run: ({ event, world }) => {
    world.spawnAt(event.pongId, [
      Pong({
        message: event.message,
        pingedAt: event.pingedAt,
        pongedAt: event.pongedAt,
      }),
    ]);
    return [];
  },
});
