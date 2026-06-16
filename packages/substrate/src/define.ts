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

import type { z } from "zod";
import type { World } from "./world.js";
import type { Result } from "./result.js";
import {
  type ClientId,
  type CommandName,
  type EventName,
  type PluginName,
  type SlotName,
  type SurfaceName,
  type TraitName,
  commandName,
  eventName,
  pluginName,
  slotName,
  surfaceName,
  traitName,
} from "./schema.js";

/**
 * Meta types — covariant in their schema parameter, no callable signature.
 * Used wherever the substrate stores or iterates a heterogeneous collection
 * of definitions (registries, plugin manifests, system reads/writes).
 *
 * Def types — extend their Meta with a callable factory and any side-typed
 * callbacks (validate / apply). Used at user-facing definition sites where
 * the schema is concretely known and `value()`/`payload()` callability matters.
 */

export interface TraitMeta<S extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly __kind: "trait";
  readonly name: TraitName;
  readonly schema: S;
  /**
   * When true, this trait represents session/connection-scoped state
   * (presence, "who's currently online", drag ghosts) rather than durable
   * world state. Persisted snapshots skip transient traits, so a server
   * restart doesn't carry "ghost players" or stale presence forward.
   * Synthetic catchup snapshots sent to clients still include them — the
   * client needs the current presence picture as part of catchup.
   */
  readonly transient: boolean;
  /**
   * When true, the trait's value is safe to copy verbatim onto another
   * entity. When false, the trait is identity-bound to the entity it lives
   * on — copying it elsewhere would carry the wrong owner / visibility /
   * id reference. Defaults to true; mark as `share: false` for sentinel
   * markers (TabSentinel.tabId), ownership references (OwnedBy.userId),
   * scoping records (EntityVisibility), and similar.
   *
   * Whole-entity replication paths (workbench tab sharing, future
   * "duplicate entity" verbs) honour this flag when gathering the source's
   * traits.
   */
  readonly share: boolean;
  /**
   * Optional sanitiser called on the trait's current value when it's
   * about to be packaged into a share snapshot. Use it to drop or zero
   * fields whose meaning is owner-specific even though the rest of the
   * trait travels fine.
   *
   * Canonical case: `PdfReaderState.scrollTop` is a pixel offset whose
   * meaning depends on the renderer's container width at `page-width`
   * scale; replaying the sender's offset on a recipient with a
   * differently-sized window lands them on a different page than the
   * sender. The trait's `shareValue` zeroes scrollTop, so the recipient
   * lands at the top of the shared page rather than at a stray pixel
   * coordinate.
   *
   * Returning the input unchanged is a no-op. Pure read — must not
   * dispatch commands or touch the world. The substrate falls back to
   * the raw value when the sanitiser is absent.
   */
  readonly shareValue?: (value: unknown) => unknown;
}

export type TraitFactory<S extends z.ZodTypeAny> = (value: z.input<S>) => {
  name: TraitName;
  value: z.infer<S>;
};

export type TraitDef<S extends z.ZodTypeAny = z.ZodTypeAny> = TraitMeta<S> & TraitFactory<S>;

export interface EventInstance<T = unknown> {
  readonly type: EventName;
  readonly payload: T;
  /**
   * Optional per-instance visibility. Set by command `apply` (typically via
   * `withVisibility(...)`) to restrict which recipients receive this event.
   * The substrate's broadcast filter and tail-replay-on-reconnect both
   * evaluate this against the recipient's session.
   */
  readonly visibility?: import("./visibility.js").Visibility;
}

