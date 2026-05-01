// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { createMemo, createSignal, onCleanup, type Accessor, For } from "solid-js";
import {
  createStore,
  reconcile,
  unwrap,
  type SetStoreFunction,
  type Store,
} from "solid-js/store";
import type { AnyViewDef, CommandInstance, TraitMeta } from "./define.js";
import type { EntityId, SurfaceName, TraitName } from "./schema.js";
import { useClient } from "./client.js";
import { readTraitWithDefault } from "./derivation.js";

type TraitValue<T extends TraitMeta> = T extends TraitMeta<infer S>
  ? import("zod").z.infer<S>
  : never;

/**
 * Returns a Solid accessor that tracks one trait on one entity.
 * Re-emits when that trait is replaced; stays stable when other traits change.
 */
export function useTrait<T extends TraitMeta>(
  entityId: EntityId,
  trait: T,
): Accessor<TraitValue<T> | undefined> {
  const client = useClient();
  const initial = client.world.get(entityId, [trait]);
  const initialValue =
    initial !== undefined
      ? ((initial as Record<string, unknown>)[shortName(trait.name)] as TraitValue<T>)
      : undefined;
  const [value, setValue] = createSignal<TraitValue<T> | undefined>(initialValue);
  const off = client.world.subscribe((id, name) => {
    if (id !== entityId || name !== trait.name) return;
    const next = client.world.get(entityId, [trait]);
    const resolved =
      next === undefined
        ? undefined
        : (((next as Record<string, unknown>)[shortName(trait.name)]) as TraitValue<T>);
    // Wrap in a thunk so Solid's setter type doesn't mistake a value-shaped
    // payload for the (prev) => next overload — TraitValue<T> can include
    // `Function`-shaped fields after zod v4's type widening.
    setValue(() => resolved);
  });
  onCleanup(off);
  return value;
}

/**
 * Returns a Solid accessor that tracks a deep path inside a trait —
 * the read half of "edit any field, read any field." Re-computes
 * whenever the trait is replaced (trait writes are atomic, so any
 * path inside the trait re-derives from the new value).
 *
 * If the trait isn't attached but its Zod schema declares a default,
 * the default is read through and the path resolved against it. If
 * neither the trait nor a default is available, the accessor returns
 * undefined; kit components render `—` in that state.
 *
 * Path = same shape as `setAtPath` from `@vtt/characters`:
 *   ["scores", "str"]    object property
 *   [0, "name"]          array index + property
 *   []                   the trait value itself
 *
 * Path is read once per call — pass a stable value or wrap the call
 * in `createMemo` if the path itself is reactive.
 */
export function useTraitPath<T extends TraitMeta>(
  entityId: EntityId,
  trait: T,
  path: ReadonlyArray<string | number>,
): Accessor<unknown> {
  const trait$ = useTrait(entityId, trait);
  const client = useClient();
  return createMemo(() => {
    const v = trait$();
    if (v !== undefined) return readPath(v, path);
    // Fall through to readTraitWithDefault for the absent case so a
    // freshly-spawned character with a defaulted trait still surfaces
    // the default value to the UI.
    const fallback = readTraitWithDefault(client.world, entityId, trait);
    if (fallback === undefined) return undefined;
    return readPath(fallback, path);
  });
}

