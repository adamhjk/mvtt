import { definePlugin } from "@vtt/substrate";
import { Formula, RollResult, RolledBy } from "./shared/traits.js";
import { RollResolved } from "./shared/events.js";
import { RequestRoll } from "./shared/commands.js";
import { RollEntrySurface } from "./shared/surfaces.js";
import { RollChatFills } from "./shared/chat-handler.js";
import { RollRecordingSystem } from "./server/systems.js";
import { RollerView, RollTrayView, RollEntryView } from "./client/index.js";

export const resolution = definePlugin({
  name: "@vtt/resolution",
  version: "0.4.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/comms@^0",
    "@vtt/identity@^0",
    "@vtt/permissions@^0",
    "@vtt/shell-default@^0",
  ],
  traits: [Formula, RollResult, RolledBy],
  events: [RollResolved],
  commands: [RequestRoll],
  systems: [RollRecordingSystem],
  surfaces: [RollEntrySurface],
  views: [RollerView, RollTrayView, RollEntryView],
  fills: RollChatFills,
});

export default resolution;
