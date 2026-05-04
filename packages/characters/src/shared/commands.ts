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

import {
  defineCommand,
  EntityId,
  fail,
  ok,
  readTraitWithDefault,
  z,
} from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { requireWrite } from "@vtt/permissions/shared";
import {
  CharacterCreated,
  CharacterFieldSet,
  CharacterRemoved,
  CharacterRenamed,
  CharacterTokenImageSet,
  PendingRollCancelled,
  PendingRollCommitted,
  PendingRollContributed,
  PendingRollContributionRemoved,
  PendingRollOpened,
} from "./events.js";
import { setAtPath } from "./path.js";
import { Character } from "./traits.js";
import { ContributionSchema, PendingRoll } from "./pending.js";

/**
 * Loose validation that `imageUrl` belongs to this character's
 * plugin-data prefix within this world. Stops a malicious client from
 * pointing the trait at an arbitrary URL — the upload endpoint already
 * gates writes to GMs and to the allowed extension list.
 *
 * Cache-bust suffixes (`?v=<bytes>`) are accepted; the upload endpoint
 * stamps them on so the browser re-fetches after a replacement.
 */
function isCharacterTokenUrl(
  url: string,
  worldId: string,
  characterId: string,
): boolean {
  const expectedPrefix =
    `/plugin-data/${worldId}/@vtt/characters/characters/${characterId}/`;
  if (!url.startsWith(expectedPrefix)) return false;
  if (url.includes("..")) return false;
  return true;
}

/**
 * Anyone authenticated may create their own character; a GM may create
 * one on behalf of another player by passing `ownerUserId`. The
 * recording system spawns Character + a default Permissions trait
 * (`read: everyone, write: users:[ownerUserId]`) from the resulting
 * event.
 */
export const CreateCharacter = defineCommand({
  name: "@vtt/characters/CreateCharacter",
  schema: z.object({
    name: z.string().min(1).max(120),
    /**
     * Optional owner override — only honoured when the dispatcher is a
     * GM; for everyone else the validator forces ownership to the
     * dispatcher's own userId regardless of what was sent.
     */
    ownerUserId: z.string().min(1).optional(),
  }),
  validate: (ctx) => {
    const auth = requireSession(ctx);
    if (!auth) return fail("not authenticated");
    if (
      ctx.cmd.ownerUserId &&
      ctx.cmd.ownerUserId !== auth.userId &&
      auth.role !== "gm"
    ) {
      return fail("only a GM can create a character for another user");
    }
    return ok();
  },
  apply: ({ cmd, session, world }) => {
    const auth = requireSession({ session })!;
    const ownerUserId = cmd.ownerUserId ?? auth.userId;
    return [
      CharacterCreated({
        characterId: world.allocateId(),
        name: cmd.name,
        ownerUserId,
        createdByUserId: auth.userId,
      }),
    ];
  },
});

/**
 * Editor-gated: change a character's display name. Game-system plugins
 * dispatch their own commands for sheet-specific state.
 */
export const RenameCharacter = defineCommand({
  name: "@vtt/characters/RenameCharacter",
  schema: z.object({
    characterId: EntityId,
    name: z.string().min(1).max(120),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`character ${ctx.cmd.characterId} does not exist`);
    }
    const got = ctx.world.get(ctx.cmd.characterId, [Character]) as
      | { Character: { name: string } }
      | undefined;
    if (!got) {
      return fail(`entity ${ctx.cmd.characterId} is not a character`);
    }
    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd }) => [
    CharacterRenamed({
      characterId: cmd.characterId,
      name: cmd.name,
    }),
  ],
});

/**
 * Editor-gated: delete a character. Future game-system traits live on
 * the same entity, so they go away in lockstep when the entity is
 * despawned by the removal system.
 */
export const RemoveCharacter = defineCommand({
  name: "@vtt/characters/RemoveCharacter",
  schema: z.object({
    characterId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`character ${ctx.cmd.characterId} does not exist`);
    }
    const got = ctx.world.get(ctx.cmd.characterId, [Character]) as
      | { Character: { name: string } }
      | undefined;
    if (!got) {
      return fail(`entity ${ctx.cmd.characterId} is not a character`);
    }
    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd }) => [CharacterRemoved({ characterId: cmd.characterId })],
});

/**
 * Universal "edit any field on any trait" command. Game-system plugins
 * use this from sheet kit components so they don't each have to define
 * a per-field setter. Validation:
 *   - trait must be registered (no writes to undeclared traits)
 *   - entity must have the trait OR the trait's Zod schema must define
 *     a default (so a write to a defaulted trait materialises it)
 *   - the path-edited result must satisfy the trait's full schema
 *   - editor-gated via `requireWrite` (reads always allowed)
 *
 * Plugins that need richer per-field semantics (e.g., HP clamping
 * against MaxHp) define their own command and the kit field opts in
 * via the `command` override prop.
 */
