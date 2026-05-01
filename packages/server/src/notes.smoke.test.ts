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
import WebSocket from "ws";
import { startServer, type ServerHandle } from "@vtt/substrate/server";
import {
  definePlugin,
  InMemoryWorldsRepository,
} from "@vtt/substrate";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { assets } from "@vtt/assets";
import { notes } from "@vtt/notes";
import {
  AddPage,
  BeginEdit,
  CreateNote,
  EditBegun,
  EditEnded,
  EndEdit,
  Note,
  NoteCreated,
  Page,
  PageAdded,
  PageBodySet,
  PageHistory,
  SetDraftBody,
  SetPageBody,
  PageBodyDraft,
  PageDraft,
  EditorLock,
  BelongsToNote,
} from "@vtt/notes/shared";
import type { AuthSession } from "@vtt/auth";

const GM: AuthSession = {
  userId: "gm-1",
  email: "gm@test.dev",
  name: "GM",
  role: "gm",
};

const notesTestSystem = definePlugin({
  name: "@vtt/notes-test-system",
  version: "0",
  dependsOn: ["@vtt/notes@^0", "@vtt/assets@^0"],
  gameSystem: true,
});

interface AckMsg { kind: "ack"; commandId: string; ok: boolean; reason?: string }
interface EventMsg {
  kind: "event";
  seq: number;
  event: { type: string; payload: Record<string, unknown> };
}
type Msg =
  | { kind: "hello"; clientId: string }
  | { kind: "snapshot"; atSeq: number; entities: unknown[] }
  | EventMsg
  | AckMsg
  | { kind: "synced" };

