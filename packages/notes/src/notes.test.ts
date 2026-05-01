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

import { describe, it, expect, beforeEach } from "vitest";
import {
  CommandPipeline,
  EventBus,
  Registry,
  World,
  type CommandInstance,
  type EntityId,
  ConnectionClosed,
  runSystemsToFixpoint,
  substrateCorePlugin,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import { permissions } from "@vtt/permissions";
import { shellWorkbench } from "@vtt/shell-workbench";
import { EntityVisibility, OwnedBy } from "@vtt/permissions/shared";
import {
  AddPage,
  BeginEdit,
  CreateNote,
  DeleteNote,
  EditBegun,
  EditEnded,
  EditLockExtended,
  EditorLock,
  EndEdit,
  ExtendEditLock,
  Headings,
  Note,
  NoteCreated,
  NoteDeleted,
  NoteRenamed,
  Page,
  PageAdded,
  PageBodyDraft,
  PageBodySet,
  PageDraft,
  PageHistory,
  PageOrdering,
  PageRemoved,
  PageRenamed,
  PagesReordered,
  RemovePage,
  RenameNote,
  RenamePage,
  ReorderPages,
  SetDraftBody,
  SetNoteVisibility,
  SetPageBody,
  SetPageVisibility,
  BelongsToNote,
} from "./shared/index.js";
import { notes } from "./manifest.js";
import {
  EditEndSystem,
  LockReleaseSystem,
  PageHeadingsSystem,
} from "./server/systems.js";

const GM: AuthSession = {
  userId: "gm-1",
  email: "gm@test.dev",
  name: "GM",
  role: "gm",
};
const ALICE: AuthSession = {
  userId: "alice",
  email: "alice@test.dev",
  name: "Alice",
  role: "player",
};
const BOB: AuthSession = {
  userId: "bob",
  email: "bob@test.dev",
  name: "Bob",
  role: "player",
};

function setup() {
  const registry = new Registry();
  registry.load(substrateCorePlugin);
  registry.load(permissions);
  registry.load(shellWorkbench);
  registry.load(notes);
  registry.validate();
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);
  return { registry, world, bus, pipeline };
}

let cmdSeq = 0;
async function dispatch(
  pipeline: CommandPipeline,
  cmd: CommandInstance,
  session: unknown,
  opts: { actor?: string; causalState?: unknown } = {},
) {
  return pipeline.dispatch({
    id: `cmd-${++cmdSeq}`,
    issuedBy: (opts.actor ?? "client-A") as never,
    issuedAt: Date.now(),
    cmd,
    session,
    causalState: opts.causalState,
  });
}

async function makeNote(
  pipeline: CommandPipeline,
  title = "Goblin Cave",
  session: AuthSession = GM,
) {
  const res = await dispatch(pipeline, CreateNote({ title }), session);
  expect(res.result.ok).toBe(true);
  return res;
}