export interface EventMeta<S extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly __kind: "event";
  readonly name: EventName;
  readonly schema: S;
  /**
   * When true, this event is a fact about the session/connection rather than
   * the durable World — the pipeline skips logging it (so it never enters the
   * future event log or snapshot replay), but it still flows through systems
   * and broadcasts (subject to `broadcast`). Examples: ConnectionOpened/Closed,
   * PlayerJoined/Left, presence-channel signals.
   */
  readonly transient: boolean;
  /**
   * When false, the event is **never** sent over the wire — it's
   * substrate-internal and only flows through server-side systems. Defaults
   * to true. Mark sensitive events (carrying session details, GM secrets)
   * with `broadcast: false` and emit a sanitised public counterpart from a
   * server-side system.
   */
  readonly broadcast: boolean;
}

export type EventFactory<S extends z.ZodTypeAny> = (
  payload: z.input<S>,
) => EventInstance<z.infer<S>>;

export type EventDef<S extends z.ZodTypeAny = z.ZodTypeAny> = EventMeta<S> & EventFactory<S>;

export interface CommandInstance<T = unknown> {
  readonly type: CommandName;
  readonly payload: T;
}

export interface CommandContext<T> {
  readonly cmd: T;
  readonly world: World;
  readonly actor: ClientId;
  /**
   * Registry the command was dispatched against. Most commands ignore
   * this and reach for traits/events imported at module top — but
   * generic commands like `SetField` need it to look up a runtime
   * trait by name (so any plugin's traits become editable through one
   * universal command).
   */
  readonly registry: import("./registry.js").Registry;
  /**
   * Opaque session attached at WS upgrade. Auth-aware plugins narrow this
   * with their own typed accessor; auth-agnostic plugins ignore it.
   */
  readonly session?: unknown;
  /**
   * Optional CAS payload the client supplied with this command — "here's
   * what I believed when I issued this." Plugins compare it against
   * current world state in `validate` and reject stale commands.
   */
  readonly causalState?: unknown;
}

export interface CommandMeta<S extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly __kind: "command";
  readonly name: CommandName;
  readonly schema: S;
  readonly validate: (ctx: CommandContext<z.infer<S>>) => Result;
  readonly apply: (ctx: CommandContext<z.infer<S>>) => EventInstance[];
}

export type CommandFactory<S extends z.ZodTypeAny> = (
  payload: z.input<S>,
) => CommandInstance<z.infer<S>>;

export type CommandDef<S extends z.ZodTypeAny = z.ZodTypeAny> = CommandMeta<S> & CommandFactory<S>;

export interface SystemContext<E> {
  readonly event: E;
  readonly world: World;
  /**
   * Same purpose as `CommandContext.registry` — generic systems (e.g.,
   * the SetField receiver, a debug trait inspector) need to resolve a
   * runtime trait by name. Most systems ignore it and use module-imported
   * trait metas directly.
   */
  readonly registry: import("./registry.js").Registry;
}

export interface SystemDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly __kind: "system";
  readonly name: string;
  readonly on: EventMeta<S>;
  readonly reads: ReadonlyArray<TraitMeta>;
  readonly writes: ReadonlyArray<TraitMeta>;
  readonly run: (ctx: SystemContext<z.infer<S>>) => EventInstance[];
}

/**
 * Storage type for a heterogeneous collection of systems. The pipeline only
 * invokes `run` after matching `on.name` to a concrete event, so the payload
 * type is genuinely existential at the bag site. The `any` here captures that
 * existential — without it TypeScript would force every consumer to either
 * assert or thread a generic through the registry.
 */
export type AnySystemDef = Omit<SystemDef, "on" | "run"> & {
  readonly on: EventMeta;
  readonly run: (ctx: {
    event: any;
    world: World;
    registry: import("./registry.js").Registry;
  }) => EventInstance[];
};

/**
 * A surface is a named UI extension point declared by a plugin. Other plugins
 * fill it with views. The substrate validates that every registered view's
 * `surface` references a declared surface and that its render context is
 * compatible with the surface's context schema.
 *
 * Cardinality:
 *  - "single"     : exactly one view fills this surface. Views are tried in
 *                   priority order (highest first); the first view whose
 *                   render returns a non-null/undefined result wins. A view
 *                   that returns `null` declines the surface and the next
 *                   candidate is tried — letting a higher-priority view gate
 *                   itself at runtime (e.g. the mobile shell on desktop)
 *                   without leaving the surface blank.
 *  - "stacked"    : multiple views, ordered by priority, rendered in sequence
 *  - "per-entity" : like stacked, but rendered once per entity matching the view's `requires`
 */
