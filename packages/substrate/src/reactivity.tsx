import { createSignal, onCleanup, type Accessor, For } from "solid-js";
import type { AnyViewDef, TraitMeta } from "./define.js";
import type { EntityId, SurfaceName, TraitName } from "./schema.js";
import { useClient } from "./client.js";

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
