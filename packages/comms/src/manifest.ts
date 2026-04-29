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
