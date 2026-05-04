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

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import {
  startServer,
  type ServerHandle,
} from "@vtt/substrate/server";
import {
  definePlugin,
  InMemoryWorldsRepository,
  type WorldId,
} from "@vtt/substrate";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { notes } from "@vtt/notes";
import { assets } from "@vtt/assets";
import {
  attachNotesSearchBridge,
  handleNotesSearch,
  NotesSearchIndex,
} from "@vtt/notes/server";
import {
  AddPage,
  BeginEdit,
  CreateNote,
  Note,
  Page,
  SetPageBody,
  BelongsToNote,
} from "@vtt/notes/shared";
import { SetPermissions } from "@vtt/permissions/shared";
import type { AuthSession } from "@vtt/auth";
import type { IncomingMessage } from "node:http";

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
const SESSIONS: Record<string, AuthSession> = {
  gm: GM,
  alice: ALICE,
};

const notesSearchTestSystem = definePlugin({
  name: "@vtt/notes-search-test-system",
  version: "0",
  dependsOn: ["@vtt/notes@^0", "@vtt/assets@^0"],
  gameSystem: true,
});

describe("notes FTS search smoke", () => {
  let handle: ServerHandle;
  let worldId: WorldId;
  let db: Database.Database;
  let index: NotesSearchIndex;

  beforeAll(async () => {
    db = new Database(":memory:");
    index = new NotesSearchIndex(db);
    index.migrate();
    const worldsRepo = new InMemoryWorldsRepository();
    await worldsRepo.migrate();
    const world = await worldsRepo.insert({
      id: "notes-search-smoke",
      name: "Notes Search smoke",
      gameSystemPlugin: notesSearchTestSystem.name,
      ownerUserId: GM.userId,
    });
    worldId = world.id;

    const authenticate = async (
      req: IncomingMessage,
      _worldId: WorldId,
    ): Promise<AuthSession | null> => {
      const userKey = (req.headers["x-test-user"] ?? "").toString();
      return SESSIONS[userKey] ?? null;
    };

    let registryRef: { value: import("@vtt/substrate").WorldsRegistry | null } = {
      value: null,
    };

    const httpHandler = async (
      req: import("node:http").IncomingMessage,
      res: import("node:http").ServerResponse,
    ): Promise<boolean> => {
      const url = req.url ?? "/";
      const path = url.split("?")[0]!;
      if (!registryRef.value) return false;
      const m = /^\/api\/worlds\/([^/]+)\/notes\/search$/.exec(path);
      if (m && req.method === "GET") {
        const u = new URL(url, "http://placeholder");
        const q = u.searchParams.get("q") ?? "";
        await handleNotesSearch(
          req,
          res,
          decodeURIComponent(m[1]!) as WorldId,
          q,
          25,
          {
            registry: registryRef.value,
            index,
            authenticate,
          },
        );
        return true;
      }
      return false;
    };

    handle = await startServer({
      port: 0,
      infrastructure: [shellWorkbench, identity, permissions, notes, assets],
      optional: [notesSearchTestSystem],
      worldsRepo,
      httpHandler,
      authenticateUpgrade: async () => GM,
      extractRecipient: (s) => {
        const sess = s as AuthSession | null;
        return sess ? { userId: sess.userId, role: sess.role } : null;
      },
      onRuntimeCreated: (runtime) => {
        attachNotesSearchBridge(runtime, index);
      },
    });
    registryRef.value = handle.worldsRegistry;
    // Pre-acquire so the runtime exists for our direct dispatches.
    await handle.worldsRegistry.acquire(worldId);
  });

  afterAll(async () => {
    if (handle) await handle.close();
    if (db) db.close();
  });

  const baseUrl = (): string => `http://127.0.0.1:${handle.port}`;
  const search = async (user: string, q: string) =>
    fetch(`${baseUrl()}/api/worlds/${worldId}/notes/search?q=${encodeURIComponent(q)}`, {
      headers: { "x-test-user": user },
    });

  it("indexes pages on save and finds them by full-text", async () => {
    const runtime = handle.worldsRegistry.get(worldId)!;
    // Create a note with a body via the command pipeline.
    await runtime.pipeline.dispatch({
      id: "c-create",
      issuedBy: "tester" as never,
      issuedAt: Date.now(),
      cmd: CreateNote({ title: "Goblin Cave" }),
      session: GM,
    });
    const page = runtime.world.query([Page, BelongsToNote])[0]!;
    await runtime.pipeline.dispatch({
      id: "c-begin",
      issuedBy: "client-A" as never,
      issuedAt: Date.now(),
      cmd: BeginEdit({ pageId: page.id }),
      session: GM,
    });
    await runtime.pipeline.dispatch({
      id: "c-save",
      issuedBy: "client-A" as never,
      issuedAt: Date.now(),
      cmd: SetPageBody({
        pageId: page.id,
        body: "A damp warren cut into the cliffs north of Mossfen. Trapped tunnels. Goblin scouts patrol.",
      }),
      session: GM,
    });
    // Allow the bus subscriber to run.
    await new Promise((r) => setTimeout(r, 30));

    const r = await search("alice", "warren");
    expect(r.status).toBe(200);
    const body = (await r.json()) as { hits: Array<{ pageId: string; snippet: string }> };
    expect(body.hits.length).toBeGreaterThanOrEqual(1);
    expect(body.hits[0]!.snippet).toMatch(/<mark>warren<\/mark>/i);
  });

  it("returns nothing for unauthenticated requests", async () => {
    const r = await fetch(
      `${baseUrl()}/api/worlds/${worldId}/notes/search?q=warren`,
    );
    expect(r.status).toBe(401);
  });

  it("filters out hits the recipient can't see", async () => {
    const runtime = handle.worldsRegistry.get(worldId)!;
    // Create a GM-only note.
    await runtime.pipeline.dispatch({
      id: "c-create-secret",
      issuedBy: "tester" as never,
      issuedAt: Date.now(),
      cmd: CreateNote({ title: "GM Secret" }),
      session: GM,
    });
    const noteRow = runtime.world.query([Note]).find(
      (r) => (r.values.Note as { title: string }).title === "GM Secret",
    )!;
    const secretPage = runtime.world
      .query([Page, BelongsToNote])
      .find(
        (r) =>
          (r.values.BelongsToNote as { noteId: string }).noteId === noteRow.id,
      )!;
    await runtime.pipeline.dispatch({
      id: "c-begin-secret",
      issuedBy: "client-A" as never,
      issuedAt: Date.now(),
      cmd: BeginEdit({ pageId: secretPage.id }),
      session: GM,
    });
    await runtime.pipeline.dispatch({
      id: "c-save-secret",
      issuedBy: "client-A" as never,
      issuedAt: Date.now(),
      cmd: SetPageBody({
        pageId: secretPage.id,
        body: "ULTRASECRET ZALGON_KEY contents.",
      }),
      session: GM,
    });
    // Now lock the note to GM-only
    await runtime.pipeline.dispatch({
      id: "c-lock-secret",
      issuedBy: "tester" as never,
      issuedAt: Date.now(),
      cmd: SetPermissions({
        entityId: noteRow.id,
        read: { kind: "role", role: "gm" },
      }),
      session: GM,
    });
    await new Promise((r) => setTimeout(r, 30));

    // Alice searches for the unique token — should not find it
    const aliceRes = await search("alice", "ZALGON_KEY");
    expect(aliceRes.status).toBe(200);
    const aliceBody = (await aliceRes.json()) as { hits: unknown[] };
    expect(aliceBody.hits.length).toBe(0);

    // GM searches the same — finds it
    const gmRes = await search("gm", "ZALGON_KEY");
    expect(gmRes.status).toBe(200);
    const gmBody = (await gmRes.json()) as {
      hits: Array<{ noteTitle: string }>;
    };
    expect(gmBody.hits.length).toBeGreaterThanOrEqual(1);
    expect(gmBody.hits[0]!.noteTitle).toBe("GM Secret");
  });

  it("indexes additional pages added to a note", async () => {
    const runtime = handle.worldsRegistry.get(worldId)!;
    const noteRow = runtime.world.query([Note]).find(
      (r) => (r.values.Note as { title: string }).title === "Goblin Cave",
    )!;
    await runtime.pipeline.dispatch({
      id: "c-add-page",
      issuedBy: "tester" as never,
      issuedAt: Date.now(),
      cmd: AddPage({ noteId: noteRow.id, title: "Inhabitants" }),
      session: GM,
    });
    const pages = runtime.world.query([Page, BelongsToNote]).filter(
      (r) =>
        (r.values.BelongsToNote as { noteId: string }).noteId === noteRow.id,
    );
    const newPage = pages[pages.length - 1]!;
    await runtime.pipeline.dispatch({
      id: "c-begin2",
      issuedBy: "client-A" as never,
      issuedAt: Date.now(),
      cmd: BeginEdit({ pageId: newPage.id }),
      session: GM,
    });
    await runtime.pipeline.dispatch({
      id: "c-save2",
      issuedBy: "client-A" as never,
      issuedAt: Date.now(),
      cmd: SetPageBody({
        pageId: newPage.id,
        body: "Krell, chief of the goblins, and his shaman EYEBOX_QUARK.",
      }),
      session: GM,
    });
    await new Promise((r) => setTimeout(r, 30));

    const r = await search("alice", "EYEBOX_QUARK");
    const body = (await r.json()) as { hits: unknown[] };
    expect(body.hits.length).toBe(1);
  });
});
