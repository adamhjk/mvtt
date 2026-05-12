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

import { z } from "@vtt/substrate";
import type { ReferenceField } from "@vtt/notes/shared";
import { readBrand } from "./brands.js";

/**
 * Walk a Zod schema and flatten it into a list of `ReferenceField`
 * rows suitable for the editor's reference panel. Mirrors the
 * traversal logic in `schemaAtPath` / `computeBlockCompletions` —
 * objects expand to their keys, arrays carry an `[]` segment, records
 * carry `<key>`, unions describe each branch.
 *
 * The output is intentionally flat (one row per leaf or per nested
 * object's *direct* keys) so the reference reads like a stat block,
 * not a tree. Deeply nested shapes get one row per level with the
 * dotted path making the structure clear.
 *
 * NOT a Zod → JSON-schema converter — we want human-readable
 * descriptions ("enum: weapon | armor | supply") for the table cells,
 * not a strict spec.
 */
export function schemaToFields(
  schema: z.ZodTypeAny,
  basePath: ReadonlyArray<string> = [],
): ReferenceField[] {
  const out: ReferenceField[] = [];
  const inner = unwrap(schema);
  if (inner instanceof z.ZodObject) {
    const shape = inner.shape as Record<string, z.ZodTypeAny>;
    for (const [key, child] of Object.entries(shape)) {
      const path = [...basePath, key].join(".");
      const required = !isOptional(child);
      const def = defaultValue(child);
      const description = cleanDescription(child);
      out.push({
        path,
        type: describeType(child),
        required,
        ...(def !== undefined ? { default: def } : {}),
        ...(description ? { description } : {}),
      });
      const childInner = unwrap(child);
      // Recurse into nested objects so the GM sees nature.rating,
      // weapon.attack, etc. Arrays of objects expand under `[].<key>`.
      if (childInner instanceof z.ZodObject) {
        out.push(...schemaToFields(childInner, [...basePath, key]));
      } else if (childInner instanceof z.ZodArray) {
        const element = unwrap(arrayElement(childInner));
        if (element instanceof z.ZodObject) {
          out.push(...schemaToFields(element, [...basePath, key, "[]"]));
        } else if (element instanceof z.ZodUnion) {
          // Array-of-union (e.g. `carries: array<wikilink:item | { item,
          // slot, quantity }>`) — expand each variant so the GM sees the
          // concrete shapes available. Object variants recurse into
          // their keys under `<field>.[] (object form)`.
          out.push(
            ...expandUnionVariants(element, [...basePath, key, "[]"]),
          );
        }
      } else if (childInner instanceof z.ZodRecord) {
        const value = unwrap(recordValue(childInner));
        if (value instanceof z.ZodObject) {
          out.push(...schemaToFields(value, [...basePath, key, "<key>"]));
        }
      } else if (childInner instanceof z.ZodUnion) {
        // Field is a union (not wrapped in an array). Expand its
        // variants inline as `field (variant N)` rows.
        out.push(...expandUnionVariants(childInner, [...basePath, key]));
      }
    }
  }
  return out;
}

/**
 * Walk a union type and emit one or more "child" rows describing each
 * branch. Used for array-of-union fields where the GM needs to see the
 * concrete shapes (e.g. `carries` accepts EITHER a quoted wikilink
 * string OR `{ item, slot, quantity }` — without this expansion the
 * field table just says `array<X | Y>` and provides zero guidance).
 *
 * For each variant:
 *   - A simple branded leaf (wikilink/dice) → one row labelled
 *     `<path> (as <type>)`.
 *   - An object variant → one summary row plus recursed rows for the
 *     object's own fields under `<path>.<objectKey>`.
 */
