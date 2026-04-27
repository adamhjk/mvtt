import {
  defineCommand,
  EntityId,
  fail,
  ok,
  z,
} from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { requireOwnerOrGm } from "@vtt/permissions/shared";
import {
  CharacterCreated,
  CharacterRemoved,
  CharacterRenamed,
} from "./events.js";
import { Character } from "./traits.js";

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
  apply: ({ cmd, session }) => {
    const auth = requireSession({ session })!;
    return [
      CharacterCreated({
        name: cmd.name,
        ownerUserId: cmd.ownerUserId ?? auth.userId,
        createdByUserId: auth.userId,
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
