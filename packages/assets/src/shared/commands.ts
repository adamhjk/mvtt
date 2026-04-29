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
  AssetDeleted,
  AssetRegistered,
  AssetRenamed,
  AssetVisibilityChanged,
} from "./events.js";

const VisibilityShape = z.union([
  z.object({ kind: z.literal("everyone") }),
  z.object({ kind: z.literal("role"), role: z.string() }),
  z.object({ kind: z.literal("users"), userIds: z.array(z.string()) }),
]);

/**
 * Register a freshly-uploaded asset against the world.
 *
 * **Server-dispatched only.** The HTTP upload route validates auth +
 * mime + size + hash, writes the bytes to a temp path, then dispatches
 * this command. The validator just confirms the session is real; the
 * upload route is the trusted gate. (Client-side dispatch with a fake
 * sha256 would create a broken asset entity pointing at no bytes —
 * a janitor job can GC them; not a security hazard.)
 */
export const RegisterAsset = defineCommand({
  name: "@vtt/assets/RegisterAsset",
  schema: z.object({
    mime: z.string().min(1).max(127),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    filename: z.string().min(1).max(255).nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
  }),
  validate: (ctx) => {
    const auth = requireSession({ session: ctx.session });
    return auth ? ok() : fail("not authenticated");
  },
  apply: ({ cmd, session, world }) => {
    const auth = requireSession({ session })!;
    return [
      AssetRegistered({
        assetId: world.allocateId(),
        mime: cmd.mime,
        sizeBytes: cmd.sizeBytes,
        sha256: cmd.sha256,
        filename: cmd.filename,
        width: cmd.width,
        height: cmd.height,
        uploadedAt: Date.now(),
        uploadedByUserId: auth.userId,
      }),
    ];
  },
});

/**
 * Rename (display only — bytes immutable). Owner or GM.
 */
export const RenameAsset = defineCommand({
  name: "@vtt/assets/RenameAsset",
  schema: z.object({
    assetId: EntityId,
    filename: z.string().min(1).max(255),
  }),
  validate: (ctx) => {
    if (!ctx.world.has(ctx.cmd.assetId)) {
      return fail(`asset ${ctx.cmd.assetId} does not exist`);
    }
    return requireOwnerOrGm(ctx, ctx.cmd.assetId);
  },
  apply: ({ cmd }) => [
    AssetRenamed({
      assetId: cmd.assetId,
      filename: cmd.filename,
    }),
  ],
});

/**
 * Change which recipients can see (and fetch) the asset. Owner or GM.
 * The mirror system writes a new `EntityVisibility` trait; the fetch
 * route consults it on every request, so the new setting takes effect
 * immediately. Pre-cached image URLs in already-loaded clients keep
 * working as long as the substrate's snapshot already showed them the
 * asset entity — but that's expected.
 */
export const SetAssetVisibility = defineCommand({
  name: "@vtt/assets/SetAssetVisibility",
  schema: z.object({
    assetId: EntityId,
    visibility: VisibilityShape,
  }),
  validate: (ctx) => {
    if (!ctx.world.has(ctx.cmd.assetId)) {
      return fail(`asset ${ctx.cmd.assetId} does not exist`);
    }
    return requireOwnerOrGm(ctx, ctx.cmd.assetId);
  },
  apply: ({ cmd }) => [
    AssetVisibilityChanged({
      assetId: cmd.assetId,
      visibility: cmd.visibility,
    }),
  ],
});

/**
 * Delete the asset. Despawn system removes the entity; a server-only
 * companion system removes the bytes from disk. Existing
 * `[[asset:…]]` references in note bodies become broken chips —
 * preserved in storage, rendered as "deleted asset."
 */
export const DeleteAsset = defineCommand({
  name: "@vtt/assets/DeleteAsset",
  schema: z.object({
    assetId: EntityId,
  }),
  validate: (ctx) => {
    if (!ctx.world.has(ctx.cmd.assetId)) {
      return fail(`asset ${ctx.cmd.assetId} does not exist`);
    }
    return requireOwnerOrGm(ctx, ctx.cmd.assetId);
  },
  apply: ({ cmd }) => [AssetDeleted({ assetId: cmd.assetId })],
});