export const SetField = defineCommand({
  name: "@vtt/characters/SetField",
  schema: z.object({
    characterId: EntityId,
    /** Qualified trait name, e.g. `@vtt/dnd5e/Abilities`. */
    trait: z.string(),
    /** Path into the trait value. Empty array sets the whole trait. */
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
    value: z.unknown(),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`character ${ctx.cmd.characterId} does not exist`);
    }
    const isCharacter = ctx.world.get(ctx.cmd.characterId, [Character]);
    if (!isCharacter) {
      return fail(`entity ${ctx.cmd.characterId} is not a character`);
    }
    const traitMeta = ctx.registry.traits.get(
      ctx.cmd.trait as Parameters<typeof ctx.registry.traits.get>[0],
    );
    if (!traitMeta) return fail(`unknown trait: ${ctx.cmd.trait}`);

    // Read the current trait value (with Zod default fallback). If
    // neither the trait is attached nor the schema provides a default,
    // the path edit has nothing to merge onto and we reject.
    const current = readTraitWithDefault(ctx.world, ctx.cmd.characterId, traitMeta);
    if (current === undefined) {
      return fail(
        `trait ${ctx.cmd.trait} is not attached to ${ctx.cmd.characterId} and has no schema default`,
      );
    }

    let next: unknown;
    try {
      next = setAtPath(current, ctx.cmd.path, ctx.cmd.value);
    } catch (e) {
      return fail(`invalid path: ${e instanceof Error ? e.message : String(e)}`);
    }

    const parsed = traitMeta.schema.safeParse(next);
    if (!parsed.success) {
      return fail(
        `value at path ${JSON.stringify(ctx.cmd.path)} fails ${ctx.cmd.trait} schema: ${parsed.error.message}`,
      );
    }

    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd }) => [
    CharacterFieldSet({
      characterId: cmd.characterId,
      trait: cmd.trait,
      path: cmd.path,
      value: cmd.value,
    }),
  ],
});

/**
 * Open a PendingRoll: spawn a sentinel entity carrying the rollable
 * name + the initiator's per-call opts. Visible to everyone in the
 * world so other players can offer help / modifiers via
 * ContributeToPendingRoll. Editor-gated on the initiator's character.
 *
 * The kit's `<RollableLabel>` dispatches this instead of the
 * rollable's command directly when `rollable.interactive === true`.
 */
export const OpenPendingRoll = defineCommand({
  name: "@vtt/characters/OpenPendingRoll",
  schema: z.object({
    initiatorCharacterId: EntityId,
    /** Qualified name of a registered rollable. */
    rollableName: z.string().min(1),
    /** Per-call opts passed through to the rollable's compute on commit. */
    opts: z.unknown(),
  }),
  validate: (ctx) => {
    const auth = requireSession(ctx);
    if (!auth) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.initiatorCharacterId)) {
      return fail(`character ${ctx.cmd.initiatorCharacterId} does not exist`);
    }
    if (!ctx.world.get(ctx.cmd.initiatorCharacterId, [Character])) {
      return fail(`entity ${ctx.cmd.initiatorCharacterId} is not a character`);
    }
    if (!ctx.registry.rollables.get(ctx.cmd.rollableName)) {
      return fail(`unknown rollable: ${ctx.cmd.rollableName}`);
    }
    return requireWrite(ctx, ctx.cmd.initiatorCharacterId);
  },
  apply: ({ cmd, session, world }) => {
    const auth = requireSession({ session });
    if (!auth) throw new Error("OpenPendingRoll.apply called without session");
    return [
      PendingRollOpened({
        pendingRollId: world.allocateId(),
        initiatorUserId: auth.userId,
        initiatorCharacterId: cmd.initiatorCharacterId,
        rollableName: cmd.rollableName,
        opts: cmd.opts,
        openedAt: Date.now(),
      }),
    ];
  },
});

/**
 * Append a contribution to an open PendingRoll. Anyone can contribute
 * to anyone's roll — that's the whole point of the multi-actor flow
 * (BW Help, FATE invocations, "spend a benny on someone else's roll").
 *
 * If the contribution carries `fromCharacterId`, the dispatcher must
 * be its editor (or a GM). Server validates ownership but NOT payload
 * semantics — each game system's rollable.compute decides how to
 * incorporate the payload at commit time.
 */
export const ContributeToPendingRoll = defineCommand({
  name: "@vtt/characters/ContributeToPendingRoll",
  schema: z.object({
    pendingRollId: EntityId,
    contribution: ContributionSchema,
  }),
  validate: (ctx) => {
    const auth = requireSession(ctx);
    if (!auth) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.pendingRollId)) {
      return fail(`pending roll ${ctx.cmd.pendingRollId} does not exist`);
    }
    if (!ctx.world.get(ctx.cmd.pendingRollId, [PendingRoll])) {
      return fail(`entity ${ctx.cmd.pendingRollId} is not a pending roll`);
    }
    // The contribution's claimed fromUserId must match the dispatcher.
    if (ctx.cmd.contribution.fromUserId !== auth.userId) {
      return fail(
        `contribution.fromUserId must match the dispatcher; got ${ctx.cmd.contribution.fromUserId} but session is ${auth.userId}`,
      );
    }
    const fromChar = ctx.cmd.contribution.fromCharacterId;
    if (fromChar) {
      if (!ctx.world.has(fromChar)) {
        return fail(`character ${fromChar} does not exist`);
      }
      const editor = requireWrite(ctx, fromChar);
      if (!editor.ok) return editor;
    }
    return ok();
  },
  apply: ({ cmd }) => [
    PendingRollContributed({
      pendingRollId: cmd.pendingRollId,
      contribution: cmd.contribution,
    }),
  ],
});

