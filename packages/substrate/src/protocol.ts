import { z } from "zod";
import { QualifiedNameSchema } from "./schema.js";

export const HelloMsg = z.object({
  kind: z.literal("hello"),
  clientId: z.string(),
  worldId: z.string(),
  plugins: z.array(z.object({ name: z.string(), version: z.string() })),
});

/**
 * Sent immediately after `hello` — frozen in-memory dump of the current
 * World state at the given seq. The client applies it directly (no system
 * run) to bring its local World up to the same seq.
 */
export const SnapshotMsg = z.object({
  kind: z.literal("snapshot"),
  worldId: z.string(),
  atSeq: z.number().int().nonnegative(),
  state: z.object({
    nextId: z.number().int().nonnegative(),
    entities: z.record(z.string(), z.record(z.string(), z.unknown())),
  }),
});

/**
 * Sent after the snapshot (and any catchup events between the snapshot's
 * seq and the live cursor). Marks the boundary between catchup and live
 * mode — clients can use it to clear a "loading…" UI.
 */
export const SyncedMsg = z.object({
  kind: z.literal("synced"),
  atSeq: z.number().int().nonnegative(),
});

/**
 * Presence — high-frequency, ephemeral, never-persisted side channel.
 * Cursor positions, drag ghosts, "X is typing", any signal where freshness
 * matters and durability doesn't. Carries a `channel` discriminator so
 * multiple plugins can multiplex without collision; the server fans each
 * payload out to all OTHER clients (the originator already has the value
 * locally). Subject to the same visibility filter as durable events.
 */
export const PresenceMsg = z.object({
  kind: z.literal("presence"),
  channel: QualifiedNameSchema,
  payload: z.unknown(),
  /** Optional userIds for whisper-style presence. Defaults to everyone. */
  to: z.array(z.string()).optional(),
});

export const CommandMsg = z.object({
  kind: z.literal("command"),
  id: z.string(),
  issuedAt: z.number(),
  cmd: z.object({
    type: QualifiedNameSchema,
    payload: z.unknown(),
  }),
  /** Optional CAS payload — see CommandEnvelope.causalState. */
  causalState: z.unknown().optional(),
});

export const EventMsg = z.object({
  kind: z.literal("event"),
  seq: z.number(),
  event: z.object({
    type: QualifiedNameSchema,
    payload: z.unknown(),
  }),
});

export const AckMsg = z.object({
  kind: z.literal("ack"),
  commandId: z.string(),
  ok: z.boolean(),
  reason: z.string().optional(),
});

export const WireMsg = z.union([HelloMsg, SnapshotMsg, SyncedMsg, CommandMsg, EventMsg, AckMsg, PresenceMsg]);
export type WireMsg = z.infer<typeof WireMsg>;
