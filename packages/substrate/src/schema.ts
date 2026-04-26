import { z } from "zod";

export { z };

export const EntityId = z.string().min(1);
export type EntityId = z.infer<typeof EntityId>;

export const CommandId = z.string().min(1);
export type CommandId = z.infer<typeof CommandId>;

export const ClientId = z.string().min(1);
export type ClientId = z.infer<typeof ClientId>;

/**
 * One server can host many independent live Worlds (sessions, encounters,
 * separate campaigns) keyed by `worldId`. Every persistence call, every
 * event row, and every snapshot row carries it from day one — even though
 * v1 servers only host the `"default"` world. Adding multi-tenancy later
 * is then "let connections name the world they're joining," not "migrate
 * the schema and rewrite every adapter call site."
 */
export const WorldId = z.string().min(1).max(120);
export type WorldId = z.infer<typeof WorldId>;
export const DEFAULT_WORLD_ID: WorldId = "default";

/**
 * Plugin-namespaced names follow the shape `@<scope>/<plugin>/<TypeName>`,
 * mirroring the plugin's package id plus a member name. The brand prevents
 * mixing kinds (a `TraitName` cannot be used where an `EventName` is required)
 * and forces all string→name conversions to go through a validating helper.
 */

declare const QualifiedNameBrand: unique symbol;
declare const TraitNameBrand: unique symbol;
declare const EventNameBrand: unique symbol;
declare const CommandNameBrand: unique symbol;
declare const SurfaceNameBrand: unique symbol;
declare const SlotNameBrand: unique symbol;
declare const PluginNameBrand: unique symbol;

export type QualifiedName = string & { readonly [QualifiedNameBrand]: true };
export type TraitName = QualifiedName & { readonly [TraitNameBrand]: true };
export type EventName = QualifiedName & { readonly [EventNameBrand]: true };
export type CommandName = QualifiedName & { readonly [CommandNameBrand]: true };
export type SurfaceName = QualifiedName & { readonly [SurfaceNameBrand]: true };
export type SlotName = QualifiedName & { readonly [SlotNameBrand]: true };

/**
 * Plugins are named `@scope/name` — two segments, distinct from the
 * three-segment QualifiedName used by traits/events/commands/surfaces/slots.
 * Mirrors the npm package naming convention because plugins ARE distributable
 * units (eventually); the substrate brands them so a `PluginName` can't be
 * passed where a `TraitName` is expected and vice versa.
 */
export type PluginName = string & { readonly [PluginNameBrand]: true };

const QUALIFIED_NAME_RE = /^@[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;

export function isQualifiedName(s: string): s is QualifiedName {
  return QUALIFIED_NAME_RE.test(s);
}

export function qualifiedName(s: string): QualifiedName {
  if (!isQualifiedName(s)) {
    throw new Error(
      `invalid qualified name: ${JSON.stringify(s)} — expected "@scope/plugin/Type"`,
    );
  }
  return s;
}

export const traitName = (s: string): TraitName => qualifiedName(s) as TraitName;
export const eventName = (s: string): EventName => qualifiedName(s) as EventName;
export const commandName = (s: string): CommandName => qualifiedName(s) as CommandName;
export const surfaceName = (s: string): SurfaceName => qualifiedName(s) as SurfaceName;
export const slotName = (s: string): SlotName => qualifiedName(s) as SlotName;

const PLUGIN_NAME_RE = /^@[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;

export function isPluginName(s: string): s is PluginName {
  return PLUGIN_NAME_RE.test(s);
}

export function pluginName(s: string): PluginName {
  if (!isPluginName(s)) {
    throw new Error(
      `invalid plugin name: ${JSON.stringify(s)} — expected "@scope/name"`,
    );
  }
  return s as PluginName;
}

export const QualifiedNameSchema = z
  .string()
  .refine(isQualifiedName, "expected a plugin-qualified name @scope/plugin/Type")
  .transform((s): QualifiedName => s as QualifiedName);
