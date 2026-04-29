import WebSocket from "ws";
import { startServer } from "@vtt/substrate/server";
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

const worldsRepo = new InMemoryWorldsRepository();
await worldsRepo.migrate();
const world = await worldsRepo.insert({
  id: "books-smoke",
  name: "Books smoke",
  gameSystemPlugin: booksTestSystem.name,
  ownerUserId: GM.userId,
});

const handle = await startServer({
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

const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?worldId=${world.id}`);

interface AckMsg {
  kind: "ack";
  commandId: string;
  ok: boolean;
  reason?: string;
}
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

const messages: Msg[] = [];
ws.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as Msg));

await new Promise<void>((r) => ws.on("open", () => r()));

const send = (env: object) => ws.send(JSON.stringify(env));
const assert = (cond: unknown, msg: string): void => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
};

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

const bookEntity = handle.worldsRegistry.get(world.id)!.world.query([Book])[0];
assert(bookEntity, "expected one Book entity after CreateBook");

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

const renamed = handle.worldsRegistry.get(world.id)!.world.get(bookEntity!.id, [Book]) as {
  Book: { name: string };
};
assert(
  renamed.Book.name === "Player's Handbook",
  `expected book renamed; got ${renamed.Book.name}`,
);

const pdfUrl = `/plugin-data/${world.id}/@vtt/pdf-book/books/${bookEntity!.id}/document.pdf`;
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

const withPdf = handle.worldsRegistry.get(world.id)!.world.get(bookEntity!.id, [Book, PdfDocument]) as {
  Book: { name: string };
  PdfDocument: { url: string };
};
assert(
  withPdf.PdfDocument.url === pdfUrl,
  `expected PdfDocument trait attached with the upload URL; got ${withPdf.PdfDocument.url}`,
);

const eventTypes = messages
  .filter((m): m is EventMsg => m.kind === "event")
  .map((m) => m.event.type);
assert(
  eventTypes.includes(BookCreated.name) &&
    eventTypes.includes(BookUpdated.name) &&
    eventTypes.includes(PdfDocumentSet.name),
  `expected BookCreated, BookUpdated, PdfDocumentSet in event stream; got ${eventTypes.join(",")}`,
);

const acks = messages.filter((m): m is AckMsg => m.kind === "ack");
assert(acks.length === 3 && acks.every((a) => a.ok), "expected three ok acks");

console.log(
  "ok — books wire round-trips create/update and pdf-book attaches PdfDocument",
);
ws.close();
await handle.close();
process.exit(0);
