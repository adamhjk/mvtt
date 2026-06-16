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
import type { EventInstance, TraitMeta } from "./define.js";
import type { World } from "./world.js";
import type { EntityId, TraitName } from "./schema.js";

/**
 * A derivation is "the value of trait X is a pure function of traits A, B, C
 * on the same entity." When any input changes, the substrate recomputes the
 * output and emits the corresponding `*Changed` event — same rule as a hand-
 * written system, just declarative.
 *
 * Derivations are first-class because the *number itself* needs to be
 * queryable from anywhere — chat interpolation, roll commands, automations,
 * AI tools — not just rendered in a sheet. UI-only derived values would
 * silently lock those capabilities out.
 *
 * Cross-plugin composition uses Zod defaults: a derivation declares an input
 * trait whose `.default(...)` makes it always-present, and other plugins
 * write to that trait to contribute. The dependent plugin doesn't need to
 * know who's writing — just that the trait carries the contract.
 *
 * Where derivations run: server-only by default (deterministic; clients see
 * the result via normal trait sync). `where: "both"` runs them on the client
 * too, for plugins that want client-side prediction of derived numbers.
 */

type ValueOf<T extends TraitMeta> = T extends TraitMeta<infer S> ? z.infer<S> : never;

type ValuesOf<I extends ReadonlyArray<TraitMeta>> = {
  [K in keyof I]: I[K] extends TraitMeta<infer S> ? z.infer<S> : never;
};

export interface DerivationContext {
  readonly entityId: EntityId;
  readonly world: World;
}

export interface DerivationDef<
  Inputs extends ReadonlyArray<TraitMeta> = ReadonlyArray<TraitMeta>,
  Output extends TraitMeta = TraitMeta,
> {
  readonly __kind: "derivation";
  readonly name: string;
  readonly inputs: Inputs;
  readonly output: Output;
  readonly compute: (args: ValuesOf<Inputs>, ctx: DerivationContext) => ValueOf<Output> | undefined;
  /**
   * Build the domain `*Changed` event the substrate emits when this
   * derivation's output value changes. Optional: if omitted, no event is
   * emitted (the trait write still fires reactivity for client signals,
   * but no event flows through systems). Provide one when other systems
   * react to derivative changes — which is most of the time.
   */
  readonly toEvent?: (entityId: EntityId, value: ValueOf<Output>) => EventInstance;
  /**
   * "server" (default): runs only inside the command pipeline; clients
   * see the result via normal trait sync.
   * "both": also runs on the client when an input trait changes there
   * (for predictive UI of derived numbers). The compute fn must be
   * deterministic in either mode.
   */
  readonly where: "server" | "both";
}

/**
 * Storage type for the heterogeneous derivation collection. The compute and
 * toEvent inputs are existential at the bag site — only the registration
 * call site knows the concrete shape. The `any`s mirror the same trick used
 * by `AnySystemDef` for `event` and let a strongly-typed `DerivationDef<I,O>`
 * downcast into the bag without contravariance complaints.
 */
export type AnyDerivationDef = Omit<DerivationDef, "inputs" | "compute" | "toEvent"> & {
  readonly inputs: ReadonlyArray<TraitMeta>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly compute: (args: any, ctx: DerivationContext) => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly toEvent?: (entityId: EntityId, value: any) => EventInstance;
};

export function defineDerivation<
  Inputs extends ReadonlyArray<TraitMeta>,
  Output extends TraitMeta,
>(def: {
  name: string;
  inputs: Inputs;
  output: Output;
  compute: (args: ValuesOf<Inputs>, ctx: DerivationContext) => ValueOf<Output> | undefined;
  toEvent?: (entityId: EntityId, value: ValueOf<Output>) => EventInstance;
  where?: "server" | "both";
}): DerivationDef<Inputs, Output> {
  return {
    __kind: "derivation",
    name: def.name,
    inputs: def.inputs,
    output: def.output,
    compute: def.compute,
    toEvent: def.toEvent,
    where: def.where ?? "server",
  };
}

/**
 * Read a single trait value from an entity, falling back to the trait's Zod
 * `.default(...)` if the trait is absent. Returns undefined only when the
 * entity doesn't exist, the trait is genuinely absent, AND no schema default
 * applies. Used by the derivation runner so a missing input either flows a
 * sensible default through compute or causes the derivation to skip.
 *
 * Read-only synthesis: the default is NOT written into the world — derivations
 * shouldn't materialize traits that never explicitly existed, otherwise the
 * event log fills with traits the user never touched.
 */
export function readTraitWithDefault(world: World, id: EntityId, trait: TraitMeta): unknown {
  if (!world.has(id)) return undefined;
  const got = world.get(id, [trait]);
  if (got !== undefined) {
    const short = trait.name.split("/").pop() ?? trait.name;
    return (got as Record<string, unknown>)[short];
  }
  // Trait not attached — try synthesizing from the schema default.
  const parsed = trait.schema.safeParse(undefined);
  if (parsed.success) return parsed.data;
  return undefined;
}

/**
 * Direct trait-value read with no default fallback — used for the
 * skip-on-unchanged comparison and for invokeRollable. Returns undefined
 * if the entity or the trait is absent.
 */
export function readTraitDirect(world: World, id: EntityId, trait: TraitMeta): unknown {
  if (!world.has(id)) return undefined;
  const got = world.get(id, [trait]);
  if (got === undefined) return undefined;
  const short = trait.name.split("/").pop() ?? trait.name;
  return (got as Record<string, unknown>)[short];
}