function readPath(root: unknown, path: ReadonlyArray<string | number>): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg];
    } else {
      if (typeof cur !== "object" || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

export interface OptimisticTraitOptions<T extends TraitMeta> {
  /**
   * Build the command that persists a write. Called after the local store
   * has already been mutated, with the unwrapped post-mutation value. The
   * returned command MUST NOT call `world.allocateId()` in its `apply`:
   * this primitive writes one trait on one already-existing entity, and
   * predicting server-allocated ids on the client is silently broken under
   * filtered events. If you need to create entities, use a non-optimistic
   * dispatch.
   */
  readonly write: (next: TraitValue<T>) => CommandInstance;
  /**
   * Initial value override. Used only when the trait isn't attached AND
   * the schema has no `.default(...)`. Discipline: UI-state traits should
   * declare a Zod default; `initial` is the escape hatch for context-
   * dependent initial values.
   */
  readonly initial?: TraitValue<T>;
  /**
   * If set, command dispatch is trailing-edge debounced by this many
   * milliseconds. The local store still updates synchronously on every
   * `setStore` call — only the network write coalesces to one dispatch
   * carrying the latest value. A pending dispatch is flushed synchronously
   * on `onCleanup`. Default 0 (dispatch every setter call).
   */
  readonly debounceMs?: number;
}

/**
 * Optimistic per-trait reactive store. Returns `[store, setStore]` where:
 *
 *   • Reads (`store.foo`) are path-granular — sibling fields can change
 *     without invalidating this read. No more parent re-renders cascading
 *     through the component tree.
 *   • Writes (`setStore(...)`) update the local store synchronously and
 *     dispatch the configured command in parallel.
 *   • Server events for `(entityId, trait)` reconcile the store via
 *     Solid's `reconcile` — server is canonical, last-write-wins.
 *   • An `ack.ok === false` ack rolls the store back to the most recent
 *     server-confirmed value (`lastServerValue`). Disconnect resolves to
 *     `ok: false`, so the same path covers connection drops.
 *
 * Throws at construction if the trait has no value on `entityId`, no Zod
 * `.default(...)`, and no `initial` — the contract is "stable shape from
 * first read", not "consumers handle undefined".
 *
 * Designed for plugin UI state on a per-tab sentinel entity. Not for
 * commands that allocate entities — see `OptimisticTraitOptions.write`.
 */
export function createOptimisticTrait<T extends TraitMeta>(
  entityId: EntityId,
  trait: T,
  options: OptimisticTraitOptions<T>,
): readonly [Store<TraitValue<T>>, SetStoreFunction<TraitValue<T>>] {
  const client = useClient();
  const fromWorld = readTraitWithDefault(client.world, entityId, trait) as
    | TraitValue<T>
    | undefined;
  const seed = fromWorld ?? options.initial;
  if (seed === undefined) {
    throw new Error(
      `createOptimisticTrait: trait ${trait.name} has no value on ${entityId}, no Zod default, and no initial. Add a .default(...) to the schema or pass initial.`,
    );
  }

  // Solid's createStore requires `T extends object`. TraitValue<T> resolves
  // to z.infer<S> which is an object-shaped record in practice, but the
  // generic doesn't know that, hence the intersection narrowing.
  type V = TraitValue<T> & object;
  // Clone on capture for both the store backing and `lastServerValue`. A
  // Solid store proxy is backed by the object passed to createStore;
  // mutations through the proxy mutate that object in place. If we kept
  // `lastServerValue` pointing at the same reference, an optimistic
  // setStore would silently mutate `lastServerValue` too, and the rollback
  // path would have nothing left to roll back to. Trait values are
  // JSON-shaped (see `derivation.ts:251`) so structuredClone is sound.
  const [store, rawSet] = createStore<V>(structuredClone(seed) as V);
  let lastServerValue: V = structuredClone(seed) as V;

  const off = client.world.subscribe((id, name) => {
    if (id !== entityId || name !== trait.name) return;
    const next = readTraitWithDefault(client.world, entityId, trait) as V | undefined;
    if (next === undefined) return;
    lastServerValue = structuredClone(next);
    rawSet(reconcile(next));
  });

  let pending: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (pending !== null) {
      clearTimeout(pending);
      pending = null;
    }
    const handle = client.dispatch(options.write(unwrap(store) as TraitValue<T>));
    handle.ack.then((ack) => {
      if (!ack.ok) rawSet(reconcile(lastServerValue));
    });
  };

  const debounceMs = options.debounceMs ?? 0;
  const set = ((...args: unknown[]) => {
    (rawSet as (...a: unknown[]) => void)(...args);
    if (debounceMs <= 0) {
      flush();
      return;
    }
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(flush, debounceMs);
  }) as SetStoreFunction<TraitValue<T>>;

  onCleanup(() => {
    off();
    if (pending !== null) flush();
  });

  return [store, set] as const;
}

export interface QueryRow {
  readonly id: EntityId;
  readonly values: Record<string, unknown>;
}

/**
 * Returns a Solid accessor that tracks every entity carrying all of `traits`.
 * Re-emits when any matching entity gains, loses, or has any of those traits replaced.
 *
 * Trait values are keyed in `values` by the trait's short name (the segment
 * after the final `/` in its qualified name), so `Pong` for `@vtt/ping/Pong`.
 */
export function useQuery(traits: ReadonlyArray<TraitMeta>): Accessor<QueryRow[]> {
  const client = useClient();
  const watched = new Set<TraitName>(traits.map((t) => t.name));
  const run = (): QueryRow[] => client.world.query(traits);
  const [rows, setRows] = createSignal<QueryRow[]>(run());
  const off = client.world.subscribe((_id, name) => {
    if (!watched.has(name)) return;
    setRows(run());
  });
  onCleanup(off);
  return rows;
}

/**
 * Renders every view registered against `surface`, in priority order.
 * Per-entity surfaces fan out automatically by iterating matching entities.
 */
export function Surface(props: {
  name: SurfaceName;
  context?: Record<string, unknown>;
}) {
  const client = useClient();
  const surface = client.registry.surfaces.get(props.name);
  if (!surface) {
    throw new Error(`unknown surface: ${props.name}`);
  }
  const views = client.registry.viewsForSurface(props.name);

  if (surface.kind === "per-entity") {
    return (
      <For each={views}>
        {(view) => <PerEntityView view={view} extra={props.context ?? {}} />}
      </For>
    );
  }

  const ordered = surface.kind === "single" ? views.slice(0, 1) : views;
  return (
    <For each={ordered}>
      {(view) => <>{view.render(props.context ?? {}) as unknown}</>}
    </For>
  );
}

function PerEntityView(props: {
  view: AnyViewDef;
  extra: Record<string, unknown>;
}) {
  const client = useClient();
  const requires = props.view.requires;
  const [ids, setIds] = createSignal<EntityId[]>(
    client.world.query(requires).map((r) => r.id),
  );
  const watched = new Set<TraitName>(requires.map((t) => t.name));
  const off = client.world.subscribe((_id, name) => {
    if (!watched.has(name)) return;
    setIds(client.world.query(requires).map((r) => r.id));
  });
  onCleanup(off);
  return (
    <For each={ids()}>
      {(entityId) => <>{props.view.render({ ...props.extra, entityId }) as unknown}</>}
    </For>
  );
}

function shortName(name: string): string {
  return name.split("/").pop() ?? name;
}
