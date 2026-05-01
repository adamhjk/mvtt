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
  z,
  EntityId,
  CommandId,
  ClientId,
  WorldId,
  DEFAULT_WORLD_ID,
  QualifiedNameSchema,
  isQualifiedName,
  qualifiedName,
  traitName,
  eventName,
  commandName,
  surfaceName,
  slotName,
  pluginName,
  isPluginName,
} from "./schema.js";
export type {
  QualifiedName,
  TraitName,
  EventName,
  CommandName,
  SurfaceName,
  SlotName,
  PluginName,
} from "./schema.js";
export { ok, fail } from "./result.js";
export type { Result, Ok, Fail } from "./result.js";
export {
  defineTrait,
  defineEvent,
  defineCommand,
  defineSystem,
  defineSurface,
  defineSlot,
  defineView,
  definePlugin,
  serverOnly,
  clientOnly,
} from "./define.js";
export {
  defineDerivation,
  readTraitWithDefault,
  readTraitDirect,
  topoSortDerivations,
  runDerivationPass,
  deepEqual,
} from "./derivation.js";
export type {
  DerivationDef,
  AnyDerivationDef,
  DerivationContext,
} from "./derivation.js";
export {
  defineRollable,
  invokeRollable,
  previewRollable,
  validateRollables,
} from "./rollable.js";
export type {
  RollableDef,
  AnyRollableDef,
  RollableContext,
} from "./rollable.js";
export {
  RootSurface,
  ConnectionOpened,
  ConnectionClosed,
  substrateCorePlugin,
} from "./core-plugin.js";
export type {
  TraitDef,
  TraitMeta,
  EventDef,
  EventMeta,
  EventInstance,
  CommandDef,
  CommandMeta,
  CommandInstance,
  CommandContext,
  SystemDef,
  AnySystemDef,
  SystemContext,
  SurfaceDef,
  SurfaceMeta,
  SurfaceKind,
  SlotDef,
  SlotMeta,
  ViewDef,
  AnyViewDef,
  PluginDef,
  EntityVisibilityResolver,
} from "./define.js";
export { World } from "./world.js";
export type { WorldState } from "./world.js";
export { EventBus } from "./event-bus.js";
export { Registry } from "./registry.js";
export { CommandPipeline } from "./command-pipeline.js";
export type { CommandEnvelope, DispatchResult } from "./command-pipeline.js";
export { runSystemsToFixpoint } from "./systems-runner.js";
export { WireMsg } from "./protocol.js";
export { toPersistedEvent } from "./persistence.js";
export type {
  PersistenceAdapter,
  PersistedEvent,
  PersistedSnapshot,
} from "./persistence.js";
export type {
  WorldsRepository,
  WorldRecord,
  MembershipRecord,
  WorldRole,
} from "./worlds-repository.js";
export { resolveActivePlugins, listGameSystems } from "./active-plugins.js";
export type { ActivePluginSet } from "./active-plugins.js";
export { WorldsRegistry, WorldRuntime } from "./worlds-registry.js";
export type { WorldsRegistryOptions } from "./worlds-registry.js";
export { InMemoryWorldsRepository } from "./testing.js";
export { matches, withVisibility } from "./visibility.js";
export type { Visibility, Recipient } from "./visibility.js";
