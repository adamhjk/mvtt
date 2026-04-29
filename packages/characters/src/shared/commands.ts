import {
  defineCommand,
  EntityId,
  fail,
  ok,
  readTraitWithDefault,
  z,
} from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { requireOwnerOrGm } from "@vtt/permissions/shared";
import { OwnedBy } from "@vtt/permissions/shared";
import {
  CharacterAssigned,
  CharacterCreated,
  CharacterFieldSet,
  CharacterRemoved,
  CharacterRenamed,
  PendingRollCancelled,
  PendingRollCommitted,
  PendingRollContributed,
  PendingRollOpened,
} from "./events.js";
import { setAtPath } from "./path.js";
import { Character } from "./traits.js";
import { ContributionSchema, PendingRoll } from "./pending.js";

/**
 * Anyone authenticated may create their own character; a GM may create
 * one on behalf of another player by passing `ownerUserId`. The
 * recording system spawns Character + OwnedBy from the resulting event.
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
    /**
     * Optional initial assignment — the userId of the player who will
     * play this character. Empty string explicitly creates an
     * unassigned character; omit to default to the owner.
     */
    playerUserId: z.string().optional(),
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
    if (
      ctx.cmd.playerUserId !== undefined &&
      ctx.cmd.playerUserId.length > 0 &&
      ctx.cmd.playerUserId !== auth.userId &&
      auth.role !== "gm"
    ) {
      return fail("only a GM can assign a character to another player");
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
        playerUserId:
          cmd.playerUserId !== undefined ? cmd.playerUserId : ownerUserId,
      }),
    ];
  },
});

/**
 * Owner-or-GM: change a character's display name. Game-system plugins
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
    return requireOwnerOrGm(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd }) => [
    CharacterRenamed({
      characterId: cmd.characterId,
      name: cmd.name,
    }),
  ],
});

/**
 * Owner-or-GM: delete a character. Future game-system traits live on
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
    return requireOwnerOrGm(ctx, ctx.cmd.characterId);
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
 *   - owner-or-GM (read access is always permitted; writes are gated)
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

    return requireOwnerOrGm(ctx, ctx.cmd.characterId);
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
 * ContributeToPendingRoll. Owner-or-GM-of-character gated.
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
    return requireOwnerOrGm(ctx, ctx.cmd.initiatorCharacterId);
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
 * own that character (or be a GM). Server validates ownership but
 * NOT payload semantics — each game system's rollable.compute decides
 * how to incorporate the payload at commit time.
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
    // If the contribution names a character, the dispatcher must own it.
    const fromChar = ctx.cmd.contribution.fromCharacterId;
    if (fromChar) {
      if (!ctx.world.has(fromChar)) {
        return fail(`character ${fromChar} does not exist`);
      }
      if (auth.role !== "gm") {
        const owned = ctx.world.get(fromChar, [OwnedBy]) as
          | { OwnedBy: { userId: string } }
          | undefined;
        if (!owned || owned.OwnedBy.userId !== auth.userId) {
          return fail(`you don't own character ${fromChar}`);
        }
      }
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
 * Initiator-only (or GM): commit the pending roll. The server-side
 * effect is just despawning the entity — the actual roll is dispatched
 * separately by the committing client (via the rollable's command), so
 * this command never crosses into "system dispatches commands"
 * territory and the rollable flows through its normal apply path.
 */
export const CommitPendingRoll = defineCommand({
  name: "@vtt/characters/CommitPendingRoll",
  schema: z.object({
    pendingRollId: EntityId,
  }),
  validate: (ctx) => {
    const auth = requireSession(ctx);
    if (!auth) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.pendingRollId)) {
      return fail(`pending roll ${ctx.cmd.pendingRollId} does not exist`);
    }
    const got = ctx.world.get(ctx.cmd.pendingRollId, [PendingRoll]) as
      | { PendingRoll: { initiatorUserId: string } }
      | undefined;
    if (!got) return fail(`entity ${ctx.cmd.pendingRollId} is not a pending roll`);
    if (auth.role !== "gm" && got.PendingRoll.initiatorUserId !== auth.userId) {
      return fail("only the initiator (or a GM) can commit a pending roll");
    }
    return ok();
  },
  apply: ({ cmd }) => [PendingRollCommitted({ pendingRollId: cmd.pendingRollId })],
});

/**
 * Initiator-only (or GM): cancel a pending roll without rolling.
 * Despawns the entity.
 */
export const CancelPendingRoll = defineCommand({
  name: "@vtt/characters/CancelPendingRoll",
  schema: z.object({
    pendingRollId: EntityId,
  }),
  validate: (ctx) => {
    const auth = requireSession(ctx);
    if (!auth) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.pendingRollId)) {
      return fail(`pending roll ${ctx.cmd.pendingRollId} does not exist`);
    }
    const got = ctx.world.get(ctx.cmd.pendingRollId, [PendingRoll]) as
      | { PendingRoll: { initiatorUserId: string } }
      | undefined;
    if (!got) return fail(`entity ${ctx.cmd.pendingRollId} is not a pending roll`);
    if (auth.role !== "gm" && got.PendingRoll.initiatorUserId !== auth.userId) {
      return fail("only the initiator (or a GM) can cancel a pending roll");
    }
    return ok();
  },
  apply: ({ cmd }) => [PendingRollCancelled({ pendingRollId: cmd.pendingRollId })],
});

/**
 * Owner-or-GM: change which player a character is assigned to. Pass
 * an empty string to clear the assignment ("unassigned"). The chat
 * composer's "speak as" dropdown reads `Character.playerUserId` to
 * decide which characters a given player can speak as.
 */
export const AssignCharacter = defineCommand({
  name: "@vtt/characters/AssignCharacter",
  schema: z.object({
    characterId: EntityId,
    /** userId of the new player, or `""` to unassign. */
    playerUserId: z.string(),
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
    return requireOwnerOrGm(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd }) => [
    CharacterAssigned({
      characterId: cmd.characterId,
      playerUserId: cmd.playerUserId,
    }),
  ],
});