describe("@vtt/notes", () => {
  let pipeline: CommandPipeline;
  let world: World;
  let bus: EventBus;
  let registry: Registry;

  beforeEach(() => {
    cmdSeq = 0;
    ({ pipeline, world, bus, registry } = setup());
  });

  it("uses plugin-namespaced ubiquitous-language names", () => {
    expect(Note.name).toBe("@vtt/notes/Note");
    expect(Page.name).toBe("@vtt/notes/Page");
    expect(EditorLock.name).toBe("@vtt/notes/EditorLock");
    expect(PageHistory.name).toBe("@vtt/notes/PageHistory");
    expect(CreateNote.name).toBe("@vtt/notes/CreateNote");
    expect(BeginEdit.name).toBe("@vtt/notes/BeginEdit");
    expect(SetDraftBody.name).toBe("@vtt/notes/SetDraftBody");
    expect(SetPageBody.name).toBe("@vtt/notes/SetPageBody");
    expect(NoteCreated.name).toBe("@vtt/notes/NoteCreated");
    expect(PageBodySet.name).toBe("@vtt/notes/PageBodySet");
  });

  describe("CreateNote", () => {
    it("spawns a note + a first page; both visible to everyone by default", async () => {
      const seen: string[] = [];
      bus.onAny((e) => seen.push(e.type));
      const res = await makeNote(pipeline, "Goblin Cave", GM);
      expect(res.events.map((e) => e.type)).toContain(NoteCreated.name);
      const noteRow = world.query([Note])[0]!;
      expect((noteRow.values.Note as { title: string }).title).toBe("Goblin Cave");
      const owned = world.get(noteRow.id, [OwnedBy]) as
        | { OwnedBy: { userId: string } }
        | undefined;
      expect(owned?.OwnedBy.userId).toBe(GM.userId);
      const noteVis = world.get(noteRow.id, [EntityVisibility]) as
        | { EntityVisibility: { visibility: { kind: string } } }
        | undefined;
      expect(noteVis?.EntityVisibility.visibility.kind).toBe("everyone");
      // First page exists with the right BelongsToNote
      const pageRow = world.query([Page, BelongsToNote])[0]!;
      const back = pageRow.values.BelongsToNote as { noteId: EntityId };
      expect(back.noteId).toBe(noteRow.id);
      const pageVis = world.get(pageRow.id, [EntityVisibility]) as
        | { EntityVisibility: { visibility: { kind: string } } }
        | undefined;
      expect(pageVis?.EntityVisibility.visibility.kind).toBe("everyone");
    });

    it("requires a session", async () => {
      const res = await dispatch(
        pipeline,
        CreateNote({ title: "X" }),
        undefined,
      );
      expect(res.result.ok).toBe(false);
      expect(world.query([Note])).toHaveLength(0);
    });
  });

  describe("RenameNote", () => {
    it("owner renames", async () => {
      await makeNote(pipeline, "Original", ALICE);
      const noteId = world.query([Note])[0]!.id;
      const res = await dispatch(
        pipeline,
        RenameNote({ noteId, title: "Renamed" }),
        ALICE,
      );
      expect(res.result.ok).toBe(true);
      const after = world.get(noteId, [Note]) as { Note: { title: string } };
      expect(after.Note.title).toBe("Renamed");
    });

    it("GM renames any note", async () => {
      await makeNote(pipeline, "Original", ALICE);
      const noteId = world.query([Note])[0]!.id;
      const res = await dispatch(
        pipeline,
        RenameNote({ noteId, title: "By GM" }),
        GM,
      );
      expect(res.result.ok).toBe(true);
    });

    it("non-owner non-GM rejected", async () => {
      await makeNote(pipeline, "Original", ALICE);
      const noteId = world.query([Note])[0]!.id;
      const res = await dispatch(
        pipeline,
        RenameNote({ noteId, title: "Hax" }),
        BOB,
      );
      expect(res.result.ok).toBe(false);
    });
  });

  describe("DeleteNote", () => {
    it("cascades child pages", async () => {
      await makeNote(pipeline, "X", GM);
      const noteId = world.query([Note])[0]!.id;
      // Add a second page
      await dispatch(pipeline, AddPage({ noteId, title: "Page 2" }), GM);
      expect(world.query([Page])).toHaveLength(2);
      const res = await dispatch(pipeline, DeleteNote({ noteId }), GM);
      expect(res.result.ok).toBe(true);
      expect(world.has(noteId)).toBe(false);
      expect(world.query([Page])).toHaveLength(0);
    });
  });

  describe("SetNoteVisibility", () => {
    it("propagates to all child pages", async () => {
      await makeNote(pipeline, "Secret", GM);
      const noteId = world.query([Note])[0]!.id;
      await dispatch(pipeline, AddPage({ noteId, title: "Page 2" }), GM);
      const res = await dispatch(
        pipeline,
        SetNoteVisibility({
          noteId,
          visibility: { kind: "role", role: "gm" },
        }),
        GM,
      );
      expect(res.result.ok).toBe(true);
      const noteVis = world.get(noteId, [EntityVisibility]) as
        | { EntityVisibility: { visibility: { kind: string } } }
        | undefined;
      expect(noteVis?.EntityVisibility.visibility.kind).toBe("role");
      // Both pages should now be gmOnly too
      for (const row of world.query([Page, BelongsToNote])) {
        const v = world.get(row.id, [EntityVisibility]) as
          | { EntityVisibility: { visibility: { kind: string } } }
          | undefined;
        expect(v?.EntityVisibility.visibility.kind).toBe("role");
      }
    });
  });

  describe("AddPage / RenamePage / RemovePage", () => {
    it("AddPage assigns ordinal incrementally per-note", async () => {
      await makeNote(pipeline, "X", GM);
      const noteId = world.query([Note])[0]!.id;
      await dispatch(pipeline, AddPage({ noteId, title: "Page 2" }), GM);
      await dispatch(pipeline, AddPage({ noteId, title: "Page 3" }), GM);
      const ordinals = world
        .query([Page, BelongsToNote, PageOrdering])
        .filter((r) => (r.values.BelongsToNote as { noteId: EntityId }).noteId === noteId)
        .map((r) => (r.values.PageOrdering as { ordinal: number }).ordinal)
        .sort((a, b) => a - b);
      expect(ordinals).toEqual([0, 1, 2]);
    });

    it("RenamePage updates title via owner of parent note", async () => {
      await makeNote(pipeline, "X", ALICE);
      const pageId = world.query([Page])[0]!.id;
      const res = await dispatch(
        pipeline,
        RenamePage({ pageId, title: "Renamed" }),
        ALICE,
      );
      expect(res.result.ok).toBe(true);
      const after = world.get(pageId, [Page]) as { Page: { title: string } };
      expect(after.Page.title).toBe("Renamed");
    });

    it("RemovePage despawns the page only", async () => {
      await makeNote(pipeline, "X", GM);
      const noteId = world.query([Note])[0]!.id;
      await dispatch(pipeline, AddPage({ noteId, title: "P2" }), GM);
      const pages = world.query([Page]);
      const target = pages[1]!.id;
      const res = await dispatch(pipeline, RemovePage({ pageId: target }), GM);
      expect(res.result.ok).toBe(true);
      expect(world.has(target)).toBe(false);
      expect(world.has(noteId)).toBe(true);
    });

    it("ReorderPages updates ordinals to match the supplied order", async () => {
      await makeNote(pipeline, "X", GM);
      const noteId = world.query([Note])[0]!.id;
      await dispatch(pipeline, AddPage({ noteId, title: "P2" }), GM);
      await dispatch(pipeline, AddPage({ noteId, title: "P3" }), GM);
      const pages = world
        .query([Page, BelongsToNote, PageOrdering])
        .filter((r) => (r.values.BelongsToNote as { noteId: EntityId }).noteId === noteId)
        .sort(
          (a, b) =>
            (a.values.PageOrdering as { ordinal: number }).ordinal -
            (b.values.PageOrdering as { ordinal: number }).ordinal,
        );
      const reversed = [...pages].reverse().map((r) => r.id);
      const res = await dispatch(
        pipeline,
        ReorderPages({ noteId, pageIds: reversed }),
        GM,
      );
      expect(res.result.ok).toBe(true);
      reversed.forEach((id, idx) => {
        const o = world.get(id, [PageOrdering]) as { PageOrdering: { ordinal: number } };
        expect(o.PageOrdering.ordinal).toBe(idx);
      });
    });

    it("ReorderPages rejects ids that don't belong to the note", async () => {
      await makeNote(pipeline, "Note A", GM);
      const noteIdA = world.query([Note])[0]!.id;
      await makeNote(pipeline, "Note B", GM);
      const noteIdB = world.query([Note])[1]!.id;
      const pageInB = world
        .query([Page, BelongsToNote])
        .find((r) => (r.values.BelongsToNote as { noteId: EntityId }).noteId === noteIdB)!.id;
      const res = await dispatch(
        pipeline,
        ReorderPages({ noteId: noteIdA, pageIds: [pageInB] }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });
  });

  describe("Edit lock + body", () => {
    it("BeginEdit sets EditorLock; ExtendEditLock bumps expires; EndEdit clears", async () => {
      await makeNote(pipeline, "Doc", ALICE);
      const pageId = world.query([Page])[0]!.id;
      const begin = await dispatch(
        pipeline,
        BeginEdit({ pageId }),
        ALICE,
        { actor: "client-A" },
      );
      expect(begin.result.ok).toBe(true);
      const lock = world.get(pageId, [EditorLock]) as
        | {
            EditorLock: {
              userId: string;
              clientId: string;
              expires: number;
            };
          }
        | undefined;
      expect(lock?.EditorLock.userId).toBe(ALICE.userId);
      expect(lock?.EditorLock.clientId).toBe("client-A");
      const initialExpires = lock!.EditorLock.expires;
      // Wait a tick so Date.now() advances
      await new Promise((r) => setTimeout(r, 5));
      const ext = await dispatch(
        pipeline,
        ExtendEditLock({ pageId }),
        ALICE,
        { actor: "client-A" },
      );
      expect(ext.result.ok).toBe(true);
      const lock2 = world.get(pageId, [EditorLock]) as
        | { EditorLock: { expires: number } }
        | undefined;
      expect(lock2?.EditorLock.expires).toBeGreaterThan(initialExpires);
      const end = await dispatch(
        pipeline,
        EndEdit({ pageId }),
        ALICE,
        { actor: "client-A" },
      );
      expect(end.result.ok).toBe(true);
      const cleared = world.get(pageId, [EditorLock]) as
        | { EditorLock: { expires: number } }
        | undefined;
      expect(cleared?.EditorLock.expires).toBe(0);
    });

    it("BeginEdit refuses when another client holds a live lock", async () => {
      await makeNote(pipeline, "Doc", GM);
      const pageId = world.query([Page])[0]!.id;
      // Alice (also editable: GM god-mode → use ALICE who is owner of nothing here)
      // Hmm, Alice can't edit GM's note. Use GM for both holders by clientId.
      const a = await dispatch(pipeline, BeginEdit({ pageId }), GM, {
        actor: "client-A",
      });
      expect(a.result.ok).toBe(true);
      const b = await dispatch(pipeline, BeginEdit({ pageId }), GM, {
        actor: "client-B",
      });
      expect(b.result.ok).toBe(false);
    });

    it("Re-acquiring with the same userId+clientId is idempotent", async () => {
      await makeNote(pipeline, "Doc", GM);
      const pageId = world.query([Page])[0]!.id;
      await dispatch(pipeline, BeginEdit({ pageId }), GM, {
        actor: "client-A",
      });
      const second = await dispatch(pipeline, BeginEdit({ pageId }), GM, {
        actor: "client-A",
      });
      expect(second.result.ok).toBe(true);
    });

    it("SetDraftBody emits transient PageBodyDraft and writes PageDraft trait", async () => {
      await makeNote(pipeline, "Doc", GM);
      const pageId = world.query([Page])[0]!.id;
      await dispatch(pipeline, BeginEdit({ pageId }), GM, { actor: "client-A" });
      const seen: string[] = [];
      bus.onAny((e) => seen.push(e.type));
      const res = await dispatch(
        pipeline,
        SetDraftBody({ pageId, body: "draft-1" }),
        GM,
        { actor: "client-A" },
      );
      expect(res.result.ok).toBe(true);
      expect(seen).toContain(PageBodyDraft.name);
      const draft = world.get(pageId, [PageDraft]) as
        | { PageDraft: { body: string } }
        | undefined;
      expect(draft?.PageDraft.body).toBe("draft-1");
      const page = world.get(pageId, [Page]) as { Page: { body: string; bodyRev: number } };
      expect(page.Page.body).toBe("");
      expect(page.Page.bodyRev).toBe(0);
    });

    it("SetPageBody requires the lock; CAS rejects stale rev", async () => {
      await makeNote(pipeline, "Doc", GM);
      const pageId = world.query([Page])[0]!.id;
      await dispatch(pipeline, BeginEdit({ pageId }), GM, { actor: "client-A" });

      const r1 = await dispatch(
        pipeline,
        SetPageBody({ pageId, body: "rev1" }),
        GM,
        { actor: "client-A", causalState: { lastSeenRev: 0 } },
      );
      expect(r1.result.ok).toBe(true);
      const after1 = world.get(pageId, [Page]) as { Page: { body: string; bodyRev: number } };
      expect(after1.Page.body).toBe("rev1");
      expect(after1.Page.bodyRev).toBe(1);

      // Stale CAS
      const r2 = await dispatch(
        pipeline,
        SetPageBody({ pageId, body: "rev-stale" }),
        GM,
        { actor: "client-A", causalState: { lastSeenRev: 0 } },
      );
      expect(r2.result.ok).toBe(false);
      expect(
        (world.get(pageId, [Page]) as { Page: { body: string } }).Page.body,
      ).toBe("rev1");

      // Fresh CAS
      const r3 = await dispatch(
        pipeline,
        SetPageBody({ pageId, body: "rev2" }),
        GM,
        { actor: "client-A", causalState: { lastSeenRev: 1 } },
      );
      expect(r3.result.ok).toBe(true);
      const after3 = world.get(pageId, [Page]) as { Page: { bodyRev: number } };
      expect(after3.Page.bodyRev).toBe(2);
    });

    it("SetPageBody by a non-lock-holder is rejected", async () => {
      await makeNote(pipeline, "Doc", GM);
      const pageId = world.query([Page])[0]!.id;
      await dispatch(pipeline, BeginEdit({ pageId }), GM, { actor: "client-A" });
      const res = await dispatch(
        pipeline,
        SetPageBody({ pageId, body: "intruder" }),
        GM,
        { actor: "client-B" },
      );
      expect(res.result.ok).toBe(false);
    });

    it("SetPageBody appends to PageHistory and trims to 20", async () => {
      await makeNote(pipeline, "Doc", GM);
      const pageId = world.query([Page])[0]!.id;
      await dispatch(pipeline, BeginEdit({ pageId }), GM, { actor: "client-A" });
      for (let i = 0; i < 25; i++) {
        await dispatch(
          pipeline,
          SetPageBody({ pageId, body: `b${i}` }),
          GM,
          { actor: "client-A" },
        );
      }
      const hist = world.get(pageId, [PageHistory]) as
        | { PageHistory: { entries: { rev: number }[] } }
        | undefined;
      expect(hist?.PageHistory.entries.length).toBe(20);
      // Most recent rev should be 25
      const last = hist!.PageHistory.entries[hist!.PageHistory.entries.length - 1]!;
      expect(last.rev).toBe(25);
      // Oldest in the buffer should be rev 6 (drops 1..5)
      const first = hist!.PageHistory.entries[0]!;
      expect(first.rev).toBe(6);
    });

    it("PageHeadingsSystem derives Headings from body on save", async () => {
      await makeNote(pipeline, "Doc", GM);
      const pageId = world.query([Page])[0]!.id;
      await dispatch(pipeline, BeginEdit({ pageId }), GM, { actor: "client-A" });
      await dispatch(
        pipeline,
        SetPageBody({
          pageId,
          body: "# H1\n## H2\nbody",
        }),
        GM,
        { actor: "client-A" },
      );
      const h = world.get(pageId, [Headings]) as
        | { Headings: { items: Array<{ level: number; text: string }> } }
        | undefined;
      expect(h?.Headings.items.map((i) => i.text)).toEqual(["H1", "H2"]);
    });

    it("LockReleaseSystem emits EditEnded for held locks on disconnect", () => {
      // Set up world manually
      const noteId = world.allocateId();
      const pageId = world.allocateId();
      world.spawnAt(pageId, [Page({ title: "p", body: "", bodyRev: 0 })]);
      world.set(pageId, EditorLock, {
        userId: "alice",
        clientId: "client-A",
        since: Date.now(),
        expires: Date.now() + 30_000,
      });
      void noteId; // unused but documents intent
      const events = LockReleaseSystem.run({
        event: { clientId: "client-A" } as never,
        world,
        registry,
      });
      const types = events.map((e) => e.type);
      expect(types).toContain(EditEnded.name);
    });
  });

  describe("schema validation", () => {
    it("rejects empty note title", () => {
      expect(() => CreateNote({ title: "" })).toThrow();
    });

    it("rejects title longer than 200 chars", () => {
      expect(() => CreateNote({ title: "a".repeat(201) })).toThrow();
    });

    it("rejects empty pageIds in ReorderPages", () => {
      expect(() =>
        ReorderPages({ noteId: "n" as EntityId, pageIds: [] }),
      ).toThrow();
    });
  });
});
