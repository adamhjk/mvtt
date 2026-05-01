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
import { Identity, Name, Online } from "./shared/traits.js";
import { PlayerJoined, PlayerLeft } from "./shared/events.js";
import {
  PlayerSpawningSystem,
  PlayerMirrorSystem,
  PlayerDespawnSystem,
  PlayerLeftMirrorSystem,
} from "./server/systems.js";
import { PlayerListView, UserMenuView } from "./client/index.js";

export const identity = definePlugin({
  name: "@vtt/identity",
  version: "0.1.0",
  dependsOn: ["@vtt/substrate@^0", "@vtt/auth@^0"],
  traits: [Identity, Name, Online],
  events: [PlayerJoined, PlayerLeft],
  systems: [
    PlayerSpawningSystem,
    PlayerMirrorSystem,
    PlayerDespawnSystem,
    PlayerLeftMirrorSystem,
  ],
  views: [PlayerListView, UserMenuView],
});

export default identity;
