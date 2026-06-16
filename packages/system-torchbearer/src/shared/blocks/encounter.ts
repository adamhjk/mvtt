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
import { defineBlockKind, EncounterTemplate, type EntityProjection } from "@vtt/adventures/shared";
import { OpenPage } from "@vtt/shell-workbench/shared";
import { ConflictActionEnum } from "../../conflict/shared/actions.js";
import { CONFLICT_PAGE_KIND } from "../../conflict/shared/page-kind.js";

/**
 * Author-facing conflict-type vocabulary. Snake_case so the YAML
 * reads naturally ("type: drive_off"); `mapConflictType` in
 * encounter-commands.ts normalises both these and the canonical
 * camelCase ids to the runtime `ConflictTypeEnum` at encounter start.
 * Listed here to drive autocomplete + the reference panel.
 */
const ENCOUNTER_TYPE_SUGGESTIONS = [
  "kill",
  "drive_off",
  "capture",
  "convince",
  "convince_crowd",
  "flee",
  "pursue",
  "trick",
  "other",
] as const;

/**
 * Peel a wiki-link wrapper off a reference string. Authors typically
 * write encounter participants and the location field as full
 * wiki-links (`[[npc:e123|Display Name]]`), but the underlying
 * `EncounterTemplate.locationRef` / `participants[].body` schemas
 * just want `kind` + the entity id or name.
 *
 *   `[[npc:e123|Display Name]]` → `npc:e123`
 *   `[[note:e720]]`             → `note:e720`
 *   `note:Bywater Bridge`       → `note:Bywater Bridge`
 *   `e720`                      → `e720`
 *
 * Both halves are stripped independently — encounters stored before
 * this peeler landed have the brackets split across `kind` and
 * `body` (kind = `"[[note"`, body = `"e720|Goblin Cave]]"`), so this
 * function has to tolerate either half existing in isolation.
 *
 * Exported so the conflict-declare pre-fill can normalise legacy
 * stored bodies that predate this peeler.
 */
export function peelRef(s: string): string {
  let r = s.trim();
  if (r.startsWith("[[")) r = r.slice(2);
  if (r.endsWith("]]")) r = r.slice(0, -2);
  const pipe = r.indexOf("|");
  if (pipe >= 0) r = r.slice(0, pipe);
  return r.trim();
}

/**
 * Split a peeled reference (`kind:id` or bare `id`) into its parts.
 * Falls back to `character` when no colon is present — keeps the
 * shorthand `- goblin scout` form working without forcing authors to
 * type the kind every time.
 */
function splitRef(r: string): { kind: string; body: string } {
  const colon = r.indexOf(":");
  if (colon <= 0) return { kind: "character", body: r };
  return { kind: r.slice(0, colon), body: r.slice(colon + 1) };
}

/**
 * One participant reference inside an encounter side. Quantified
 * references (`4× [[character:goblin scout]]`) are written in YAML as
 * a `qty:` + `ref:` pair (or as a string with the prefix shorthand).
 *
 * The grammar accepts:
 *   - "character:Skarra"                       → singular reference (bind by id)
 *   - "4× character:goblin scout"              → quantified (spawn 4 copies)
 *   - "[[npc:e123|Alchemist]]"                 → wiki-link form (the editor
 *                                                writes this when the GM
 *                                                clicks a `[[`-autocomplete)
 *   - "3× [[monster:e627|Black Dragon]]"       → quantified wiki-link
 *   - { qty: 4, ref: "character:goblin scout" } → explicit object form
 */
const ParticipantStringSchema = z
  .string()
  .min(1)
  .max(240)
  .describe(
    "String form: `<kind>:<id-or-name>`, e.g. `character:Skarra` or the wiki-link wrapping `[[npc:e123|Alchemist]]`. Prefix with `N×` or `Nx` to spawn N copies, e.g. `4× [[monster:e627|Black Dragon]]`. With no kind prefix, the ref defaults to `character`.",
  );

const ParticipantObjectSchema = z
  .object({
    qty: z.number().int().min(1).max(99).default(1).describe("Spawn this many copies of `ref`."),
    ref: z
      .string()
      .min(1)
      .max(240)
      .describe("The participant reference: `<kind>:<id-or-name>` or `[[kind:id|Display]]`."),
  })
  .describe(
    "Object form: explicit `{ qty, ref }`. Useful when the count comes from a variable or you'd rather not eyeball the `N×` prefix in the YAML.",
  );

