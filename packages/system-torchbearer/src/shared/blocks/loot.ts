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

/**
 * Schema for one loot item entry. The string form `"3× item:silver chalice"`
 * mirrors the encounter participant grammar so authors learn one
 * convention. The object form lets authors set qty + ref explicitly.
 */
const LootItemSchema = z
  .union([
    z.string().min(1).max(240),
    z.object({
      qty: z.number().int().min(1).max(99).default(1),
      item: z.string().min(1).max(240),
    }),
  ])
  .transform((v) => {
    if (typeof v === "object") {
      const colon = v.item.indexOf(":");
      const kind = colon > 0 ? v.item.slice(0, colon) : "item";
      const body = colon > 0 ? v.item.slice(colon + 1) : v.item;
      return { kind, body, quantity: v.qty };
    }
    const m = v.match(/^(\d+)[×x]\s*(.+)$/);
    if (m) {
      const qty = parseInt(m[1]!, 10);
      const ref = m[2]!.trim();
      const colon = ref.indexOf(":");
      const kind = colon > 0 ? ref.slice(0, colon) : "item";
      const body = colon > 0 ? ref.slice(colon + 1) : ref;
      return { kind, body, quantity: qty };
    }
    const colon = v.indexOf(":");
    const kind = colon > 0 ? v.slice(0, colon) : "item";
    const body = colon > 0 ? v.slice(colon + 1) : v;
    return { kind, body, quantity: 1 };
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
  items: z.array(LootItemSchema).default([]),
  cash: z
    .object({
      copper: z.number().int().min(0).max(999999).default(0),
      silver: z.number().int().min(0).max(999999).default(0),
      gold: z.number().int().min(0).max(999999).default(0),
    })
    .default({ copper: 0, silver: 0, gold: 0 }),
  notes: z.string().max(4000).default(""),
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
  - \${2:item:treasure thing}
cash:
  copper: \${3:0}
  silver: \${4:0}
  gold: \${5:0}
notes: |
  \${0}`,
});
