import WebSocket from "ws";
import { startServer } from "@vtt/substrate/server";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { characters } from "@vtt/characters";
import {
  Character,
  CharacterCreated,
  CharacterRemoved,
  CharacterRenamed,
  CreateCharacter,
  RemoveCharacter,
  RenameCharacter,
} from "@vtt/characters/shared";
import { OwnedBy } from "@vtt/permissions/shared";
import type { AuthSession } from "@vtt/auth";

const PLAYER: AuthSession = {
  userId: "player-1",
  email: "p@test.dev",
  name: "Player",
  role: "player",
};

const handle = await startServer({
  port: 0,
  plugins: [shellWorkbench, identity, permissions, characters],
  authenticateUpgrade: async () => PLAYER,
  extractRecipient: (s) => {
    const sess = s as AuthSession | null;
    return sess ? { userId: sess.userId, role: sess.role } : null;
  },
});

const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws`);

interface EventMsg {
  kind: "event";
  seq: number;
  event: { type: string; payload: Record<string, unknown> };
}
interface AckMsg {
  kind: "ack";
  commandId: string;
  ok: boolean;
  reason?: string;
}
type Msg =
  | { kind: "hello"; clientId: string }
  | { kind: "snapshot"; atSeq: number; entities: { id: string }[] }
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

// Create
send({
  kind: "command",
  id: "create-character",
  issuedAt: Date.now(),
  cmd: {
    type: CreateCharacter.name,
    payload: CreateCharacter({ name: "Tarn the Bold" }).payload,
  },
});

await new Promise((r) => setTimeout(r, 80));

const after = handle.world.query([Character]);
assert(after.length === 1, "expected one Character entity after CreateCharacter");
const characterId = after[0]!.id;
const initial = handle.world.get(characterId, [Character, OwnedBy]) as {
  Character: { name: string };
  OwnedBy: { userId: string };
};
assert(initial.Character.name === "Tarn the Bold", "expected character name to round-trip");
assert(initial.OwnedBy.userId === PLAYER.userId, "expected dispatcher to own the character");

// Rename
send({
  kind: "command",
  id: "rename-character",
  issuedAt: Date.now(),
  cmd: {
    type: RenameCharacter.name,
    payload: RenameCharacter({ characterId, name: "Tarn the Bolder" }).payload,
  },
});

await new Promise((r) => setTimeout(r, 80));

const renamed = handle.world.get(characterId, [Character]) as {
  Character: { name: string };
};
assert(renamed.Character.name === "Tarn the Bolder", "expected rename to land on the trait");

// Remove
send({
  kind: "command",
  id: "remove-character",
  issuedAt: Date.now(),
  cmd: {
    type: RemoveCharacter.name,
    payload: RemoveCharacter({ characterId }).payload,
  },
});

await new Promise((r) => setTimeout(r, 80));

assert(!handle.world.has(characterId), "expected character to be despawned after RemoveCharacter");

const eventTypes = messages
  .filter((m): m is EventMsg => m.kind === "event")
  .map((m) => m.event.type);
assert(
  eventTypes.includes(CharacterCreated.name) &&
    eventTypes.includes(CharacterRenamed.name) &&
    eventTypes.includes(CharacterRemoved.name),
  `expected CharacterCreated, CharacterRenamed, CharacterRemoved in event stream; got ${eventTypes.join(",")}`,
);

const acks = messages.filter((m): m is AckMsg => m.kind === "ack");
assert(
  acks.length === 3 && acks.every((a) => a.ok),
  `expected three ok acks, got ${JSON.stringify(acks)}`,
);

console.log("ok — characters wire round-trips create/rename/remove");
ws.close();
await handle.close();
process.exit(0);
