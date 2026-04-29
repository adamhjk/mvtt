import { defineEvent, EntityId, z } from "@vtt/substrate";

/**
 * An asset finished uploading and was registered against the world.
 * `assetId` is allocated by the server's command `apply` (via
 * `world.allocateId()`) and embedded in the event so every recipient
 * spawns at the same id via `spawnAt`. The on-disk bytes already exist
 * at `assets/<assetId>` by the time recipients see this event — the
 * upload handler's atomic temp→final rename completes between dispatch
 * and broadcast.
 */
export const AssetRegistered = defineEvent({
  name: "@vtt/assets/AssetRegistered",
  schema: z.object({
    assetId: EntityId,
    mime: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    filename: z.string().nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    uploadedAt: z.number().int().nonnegative(),
    /** Who uploaded — becomes the OwnedBy on the asset entity. */
    uploadedByUserId: z.string().min(1),
  }),
});

/**
 * The asset's display filename was changed. Bytes are immutable;
 * `RenameAsset` only updates the `Asset.filename` field.
 */
export const AssetRenamed = defineEvent({
  name: "@vtt/assets/AssetRenamed",
  schema: z.object({
    assetId: EntityId,
    filename: z.string().min(1).max(255),
  }),
});

/**
 * The owner or GM changed the asset's visibility. Mirror system writes
 * the new `EntityVisibility` trait. The fetch route consults
 * `EntityVisibility` on every read, so the change takes effect
 * immediately for new requests.
 */
export const AssetVisibilityChanged = defineEvent({
  name: "@vtt/assets/AssetVisibilityChanged",
  schema: z.object({
    assetId: EntityId,
    visibility: z.union([
      z.object({ kind: z.literal("everyone") }),
      z.object({ kind: z.literal("role"), role: z.string() }),
      z.object({ kind: z.literal("users"), userIds: z.array(z.string()) }),
    ]),
  }),
});

/**
 * The owner or GM deleted the asset. The despawn system removes the
 * entity; a server-only system also removes the bytes from disk.
 * Existing `[[asset:…]]` references in note bodies become "deleted
 * asset" chips — the link kind's resolver returns null when the entity
 * is gone.
 */
export const AssetDeleted = defineEvent({
  name: "@vtt/assets/AssetDeleted",
  schema: z.object({
    assetId: EntityId,
  }),
});
