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
import {
  defineBlockKind,
  type BlockKindContext,
  type EntityProjection,
} from "@vtt/adventures/shared";
import { Character } from "@vtt/characters/shared";
import { TbNpc } from "../npc-traits.js";
import {
  buildCharacterTraitWrites,
  CharacterBlockSchema,
  completeCharacterKeys,
  type CharacterBlockParsed,
} from "./character.js";

/**
 * Schema for the body of an `npc` fenced block — same surface as
 * `character` (every TB stat / skill / wise / trait field, plus the
 * `carries` inventory), with one extra field — `role` — for the
 * proper-noun denizen label that appears on the NPC sheet header.
 *
 * The presence of the `TbNpc` trait on the projected entity is the
 * load-bearing marker that distinguishes NPCs from PCs: the NPCs
 * page lists `[Character, TbNpc]`, the Characters page hides anyone
 * with `TbNpc` via the exclusion slot, and the simplified NPC sheet
 * renders. Authors switch a block from PC to NPC by changing the
 * fence kind from \`\`\`character to \`\`\`npc — that's the whole
 * affordance.
 */
/**
 * Optional book citation for a published / canon NPC. Renders as a
 * `<BookCitation>` on the NPC sheet header so the GM can jump to the
 * printed stat block. Block authors who don't have a canonical
 * source leave it absent and the sheet hides the citation.
 */
const PageRefSchema = z
  .object({
    canonicalId: z.string().min(1).max(120),
    page: z.number().int().min(1).max(2000),
  })
  .optional();

export const NpcBlockSchema = CharacterBlockSchema.extend({
  // Proper-noun denizen label rendered on the NPC sheet header
  // ("Smuggler", "Alchemist", "Bandit Chief"). Free-text — the
  // printed catalog covers the common ones but homebrew NPCs invent
  // freely.
  role: z.string().min(1).max(120).default("Folk"),
  // Optional book citation — printed catalog NPCs cite an LMM / SG
  // page; block-authored homebrew NPCs typically omit it.
  pageRef: PageRefSchema,
});

export type NpcBlockParsed = z.infer<typeof NpcBlockSchema>;

/**
 * Project a parsed NPC block to its trait writes. Shares the
 * `character` projection's heavy lifting via `buildCharacterTraitWrites`
 * — every stat / skill / wise / trait / carries write is identical —
 * then layers the `TbNpc` marker on top. `TbNpc.description` mirrors
 * the YAML `notes` field; `pageRef` is null for block-authored NPCs
 * (the field only resolves when the catalog NPC seeder fills it).
 */
function projectNpc(parsed: NpcBlockParsed, info: string, ctx: BlockKindContext): EntityProjection {
  const base = buildCharacterTraitWrites(parsed, info, ctx);
  return {
    traits: [
      ...base.traits,
      {
        trait: TbNpc,
        value: {
          role: parsed.role,
          // `notes:` is the GM-only description shown on the NPC
          // sheet — same field; we just project it where the NPC
          // sheet expects it (TbNpc.description).
          description: parsed.notes,
          pageRef: parsed.pageRef ?? null,
        },
      },
    ],
    ...(base.spawnIfMissing ? { spawnIfMissing: base.spawnIfMissing } : {}),
  };
}

/** The `npc` block kind — authored named NPCs / "regular folk". */
export const npcBlockKind = defineBlockKind<NpcBlockParsed>({
  name: "npc",
  description: "TB named NPC — projects as Character + TbNpc",
  schema: NpcBlockSchema,
  project: (parsed, ctx) => projectNpc(parsed, ctx.info ?? "Unnamed", ctx),
  // Share the character block's completion logic — skills inside
  // `skills:`, body-slot vocabulary inside `carries.[].slot`.
  complete: completeCharacterKeys,
  display: (entityId, world) => {
    const got = world.get(entityId, [Character, TbNpc]) as
      | { Character: { name: string }; TbNpc: { role: string } }
      | undefined;
    if (!got) return "(unknown npc)";
    return `${got.Character.name} · ${got.TbNpc.role}`;
  },
  // Wiki-links in YAML are pre-escaped by the adventures parser, so
  // \`[[…]]\` literals appear bare in the snippet — no quoting. The
  // snippet covers the high-value NPC fields (role, team, stats,
  // skills, carries, notes) so authors discover the surface; the
  // Reference panel's expand-fields lists every field including the
  // identity-flavor ones (age/home/raiment/parents/...).
  snippet: () => `\${1:name}
role: \${2:Smuggler}
team: \${3|enemy,party,neutral|}
stock: \${4:Human}
class: \${5:Warrior}
level: \${6:3}
will: \${7:4}
health: \${8:5}
nature:
  rating: \${9:4}
  descriptors: [\${10:descriptor}]
skills:
  fighter: \${11:3}
wises: [\${12:wise}]
carries:
  - item: [[item:\${13:hammer}]]
    slot: handR
spellbook: []
memory: []
invocations: []
urdr: \${14:1}
burden: \${15:0}
belief: \${16:What this NPC believes.}
goal: \${17:What they're trying to do right now.}
instinct: \${18:When in doubt, they…}
notes: |
  \${0:GM-only description. Personality, situation, hooks.}`,
});
