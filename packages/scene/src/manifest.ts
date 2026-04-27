import { definePlugin } from "@vtt/substrate";
import { PagesSlot } from "@vtt/shell-workbench/shared";
import { Scene, Position, Sprite, Token } from "./shared/traits.js";
import {
  SceneCreated,
  SceneRemoved,
  SceneUpdated,
  TokenCreated,
  TokenMoved,
  TokenRemoved,
} from "./shared/events.js";
import {
  CreateScene,
  CreateToken,
  MoveToken,
  RemoveScene,
  RemoveToken,
  UpdateScene,
} from "./shared/commands.js";
import { SceneCanvasSurface } from "./shared/surfaces.js";
import { SceneOverlayTabsSlot } from "./shared/slot.js";
import {
  SceneSpawningSystem,
  SceneRemovalSystem,
  SceneUpdateSystem,
  TokenSpawningSystem,
  TokenMovementSystem,
  TokenRemovalSystem,
} from "./server/systems.js";
import {
  SceneCanvasView,
  ScenesPageProvider,
  TokensOverlayTab,
  ConfigOverlayTab,
} from "./client/index.js";

export const scene = definePlugin({
  name: "@vtt/scene",
  version: "0.3.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/identity@^0",
    "@vtt/permissions@^0",
    "@vtt/shell-workbench@^0",
  ],
  traits: [Scene, Position, Sprite, Token],
  events: [
    SceneCreated,
    SceneRemoved,
    SceneUpdated,
    TokenCreated,
    TokenMoved,
    TokenRemoved,
  ],
  commands: [
    CreateScene,
    CreateToken,
    MoveToken,
    RemoveScene,
    RemoveToken,
    UpdateScene,
  ],
  systems: [
    SceneSpawningSystem,
    SceneRemovalSystem,
    SceneUpdateSystem,
    TokenSpawningSystem,
    TokenMovementSystem,
    TokenRemovalSystem,
  ],
  surfaces: [SceneCanvasSurface],
  slots: [SceneOverlayTabsSlot],
  views: [SceneCanvasView],
  fills: {
    [PagesSlot.name]: [ScenesPageProvider],
    [SceneOverlayTabsSlot.name]: [ConfigOverlayTab, TokensOverlayTab],
  },
});

export default scene;
