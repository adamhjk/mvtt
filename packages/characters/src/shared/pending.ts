import { defineTrait, EntityId, z } from "@vtt/substrate";

/**
 * One contribution to a PendingRoll. Generic shape — the rollable's
 * `compute` interprets `payload` per game system.
 *
 *   kind  — system-defined discriminator ("modifier", "help", "aspect"…)
 *   label — what the panel shows ("Tarn helps with Brawn 4")
 *   fromUserId — the user who added this contribution (validated server-side)
 *   fromCharacterId — optional character the contribution came from
 *   payload — system-specific blob; merged into the rollable's opts on commit
 */
export const ContributionSchema = z.object({
  kind: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  fromUserId: z.string().min(1),
  fromCharacterId: EntityId.optional(),
  payload: z.unknown(),
});

export type Contribution = z.infer<typeof ContributionSchema>;

/**
 * The sentinel entity that represents a roll-in-progress. Spawned by
 * OpenPendingRoll, mutated by ContributeToPendingRoll, despawned by
 * Commit/Cancel.
 *
 * Visible to everyone in the world — the panel renders for every
 * client so other players can see what's being rolled and offer
 * help / modifiers.
 *
 * `rollableName` is the qualified name of the registered rollable
 * (resolved at commit time via `client.registry.rollables.get`).
 * `opts` is the per-call options the initiator passed (e.g.
 * `{ stat: "might" }`); contributions are added to it as
 * `opts.contributions` before the rollable's compute runs at commit.
 */
export const PendingRoll = defineTrait({
  name: "@vtt/characters/PendingRoll",
  schema: z.object({
    initiatorUserId: z.string().min(1),
    initiatorCharacterId: EntityId,
    rollableName: z.string().min(1),
    opts: z.unknown(),
    contributions: z.array(ContributionSchema),
    openedAt: z.number(),
  }),
});

export type PendingRollValue = z.infer<typeof PendingRoll.schema>;
