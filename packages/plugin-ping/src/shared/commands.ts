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

import { defineCommand, ok, z } from "@vtt/substrate";
import { PingReceived } from "./events.js";

export const Ping = defineCommand({
  name: "@vtt/ping/Ping",
  schema: z.object({
    message: z.string().min(1).max(280),
    issuedAt: z.number(),
  }),
  validate: () => ok(),
  apply: ({ cmd, world }) => [
    PingReceived({
      pongId: world.allocateId(),
      message: cmd.message,
      pingedAt: cmd.issuedAt,
      pongedAt: Date.now(),
    }),
  ],
});
