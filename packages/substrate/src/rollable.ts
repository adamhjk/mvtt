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
import type { CommandDef, CommandInstance, TraitMeta } from "./define.js";
import type { World } from "./world.js";
import type { EntityId } from "./schema.js";
import { readTraitWithDefault } from "./derivation.js";

/**
 * A rollable is "the dice expression for X comes from these traits, and
 * dispatching it goes through this command." Same registration shape as
 * derivations: declared inputs, validated at boot, callable from anywhere
 * (sheet click, chat slash command, automation, AI tool) — so the same
 * formula serves every consumer and can never drift across surfaces.
 *
 * Rollables compute on demand, not on input change. Storing per-character
 * RollSpec traits would be churn for things that may never be rolled, and
 * the value depends on per-click options (advantage, situational mods)
 * anyway. The substrate just wires inputs + opts → spec → command payload.
 *
 * The RollSpec shape is system-defined. D&D's `1d20+N`, Burning Wheel's
 * `Nd6 ob X`, Savage Worlds' wild-die-plus-trait — all expressible because
 * the substrate doesn't enforce a shape; it just routes spec → toPayload →
 * the system's own command.
 */

type ValuesOf<I extends ReadonlyArray<TraitMeta>> = {
  [K in keyof I]: I[K] extends TraitMeta<infer S> ? z.infer<S> : never;
};

export interface RollableContext<Opts = unknown> {
  readonly entityId: EntityId;
  readonly opts: Opts;
}

export interface RollableDef<
  Inputs extends ReadonlyArray<TraitMeta> = ReadonlyArray<TraitMeta>,
  CmdSchema extends z.ZodTypeAny = z.ZodTypeAny,
  OptsSchema extends z.ZodTypeAny = z.ZodTypeAny,
  Spec = unknown,
> {
  readonly __kind: "rollable";
  readonly name: string;
  readonly inputs: Inputs;
  readonly command: CommandDef<CmdSchema>;
  readonly compute: (
    args: ValuesOf<Inputs>,
    ctx: RollableContext<z.infer<OptsSchema>>,
  ) => Spec;
  readonly toPayload: (
    spec: Spec,
    ctx: RollableContext<z.infer<OptsSchema>>,
  ) => z.input<CmdSchema>;
  /**
   * Optional Zod schema for the per-call options bag. When provided, opts
   * are parsed at invocation; the kit's situational-mods popover renders
   * directly from this schema by default. Omit when the rollable takes no
   * per-call options.
   */
  readonly opts?: OptsSchema;
  /**
   * Flagged for the future Help-style interactive flow (multi-actor
   * pre-roll dialog with contributions). When true, the kit dispatches an
   * `OpenPendingRoll` command instead of `command` directly, and `command`
   * is reserved for the eventual commit. v1 just records the flag — the
   * runtime path for interactive rollables is layered on later.
   */
  readonly interactive: boolean;
  /**
   * "server" runs only via dispatch. "both" lets clients also invoke the
   * compute fn locally for previews/automations without a server round
   * trip. Defaults to "both" — rollables are usually safe for client
   * preview because they're just reading current world state.
   */
  readonly where: "server" | "both";
}

export type AnyRollableDef = Omit<
  RollableDef,
  "inputs" | "compute" | "toPayload" | "opts" | "command"
> & {
  readonly inputs: ReadonlyArray<TraitMeta>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly command: CommandDef<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly compute: (args: any, ctx: RollableContext<any>) => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly toPayload: (spec: any, ctx: RollableContext<any>) => unknown;
  readonly opts?: z.ZodTypeAny;
};

export function defineRollable<
  Inputs extends ReadonlyArray<TraitMeta>,
  CmdSchema extends z.ZodTypeAny,
  OptsSchema extends z.ZodTypeAny,
  Spec,
>(def: {
  name: string;
  inputs: Inputs;
  command: CommandDef<CmdSchema>;
  compute: (args: ValuesOf<Inputs>, ctx: RollableContext<z.infer<OptsSchema>>) => Spec;
  toPayload: (spec: Spec, ctx: RollableContext<z.infer<OptsSchema>>) => z.input<CmdSchema>;
  opts?: OptsSchema;
  interactive?: boolean;
  where?: "server" | "both";
}): RollableDef<Inputs, CmdSchema, OptsSchema, Spec> {
  return {
    __kind: "rollable",
    name: def.name,
    inputs: def.inputs,
    command: def.command,
    compute: def.compute,
    toPayload: def.toPayload,
    opts: def.opts,
    interactive: def.interactive ?? false,
    where: def.where ?? "both",
  };
}

