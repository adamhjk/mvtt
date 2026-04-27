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