describe("notes wire smoke", () => {
  let handle: ServerHandle;
  let worldId: string;

  beforeAll(async () => {
    const worldsRepo = new InMemoryWorldsRepository();
    await worldsRepo.migrate();
    const world = await worldsRepo.insert({
      id: "notes-smoke",
      name: "Notes smoke",
      gameSystemPlugin: notesTestSystem.name,
      ownerUserId: GM.userId,
    });
    worldId = world.id;
    handle = await startServer({
      port: 0,
      infrastructure: [shellWorkbench, identity, permissions, notes, assets],
      optional: [notesTestSystem],
      worldsRepo,
      authenticateUpgrade: async () => GM,
      extractRecipient: (s) => {
        const sess = s as AuthSession | null;
        return sess ? { userId: sess.userId, role: sess.role } : null;
      },
    });
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  function connect(): {
    ws: WebSocket;
    messages: Msg[];
    send: (env: object) => void;
    helloed: Promise<{ clientId: string }>;
    close: () => void;
  } {
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?worldId=${worldId}`);
    const messages: Msg[] = [];
    let resolveHello: ((m: { clientId: string }) => void) | null = null;
    const helloed = new Promise<{ clientId: string }>((r) => {
      resolveHello = r;
    });
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString()) as Msg;
      messages.push(m);
      if (m.kind === "hello" && resolveHello) {
        resolveHello({ clientId: m.clientId });
        resolveHello = null;
      }
    });
    return {
      ws,
      messages,
      send: (env) => ws.send(JSON.stringify(env)),
      helloed,
      close: () => ws.close(),
    };
  }

  it("round-trips create → begin-edit → drafts → save → end", async () => {
    const conn = connect();
    await new Promise<void>((r) => conn.ws.on("open", () => r()));
    await conn.helloed;

    conn.send({
      kind: "command",
      id: "c-create",
      issuedAt: Date.now(),
      cmd: {
        type: CreateNote.name,
        payload: CreateNote({ title: "Goblin Cave" }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const runtime = handle.worldsRegistry.get(worldId)!;
    const note = runtime.world.query([Note])[0];
    expect(note).toBeDefined();
    const page = runtime.world.query([Page, BelongsToNote])[0]!;
    expect(page).toBeDefined();

    // BeginEdit
    conn.send({
      kind: "command",
      id: "c-begin",
      issuedAt: Date.now(),
      cmd: {
        type: BeginEdit.name,
        payload: BeginEdit({ pageId: page.id }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));
    const lock = runtime.world.get(page.id, [EditorLock]) as
      | { EditorLock: { userId: string; expires: number } }
      | undefined;
    expect(lock?.EditorLock.userId).toBe(GM.userId);
    expect(lock?.EditorLock.expires).toBeGreaterThan(Date.now());

    // Draft (transient — broadcast to readers, not logged)
    conn.send({
      kind: "command",
      id: "c-draft",
      issuedAt: Date.now(),
      cmd: {
        type: SetDraftBody.name,
        payload: SetDraftBody({ pageId: page.id, body: "draft text" }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));
    const draft = runtime.world.get(page.id, [PageDraft]) as
      | { PageDraft: { body: string } }
      | undefined;
    expect(draft?.PageDraft.body).toBe("draft text");
    // Page.body unchanged because draft is transient
    expect((runtime.world.get(page.id, [Page]) as { Page: { body: string } }).Page.body).toBe("");

    // Durable save (checkpoint)
    conn.send({
      kind: "command",
      id: "c-save",
      issuedAt: Date.now(),
      cmd: {
        type: SetPageBody.name,
        payload: SetPageBody({ pageId: page.id, body: "# Heading\n\nbody" }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));
    const saved = runtime.world.get(page.id, [Page]) as { Page: { body: string; bodyRev: number } };
    expect(saved.Page.body).toBe("# Heading\n\nbody");
    expect(saved.Page.bodyRev).toBe(1);
    const hist = runtime.world.get(page.id, [PageHistory]) as
      | { PageHistory: { entries: Array<{ rev: number }> } }
      | undefined;
    expect(hist?.PageHistory.entries).toHaveLength(1);
    expect(hist?.PageHistory.entries[0]!.rev).toBe(1);

    // End edit
    conn.send({
      kind: "command",
      id: "c-end",
      issuedAt: Date.now(),
      cmd: {
        type: EndEdit.name,
        payload: EndEdit({ pageId: page.id }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));
    const cleared = runtime.world.get(page.id, [EditorLock]) as
      | { EditorLock: { expires: number } }
      | undefined;
    expect(cleared?.EditorLock.expires).toBe(0);

    // Inspect the broadcast event stream
    const eventTypes = conn.messages
      .filter((m): m is EventMsg => m.kind === "event")
      .map((m) => m.event.type);
    expect(eventTypes).toContain(NoteCreated.name);
    expect(eventTypes).toContain(PageAdded.name);
    expect(eventTypes).toContain(EditBegun.name);
    expect(eventTypes).toContain(PageBodyDraft.name);
    expect(eventTypes).toContain(PageBodySet.name);
    expect(eventTypes).toContain(EditEnded.name);

    // Acks all OK
    const acks = conn.messages.filter((m): m is AckMsg => m.kind === "ack");
    expect(acks.every((a) => a.ok)).toBe(true);

    conn.close();
  });

  it("LockReleaseSystem releases a held lock when the holder disconnects", async () => {
    // Fresh connection
    const conn = connect();
    await new Promise<void>((r) => conn.ws.on("open", () => r()));
    const hello = await conn.helloed;

    // Make a note and begin editing the auto-created first page
    conn.send({
      kind: "command",
      id: `c-create-2`,
      issuedAt: Date.now(),
      cmd: {
        type: CreateNote.name,
        payload: CreateNote({ title: "Crash test" }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const runtime = handle.worldsRegistry.get(worldId)!;
    const allPages = runtime.world.query([Page, BelongsToNote]);
    const newPage = allPages[allPages.length - 1]!;

    conn.send({
      kind: "command",
      id: `c-begin-2`,
      issuedAt: Date.now(),
      cmd: {
        type: BeginEdit.name,
        payload: BeginEdit({ pageId: newPage.id }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const lock = runtime.world.get(newPage.id, [EditorLock]) as
      | { EditorLock: { clientId: string; expires: number } }
      | undefined;
    expect(lock?.EditorLock.clientId).toBe(hello.clientId);
    expect(lock?.EditorLock.expires).toBeGreaterThan(Date.now());

    // Slam the connection. Server's ConnectionClosed → LockReleaseSystem
    // dispatches EndEdit for held locks.
    conn.ws.terminate();
    await new Promise((r) => setTimeout(r, 200));

    const afterDisconnect = runtime.world.get(newPage.id, [EditorLock]) as
      | { EditorLock: { expires: number } }
      | undefined;
    expect(afterDisconnect?.EditorLock.expires).toBe(0);
  });
});