/**
 * Remove a previously-posted contribution from a PendingRoll. The
 * `modifierId` matches the inner `payload.id` of the contribution
 * being removed — anything in the contributions list with that
 * payload id is filtered out by the receiving system. Used by the
 * pending-roll panel's chip × affordance so a player who clicks
 * "+1D" twice can undo one of them.
 *
 * Permissions: same shape as ContributeToPendingRoll — anyone
 * authenticated can remove their own (or anyone's) contribution.
 * No `replaces` keys are honoured here; this is the explicit-undo
 * verb. Auto-modifiers (those without a corresponding contribution)
 * are unaffected — they're not in the contributions list to begin
 * with.
 */
export const RemoveContribution = defineCommand({
  name: "@vtt/characters/RemoveContribution",
  schema: z.object({
    pendingRollId: EntityId,
    modifierId: z.string().min(1).max(80),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.pendingRollId)) {
      return fail(`pending roll ${ctx.cmd.pendingRollId} does not exist`);
    }
    if (!ctx.world.get(ctx.cmd.pendingRollId, [PendingRoll])) {
      return fail(`entity ${ctx.cmd.pendingRollId} is not a pending roll`);
    }
    return ok();
  },
  apply: ({ cmd }) => [
    PendingRollContributionRemoved({
      pendingRollId: cmd.pendingRollId,
      modifierId: cmd.modifierId,
    }),
  ],
});

/**
 * Initiator (or GM, by universal write bypass): commit the pending
 * roll. The server-side effect is just despawning the entity — the
 * actual roll is dispatched separately by the committing client (via
 * the rollable's command), so this command never crosses into "system
 * dispatches commands" territory and the rollable flows through its
 * normal apply path.
 *
 * Gated by `requireWrite` against the PendingRoll entity's Permissions,
 * which is `users:[initiator]` from the spawn system.
 */
export const CommitPendingRoll = defineCommand({
  name: "@vtt/characters/CommitPendingRoll",
  schema: z.object({
    pendingRollId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.pendingRollId)) {
      return fail(`pending roll ${ctx.cmd.pendingRollId} does not exist`);
    }
    if (!ctx.world.get(ctx.cmd.pendingRollId, [PendingRoll])) {
      return fail(`entity ${ctx.cmd.pendingRollId} is not a pending roll`);
    }
    return requireWrite(ctx, ctx.cmd.pendingRollId);
  },
  apply: ({ cmd }) => [PendingRollCommitted({ pendingRollId: cmd.pendingRollId })],
});

/**
 * Initiator (or GM): cancel a pending roll without rolling. Despawns
 * the entity. Same `requireWrite` gate as commit.
 */
export const CancelPendingRoll = defineCommand({
  name: "@vtt/characters/CancelPendingRoll",
  schema: z.object({
    pendingRollId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.pendingRollId)) {
      return fail(`pending roll ${ctx.cmd.pendingRollId} does not exist`);
    }
    if (!ctx.world.get(ctx.cmd.pendingRollId, [PendingRoll])) {
      return fail(`entity ${ctx.cmd.pendingRollId} is not a pending roll`);
    }
    return requireWrite(ctx, ctx.cmd.pendingRollId);
  },
  apply: ({ cmd }) => [PendingRollCancelled({ pendingRollId: cmd.pendingRollId })],
});

/**
 * Editor-gated: set or clear the character's uploaded token image.
 * Pass `imageUrl: null` to clear. The upload endpoint enforces the
 * GM-only / size / extension policy server-side; this command keeps
 * the trait pointing at this plugin's own storage by validating the
 * URL belongs to the character's plugin-data prefix.
 */
export const SetCharacterTokenImage = defineCommand({
  name: "@vtt/characters/SetCharacterTokenImage",
  schema: z.object({
    characterId: EntityId,
    imageUrl: z.string().nullable(),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`character ${ctx.cmd.characterId} does not exist`);
    }
    if (!ctx.world.get(ctx.cmd.characterId, [Character])) {
      return fail(`entity ${ctx.cmd.characterId} is not a character`);
    }
    if (
      ctx.cmd.imageUrl !== null &&
      !isCharacterTokenUrl(
        ctx.cmd.imageUrl,
        ctx.world.worldId,
        ctx.cmd.characterId,
      )
    ) {
      return fail(
        `imageUrl must start with /plugin-data/${ctx.world.worldId}/@vtt/characters/characters/${ctx.cmd.characterId}/`,
      );
    }
    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd }) => [
    CharacterTokenImageSet({
      characterId: cmd.characterId,
      imageUrl: cmd.imageUrl,
    }),
  ],
});