export type SurfaceKind = "single" | "stacked" | "per-entity";

export interface SurfaceMeta<C extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly __kind: "surface";
  readonly name: SurfaceName;
  readonly kind: SurfaceKind;
  readonly context: C;
  readonly description: string | undefined;
}

export type SurfaceDef<C extends z.ZodTypeAny = z.ZodTypeAny> = SurfaceMeta<C>;

/**
 * A slot is a typed list a plugin maintains and exposes for dependents to
 * fill. The declaring plugin uses `defineSlot()` and lists the slot in its
 * manifest's `slots`. Dependent plugins contribute values via the
 * manifest's `fills` map (keyed by the slot's qualified name); the
 * registry validates each value against the slot's Zod schema at load time.
 *
 * Slots and surfaces are deliberately separate primitives: surfaces are
 * UI extension points (a plugin says "render here, with this context"),
 * slots are data-shape extension points (a plugin says "give me typed
 * values of shape T, I'll decide what to do with them"). A spell plugin
 * declares a `spellTemplates` slot; a content plugin fills it with 300
 * spell templates; the spell plugin reads `registry.fillsForSlot(...)`
 * at runtime.
 */
export interface SlotMeta<S extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly __kind: "slot";
  readonly name: SlotName;
  readonly schema: S;
  readonly description: string | undefined;
}

export type SlotDef<S extends z.ZodTypeAny = z.ZodTypeAny> = SlotMeta<S>;

export interface ViewDef<RenderProps = unknown> {
  readonly __kind: "view";
  readonly name: string;
  readonly surface: SurfaceName;
  readonly requires: ReadonlyArray<TraitMeta>;
  readonly priority: number;
  readonly render: (props: RenderProps) => unknown;
}

/**
 * Storage type for a heterogeneous view collection. The render function's
 * input type is existential at the bag site — the substrate only invokes a
 * view once it has resolved its surface and rendered context, so the
 * specific type only matters at the definition call site.
 */
export type AnyViewDef = Omit<ViewDef, "render"> & {
  readonly render: (props: any) => unknown;
};

/**
 * Resolver that maps an entity's traits to a per-entity visibility, or
 * null if this resolver doesn't claim the entity. The substrate runs
 * registered resolvers in plugin-load order during snapshot dump; the
 * first non-null result wins. Used to make per-entity state respect the
 * same visibility model as events — e.g. a GM-only roll's spawned Roll
 * entity is filtered out of player snapshots.
 */
export type EntityVisibilityResolver = (
  traits: Readonly<Record<string, unknown>>,
) => import("./visibility.js").Visibility | null;

