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
import { definePlugin, InMemoryWorldsRepository } from "@vtt/substrate";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { books } from "@vtt/books";
import { notes } from "@vtt/notes";
import { assets } from "@vtt/assets";
import { pdfBook } from "@vtt/pdf-book";
import {
  Book,
  BookCreated,
  BookUpdated,
  CreateBook,
  UpdateBook,
} from "@vtt/books/shared";
import {
  PdfDocument,
  PdfDocumentSet,
  SetPdfDocument,
} from "@vtt/pdf-book/shared";
import { Asset } from "@vtt/assets/shared";
import { Permissions, ownedBy } from "@vtt/permissions/shared";
import type { AuthSession } from "@vtt/auth";
import type { EntityId } from "@vtt/substrate";

/**
 * Wire-protocol smoke for the books + pdf-book plugins: create a book,
 * rename it, attach a PDF, verify trait state and event ordering.
 */

const GM: AuthSession = {
  userId: "gm-1",
  email: "gm@test.dev",
  name: "GM",
  role: "gm",
};

const booksTestSystem = definePlugin({
  name: "@vtt/books-test-system",
  version: "0",
  dependsOn: ["@vtt/books@^0", "@vtt/pdf-book@^0", "@vtt/assets@^0"],
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

describe("books wire smoke", () => {
  let handle: ServerHandle;
  let worldId: string;
  let ws: WebSocket;
  const messages: Msg[] = [];

  beforeAll(async () => {
    const worldsRepo = new InMemoryWorldsRepository();
    await worldsRepo.migrate();
    const world = await worldsRepo.insert({
      id: "books-smoke",
      name: "Books smoke",
      gameSystemPlugin: booksTestSystem.name,
      ownerUserId: GM.userId,
    });
    worldId = world.id;
    handle = await startServer({
      port: 0,
      infrastructure: [shellWorkbench, notes, identity, permissions, assets],
      optional: [books, pdfBook, booksTestSystem],
      worldsRepo,
      authenticateUpgrade: async () => GM,
      extractRecipient: (s) => {
        const sess = s as AuthSession | null;
        return sess ? { userId: sess.userId, role: sess.role } : null;
      },
    });
  });

  afterAll(async () => {
    if (ws && ws.readyState === ws.OPEN) ws.close();
    if (handle) await handle.close();
  });

  it("round-trips create/update and attaches PdfDocument", async () => {
    ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?worldId=${worldId}`);
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as Msg));
    await new Promise<void>((r) => ws.on("open", () => r()));

    const send = (env: object) => ws.send(JSON.stringify(env));

    send({
      kind: "command",
      id: "create-book",
      issuedAt: Date.now(),
      cmd: {
        type: CreateBook.name,
        payload: CreateBook({ name: "PHB" }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const bookEntity = handle.worldsRegistry.get(worldId)!.world.query([Book])[0];
    expect(bookEntity).toBeDefined();

    send({
      kind: "command",
      id: "rename-book",
      issuedAt: Date.now(),
      cmd: {
        type: UpdateBook.name,
        payload: UpdateBook({
          bookId: bookEntity!.id,
          name: "Player's Handbook",
        }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const renamed = handle.worldsRegistry.get(worldId)!.world.get(bookEntity!.id, [Book]) as {
      Book: { name: string };
    };
    expect(renamed.Book.name).toBe("Player's Handbook");

    // Seed an Asset entity directly (the upload route would do this in
    // production via RegisterAsset; tests bypass the HTTP layer).
    const runtime = handle.worldsRegistry.get(worldId)!;
    const assetId = runtime.world.allocateId();
    runtime.world.spawnAt(assetId, [
      Asset({
        mime: "application/pdf",
        sizeBytes: 1024,
        sha256: "f".repeat(64),
        filename: "phb.pdf",
        width: null,
        height: null,
        uploadedAt: Date.now(),
      }),
      Permissions(ownedBy(GM.userId)),
    ]);

    send({
      kind: "command",
      id: "set-pdf",
      issuedAt: Date.now(),
      cmd: {
        type: SetPdfDocument.name,
        payload: SetPdfDocument({
          bookId: bookEntity!.id,
          assetId,
        }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const withPdf = runtime.world.get(bookEntity!.id, [Book, PdfDocument]) as {
      Book: { name: string };
      PdfDocument: { assetId: EntityId };
    };
    expect(withPdf.PdfDocument.assetId).toBe(assetId);

    const eventTypes = messages
      .filter((m): m is EventMsg => m.kind === "event")
      .map((m) => m.event.type);
    expect(eventTypes).toContain(BookCreated.name);
    expect(eventTypes).toContain(BookUpdated.name);
    expect(eventTypes).toContain(PdfDocumentSet.name);

    const acks = messages.filter((m): m is AckMsg => m.kind === "ack");
    expect(acks).toHaveLength(3);
    expect(acks.every((a) => a.ok)).toBe(true);
  });
});
