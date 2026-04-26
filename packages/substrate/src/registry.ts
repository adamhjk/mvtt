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
