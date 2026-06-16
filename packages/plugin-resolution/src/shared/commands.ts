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

import { defineCommand, EntityId, fail, ok, withVisibility, z } from "@vtt/substrate";
import { DiceRoll } from "@dice-roller/rpg-dice-roller";
import { requireSession } from "@vtt/identity/shared";
import { actors, everyone, gmOnly, requireWrite } from "@vtt/permissions/shared";
import { Character } from "@vtt/characters/shared";
import { RollResolved, type DieOutcome } from "./events.js";

/**
 * Tokenize the dice groups in a notation string in order. Each match
 * captures `(qty, sides)` where qty defaults to 1 and sides is `"F"`
 * for Fudge dice, `100` for percentile (`d%` → 100), or a positive int.
 *
 * Used to recover per-die `sides` for animation: rpg-dice-roller's
 * `RollResults` doesn't carry the originating die's sides, but the
 * groups appear in `roll.rolls` in the same order as the notation, so
 * a left-to-right zip recovers the mapping. Operators and constants in
 * the notation aren't dice and don't produce a `RollResults` — they
 * appear in the result tree as plain numbers/strings, which the
 * extractor below skips.
 */
function diceTokensFromNotation(notation: string): Array<{ qty: number; sides: number | "F" }> {
  const out: Array<{ qty: number; sides: number | "F" }> = [];
  // Match groups of the form `[qty]d{sides}` where sides is a positive
  // integer, `F` (Fudge), or `%` (percentile, equivalent to 100).
  const re = /(\d*)d(F|%|\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(notation)) !== null) {
    const qty = m[1] ? parseInt(m[1], 10) : 1;
    const sidesTok = m[2]!;
    const sides: number | "F" =
      sidesTok === "F" ? "F" : sidesTok === "%" ? 100 : parseInt(sidesTok, 10);
    out.push({ qty, sides });
  }
  return out;
}

/**
 * Walk a DiceRoll's result tree (the public `rolls` getter — an array
 * of `ResultGroup | RollResults | string | number`) and emit the flat
 * list of per-die outcomes by zipping with `tokens`.
 *
 * The walk is structural: descend into ResultGroup-like nodes (those
 * with a `.results` array), and treat anything with a `.rolls` array
 * of `{value: number}` entries as a RollResults. Plain strings/numbers
 * are operators/constants and are skipped — no token consumed.
 *
 * Modifier-driven extra dice (exploding, re-rolls) inflate a
 * RollResults beyond its declared `qty`. We honour the declared qty
 * when consuming a token so the next group's sides line up with the
 * next notation token; the *trailing* dice (the explodes) are emitted
 * with the same sides as their group, which is what an animator wants.
 */
function extractDieOutcomes(
  rollsTree: unknown,
  tokens: Array<{ qty: number; sides: number | "F" }>,
): DieOutcome[] {
  const out: DieOutcome[] = [];
  let tokenIdx = 0;

  const visit = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node === "string" || typeof node === "number") {
      // Operator or constant — no die associated.
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as { results?: unknown; rolls?: unknown };
    if (Array.isArray(obj.results)) {
      // ResultGroup-like — recurse into children.
      for (const child of obj.results) visit(child);
      return;
    }
    if (Array.isArray(obj.rolls)) {
      // RollResults: emit one DieOutcome per individual roll, sourcing
      // sides from the next unclaimed notation token. Modifier-inflated
      // results (qty > tokens[tokenIdx].qty) inherit the same sides.
      const tok = tokens[tokenIdx];
      tokenIdx++;
      const sides: number | "F" = tok ? tok.sides : 0;
      for (const r of obj.rolls as Array<{ value?: unknown }>) {
        const v = r?.value;
        if (typeof v === "number") {
          out.push({ sides, value: v });
        }
      }
    }
  };

  visit(rollsTree);
  return out;
}

