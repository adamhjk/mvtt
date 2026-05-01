// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import {
  defineCommand,
  EntityId,
  fail,
  ok,
  z,
  type ClientId,
  type Result,
} from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { requireOwnerOrGm } from "@vtt/permissions/shared";
import {
  EditBegun,
  EditEnded,
  EditLockExtended,
  NoteCreated,
  NoteDeleted,
  NoteRenamed,
  NoteVisibilityChanged,
  PageAdded,
  PageBodyDraft,
  PageBodySet,
  PageRemoved,
  PageRenamed,
  PageVisibilityChanged,
  PagesReordered,
} from "./events.js";
import {
  BelongsToNote,
  EditorLock,
  Note,
  NoteOrdering,
  Page,
  PageOrdering,
} from "./traits.js";

const VisibilityShape = z.union([
  z.object({ kind: z.literal("everyone") }),
  z.object({ kind: z.literal("role"), role: z.string() }),
  z.object({ kind: z.literal("users"), userIds: z.array(z.string()) }),
]);

/** 30 second auto-expiry for an editor lock; the client refreshes via heartbeat. */
export const EDITOR_LOCK_TTL_MS = 30_000;

// Helpers ---------------------------------------------------------------

/**
 * Compute the next ordinal for a list-style trait by scanning every
 * entity that carries it. Linear; v1 fine for thousands.
 */
function nextOrdinalFor(
  world: import("@vtt/substrate").World,
  traitDef: typeof NoteOrdering | typeof PageOrdering,
  filter?: (id: import("@vtt/substrate").EntityId, value: { ordinal: number }) => boolean,
): number {
  let max = -1;
  for (const row of world.query([traitDef])) {
    const v = row.values[traitDef.name.split("/").pop()!] as { ordinal: number };
    if (filter && !filter(row.id, v)) continue;
    if (v.ordinal > max) max = v.ordinal;
  }
  return max + 1;
}

function pageBelongsTo(
  world: import("@vtt/substrate").World,
  pageId: EntityId,
): EntityId | null {
  const got = world.get(pageId, [BelongsToNote]) as
    | { BelongsToNote: { noteId: EntityId } }
    | undefined;
  return got ? got.BelongsToNote.noteId : null;
}

function lockHolder(
  world: import("@vtt/substrate").World,
  pageId: EntityId,
  now: number,
): { userId: string; clientId: string } | null {
  const got = world.get(pageId, [EditorLock]) as
    | { EditorLock: { userId: string; clientId: string; expires: number } }
    | undefined;
  if (!got) return null;
  if (got.EditorLock.expires <= now) return null;
  return { userId: got.EditorLock.userId, clientId: got.EditorLock.clientId };
}

// Note commands ---------------------------------------------------------

export const CreateNote = defineCommand({
  name: "@vtt/notes/CreateNote",
  schema: z.object({
    title: z.string().min(1).max(200),
    /** Title for the auto-created first page. Optional. */
    firstPageTitle: z.string().min(1).max(200).optional(),
  }),
  validate: (ctx) => {
    const auth = requireSession({ session: ctx.session });
    return auth ? ok() : fail("not authenticated");
  },
  apply: ({ cmd, session, world }) => {
    const auth = requireSession({ session })!;
    const noteId = world.allocateId();
    const firstPageId = world.allocateId();
    const ordinal = nextOrdinalFor(world, NoteOrdering);
    return [
      NoteCreated({
        noteId,
        title: cmd.title,
        createdAt: Date.now(),
        createdByUserId: auth.userId,
        ordinal,
      }),
      PageAdded({
        pageId: firstPageId,
        noteId,
        title: cmd.firstPageTitle ?? "Untitled",
        ordinal: 0,
      }),
    ];
  },
});

export const RenameNote = defineCommand({
  name: "@vtt/notes/RenameNote",
  schema: z.object({
    noteId: EntityId,
    title: z.string().min(1).max(200),
  }),
  validate: (ctx) => {
    if (!ctx.world.has(ctx.cmd.noteId)) return fail(`note ${ctx.cmd.noteId} not found`);
    return requireOwnerOrGm(ctx, ctx.cmd.noteId);
  },
  apply: ({ cmd }) => [NoteRenamed({ noteId: cmd.noteId, title: cmd.title })],
});

export const DeleteNote = defineCommand({
  name: "@vtt/notes/DeleteNote",
  schema: z.object({
    noteId: EntityId,
  }),
  validate: (ctx) => {
    if (!ctx.world.has(ctx.cmd.noteId)) return fail(`note ${ctx.cmd.noteId} not found`);
    return requireOwnerOrGm(ctx, ctx.cmd.noteId);
  },
  apply: ({ cmd }) => [NoteDeleted({ noteId: cmd.noteId })],
});

