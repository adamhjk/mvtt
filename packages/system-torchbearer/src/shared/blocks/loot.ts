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

import { type EntityId, z } from "@vtt/substrate";
import {
  defineBlockKind,
  LootParcel,
  type EntityProjection,
} from "@vtt/adventures/shared";
import { PlaceLootInScene } from "../loot-commands.js";
import { peelRef } from "./encounter.js";

/**
 * Schema for one loot item entry. The string form `"3× item:silver chalice"`
 * mirrors the encounter participant grammar so authors learn one
 * convention. The object form lets authors set qty + item explicitly.
 *
 * The wiki-link form `[[item:e123|Display Name]]` is accepted on
 * either branch — `peelRef` strips the wrapping + alias so the stored
 * `body` is a clean entity id (or item name) the awarder can resolve.
 */
const LootItemStringSchema = z
  .string()
  .min(1)
  .max(240)
  .describe(
    'String form: `<kind>:<id-or-name>` or the wiki-link `[[item:e123|Display]]`. Prefix with `N×` (or `Nx`) to award that many copies — e.g. `3× [[item:silver chalice]]`. With no kind prefix the ref defaults to `item`.',
  );

const LootItemObjectSchema = z
  .object({
    qty: z
      .number()
      .int()
      .min(1)
      .max(99)
      .default(1)
      .describe("How many copies of `item` to award."),
    item: z
      .string()
      .min(1)
      .max(240)
      .describe(
        "The item reference: `<kind>:<id-or-name>` or `[[item:id|Display]]`.",
      ),
  })
  .describe(
    "Object form: explicit `{ qty, item }`. Pick this when the count is data-driven or you'd rather not eyeball the `N×` prefix.",
  );

const LootItemSchema = z
  .union([LootItemStringSchema, LootItemObjectSchema])
  .describe(
    "One row in the loot list. Use the string form for quick authoring or the object form when you want the count as a discrete field.",
  )
  .transform((v) => {
    if (typeof v === "object") {
      const ref = peelRef(v.item);
      const colon = ref.indexOf(":");
      const kind = colon > 0 ? ref.slice(0, colon) : "item";
      const body = colon > 0 ? ref.slice(colon + 1) : ref;
      return { kind, body, quantity: v.qty };
    }
    let raw = v.trim();
    let quantity = 1;
    const m = raw.match(/^(\d+)[×x]\s*(.+)$/);
    if (m) {
      quantity = parseInt(m[1]!, 10);
      raw = m[2]!.trim();
    }
    const ref = peelRef(raw);
    const colon = ref.indexOf(":");
    const kind = colon > 0 ? ref.slice(0, colon) : "item";
    const body = colon > 0 ? ref.slice(colon + 1) : ref;
    return { kind, body, quantity };
  });

/**
 * Schema for a `loot` fenced block. Fence info-string is the parcel
 * name; body covers the items list and (optional) cash totals.
 *
 * Random-table loot is deferred to v2 — non-deterministic rolls in
 * `apply` break replay, and the v1 design explicitly chose fixed lists
 * over RollLoot+AwardLoot two-step.
 */
export const LootBlockSchema = z.object({
  items: z
    .array(LootItemSchema)
    .default([])
    .describe(
      "Items in this parcel. See the row variants below for the accepted string + object forms — both support the `N×` quantifier and wiki-link wrapping.",
    ),
  cash: z
    .object({
      copper: z
        .number()
        .int()
        .min(0)
        .max(999999)
        .default(0)
        .describe("Copper coins in this parcel."),
      silver: z
        .number()
        .int()
        .min(0)
        .max(999999)
        .default(0)
        .describe("Silver coins in this parcel."),
      gold: z
        .number()
        .int()
        .min(0)
        .max(999999)
        .default(0)
        .describe("Gold coins in this parcel."),
    })
    .default({ copper: 0, silver: 0, gold: 0 })
    .describe("Currency awarded alongside the items."),
  notes: z
    .string()
    .max(4000)
    .default("")
    .describe("GM-facing flavor / context for the parcel."),
});

export type LootBlockParsed = z.infer<typeof LootBlockSchema>;

function projectLoot(parsed: LootBlockParsed, info: string): EntityProjection {
  return {
    traits: [
      {
        trait: LootParcel,
        value: {
          name: info,
          items: parsed.items.map((p) => ({
            kind: p.kind,
            body: p.body,
            quantity: p.quantity,
          })),
          cash: parsed.cash,
          notes: parsed.notes,
        },
      },
    ],
  };
}

/**
 * Find the first Scene entity in the world (any). Loot drop targets
 * the first scene when the GM clicks "Place on ground" — they don't
 * pick a position. v1 simplification per the user's direction.
 *
 * Returns null when no scene exists; the action is a no-op in that case.
 * Uses a duck-typed query against the trait name so this file doesn't
 * import from `@vtt/scene` directly (avoiding a layering inversion —
 * scene depends on substrate, system-torchbearer depends on scene
 * already, but the loot block kind shouldn't need to know).
 */
function firstSceneId(world: import("@vtt/substrate").World): EntityId | null {
  // Iterate via traitsOn on every Page-or-Note like entity? No, we
  // need a raw query. Use a bare TraitMeta-shaped object with the
  // known trait name; world.query reads the name field.
  const SceneTraitMeta = { name: "@vtt/scene/Scene" } as unknown as import("@vtt/substrate").TraitMeta;
  try {
    const rows = world.query([SceneTraitMeta]);
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

export const lootBlockKind = defineBlockKind<LootBlockParsed>({
  name: "loot",
  description: "Treasure parcel — Award action grants items + cash to a character",
  schema: LootBlockSchema,
  project: (parsed, ctx) => projectLoot(parsed, ctx.info ?? "Unnamed Loot"),
  display: (entityId, world) => {
    const got = world.get(entityId, [LootParcel]) as
      | { LootParcel: { name: string; items: ReadonlyArray<unknown>; cash: { copper: number; silver: number; gold: number } } }
      | undefined;
    if (!got) return "(unknown loot)";
    const cashSum =
      got.LootParcel.cash.copper +
      got.LootParcel.cash.silver +
      got.LootParcel.cash.gold;
    const parts = [`${got.LootParcel.items.length} item(s)`];
    if (cashSum > 0) parts.push(`${cashSum} coins`);
    return `${got.LootParcel.name} · ${parts.join(", ")}`;
  },
  actions: [
    {
      id: "place-on-ground",
      label: "Place on ground",
      visibility: "gm",
      run: ({ entityId, world, dispatch }) => {
        if (!dispatch) {
          // eslint-disable-next-line no-console
          console.warn(
            "[loot] place-on-ground: no dispatch hook in context — widget can't fire commands",
          );
          return;
        }
        const sceneId = firstSceneId(world);
        if (!sceneId) {
          // eslint-disable-next-line no-console
          console.warn(
            "[loot] place-on-ground: no Scene exists in this world",
          );
          return;
        }
        dispatch(
          PlaceLootInScene({ parcelId: entityId, sceneId, x: 0, y: 0 }),
        );
      },
    },
  ],
  snippet: () => `\${1:name}
items:
  - \${2:[[item:silver chalice]]}
  - \${3:3×} \${4:[[item:torch]]}
cash:
  copper: \${5:0}
  silver: \${6:0}
  gold: \${7:0}
notes: |
  \${0}`,
});
