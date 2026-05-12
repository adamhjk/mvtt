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
import { readBrand } from "../shared/brands.js";
import type {
  AnyBlockKindDef,
  BlockKindContext,
} from "../shared/block-kinds.js";

export interface BlockCompletion {
  /** Insertion text. */
  readonly value: string;
  /** Display label (defaults to value). */
  readonly label?: string;
  /** Right-aligned hint shown in the dropdown. */
  readonly detail?: string;
  /** Sort key — lower sorts first. */
  readonly priority?: number;
  /** Marker for ranking by recency / in-adventure scope. */
  readonly source?: "schema" | "wikiLink" | "dice" | "snippet" | "kindName";
}

export interface CompletionContext {
  /** Path to the cursor (e.g. ["sides", "enemies"]) within the parsed YAML. */
  readonly path: ReadonlyArray<string>;
  /**
   * Slot context: "key" when cursor is at a key position (start of a
   * line in object context), "value" when after `: `, "info" when on
   * the fence info-string line.
   */
  readonly slot: "key" | "value" | "info";
  /** Current query (after the prefix the user has typed). */
  readonly query: string;
  /** Block kind in scope (the fence info-string's first word). */
  readonly kind?: AnyBlockKindDef;
  /** All registered kinds — used for info-string completion. */
  readonly allKinds: ReadonlyArray<AnyBlockKindDef>;
  /** Live world + registry, passed to dynamic `complete()` and wikiLink lookups. */
  readonly ctx: BlockKindContext;
  /**
   * For wikiLink completions, a callback that returns suggestions
   * for a given link kind. Adventures depends only on @vtt/notes for
   * trait shapes; the real autocomplete provider that wires this into
   * CodeMirror plugs in the notes plugin's link-kind autocomplete.
   */
  readonly wikiLinkCompletions?: (
    kindName: string,
    query: string,
  ) => ReadonlyArray<{ value: string; label?: string; detail?: string }>;
}

/**
 * Walk the schema tree at `path` and return the schema node, drilling
 * into objects/arrays/unions/discriminated unions transparently.
 * Returns null if the path falls off the schema.
 */
export function schemaAtPath(
  schema: z.ZodTypeAny,
  path: ReadonlyArray<string>,
): z.ZodTypeAny | null {
  let cur: z.ZodTypeAny = schema;
  for (const segment of path) {
    cur = unwrap(cur);
    const def = cur._def as unknown as Record<string, unknown>;
    if (cur instanceof z.ZodObject) {
      const shape = cur.shape as Record<string, z.ZodTypeAny>;
      const next = shape[segment];
      if (!next) return null;
      cur = next;
    } else if (cur instanceof z.ZodArray) {
      // Array indexing — segments may be numeric indices; recurse into
      // element schema regardless. Zod 4 stores the element schema
      // under `def.element` (was `def.type` in v3).
      cur = (def.element ?? def.type) as z.ZodTypeAny;
      if (!cur) return null;
    } else if (cur instanceof z.ZodRecord) {
      cur = (def.valueType ?? def.value) as z.ZodTypeAny;
      if (!cur) return null;
    } else if (
      cur instanceof z.ZodUnion ||
      cur instanceof z.ZodDiscriminatedUnion
    ) {
      // Try each option; return the first that has the segment.
      const options = ((def.options as z.ZodTypeAny[] | undefined) ?? []);
      let found: z.ZodTypeAny | null = null;
      for (const opt of options) {
        const r = schemaAtPath(opt, [segment]);
        if (r) {
          found = r;
          break;
        }
      }
      if (!found) return null;
      cur = found;
    } else {
      return null;
    }
  }
  return cur;
}

/**
 * Strip Zod wrappers (Optional, Default, Nullable, Effects, Readonly)
 * to expose the inner schema.
 */
function unwrap(s: z.ZodTypeAny): z.ZodTypeAny {
  let cur: z.ZodTypeAny = s;
  for (let i = 0; i < 8; i += 1) {
    const def = cur._def as unknown as Record<string, unknown>;
    if (
      cur instanceof z.ZodOptional ||
      cur instanceof z.ZodNullable ||
      cur instanceof z.ZodDefault
    ) {
      const inner = (def.innerType ?? def.type) as z.ZodTypeAny | undefined;
      if (!inner) return cur;
      cur = inner;
    } else {
      return cur;
    }
  }
  return cur;
}

/**
 * Compute completions for the given context. Pure function over the
 * schema + world — easy to unit test, easy to plug into CodeMirror's
 * autocomplete extension separately.
 *
 * Behaviour per `design/adventures.md` § "Autocomplete":
 * - **info slot**: list every registered kind with its description.
 * - **key slot**: list keys not yet present at this object level.
 * - **value slot, enum/literal**: list every literal.
 * - **value slot, wikiLink brand**: defer to the wikiLink resolver
 *   (caller supplies — the notes plugin owns it).
 * - **value slot, dice brand**: static dice suggestions.
 * - **value slot, plain string**: no completions.
 * - Snippet expansion: the *first* completion when the kind is set
 *   and the body is empty.
 *
 * Ranking: schema-derived completions get priority 100; wikiLink and
 * dice get 50; snippets get 10 (top of list); kind names get 50.
 * Lower number sorts first.
 */
