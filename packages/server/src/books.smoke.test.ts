import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { startServer, type ServerHandle } from "@vtt/substrate/server";
import { definePlugin, InMemoryWorldsRepository } from "@vtt/substrate";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { books } from "@vtt/books";
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
import type { AuthSession } from "@vtt/auth";

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
  dependsOn: ["@vtt/books@^0", "@vtt/pdf-book@^0"],
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
      infrastructure: [shellWorkbench, identity, permissions],
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

    const pdfUrl = `/plugin-data/${worldId}/@vtt/pdf-book/books/${bookEntity!.id}/document.pdf`;
    send({
      kind: "command",
      id: "set-pdf",
      issuedAt: Date.now(),
      cmd: {
        type: SetPdfDocument.name,
        payload: SetPdfDocument({
          bookId: bookEntity!.id,
          url: pdfUrl,
        }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const withPdf = handle.worldsRegistry.get(worldId)!.world.get(bookEntity!.id, [Book, PdfDocument]) as {
      Book: { name: string };
      PdfDocument: { url: string };
    };
    expect(withPdf.PdfDocument.url).toBe(pdfUrl);

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