export const SetNoteVisibility = defineCommand({
  name: "@vtt/notes/SetNoteVisibility",
  schema: z.object({
    noteId: EntityId,
    visibility: VisibilityShape,
  }),
  validate: (ctx) => {
    if (!ctx.world.has(ctx.cmd.noteId)) return fail(`note ${ctx.cmd.noteId} not found`);
    return requireOwnerOrGm(ctx, ctx.cmd.noteId);
  },
  apply: ({ cmd }) => [
    NoteVisibilityChanged({ noteId: cmd.noteId, visibility: cmd.visibility }),
  ],
});

// Page commands ---------------------------------------------------------

export const AddPage = defineCommand({
  name: "@vtt/notes/AddPage",
  schema: z.object({
    noteId: EntityId,
    title: z.string().min(1).max(200),
    afterPageId: EntityId.optional(),
  }),
  validate: (ctx) => {
    if (!ctx.world.has(ctx.cmd.noteId)) {
      return fail(`note ${ctx.cmd.noteId} not found`);
    }
    return requireOwnerOrGm(ctx, ctx.cmd.noteId);
  },
  apply: ({ cmd, world }) => {
    const pageId = world.allocateId();
    // Page ordinal is "next within this note." Linear scan but bounded
    // by pages-per-note (typically a handful).
    let max = -1;
    for (const row of world.query([BelongsToNote, PageOrdering])) {
      const b = row.values.BelongsToNote as { noteId: EntityId };
      if (b.noteId !== cmd.noteId) continue;
      const o = row.values.PageOrdering as { ordinal: number };
      if (o.ordinal > max) max = o.ordinal;
    }
    return [
      PageAdded({
        pageId,
        noteId: cmd.noteId,
        title: cmd.title,
        ordinal: max + 1,
      }),
    ];
  },
});

export const RenamePage = defineCommand({
  name: "@vtt/notes/RenamePage",
  schema: z.object({
    pageId: EntityId,
    title: z.string().min(1).max(200),
  }),
  validate: (ctx) => {
    const noteId = pageBelongsTo(ctx.world, ctx.cmd.pageId);
    if (!noteId) return fail(`page ${ctx.cmd.pageId} not found`);
    return requireOwnerOrGm(ctx, noteId);
  },
  apply: ({ cmd }) => [PageRenamed({ pageId: cmd.pageId, title: cmd.title })],
});

export const RemovePage = defineCommand({
  name: "@vtt/notes/RemovePage",
  schema: z.object({
    pageId: EntityId,
  }),
  validate: (ctx) => {
    const noteId = pageBelongsTo(ctx.world, ctx.cmd.pageId);
    if (!noteId) return fail(`page ${ctx.cmd.pageId} not found`);
    return requireOwnerOrGm(ctx, noteId);
  },
  apply: ({ cmd }) => [PageRemoved({ pageId: cmd.pageId })],
});

export const ReorderPages = defineCommand({
  name: "@vtt/notes/ReorderPages",
  schema: z.object({
    noteId: EntityId,
    pageIds: z.array(EntityId).min(1),
  }),
  validate: (ctx) => {
    if (!ctx.world.has(ctx.cmd.noteId)) {
      return fail(`note ${ctx.cmd.noteId} not found`);
    }
    // Every supplied id must belong to this note. Reordering with a
    // foreign id would corrupt the order of two notes at once.
    for (const pid of ctx.cmd.pageIds) {
      const owner = pageBelongsTo(ctx.world, pid);
      if (owner !== ctx.cmd.noteId) {
        return fail(`page ${pid} does not belong to note ${ctx.cmd.noteId}`);
      }
    }
    return requireOwnerOrGm(ctx, ctx.cmd.noteId);
  },
  apply: ({ cmd }) => [
    PagesReordered({ noteId: cmd.noteId, pageIds: [...cmd.pageIds] }),
  ],
});

export const SetPageVisibility = defineCommand({
  name: "@vtt/notes/SetPageVisibility",
  schema: z.object({
    pageId: EntityId,
    /** null clears the page-level override (inherit from note). */
    visibility: VisibilityShape.nullable(),
  }),
  validate: (ctx) => {
    const noteId = pageBelongsTo(ctx.world, ctx.cmd.pageId);
    if (!noteId) return fail(`page ${ctx.cmd.pageId} not found`);
    return requireOwnerOrGm(ctx, noteId);
  },
  apply: ({ cmd }) => [
    PageVisibilityChanged({ pageId: cmd.pageId, visibility: cmd.visibility }),
  ],
});

// Editor lock + body ----------------------------------------------------

interface BeginEditCausalState {
  hasNoLiveLock: boolean;
}