/**
 * Topologically sort derivations so each derivation runs after every
 * derivation it depends on. The dependency graph is "trait → derivations
 * that read it as input"; a derivation depends on whatever derivation
 * produces a trait listed in its inputs.
 *
 * Throws on cycle with a message that names the involved traits and
 * derivations. Cycle = "we cannot reach a stable derived state because
 * trait A depends on trait B, B on C, C on A." Better to refuse boot than
 * to discover the loop the first time someone bumps a stat.
 *
 * Throws on "input trait undeclared by any plugin" — fail fast at boot
 * rather than always-skipping silently at runtime.
 */
export function topoSortDerivations(
  derivations: ReadonlyArray<AnyDerivationDef>,
  declaredTraits: ReadonlySet<TraitName>,
): AnyDerivationDef[] {
  // Pre-flight: every input trait must be declared somewhere in the
  // registry. Optional inputs would be a future extension; for now use
  // Zod defaults to express "this trait may be unfilled."
  const errors: string[] = [];
  for (const d of derivations) {
    for (const input of d.inputs) {
      if (!declaredTraits.has(input.name)) {
        errors.push(
          `derivation ${JSON.stringify(d.name)} requires input trait ${JSON.stringify(input.name)} which is not declared by any loaded plugin`,
        );
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`derivation registration failed:\n  - ${errors.join("\n  - ")}`);
  }

  // Build the trait-producer map: for each output trait, which derivation
  // produces it. Multiple derivations producing the same trait is rejected
  // — that would mean two systems racing to compute the "true" value.
  const producer = new Map<TraitName, AnyDerivationDef>();
  for (const d of derivations) {
    const existing = producer.get(d.output.name);
    if (existing) {
      throw new Error(
        `derivation registration failed: trait ${JSON.stringify(d.output.name)} is produced by both ${JSON.stringify(existing.name)} and ${JSON.stringify(d.name)} — only one derivation may write any given trait`,
      );
    }
    producer.set(d.output.name, d);
  }

  // Build the derivation-dependency graph: derivation D depends on
  // derivation E iff E.output is in D.inputs.
  const incoming = new Map<AnyDerivationDef, Set<AnyDerivationDef>>();
  const outgoing = new Map<AnyDerivationDef, Set<AnyDerivationDef>>();
  for (const d of derivations) {
    incoming.set(d, new Set());
    outgoing.set(d, new Set());
  }
  for (const d of derivations) {
    for (const input of d.inputs) {
      const dep = producer.get(input.name);
      if (dep && dep !== d) {
        incoming.get(d)!.add(dep);
        outgoing.get(dep)!.add(d);
      }
    }
  }

  // Kahn's algorithm.
  const sorted: AnyDerivationDef[] = [];
  const ready: AnyDerivationDef[] = [];
  for (const d of derivations) {
    if (incoming.get(d)!.size === 0) ready.push(d);
  }
  while (ready.length > 0) {
    const d = ready.shift()!;
    sorted.push(d);
    for (const next of outgoing.get(d)!) {
      const inc = incoming.get(next)!;
      inc.delete(d);
      if (inc.size === 0) ready.push(next);
    }
  }

  if (sorted.length !== derivations.length) {
    const stuck = derivations.filter((d) => !sorted.includes(d));
    const names = stuck.map((d) => d.name).join(" → ");
    throw new Error(
      `derivation registration failed: cycle detected involving derivations [${names}]. Each derivation's output must not, transitively, feed back into its own inputs.`,
    );
  }

  return sorted;
}

/**
 * Recursive structural equality for the small POJOs traits hold. Sufficient
 * for skip-on-unchanged: the only values traits hold are values that pass
 * `Zod.safeParse`, which means JSON-compatible structures (numbers, strings,
 * booleans, arrays, plain objects). No Maps/Sets/Dates/cycles to worry about.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/**
 * Run one pass of derivations against the set of (entity, trait) pairs
 * that were written during the current tick. Returns the events that
 * should re-enter the system fixpoint (one per derivation whose output
 * actually changed).
 *
 * "One pass" = walk the topo-sorted derivation list once. Within the pass,
 * a derivation may produce output that another later-in-topo derivation
 * reads — the dirty-trait set is mutated as the pass writes, so downstream
 * derivations see the new values via the trait subscriber the caller has
 * already wired up.
 *
 * The runner does NOT loop on its own — that's the system fixpoint's job.
 * A derivation's output may emit an event which triggers a system which
 * writes another trait which re-triggers a derivation. Letting the outer
 * fixpoint orchestrate that loop keeps the contract simple.
 */
export function runDerivationPass(
  derivations: ReadonlyArray<AnyDerivationDef>,
  world: World,
  dirtyTraits: ReadonlyMap<EntityId, ReadonlySet<TraitName>>,
): EventInstance[] {
  const events: EventInstance[] = [];
  for (const d of derivations) {
    const inputNames = new Set(d.inputs.map((t) => t.name));
    // Collect entities whose dirty traits intersect this derivation's
    // declared inputs. Excludes entities the world doesn't have.
    for (const [entityId, traits] of dirtyTraits) {
      if (!world.has(entityId)) continue;
      let touched = false;
      for (const tn of traits) {
        if (inputNames.has(tn)) {
          touched = true;
          break;
        }
      }
      if (!touched) continue;

      // Read all inputs (with Zod defaults). If any required input has
      // no value and no default, skip — the derivation can't produce
      // a meaningful output.
      const args: unknown[] = [];
      let ok = true;
      for (const input of d.inputs) {
        const v = readTraitWithDefault(world, entityId, input);
        if (v === undefined) {
          ok = false;
          break;
        }
        args.push(v);
      }
      if (!ok) continue;

      const next = d.compute(args, { entityId, world });
      if (next === undefined) continue;

      const prev = readTraitDirect(world, entityId, d.output);
      if (deepEqual(prev, next)) continue;

      world.set(entityId, d.output, next);
      if (d.toEvent) events.push(d.toEvent(entityId, next));
    }
  }
  return events;
}
