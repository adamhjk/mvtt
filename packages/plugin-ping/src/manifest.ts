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