export const BeginEdit = defineCommand({
  name: "@vtt/notes/BeginEdit",
  schema: z.object({
    pageId: EntityId,
  }),
  validate: (ctx) => {
    const noteId = pageBelongsTo(ctx.world, ctx.cmd.pageId);
    if (!noteId) return fail(`page ${ctx.cmd.pageId} not found`);
    const owns = requireOwnerOrGm(ctx, noteId);
    if (!owns.ok) return owns;
    const now = Date.now();
    const holder = lockHolder(ctx.world, ctx.cmd.pageId, now);
    if (holder) {
      const auth = requireSession({ session: ctx.session })!;
      const sameClient =
        holder.userId === auth.userId &&
        holder.clientId === (ctx.actor as unknown as string);
      if (!sameClient) {
        return fail(`page is being edited by ${holder.userId}`);
      }
    }
    // CAS: client may declare it expects no live lock — reject if one exists.
    const cs = ctx.causalState as BeginEditCausalState | undefined;
    if (cs?.hasNoLiveLock && holder) {
      return fail("page lock changed since you saw it");
    }
    return ok();
  },
  apply: ({ cmd, session, actor }) => {
    const auth = requireSession({ session })!;
    const now = Date.now();
    return [
      EditBegun({
        pageId: cmd.pageId,
        userId: auth.userId,
        clientId: actor as unknown as string,
        since: now,
        expires: now + EDITOR_LOCK_TTL_MS,
      }),
    ];
  },
});

function requireLockHeldBy(
  ctx: {
    world: import("@vtt/substrate").World;
    session?: unknown;
    actor: ClientId;
    cmd: { pageId: EntityId };
  },
): Result {
  const auth = requireSession({ session: ctx.session });
  if (!auth) return fail("not authenticated");
  const now = Date.now();
  const holder = lockHolder(ctx.world, ctx.cmd.pageId, now);
  if (!holder) return fail("no active edit lock on this page");
  if (
    holder.userId !== auth.userId ||
    holder.clientId !== (ctx.actor as unknown as string)
  ) {
    return fail("edit lock is held by another client");
  }
  return ok();
}

export const ExtendEditLock = defineCommand({
  name: "@vtt/notes/ExtendEditLock",
  schema: z.object({
    pageId: EntityId,
  }),
  validate: requireLockHeldBy,
  apply: ({ cmd }) => [
    EditLockExtended({
      pageId: cmd.pageId,
      expires: Date.now() + EDITOR_LOCK_TTL_MS,
    }),
  ],
});

export const EndEdit = defineCommand({
  name: "@vtt/notes/EndEdit",
  schema: z.object({
    pageId: EntityId,
  }),
  validate: requireLockHeldBy,
  apply: ({ cmd }) => [EditEnded({ pageId: cmd.pageId })],
});

export const SetDraftBody = defineCommand({
  name: "@vtt/notes/SetDraftBody",
  schema: z.object({
    pageId: EntityId,
    body: z.string(),
  }),
  validate: requireLockHeldBy,
  apply: ({ cmd }) => [
    PageBodyDraft({ pageId: cmd.pageId, body: cmd.body }),
  ],
});

interface SetPageBodyCausalState {
  lastSeenRev: number;
}

export const SetPageBody = defineCommand({
  name: "@vtt/notes/SetPageBody",
  schema: z.object({
    pageId: EntityId,
    body: z.string(),
  }),
  validate: (ctx) => {
    const lockOk = requireLockHeldBy(ctx);
    if (!lockOk.ok) return lockOk;
    // CAS belt: if the client supplied lastSeenRev, reject when stale.
    // Disconnect → lock auto-released → another client took over →
    // queued write would otherwise overwrite the new body.
    const got = ctx.world.get(ctx.cmd.pageId, [Page]) as
      | { Page: { bodyRev: number } }
      | undefined;
    if (!got) return fail("page no longer exists");
    const cs = ctx.causalState as SetPageBodyCausalState | undefined;
    if (typeof cs?.lastSeenRev === "number" && cs.lastSeenRev !== got.Page.bodyRev) {
      return fail(
        `bodyRev mismatch (saw ${cs.lastSeenRev}, current ${got.Page.bodyRev})`,
      );
    }
    return ok();
  },
  apply: ({ cmd, session, world }) => {
    const auth = requireSession({ session })!;
    const got = world.get(cmd.pageId, [Page]) as
      | { Page: { bodyRev: number } }
      | undefined;
    const nextRev = got ? got.Page.bodyRev + 1 : 1;
    return [
      PageBodySet({
        pageId: cmd.pageId,
        body: cmd.body,
        bodyRev: nextRev,
        savedAt: Date.now(),
        savedByUserId: auth.userId,
      }),
    ];
  },
});

// Re-export for symmetry with other plugins; consumers usually import
// from "@vtt/notes/shared".
export { Note, Page, BelongsToNote, EditorLock };
