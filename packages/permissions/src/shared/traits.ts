import { defineTrait, z } from "@vtt/substrate";

/**
 * Generic ownership reference: this entity belongs to that user (by
 * userId, not by Player entityId — the Player entity is ephemeral but the
 * userId is stable across reconnects). Other plugins use it for "you can
 * only move tokens you own," "this character sheet is yours to edit," etc.
 *
 * Lives in `@vtt/permissions` rather than `@vtt/identity` because it's
 * fundamentally a *permissions* concept (who can act on what) — identity
 * just provides the userId. Persistent (not transient): a token's owner
 * survives a server restart.
 */
export const OwnedBy = defineTrait({
  name: "@vtt/permissions/OwnedBy",
  schema: z.object({
    userId: z.string().min(1),
  }),
});

const VisibilityShape = z.union([
  z.object({ kind: z.literal("everyone") }),
  z.object({ kind: z.literal("role"), role: z.string() }),
  z.object({ kind: z.literal("users"), userIds: z.array(z.string()) }),
]);

/**
 * Entity-level visibility — "who's allowed to know this entity exists."
 * Carried by entities whose existence should be filtered out of certain
 * recipients' snapshots (GM-only rolls, hidden tokens, secret notes).
 * The permissions plugin registers a resolver on this trait so the
 * substrate's per-recipient snapshot filtering works without the
 * substrate hardcoding any specific trait names.
 *
 * Stores the substrate's `Visibility` union directly (not a domain-specific
 * mode field) so the resolver is a one-line passthrough.
 */
export const EntityVisibility = defineTrait({
  name: "@vtt/permissions/EntityVisibility",
  schema: z.object({
    visibility: VisibilityShape,
  }),
});