export interface PluginDef {
  readonly __kind: "plugin";
  readonly name: PluginName;
  readonly version: string;
  readonly dependsOn: ReadonlyArray<string>;
  readonly traits: ReadonlyArray<TraitMeta>;
  readonly events: ReadonlyArray<EventMeta>;
  readonly commands: ReadonlyArray<CommandMeta>;
  readonly systems: ReadonlyArray<AnySystemDef>;
  readonly derivations: ReadonlyArray<import("./derivation.js").AnyDerivationDef>;
  readonly rollables: ReadonlyArray<import("./rollable.js").AnyRollableDef>;
  readonly surfaces: ReadonlyArray<SurfaceMeta>;
  readonly slots: ReadonlyArray<SlotMeta>;
  readonly views: ReadonlyArray<AnyViewDef>;
  /**
   * Contributions to other plugins' slots, keyed by the slot's qualified
   * name. Each value array is validated against the target slot's schema
   * when the registry loads this plugin (so a fill for a slot that hasn't
   * been declared yet is a startup error, not a runtime surprise).
   */
  readonly fills: Readonly<Record<string, ReadonlyArray<unknown>>>;
  /**
   * Optional: tell the substrate "if an entity has trait X, here's the
   * Visibility that applies to it." Plugins that own visibility-carrying
   * traits register one of these. The substrate doesn't hardcode any
   * trait names — it runs resolvers in load order at snapshot time.
   */
  readonly entityVisibility?: EntityVisibilityResolver;
  /**
   * Marks this plugin as a *game system* — a chooseable top-level rule
   * system (e.g. `@vtt/system-simple`, `@vtt/dnd5e`). Each world is
   * created against exactly one game-system plugin, and the substrate's
   * per-world Registry only loads that plugin plus its transitive
   * dependsOn (alongside the always-on infrastructure plugins). Worlds
   * whose chosen game system is not present are not bootable.
   */
  readonly gameSystem?: boolean;
  /**
   * Optional seed hook. Called once per world after cold-boot replay,
   * before any client is allowed to attach. Plugins use this to spawn
   * deterministic entities derived from their content catalogs (item
   * templates, spell lists, monster stat blocks, etc.) and to merge
   * upstream catalog updates into already-seeded worlds. The hook
   * runs *outside* the command pipeline — it writes to `world`
   * directly via `spawn`/`spawnAt`/`set` and never emits events into
   * the persisted log.
   *
   * Idempotency is the contract: re-running the seed against an
   * already-seeded world must converge on the same state, only adding
   * new templates that weren't there before and merging updates onto
   * existing entities. Plugins typically achieve this with a sentinel
   * "catalog index" entity whose trait maps templateId → entityId.
   */
  readonly seed?: SeedFn;
}

/**
 * Seed hook signature. The substrate calls this with the live World
 * (post-replay) and the world's Registry. Plugins are responsible
 * for their own idempotency — the same hook may run on every boot
 * of an existing world.
 */
export type SeedFn = (ctx: { world: World; registry: import("./registry.js").Registry }) => void;

function attach<F extends (...a: never[]) => unknown, M extends Record<string, unknown>>(
  fn: F,
  meta: M,
): F & M {
  for (const [k, v] of Object.entries(meta)) {
    Object.defineProperty(fn, k, {
      value: v,
      writable: false,
      configurable: true,
      enumerable: true,
    });
  }
  return fn as F & M;
}

export function defineTrait<S extends z.ZodTypeAny>(def: {
  name: string;
  schema: S;
  transient?: boolean;
  share?: boolean;
  shareValue?: (value: z.infer<S>) => z.infer<S>;
}): TraitDef<S> {
  const name = traitName(def.name);
  const fn: TraitFactory<S> = (value) => ({
    name,
    value: def.schema.parse(value) as z.infer<S>,
  });
  return attach(fn as never, {
    __kind: "trait" as const,
    name,
    schema: def.schema,
    transient: def.transient ?? false,
    share: def.share ?? true,
    shareValue: def.shareValue as ((value: unknown) => unknown) | undefined,
  }) as unknown as TraitDef<S>;
}

export function defineEvent<S extends z.ZodTypeAny>(def: {
  name: string;
  schema: S;
  transient?: boolean;
  broadcast?: boolean;
}): EventDef<S> {
  const name = eventName(def.name);
  const fn: EventFactory<S> = (payload) => ({
    type: name,
    payload: def.schema.parse(payload) as z.infer<S>,
  });
  return attach(fn as never, {
    __kind: "event" as const,
    name,
    schema: def.schema,
    transient: def.transient ?? false,
    broadcast: def.broadcast ?? true,
  }) as unknown as EventDef<S>;
}

