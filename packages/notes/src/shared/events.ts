import { defineEvent, EntityId, z } from "@vtt/substrate";

const VisibilityShape = z.union([
  z.object({ kind: z.literal("everyone") }),
  z.object({ kind: z.literal("role"), role: z.string() }),
  z.object({ kind: z.literal("users"), userIds: z.array(z.string()) }),
]);

// Notes -----------------------------------------------------------------

export const NoteCreated = defineEvent({
  name: "@vtt/notes/NoteCreated",
  schema: z.object({
    noteId: EntityId,
    title: z.string(),
    createdAt: z.number().int().nonnegative(),
    createdByUserId: z.string().min(1),
    ordinal: z.number(),
  }),
});

export const NoteRenamed = defineEvent({
  name: "@vtt/notes/NoteRenamed",
  schema: z.object({
    noteId: EntityId,
    title: z.string(),
  }),
});

export const NoteDeleted = defineEvent({
  name: "@vtt/notes/NoteDeleted",
  schema: z.object({
    noteId: EntityId,
  }),
});

export const NoteVisibilityChanged = defineEvent({
  name: "@vtt/notes/NoteVisibilityChanged",
  schema: z.object({
    noteId: EntityId,
    visibility: VisibilityShape,
  }),
});

// Pages -----------------------------------------------------------------

export const PageAdded = defineEvent({
  name: "@vtt/notes/PageAdded",
  schema: z.object({
    pageId: EntityId,
    noteId: EntityId,
    title: z.string(),
    ordinal: z.number(),
  }),
});

export const PageRenamed = defineEvent({
  name: "@vtt/notes/PageRenamed",
  schema: z.object({
    pageId: EntityId,
    title: z.string(),
  }),
});

export const PageRemoved = defineEvent({
  name: "@vtt/notes/PageRemoved",
  schema: z.object({
    pageId: EntityId,
  }),
});

export const PagesReordered = defineEvent({
  name: "@vtt/notes/PagesReordered",
  schema: z.object({
    noteId: EntityId,
    pageIds: z.array(EntityId),
  }),
});

export const PageVisibilityChanged = defineEvent({
  name: "@vtt/notes/PageVisibilityChanged",
  schema: z.object({
    pageId: EntityId,
    visibility: VisibilityShape.nullable(),
  }),
});

// Edit lock + body ------------------------------------------------------

export const EditBegun = defineEvent({
  name: "@vtt/notes/EditBegun",
  schema: z.object({
    pageId: EntityId,
    userId: z.string().min(1),
    clientId: z.string().min(1),
    since: z.number().int().nonnegative(),
    expires: z.number().int().nonnegative(),
  }),
});

export const EditLockExtended = defineEvent({
  name: "@vtt/notes/EditLockExtended",
  schema: z.object({
    pageId: EntityId,
    expires: z.number().int().nonnegative(),
  }),
});

export const EditEnded = defineEvent({
  name: "@vtt/notes/EditEnded",
  schema: z.object({
    pageId: EntityId,
  }),
});

/**
 * Transient + broadcast: every keystroke-debounced draft save during
 * an edit session. Skipped from the durable log; readers' subscription
 * still updates from the bus. The mirror system writes `PageDraft`.
 */
export const PageBodyDraft = defineEvent({
  name: "@vtt/notes/PageBodyDraft",
  schema: z.object({
    pageId: EntityId,
    body: z.string(),
  }),
  transient: true,
});

/**
 * Durable. Emitted on every checkpoint (~30s during active editing
 * if changed) and on `EndEdit`. Carries the full body — the v1
 * trade-off; substrate-level compaction lands in v2 once log size
 * matters. The mirror system replaces `Page.body`, increments
 * `bodyRev`, and clears `PageDraft`.
 */
export const PageBodySet = defineEvent({
  name: "@vtt/notes/PageBodySet",
  schema: z.object({
    pageId: EntityId,
    body: z.string(),
    bodyRev: z.number().int().nonnegative(),
    savedAt: z.number().int().nonnegative(),
    savedByUserId: z.string().min(1),
  }),
});

// Derived link events ---------------------------------------------------

const WikiLinkShape = z.object({
  kind: z.string(),
  body: z.string(),
  anchor: z.string().nullable(),
  alias: z.string().nullable(),
  embed: z.boolean(),
});

export const LinkAdded = defineEvent({
  name: "@vtt/notes/LinkAdded",
  schema: z.object({
    sourcePageId: EntityId,
    ref: WikiLinkShape,
  }),
});

export const LinkRemoved = defineEvent({
  name: "@vtt/notes/LinkRemoved",
  schema: z.object({
    sourcePageId: EntityId,
    ref: WikiLinkShape,
  }),
});
