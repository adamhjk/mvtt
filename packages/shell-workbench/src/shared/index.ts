export {
  WorkspaceState,
  WorkspaceOwner,
  type WorkspaceTab,
  type WorkspacePane,
  type WorkspaceTree,
  type WorkbenchDrawerState,
} from "./traits.js";
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
  SetTabUiState,
  MoveTab,
  SetSplitProportions,
  OpenDrawer,
  CloseDrawer,
  ToggleDrawer,
  ResizeDrawer,
  allCommands,
} from "./commands.js";
export { definePageProvider } from "./define-page-provider.js";
