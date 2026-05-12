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
  EncounterTemplate,
  type EntityProjection,
} from "@vtt/adventures/shared";

/**
 * One participant reference inside an encounter side. Quantified
 * references (`4× [[character:goblin scout]]`) are written in YAML as
 * a `qty:` + `ref:` pair (or as a string with the prefix shorthand).
 *
 * The grammar accepts:
 *   - "character:Skarra"          → singular reference (bind by id)
 *   - "4× character:goblin scout" → quantified (spawn 4 copies)
 *   - { qty: 4, ref: "character:goblin scout" } → explicit object form
 */
const ParticipantSchema = z
  .union([
    z.string().min(1).max(240),
    z.object({
      qty: z.number().int().min(1).max(99).default(1),
      ref: z.string().min(1).max(240),
    }),
  ])
  .transform((v) => {
    if (typeof v === "object") {
      const colon = v.ref.indexOf(":");
      const kind = colon > 0 ? v.ref.slice(0, colon) : "character";
      const body = colon > 0 ? v.ref.slice(colon + 1) : v.ref;
      return { kind, body, quantity: v.qty };
    }
    // String form. Try to peel off a leading quantifier.
    const m = v.match(/^(\d+)[×x]\s*(.+)$/);
    if (m) {
      const qty = parseInt(m[1]!, 10);
      const ref = m[2]!.trim();
      const colon = ref.indexOf(":");
      const kind = colon > 0 ? ref.slice(0, colon) : "character";
      const body = colon > 0 ? ref.slice(colon + 1) : ref;
      return { kind, body, quantity: qty };
    }
    const colon = v.indexOf(":");
    const kind = colon > 0 ? v.slice(0, colon) : "character";
    const body = colon > 0 ? v.slice(colon + 1) : v;
    return { kind, body, quantity: undefined as number | undefined };
  });

const SideSchema = z.object({
  name: z.string().min(1).max(60),
  participants: z.array(ParticipantSchema).default([]),
});

const OpeningActionSchema = z.object({
  actor: z.string().min(1).max(240),
  action: z.string().min(1).max(60),
  note: z.string().max(2000).default(""),
  round: z.number().int().min(1).max(99).optional(),
});

/**
 * Schema for an `encounter` fenced block. The fence info-string is the
 * encounter's display name; the body covers conflict type, sides
 * (with hybrid bind/spawn participants), opening actions, treasure,
 * read-aloud text, and the trigger description.
 */
export const EncounterBlockSchema = z.object({
  type: z.string().min(1).max(60).default("kill"),
  location: z.string().max(240).optional(),
  sides: z.array(SideSchema).min(1).default([{ name: "enemies", participants: [] }]),
  opening_actions: z.array(OpeningActionSchema).default([]),
  treasure: z.string().max(2000).default(""),
  read_aloud: z.string().max(4000).default(""),
  trigger: z.string().max(2000).default(""),
});

export type EncounterBlockParsed = z.infer<typeof EncounterBlockSchema>;

function projectEncounter(
  parsed: EncounterBlockParsed,
  info: string,
): EntityProjection {
  // Convert the parsed location string ("note:Bywater Bridge" or
  // "scene:foo") into the EncounterTemplate trait's locationRef.
  let locationRef:
    | { kind: string; body: string }
    | null = null;
  if (parsed.location) {
    const colon = parsed.location.indexOf(":");
    if (colon > 0) {
      locationRef = {
        kind: parsed.location.slice(0, colon),
        body: parsed.location.slice(colon + 1),
      };
    } else {
      locationRef = { kind: "note", body: parsed.location };
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
  project: (parsed, ctx) =>
    projectEncounter(parsed, ctx.info ?? "Unnamed Encounter"),
  display: (entityId, world) => {
    const got = world.get(entityId, [EncounterTemplate]) as
      | { EncounterTemplate: { name: string; type: string; sides: ReadonlyArray<{ participants: ReadonlyArray<unknown> }> } }
      | undefined;
    if (!got) return "(unknown encounter)";
    const partyCount = got.EncounterTemplate.sides.reduce(
      (acc, s) => acc + s.participants.length,
      0,
    );
    return `${got.EncounterTemplate.name} · ${got.EncounterTemplate.type} (${partyCount} participants)`;
  },
  snippet: () => `\${1:name}
type: \${2|kill,capture,drive_off,convince,journey,scripted|}
location: \${3:note:Some Place}
sides:
  - name: enemies
    participants:
      - \${4:character:Some NPC}
read_aloud: |
  \${0}`,
});