export const RequestRoll = defineCommand({
  name: "@vtt/resolution/RequestRoll",
  schema: z.object({
    notation: z.string().min(1),
    reason: z.string().optional(),
    visibility: z.enum(["public", "gm-only", "private"]).default("public"),
    /**
     * Optional Character entity to attribute this roll to. Validated
     * the same way SendMessage validates its `speakingAsCharacterId`:
     * the entity must carry the `Character` trait and either be played
     * by the sender or the sender must be a GM. The recording system
     * resolves the character's current name into the spawned RolledBy
     * trait so the roll card reads "Tarn rolled" rather than "Adam rolled."
     */
    speakingAsCharacterId: EntityId.optional(),
    /**
     * Optional system-specific structured payload — see `Formula.meta`.
     * Forwarded verbatim into `RollResolved.meta` and then onto the
     * spawned Roll entity's `Formula` trait. The resolution layer
     * never inspects it.
     */
    meta: z.unknown().optional(),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    try {
      // Construct without rolling-side-effects: this throws on syntax errors,
      // which is the only thing we can validate before performing the roll.
      // eslint-disable-next-line no-new
      new DiceRoll(ctx.cmd.notation);
    } catch (e) {
      return fail(`invalid notation ${JSON.stringify(ctx.cmd.notation)}: ${(e as Error).message}`);
    }
    const speakerId = ctx.cmd.speakingAsCharacterId;
    if (speakerId !== undefined) {
      if (!ctx.world.has(speakerId)) {
        return fail(`character ${speakerId} does not exist`);
      }
      const got = ctx.world.get(speakerId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      if (!got) {
        return fail(`entity ${speakerId} is not a character`);
      }
      const editor = requireWrite(ctx, speakerId);
      if (!editor.ok) return editor;
    }
    return ok();
  },
  apply: ({ cmd, session, world }) => {
    // apply may have non-deterministic side effects (rolling dice) but must
    // not read or write the world. The full result lives in the event so
    // every client can mirror state without re-rolling. The rolling user's
    // userId + displayName are denormalized into the event so the roll card
    // attributes correctly even after they disconnect. Per-recipient
    // visibility decides which clients receive the broadcast at all.
    const auth = requireSession({ session });
    if (!auth) {
      // validate already rejected this; defensive — should never reach apply.
      throw new Error("RequestRoll.apply called without a valid session");
    }
    const roll = new DiceRoll(cmd.notation);
    const visibility =
      cmd.visibility === "gm-only"
        ? gmOnly()
        : cmd.visibility === "private"
          ? // "private" rolls go to the rolling user only — typical use is
            // GM rolling for themselves; for player private rolls the GM
            // would also be in the recipient set when permissions adds a
            // GM-resolution lookup.
            actors([auth.userId])
          : everyone();
    // Extract per-die outcomes for downstream animation. The dice tray
    // plugin consumes this; chat-only consumers can ignore the field.
    const tokens = diceTokensFromNotation(roll.notation);
    const dice = extractDieOutcomes(roll.rolls, tokens);
    // Resolve the speaker's display name on the server (the source
    // of truth that has unrestricted read access). Otherwise the
    // universal mirror would re-resolve per-client and players who
    // can't read a private speaker (a GM-only monster) would fall
    // back to the rolling user's name — leaving every monster's
    // dice card attributed to "the GM" instead of "Marcus
    // Poopypants". Embedding the resolved name in the public event
    // is intentional: the user explicitly wants players to see the
    // monster's name when its rolls hit chat.
    let speakingAsCharacterName: string | undefined;
    if (cmd.speakingAsCharacterId !== undefined) {
      const got = world.get(cmd.speakingAsCharacterId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      speakingAsCharacterName = got?.Character.name;
    }
    return [
      withVisibility(
        RollResolved({
          rollId: world.allocateId(),
          notation: roll.notation,
          reason: cmd.reason,
          visibility: cmd.visibility,
          total: roll.total,
          output: roll.output,
          rolledAt: Date.now(),
          rolledByUserId: auth.userId,
          rolledByName: auth.name,
          dice,
          speakingAsCharacterId: cmd.speakingAsCharacterId,
          speakingAsCharacterName,
          meta: cmd.meta,
        }),
        visibility,
      ),
    ];
  },
});
