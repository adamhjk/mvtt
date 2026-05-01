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

import { z } from "zod";
import { defineEvent, defineSurface, definePlugin } from "./define.js";

export const RootSurface = defineSurface({
  name: "@vtt/substrate/root",
  kind: "single",
  context: z.object({}),
  description: "The whole page. Filled by exactly one shell plugin's chrome view.",
});

/**
 * A WebSocket connection has been authenticated and accepted. Emitted from
 * the substrate (not from a command) and routed through the system runner so
 * plugins like @vtt/identity can react. `session` is opaque at this layer —
 * auth-aware plugins narrow it with their own schema.
 */
export const ConnectionOpened = defineEvent({
  name: "@vtt/substrate/ConnectionOpened",
  schema: z.object({
    clientId: z.string(),
    session: z.unknown(),
  }),
  transient: true,
  broadcast: false, // carries the connecting user's session — server-internal only
});

export const ConnectionClosed = defineEvent({
  name: "@vtt/substrate/ConnectionClosed",
  schema: z.object({
    clientId: z.string(),
  }),
  transient: true,
  broadcast: false,
});

/**
 * The substrate's built-in plugin. Declares the one universal surface (root)
 * and the WS connection lifecycle events. Every concrete app loads this
 * implicitly so shells have something to fill and identity-style plugins
 * have a session-attached signal to react to.
 */
export const substrateCorePlugin = definePlugin({
  name: "@vtt/substrate",
  version: "0.0.0",
  surfaces: [RootSurface],
  events: [ConnectionOpened, ConnectionClosed],
});