export function computeBlockCompletions(
  context: CompletionContext,
): BlockCompletion[] {
  const out: BlockCompletion[] = [];

  if (context.slot === "info") {
    for (const k of context.allKinds) {
      if (
        context.query.length > 0 &&
        !k.name.toLowerCase().includes(context.query.toLowerCase())
      ) {
        continue;
      }
      out.push({
        value: k.name,
        label: k.name,
        detail: k.description ?? "",
        priority: 50,
        source: "kindName",
      });
    }
    return out;
  }

  const kind = context.kind;
  if (!kind) return out;
  const node = schemaAtPath(kind.schema, context.path);
  if (!node) return out;
  const inner = unwrap(node);

  if (context.slot === "key") {
    if (inner instanceof z.ZodObject) {
      const shape = inner.shape as Record<string, z.ZodTypeAny>;
      for (const [keyName, keySchema] of Object.entries(shape)) {
        if (
          context.query.length > 0 &&
          !keyName.toLowerCase().startsWith(context.query.toLowerCase())
        ) {
          continue;
        }
        const isOptional =
          keySchema instanceof z.ZodOptional ||
          keySchema instanceof z.ZodDefault;
        out.push({
          value: keyName,
          label: keyName,
          detail: isOptional ? "(optional)" : "(required)",
          priority: 100,
          source: "schema",
        });
      }
      return out;
    }
    // Record (e.g. `skills: { fighter: 4, ... }`) — schema has no
    // enumerable keys, so we delegate to the kind's escape hatch.
    // The kind can provide context-aware key suggestions (skill ids,
    // wise names, condition names, …) for whichever record path the
    // GM is editing.
    if (inner instanceof z.ZodRecord && kind.complete) {
      const dynamic = kind.complete(context.path, context.ctx);
      for (const d of dynamic) {
        if (
          context.query.length > 0 &&
          !d.value.toLowerCase().startsWith(context.query.toLowerCase())
        ) {
          continue;
        }
        out.push({
          value: d.value,
          label: d.value,
          ...(d.detail !== undefined && { detail: d.detail }),
          priority: 75,
          source: "schema",
        });
      }
    }
    return out;
  }

  // value slot — read brand metadata from BOTH the wrapper (in case
  // the brand was attached after .optional() / .default()) and the
  // unwrapped inner (the typical case where brand was attached first).
  const brand = readBrand(node) ?? readBrand(inner);
  if (brand?.wikiLink && context.wikiLinkCompletions) {
    const wlc = context.wikiLinkCompletions(brand.wikiLink, context.query);
    for (const w of wlc) {
      out.push({
        value: w.value,
        ...(w.label !== undefined && { label: w.label }),
        ...(w.detail !== undefined && { detail: w.detail }),
        priority: 50,
        source: "wikiLink",
      });
    }
    return out;
  }
  if (brand?.dice) {
    for (const v of ["1d6", "2d6", "3d6", "1d6+1", "2d6+1", "1d20"]) {
      if (
        context.query.length > 0 &&
        !v.toLowerCase().startsWith(context.query.toLowerCase())
      ) {
        continue;
      }
      out.push({ value: v, label: v, priority: 50, source: "dice" });
    }
    return out;
  }
  if (inner instanceof z.ZodEnum) {
    const enumValues = inner.options as ReadonlyArray<string>;
    for (const v of enumValues) {
      if (
        context.query.length > 0 &&
        !v.toLowerCase().startsWith(context.query.toLowerCase())
      ) {
        continue;
      }
      out.push({ value: v, label: v, priority: 100, source: "schema" });
    }
    return out;
  }
  if (inner instanceof z.ZodLiteral) {
    // Zod 4 stores the literal value(s) under `def.values` (a tuple)
    // or `def.value` (single). We support both.
    const idef = inner._def as unknown as { value?: unknown; values?: unknown[] };
    const litValues = idef.values ?? (idef.value !== undefined ? [idef.value] : []);
    for (const v of litValues) {
      out.push({
        value: String(v),
        label: String(v),
        priority: 100,
        source: "schema",
      });
    }
    return out;
  }
  // Union of literals — e.g. `wield: z.union([z.literal(1), z.literal(2)])`.
  // Each branch is a ZodLiteral; pluck their values.
  if (inner instanceof z.ZodUnion) {
    const idef = inner._def as unknown as { options?: z.ZodTypeAny[] };
    const opts = idef.options ?? [];
    for (const opt of opts) {
      const u = unwrap(opt);
      if (u instanceof z.ZodLiteral) {
        const ldef = u._def as unknown as {
          value?: unknown;
          values?: unknown[];
        };
        const litValues =
          ldef.values ?? (ldef.value !== undefined ? [ldef.value] : []);
        for (const v of litValues) {
          out.push({
            value: String(v),
            label: String(v),
            priority: 100,
            source: "schema",
          });
        }
      }
    }
    if (out.length > 0) return out;
  }

  // Escape hatch: kind's optional dynamic completer.
  if (kind.complete) {
    const dynamic = kind.complete(context.path, context.ctx);
    for (const d of dynamic) {
      if (
        context.query.length > 0 &&
        !d.value.toLowerCase().includes(context.query.toLowerCase())
      ) {
        continue;
      }
      out.push({
        value: d.value,
        label: d.value,
        ...(d.detail !== undefined && { detail: d.detail }),
        priority: 75,
        source: "schema",
      });
    }
  }
  return out;
}
