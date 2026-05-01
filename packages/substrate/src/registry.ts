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

import type {
  AnySystemDef,
  AnyViewDef,
  CommandMeta,
  EntityVisibilityResolver,
  EventMeta,
  PluginDef,
  SlotMeta,
  SurfaceMeta,
  TraitMeta,
} from "./define.js";
import type { AnyDerivationDef } from "./derivation.js";
import { topoSortDerivations } from "./derivation.js";
import type { AnyRollableDef } from "./rollable.js";
import { validateRollables } from "./rollable.js";
import type {
  CommandName,
  EventName,
  PluginName,
  SlotName,
  SurfaceName,
  TraitName,
} from "./schema.js";
import type { Visibility } from "./visibility.js";
import type { z } from "zod";

interface PendingFill {
  readonly contributor: PluginName;
  readonly slot: SlotName;
  readonly values: ReadonlyArray<unknown>;
}

export class Registry {
  readonly traits = new Map<TraitName, TraitMeta>();
  readonly events = new Map<EventName, EventMeta>();
  readonly commands = new Map<CommandName, CommandMeta>();
  readonly surfaces = new Map<SurfaceName, SurfaceMeta>();
  readonly slots = new Map<SlotName, SlotMeta>();
  /**
   * Accumulated slot contributions, keyed by slot name. Each value array is
   * already validated against the slot's schema. The order is the order in
   * which plugins were loaded; consumers are free to sort or use as-is.
   */
  readonly fills = new Map<SlotName, unknown[]>();
  readonly systems: AnySystemDef[] = [];
  /**
   * Derivations registered by plugins. Mutated by `load`; topologically
   * sorted (and cycle-checked) by `validate`. The runtime walks this list
   * in the sorted order so each derivation runs after every derivation it
   * depends on.
   */
  derivations: AnyDerivationDef[] = [];
  /**
   * Rollables registered by plugins, indexed by name. Rollables are
   * looked up by name from kit components, chat handlers, automations,
   * and AI tools — fast hash lookup beats list scan.
   */
  readonly rollables = new Map<string, AnyRollableDef>();
  readonly views: AnyViewDef[] = [];
  readonly plugins: PluginDef[] = [];
  /**
   * Per-entity visibility resolvers contributed by plugins. Walked in
   * load order at snapshot time; the first non-null result wins. Allows
   * the substrate to filter entities per recipient without hardcoding any
   * trait names.
   */
  readonly entityVisibilityResolvers: EntityVisibilityResolver[] = [];

  /** Buffered until `validate()`: fills targeting slots that may not have been declared yet. */
  private pendingFills: PendingFill[] = [];

  load(plugin: PluginDef): void {
    for (const t of plugin.traits) this.traits.set(t.name, t);
    for (const e of plugin.events) this.events.set(e.name, e);
    for (const c of plugin.commands) this.commands.set(c.name, c);
    for (const s of plugin.systems) this.systems.push(s);
    for (const d of plugin.derivations) this.derivations.push(d);
    for (const r of plugin.rollables) this.rollables.set(r.name, r);
    for (const surface of plugin.surfaces) this.surfaces.set(surface.name, surface);
    for (const slot of plugin.slots) this.slots.set(slot.name, slot);
    for (const v of plugin.views) this.views.push(v);
    for (const [rawSlotName, values] of Object.entries(plugin.fills)) {
      this.pendingFills.push({
        contributor: plugin.name,
        slot: rawSlotName as SlotName,
        values,
      });
    }
    if (plugin.entityVisibility) {
      this.entityVisibilityResolvers.push(plugin.entityVisibility);
    }
    this.plugins.push(plugin);
  }

  /**
   * Walk plugin-registered resolvers and return the first non-null
   * Visibility for the given trait map. Returns null if no resolver
   * claims the entity — equivalent to public.
   */
  resolveEntityVisibility(traits: Readonly<Record<string, unknown>>): Visibility | null {
    for (const r of this.entityVisibilityResolvers) {
      const v = r(traits);
      if (v !== null) return v;
    }
    return null;
  }

  /**
   * Run after all plugins are loaded. Verifies every view's `surface`
   * references a registered surface, every fill's slot is declared, and
   * each fill value validates against its slot's schema. Any failure
   * raises with the full list — callers see all the problems at once
   * instead of fixing them one-by-one across restarts.
   */
  validate(): void {
    const errors: string[] = [];
    for (const v of this.views) {
      if (!this.surfaces.has(v.surface)) {
        errors.push(
          `view ${JSON.stringify(v.name)} targets unknown surface ${JSON.stringify(v.surface)}`,
        );
      }
    }
    for (const pending of this.pendingFills) {
      const slot = this.slots.get(pending.slot);
      if (!slot) {
        errors.push(
          `plugin ${JSON.stringify(pending.contributor)} fills unknown slot ${JSON.stringify(pending.slot)}`,
        );
        continue;
      }
      const accepted: unknown[] = [];
      for (let i = 0; i < pending.values.length; i++) {
        const parse = slot.schema.safeParse(pending.values[i]);
        if (!parse.success) {
          errors.push(
            `plugin ${JSON.stringify(pending.contributor)} fill #${i} for slot ${JSON.stringify(pending.slot)} failed schema: ${parse.error.message}`,
          );
        } else {
          accepted.push(parse.data);
        }
      }
      const arr = this.fills.get(pending.slot) ?? [];
      arr.push(...accepted);
      this.fills.set(pending.slot, arr);
    }
    this.pendingFills = [];
    if (errors.length > 0) {
      throw new Error(`registry validation failed:\n  - ${errors.join("\n  - ")}`);
    }

    // Derivations are sorted last because both checks ("input trait must
    // exist somewhere" and "no cycle in producer graph") depend on the
    // full trait registry being populated first. Any failure here is a
    // boot-time error, not a runtime surprise.
    if (this.derivations.length > 0) {
      const declaredTraits = new Set(this.traits.keys());
      this.derivations = topoSortDerivations(this.derivations, declaredTraits);
    }

    if (this.rollables.size > 0) {
      const declaredTraits = new Set<string>(this.traits.keys());
      const declaredCommands = new Set<string>(this.commands.keys());
      validateRollables(
        Array.from(this.rollables.values()),
        declaredTraits,
        declaredCommands,
      );
    }
  }

  viewsForSurface(surface: SurfaceName): AnyViewDef[] {
    return this.views
      .filter((v) => v.surface === surface)
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Typed accessor: pass the SlotMeta the plugin returned from defineSlot
   * and get back its accumulated fills typed to the slot's schema.
   * Returns an empty array if the slot has no contributors.
   */
  fillsForSlot<S extends z.ZodTypeAny>(slot: SlotMeta<S>): z.infer<S>[] {
    return (this.fills.get(slot.name) ?? []) as z.infer<S>[];
  }
}