export function defineCommand<S extends z.ZodTypeAny>(def: {
  name: string;
  schema: S;
  validate: (ctx: CommandContext<z.infer<S>>) => Result;
  apply: (ctx: CommandContext<z.infer<S>>) => EventInstance[];
}): CommandDef<S> {
  const name = commandName(def.name);
  const fn: CommandFactory<S> = (payload) => ({
    type: name,
    payload: def.schema.parse(payload) as z.infer<S>,
  });
  return attach(fn as never, {
    __kind: "command" as const,
    name,
    schema: def.schema,
    validate: def.validate,
    apply: def.apply,
  }) as unknown as CommandDef<S>;
}

export function defineSystem<S extends z.ZodTypeAny>(def: {
  name: string;
  on: EventDef<S>;
  reads?: ReadonlyArray<TraitMeta>;
  writes?: ReadonlyArray<TraitMeta>;
  run: (ctx: SystemContext<z.infer<S>>) => EventInstance[];
}): SystemDef<S> {
  return {
    __kind: "system",
    name: def.name,
    on: def.on,
    reads: def.reads ?? [],
    writes: def.writes ?? [],
    run: def.run,
  };
}

export function defineSurface<C extends z.ZodTypeAny>(def: {
  name: string;
  kind: SurfaceKind;
  context: C;
  description?: string;
}): SurfaceDef<C> {
  return {
    __kind: "surface",
    name: surfaceName(def.name),
    kind: def.kind,
    context: def.context,
    description: def.description,
  };
}

export function defineSlot<S extends z.ZodTypeAny>(def: {
  name: string;
  schema: S;
  description?: string;
}): SlotDef<S> {
  return {
    __kind: "slot",
    name: slotName(def.name),
    schema: def.schema,
    description: def.description,
  };
}

export function defineView<P = unknown>(def: {
  name: string;
  surface: SurfaceMeta | SurfaceName;
  requires?: ReadonlyArray<TraitMeta>;
  priority?: number;
  render: (props: P) => unknown;
}): ViewDef<P> {
  const surface = typeof def.surface === "string" ? def.surface : def.surface.name;
  return {
    __kind: "view",
    name: def.name,
    surface,
    requires: def.requires ?? [],
    priority: def.priority ?? 0,
    render: def.render,
  };
}

export function definePlugin(def: {
  name: string;
  version: string;
  dependsOn?: ReadonlyArray<string>;
  traits?: ReadonlyArray<TraitMeta>;
  events?: ReadonlyArray<EventMeta>;
  commands?: ReadonlyArray<CommandMeta>;
  systems?: ReadonlyArray<AnySystemDef>;
  derivations?: ReadonlyArray<import("./derivation.js").AnyDerivationDef>;
  rollables?: ReadonlyArray<import("./rollable.js").AnyRollableDef>;
  surfaces?: ReadonlyArray<SurfaceMeta>;
  slots?: ReadonlyArray<SlotMeta>;
  views?: ReadonlyArray<AnyViewDef>;
  fills?: Readonly<Record<string, ReadonlyArray<unknown>>>;
  entityVisibility?: EntityVisibilityResolver;
  gameSystem?: boolean;
  seed?: SeedFn;
}): PluginDef {
  return {
    __kind: "plugin",
    name: pluginName(def.name),
    version: def.version,
    dependsOn: def.dependsOn ?? [],
    traits: def.traits ?? [],
    events: def.events ?? [],
    commands: def.commands ?? [],
    systems: def.systems ?? [],
    derivations: def.derivations ?? [],
    rollables: def.rollables ?? [],
    surfaces: def.surfaces ?? [],
    slots: def.slots ?? [],
    views: def.views ?? [],
    fills: def.fills ?? {},
    entityVisibility: def.entityVisibility,
    gameSystem: def.gameSystem ?? false,
    seed: def.seed,
  };
}

export function serverOnly<F extends (...args: never[]) => unknown>(fn: F): F {
  return fn;
}

export function clientOnly<F extends (...args: never[]) => unknown>(fn: F): F {
  return fn;
}