const ParticipantSchema = z
  .union([ParticipantStringSchema, ParticipantObjectSchema])
  .describe(
    'A participant the encounter pulls into the conflict. Write as a string ("Nx kind:id" or "[[kind:id|alias]]") or an object ({ qty, ref }). Quantified entries spawn that many copies of the referenced template; singular entries bind the entity itself.',
  )
  .transform((v) => {
    if (typeof v === "object") {
      const split = splitRef(peelRef(v.ref));
      return { kind: split.kind, body: split.body, quantity: v.qty };
    }
    // String form. Peel off a leading quantifier if present, then
    // strip the wiki-link wrapping. Quantifier sits OUTSIDE the
    // `[[...]]` per the typical authoring shape ("3× [[npc:e1]]").
    let raw = v.trim();
    let quantity: number | undefined;
    const m = raw.match(/^(\d+)[×x]\s*(.+)$/);
    if (m) {
      quantity = parseInt(m[1]!, 10);
      raw = m[2]!.trim();
    }
    const split = splitRef(peelRef(raw));
    return { kind: split.kind, body: split.body, quantity };
  });

const SideSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(60)
    .describe(
      "Free-text label for this side (e.g. `enemies`, `bandits`, `townsfolk`). Informational — the conflict subsystem partitions by Team, not by side name.",
    ),
  participants: z
    .array(ParticipantSchema)
    .default([])
    .describe(
      "Who's on this side. See the participant variants below for the accepted string + object forms — including the `N×` quantifier prefix for spawning copies.",
    ),
});

const OpeningActionSchema = z.object({
  actor: z
    .string()
    .min(1)
    .max(240)
    .describe(
      "Who takes this action — typically a wiki-link to a character / NPC / monster, but free text works.",
    ),
  action: ConflictActionEnum.describe("Which of the four conflict actions this is."),
  note: z
    .string()
    .max(2000)
    .default("")
    .describe("GM-facing context for the action — flavor, target, intent."),
  round: z
    .number()
    .int()
    .min(1)
    .max(99)
    .optional()
    .describe("Which round this opening action fires on. Defaults to round 1."),
});

/**
 * Schema for an `encounter` fenced block. The fence info-string is the
 * encounter's display name; the body covers conflict type, sides
 * (with hybrid bind/spawn participants), opening actions, treasure,
 * read-aloud text, and the trigger description.
 */
export const EncounterBlockSchema = z.object({
  /**
   * Conflict type — author types snake_case (`drive_off`,
   * `convince_crowd`) or the canonical camelCase id. The runtime
   * `mapConflictType` (encounter-commands.ts) normalises both shapes.
   * Surfaced by the `complete` callback on the block kind so authors
   * see the menu in autocomplete + the reference panel.
   */
  type: z
    .string()
    .min(1)
    .max(60)
    .default("kill")
    .describe(
      "Conflict type. Snake_case (`drive_off`) or camelCase (`driveOff`) — both work; the runtime normalises. The dropdown lists the canonical set.",
    ),
  location: z
    .string()
    .max(240)
    .optional()
    .describe(
      "Where the fight happens. Accepts `note:Bywater Bridge`, the wiki-link `[[note:e720|Goblin Cave]]`, or bare text (defaults the kind to `note`). When the ref resolves to a Note entity, the conflict-declare label shows the note's current title.",
    ),
  sides: z
    .array(SideSchema)
    .min(1)
    .default([{ name: "enemies", participants: [] }])
    .describe(
      "Sides of the conflict. Typical authoring lists only the `enemies` side and lets the GM pick the party at conflict-declare time.",
    ),
  opening_actions: z
    .array(OpeningActionSchema)
    .default([])
    .describe(
      "GM-only notes that fire at the start of specific rounds (default round 1). Informational — the conflict subsystem doesn't auto-apply them.",
    ),
  treasure: z
    .string()
    .max(2000)
    .default("")
    .describe(
      "Free-text reward / payoff notes. Surfaced as GM-only commentary when the conflict ends.",
    ),
  read_aloud: z
    .string()
    .max(4000)
    .default("")
    .describe("Boxed-text the GM reads to the table when the encounter begins."),
  trigger: z
    .string()
    .max(2000)
    .default("")
    .describe(
      "How the encounter starts in fiction — what the players did, what they saw, what springs the trap. GM-facing.",
    ),
});

