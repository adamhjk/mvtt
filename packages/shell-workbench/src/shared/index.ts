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

export {
  WorkspaceState,
  WorkspaceOwner,
  TabSentinel,
  type WorkspaceTab,
  type WorkspacePane,
  type WorkspaceTree,
  type WorkbenchDrawerState,
} from "./traits.js";
export { tabSentinelEntityId } from "./tab-sentinel.js";
export {
  WorkspaceStateChanged,
  WorkspaceBootstrapped,
} from "./events.js";
export {
  WorkbenchHeaderSurface,
  WorkbenchChatRailSurface,
  PaletteSurface,
} from "./surfaces.js";
export {
  PagesSlot,
  PaletteCommandsSlot,
  ChatRailWidgetsSlot,
  WorkbenchDrawersSlot,
  type PageProvider,
  type PageProviderContext,
  type PageEntity,
  type PageRenderArgs,
  type PaletteCommand,
  type PaletteCommandContext,
  type ChatRailWidget,
  type WorkbenchDrawer,
  type WorkbenchDrawerRenderArgs,
  type DrawerEdge,
} from "./slots.js";
export {
  OpenPage,
  OpenPageInNewTab,
  OpenPageAsSplit,
  CloseTab,
  RetargetTab,
  FocusTab,
  FocusPane,
  ToggleZen,
  MoveTab,
  SetSplitProportions,
  OpenDrawer,
  CloseDrawer,
  ToggleDrawer,
  SetDrawerKeepOpen,
  ResizeDrawer,
  allCommands,
} from "./commands.js";
export { definePageProvider } from "./define-page-provider.js";