function expandUnionVariants(
  union: z.ZodTypeAny,
  basePath: ReadonlyArray<string>,
): ReferenceField[] {
  const def = union._def as unknown as { options?: z.ZodTypeAny[] };
  const variants = def.options ?? [];
  const out: ReferenceField[] = [];
  for (let i = 0; i < variants.length; i += 1) {
    const variant = variants[i]!;
    const inner = unwrap(variant);
    // Prefer the variant's own `.describe()` text — when an author
    // wires per-variant grammar (e.g. "string form with optional `N×`
    // quantifier prefix") they expect it to land here. Fall back to
    // the type-derived hints (`unionVariantHint` for wiki-link /
    // dice) so older schemas that don't carry descriptions still get
    // sensible authoring guidance.
    const ownDescription = cleanDescription(variant);
    if (inner instanceof z.ZodObject) {
      const path = [...basePath, `(object form)`].join(" ");
      out.push({
        path,
        type: describeType(variant),
        required: false,
        description:
          ownDescription ??
          "Object form. Use it when you need fields the string form can't express.",
      });
      // Recurse the object's fields under the object-form path so the
      // GM sees e.g. `carries.[] (object form).item`.
      out.push(...schemaToFields(inner, [...basePath, "(object form)"]));
    } else {
      const type = describeType(variant);
      const description = ownDescription ?? unionVariantHint(type);
      out.push({
        path: [...basePath, `(as ${type})`].join(" "),
        type,
        required: false,
        ...(description ? { description } : {}),
      });
    }
  }
  return out;
}

/**
 * One-line usage hint shown next to a non-object union variant. Calls
 * out the YAML-string quoting requirement for wiki-links — the most
 * common authoring trap (bare `[[item:hammer]]` parses as a flow-seq).
 */
function unionVariantHint(type: string): string | undefined {
  if (type.startsWith("wikilink:")) {
    return 'Quoted YAML string, e.g. "[[item:hammer]]".';
  }
  if (type === "dice") {
    return 'Quoted YAML string, e.g. "2d6+1".';
  }
  return undefined;
}

/** Strip the wrappers Zod uses for optional/default/nullable. */
function unwrap(s: z.ZodTypeAny): z.ZodTypeAny {
  let cur: z.ZodTypeAny = s;
  for (let i = 0; i < 8; i += 1) {
    const def = cur._def as unknown as Record<string, unknown>;
    if (
      cur instanceof z.ZodOptional ||
      cur instanceof z.ZodNullable ||
      cur instanceof z.ZodDefault
    ) {
      const next = (def.innerType ?? def.type) as z.ZodTypeAny | undefined;
      if (!next) return cur;
      cur = next;
    } else {
      return cur;
    }
  }
  return cur;
}

function isOptional(s: z.ZodTypeAny): boolean {
  return (
    s instanceof z.ZodOptional ||
    s instanceof z.ZodDefault ||
    s instanceof z.ZodNullable
  );
}

function defaultValue(s: z.ZodTypeAny): string | undefined {
  // Zod 4.3: `ZodDefault._def.defaultValue` holds the literal default
  // value directly (not a factory). Zod 3 stored a factory; tolerate
  // both shapes for safety. Only ZodOptional / ZodNullable wrap a
  // ZodDefault we care about (a plain string has no `innerType`, so
  // we'd otherwise crash trying to walk into it).
  let cur: z.ZodTypeAny = s;
  for (let i = 0; i < 4; i += 1) {
    if (cur instanceof z.ZodDefault) {
      const def = cur._def as unknown as {
        defaultValue?: unknown;
        default?: unknown;
      };
      const raw = (def.defaultValue ?? def.default) as unknown;
      try {
        const v = typeof raw === "function" ? (raw as () => unknown)() : raw;
        return formatValue(v);
      } catch {
        return undefined;
      }
    }
    if (cur instanceof z.ZodOptional || cur instanceof z.ZodNullable) {
      const def = cur._def as unknown as { innerType?: z.ZodTypeAny };
      const next = def.innerType;
      if (!next || next === cur) return undefined;
      cur = next;
      continue;
    }
    return undefined;
  }
  return undefined;
}

function formatValue(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string") return v.length === 0 ? '""' : JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return JSON.stringify(v);
  }
  if (typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>);
    if (keys.length === 0) return "{}";
    return JSON.stringify(v);
  }
  return String(v);
}

function arrayElement(s: z.ZodTypeAny): z.ZodTypeAny {
  const def = s._def as unknown as {
    element?: z.ZodTypeAny;
    type?: z.ZodTypeAny;
  };
  return (def.element ?? def.type) as z.ZodTypeAny;
}

function recordValue(s: z.ZodTypeAny): z.ZodTypeAny {
  const def = s._def as unknown as {
    valueType?: z.ZodTypeAny;
    value?: z.ZodTypeAny;
  };
  return (def.valueType ?? def.value) as z.ZodTypeAny;
}

