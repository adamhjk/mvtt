import { definePlugin } from "@vtt/substrate";
import {
  WorkspaceState,
  WorkspaceOwner,
  TabSentinel,
} from "./shared/traits.js";
import {
  WorkspaceStateChanged,
  WorkspaceBootstrapped,
} from "./shared/events.js";
import {
  WorkbenchHeaderSurface,
  WorkbenchChatRailSurface,
  PaletteSurface,
} from "./shared/surfaces.js";
import {
  PagesSlot,
  PaletteCommandsSlot,
  ChatRailWidgetsSlot,
  WorkbenchDrawersSlot,
} from "./shared/slots.js";
import { allCommands } from "./shared/commands.js";
import {
  WorkspaceBootstrapSystem,
  WorkspaceStateApplySystem,
} from "./server/systems.js";
import { WorkbenchView } from "./client/Workbench.js";

export const shellWorkbench = definePlugin({
  name: "@vtt/shell-workbench",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/auth@^0",
    "@vtt/identity@^0",
    "@vtt/permissions@^0",
  ],
  traits: [WorkspaceState, WorkspaceOwner, TabSentinel],
  events: [WorkspaceStateChanged, WorkspaceBootstrapped],
  commands: [...allCommands],
  systems: [WorkspaceBootstrapSystem, WorkspaceStateApplySystem],
  surfaces: [
    WorkbenchHeaderSurface,
    WorkbenchChatRailSurface,
    PaletteSurface,
  ],
  slots: [PagesSlot, PaletteCommandsSlot, ChatRailWidgetsSlot, WorkbenchDrawersSlot],
  views: [WorkbenchView],
});

export default shellWorkbench;
