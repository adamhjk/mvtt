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

import { definePlugin } from "@vtt/substrate";
import { WorkspaceState, WorkspaceOwner, TabSentinel } from "./shared/traits.js";
import { TabShared, WorkspaceStateChanged, WorkspaceBootstrapped } from "./shared/events.js";
import {
  WorkbenchHeaderSurface,
  WorkbenchChatRailSurface,
  PaletteSurface,
} from "./shared/surfaces.js";
import {
  PagesSlot,
  PaletteCommandsSlot,
  PaletteActionsSlot,
  ChatRailWidgetsSlot,
  WorkbenchStatusSlot,
  NotificationsSlot,
  WorkbenchDrawersSlot,
} from "./shared/slots.js";
import { allCommands } from "./shared/commands.js";
import {
  DismissNotification,
  NotificationDismissed,
  NotificationDismissals,
  NotificationDismissedSystem,
} from "./shared/notifications-dismiss.js";
import {
  TabSharedApplySystem,
  WorkspaceBootstrapSystem,
  WorkspaceStateApplySystem,
} from "./server/systems.js";
import { WorkbenchView } from "./client/Workbench.js";

export const shellWorkbench = definePlugin({
  name: "@vtt/shell-workbench",
  version: "0.1.0",
  dependsOn: ["@vtt/substrate@^0", "@vtt/auth@^0", "@vtt/identity@^0", "@vtt/permissions@^0"],
  traits: [WorkspaceState, WorkspaceOwner, TabSentinel, NotificationDismissals],
  events: [WorkspaceStateChanged, WorkspaceBootstrapped, TabShared, NotificationDismissed],
  commands: [...allCommands, DismissNotification],
  systems: [
    WorkspaceBootstrapSystem,
    WorkspaceStateApplySystem,
    TabSharedApplySystem,
    NotificationDismissedSystem,
  ],
  surfaces: [WorkbenchHeaderSurface, WorkbenchChatRailSurface, PaletteSurface],
  slots: [
    PagesSlot,
    PaletteCommandsSlot,
    PaletteActionsSlot,
    ChatRailWidgetsSlot,
    WorkbenchStatusSlot,
    NotificationsSlot,
    WorkbenchDrawersSlot,
  ],
  views: [WorkbenchView],
});

export default shellWorkbench;