/**
 * Build the dispatchable CommandInstance for a registered rollable.
 * Reads inputs from `world` (Zod defaults respected), runs the compute
 * fn, and turns the spec into a CommandInstance via `toPayload`.
 *
 * Returns null when the entity is missing or any required input is
 * absent and has no schema default — the caller can't roll, so no
 * command is built.
 *
 * Used by:
 *   - the kit's `<RollableLabel>` (click → invoke → dispatch)
 *   - chat slash-command interpolation (`/roll dex` → invoke → dispatch)
 *   - AI tools ("describe this roll" → invoke → preview spec without dispatch)
 *   - automations ("if attacker beats DC X" → invoke → check spec.notation)
 */
export function invokeRollable<R extends AnyRollableDef>(
  rollable: R,
  world: World,
  entityId: EntityId,
  opts: unknown = undefined,
): { spec: unknown; command: CommandInstance } | null {
  if (!world.has(entityId)) return null;

  // Validate opts against the schema if one was declared. Default to {}
  // when no schema and no opts were supplied — the compute fn can ignore
  // it, but it's easier to write than `opts?.foo` everywhere.
  let parsedOpts: unknown = opts ?? {};
  if (rollable.opts) {
    const parsed = rollable.opts.safeParse(opts ?? {});
    if (!parsed.success) {
      throw new Error(
        `invokeRollable(${rollable.name}): opts failed schema — ${parsed.error.message}`,
      );
    }
    parsedOpts = parsed.data;
  }

  // Read each declared input (with Zod defaults). Missing input = bail.
  const args: unknown[] = [];
  for (const input of rollable.inputs) {
    const v = readTraitWithDefault(world, entityId, input);
    if (v === undefined) return null;
    args.push(v);
  }

  const ctx: RollableContext<unknown> = { entityId, opts: parsedOpts };
  const spec = rollable.compute(args, ctx);
  const payload = rollable.toPayload(spec, ctx);
  const command = rollable.command(payload as never);
  return { spec, command };
}

/**
 * Preview a rollable without building a command. Same input lookup as
 * `invokeRollable`, but stops after `compute` and returns just the spec.
 * Used for hover tooltips and chat-preview ("@dex → 1d20+3") — anywhere
 * the consumer wants to show what *would* happen without committing.
 */
export function previewRollable<R extends AnyRollableDef>(
  rollable: R,
  world: World,
  entityId: EntityId,
  opts: unknown = undefined,
): unknown | null {
  if (!world.has(entityId)) return null;
  let parsedOpts: unknown = opts ?? {};
  if (rollable.opts) {
    const parsed = rollable.opts.safeParse(opts ?? {});
    if (!parsed.success) return null;
    parsedOpts = parsed.data;
  }
  const args: unknown[] = [];
  for (const input of rollable.inputs) {
    const v = readTraitWithDefault(world, entityId, input);
    if (v === undefined) return null;
    args.push(v);
  }
  return rollable.compute(args, { entityId, opts: parsedOpts });
}

/**
 * Boot-time validation: every rollable's declared inputs must be declared
 * traits, and its command must be a registered command. Same fail-fast
 * philosophy as derivations — a missing reference becomes a startup error,
 * not a runtime "click did nothing."
 */
export function validateRollables(
  rollables: ReadonlyArray<AnyRollableDef>,
  declaredTraits: ReadonlySet<string>,
  declaredCommands: ReadonlySet<string>,
): void {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const r of rollables) {
    if (seen.has(r.name)) {
      errors.push(
        `rollable name ${JSON.stringify(r.name)} is registered more than once`,
      );
      continue;
    }
    seen.add(r.name);
    for (const input of r.inputs) {
      if (!declaredTraits.has(input.name)) {
        errors.push(
          `rollable ${JSON.stringify(r.name)} requires input trait ${JSON.stringify(input.name)} which is not declared by any loaded plugin`,
        );
      }
    }
    if (!declaredCommands.has(r.command.name)) {
      errors.push(
        `rollable ${JSON.stringify(r.name)} dispatches command ${JSON.stringify(r.command.name)} which is not declared by any loaded plugin`,
      );
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `rollable registration failed:\n  - ${errors.join("\n  - ")}`,
    );
  }
}