/**
 * Produce a one-line type label for the field-table column.
 * Examples:
 *   string
 *   number (1–10)
 *   boolean
 *   enum: weapon | armor | supply
 *   array<wikilink:item>
 *   array<{ item, slot, quantity }>
 *   record<string, number>
 *   wikilink:item
 *   dice
 *   object
 */
export function describeType(schema: z.ZodTypeAny): string {
  const brand = readBrand(schema) ?? readBrand(unwrap(schema));
  if (brand?.wikiLink) return `wikilink:${brand.wikiLink}`;
  if (brand?.dice) return "dice";
  const inner = unwrap(schema);
  if (inner instanceof z.ZodString) return "string";
  if (inner instanceof z.ZodNumber) return numberRangeLabel(inner) ?? "number";
  if (inner instanceof z.ZodBoolean) return "boolean";
  if (inner instanceof z.ZodEnum) {
    const opts = (inner.options as ReadonlyArray<string>) ?? [];
    // List every option, however long. Truncating to "(N options)" left
    // authors with no way to know what to write; long enums simply
    // wrap in the reference panel's `break-all`-styled type column.
    return `enum: ${opts.join(" | ")}`;
  }
  if (inner instanceof z.ZodLiteral) {
    const def = inner._def as unknown as { values?: unknown[]; value?: unknown };
    const vals = def.values ?? (def.value !== undefined ? [def.value] : []);
    return `literal: ${vals.map((v) => JSON.stringify(v)).join(" | ")}`;
  }
  if (inner instanceof z.ZodArray) {
    const elem = arrayElement(inner);
    return `array<${describeType(elem)}>`;
  }
  if (inner instanceof z.ZodRecord) {
    const val = recordValue(inner);
    return `record<string, ${describeType(val)}>`;
  }
  if (inner instanceof z.ZodUnion) {
    const def = inner._def as unknown as { options?: z.ZodTypeAny[] };
    const opts = def.options ?? [];
    const parts = opts.map((o) => describeType(o));
    // Collapse identical parts (e.g. dice transform creates dup branches).
    const unique = Array.from(new Set(parts));
    return unique.join(" | ");
  }
  if (inner instanceof z.ZodObject) {
    const shape = inner.shape as Record<string, z.ZodTypeAny>;
    const keys = Object.keys(shape);
    // Nested rows enumerate each field separately; the summary just
    // names them so the author sees the full key set at a glance.
    return `{ ${keys.join(", ")} }`;
  }
  return "any";
}

function numberRangeLabel(n: z.ZodTypeAny): string | null {
  // Zod 4.3 stores each check as a class instance; the actual shape
  // lives under `_zod.def` ({ check: "greater_than" | "less_than",
  // value, inclusive }). Older Zod 3 stored a flat `{ kind, value }`
  // on each check. Tolerate both.
  const def = n._def as unknown as { checks?: ReadonlyArray<unknown> };
  let min: number | undefined;
  let max: number | undefined;
  let isInt = false;
  for (const check of def.checks ?? []) {
    const c = check as {
      kind?: string;
      value?: number;
      def?: { check?: string; value?: number; format?: string };
      _zod?: { def?: { check?: string; value?: number; format?: string } };
    };
    const inner = c._zod?.def ?? c.def ?? {};
    const kind = c.kind ?? inner.check;
    const value = c.value ?? inner.value;
    if (kind === "min" || kind === "greater_than") {
      if (typeof value === "number") min = value;
    }
    if (kind === "max" || kind === "less_than") {
      if (typeof value === "number") max = value;
    }
    if (inner.format === "safeint" || kind === "int") isInt = true;
  }
  const label = isInt ? "integer" : "number";
  if (min !== undefined && max !== undefined) return `${label} (${min}–${max})`;
  if (min !== undefined) return `${label} (≥ ${min})`;
  if (max !== undefined) return `${label} (≤ ${max})`;
  return isInt ? "integer" : null;
}

/**
 * Read .describe() text, returning undefined if the field carries an
 * adventures-internal brand marker (those would otherwise leak the
 * `@vtt/adventures/brand:` prefix into the user-facing column).
 */
function cleanDescription(s: z.ZodTypeAny): string | undefined {
  const inner = unwrap(s);
  const desc = inner.description ?? s.description;
  if (typeof desc !== "string") return undefined;
  if (desc.startsWith("@vtt/adventures/brand:")) return undefined;
  return desc;
}