export type EncounterBlockParsed = z.infer<typeof EncounterBlockSchema>;

function projectEncounter(parsed: EncounterBlockParsed, info: string): EntityProjection {
  // Convert the parsed location into the EncounterTemplate trait's
  // locationRef. Authors may write any of:
  //   location: note:Bywater Bridge
  //   location: [[note:e720|Goblin Cave]]
  //   location: Goblin Cave              (kind defaults to "note")
  //
  // We peel the wiki-link wrapping first so the stored `body` is the
  // clean entity id (or name) the resolver can look up later.
  let locationRef: { kind: string; body: string } | null = null;
  if (parsed.location) {
    const peeled = peelRef(parsed.location);
    const colon = peeled.indexOf(":");
    if (colon > 0) {
      locationRef = {
        kind: peeled.slice(0, colon),
        body: peeled.slice(colon + 1),
      };
    } else {
      locationRef = { kind: "note", body: peeled };
    }
  }

  return {
    traits: [
      {
        trait: EncounterTemplate,
        value: {
          name: info,
          type: parsed.type,
          locationRef,
          sides: parsed.sides.map((s) => ({
            name: s.name,
            participants: s.participants.map((p) => {
              // Keep the schema shape predictable for downstream
              // consumers. `quantity` is undefined for singular refs.
              const out: { kind: string; body: string; quantity?: number } = {
                kind: p.kind,
                body: p.body,
              };
              if (p.quantity !== undefined) out.quantity = p.quantity;
              return out;
            }),
          })),
          openingActions: parsed.opening_actions.map((a) => {
            const out: {
              actor: string;
              action: string;
              note: string;
              round?: number;
            } = {
              actor: a.actor,
              action: a.action,
              note: a.note,
            };
            if (a.round !== undefined) out.round = a.round;
            return out;
          }),
          treasure: parsed.treasure,
          readAloud: parsed.read_aloud,
          trigger: parsed.trigger,
        },
      },
    ],
  };
}

/** The `encounter` block kind. */
export const encounterBlockKind = defineBlockKind<EncounterBlockParsed>({
  name: "encounter",
  description: "TB encounter — Start dispatches DeclareConflict + spawns mob copies",
  schema: EncounterBlockSchema,
  project: (parsed, ctx) => projectEncounter(parsed, ctx.info ?? "Unnamed Encounter"),
  // Dynamic completer surfaces the author-facing conflict-type
  // vocabulary so the editor and the reference panel both expose the
  // full list. Schema stays permissive because `mapConflictType`
  // accepts both snake_case and camelCase at runtime.
  complete: (path) => {
    if (path.length === 1 && path[0] === "type") {
      return ENCOUNTER_TYPE_SUGGESTIONS.map((v) => ({ value: v }));
    }
    return [];
  },
  actions: [
    {
      id: "setupConflict",
      label: "Set up conflict",
      visibility: "gm",
      // Open the Conflict tab pointed at this encounter template.
      // ConflictPage detects EncounterTemplate vs TbConflict and
      // renders a pre-filled declare form rather than the board.
      // The GM picks party + captain manually; the encounter's type,
      // location, and enemies are pre-seeded.
      run: ({ entityId, dispatch }) => {
        if (!dispatch) return;
        dispatch(
          OpenPage({
            pageKind: CONFLICT_PAGE_KIND,
            entityId,
          }),
        );
      },
    },
  ],
  display: (entityId, world) => {
    const got = world.get(entityId, [EncounterTemplate]) as
      | {
          EncounterTemplate: {
            name: string;
            type: string;
            sides: ReadonlyArray<{ participants: ReadonlyArray<unknown> }>;
          };
        }
      | undefined;
    if (!got) return "(unknown encounter)";
    const partyCount = got.EncounterTemplate.sides.reduce(
      (acc, s) => acc + s.participants.length,
      0,
    );
    return `${got.EncounterTemplate.name} · ${got.EncounterTemplate.type} (${partyCount} participants)`;
  },
  snippet: () => `\${1:name}
type: \${2|kill,drive_off,capture,convince,convince_crowd,flee,pursue,trick,other|}
location: [[note:\${3:Some Place}]]
sides:
  - name: enemies
    participants:
      - \${4:[[npc:Some NPC]]}
      - \${5:4×} \${6:[[monster:goblin scout]]}
read_aloud: |
  \${0}`,
});
