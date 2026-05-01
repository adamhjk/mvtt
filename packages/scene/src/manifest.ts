import { definePlugin } from "@vtt/substrate";
import { PagesSlot } from "@vtt/shell-workbench/shared";
import { LinkKindsSlot } from "@vtt/notes/shared";
import { sceneLinkKind } from "./shared/scene-link-kind.js";
import {
  LinkedCharacter,
  Position,
  Scene,
  Sprite,
  Token,
  TokenImage,
} from "./shared/traits.js";
import {
  CharacterTokenPlaced,
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
  PlaceCharacterToken,
  RemoveScene,
  RemoveToken,
  UpdateScene,
} from "./shared/commands.js";
import { SceneCanvasSurface } from "./shared/surfaces.js";
import { SceneOverlayTabsSlot, TokenUnderlaysSlot } from "./shared/slot.js";
import {
  SceneUiState,
  SceneUiStateChanged,
  SceneUiStateMirror,
  SetSceneUiState,
} from "./shared/ui-state.js";
import {
  CharacterTokenPlacementSystem,
  SceneSpawningSystem,
  SceneRemovalSystem,
  SceneUpdateSystem,
  TokenSpawningSystem,
  TokenMovementSystem,
  TokenRemovalSystem,
} from "./server/systems.js";
import {
  CharactersOverlayTab,
  SceneCanvasView,
  ScenesPageProvider,
  TokensOverlayTab,
  ConfigOverlayTab,
} from "./client/index.js";

export const scene = definePlugin({
  name: "@vtt/scene",
  version: "0.4.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/identity@^0",
    "@vtt/permissions@^0",
    "@vtt/shell-workbench@^0",
    "@vtt/characters@^0",
    "@vtt/notes@^0",
  ],
  traits: [Scene, Position, Sprite, Token, TokenImage, LinkedCharacter, SceneUiState],
  events: [
    SceneCreated,
    SceneRemoved,
    SceneUpdated,
    TokenCreated,
    TokenMoved,
    TokenRemoved,
    CharacterTokenPlaced,
    SceneUiStateChanged,
  ],
  commands: [
    CreateScene,
    CreateToken,
    MoveToken,
    PlaceCharacterToken,
    RemoveScene,
    RemoveToken,
    UpdateScene,
    SetSceneUiState,
  ],
  systems: [
    SceneSpawningSystem,
    SceneRemovalSystem,
    SceneUpdateSystem,
    TokenSpawningSystem,
    TokenMovementSystem,
    TokenRemovalSystem,
    CharacterTokenPlacementSystem,
    SceneUiStateMirror,
  ],
  surfaces: [SceneCanvasSurface],
  slots: [SceneOverlayTabsSlot, TokenUnderlaysSlot],
  views: [SceneCanvasView],
  fills: {
    [PagesSlot.name]: [ScenesPageProvider],
    [SceneOverlayTabsSlot.name]: [
      ConfigOverlayTab,
      TokensOverlayTab,
      CharactersOverlayTab,
    ],
    [LinkKindsSlot.name]: [sceneLinkKind],
  },
});

export default scene;
