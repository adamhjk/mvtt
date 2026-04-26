import { describe, it, expect, beforeEach } from "vitest";
import {
  CommandPipeline,
  EventBus,
  Registry,
  World,
  definePlugin,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import { EntityVisibility } from "@vtt/permissions/shared";
import {
  ChatMessage,
  MessageSent,
  SendMessage,
} from "./shared/index.js";
import { MessageRecordingSystem } from "./server/systems.js";

const serverPlugin = definePlugin({
  name: "@vtt/comms",
  version: "0.1.0",
  traits: [ChatMessage, EntityVisibility],
  events: [MessageSent],
  commands: [SendMessage],
  systems: [MessageRecordingSystem],
});

const SESSION: AuthSession = {
  userId: "user-1",
  email: "hero@test.dev",
  name: "Hero",
  role: "gm",
};

function setup() {
  const registry = new Registry();
  registry.load(serverPlugin);
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);
  return { registry, world, bus, pipeline };
}

function dispatch(
  pipeline: CommandPipeline,
  id: string,
  cmd: ReturnType<typeof SendMessage>,
  session: unknown = SESSION,
) {
  return pipeline.dispatch({
    id,
    issuedBy: "tester",
    issuedAt: Date.now(),
    cmd,
    session,
  });
}

describe("@vtt/comms", () => {
  let pipeline: CommandPipeline;
  let world: World;
  let bus: EventBus;

  beforeEach(() => {
    ({ pipeline, world, bus } = setup());
  });

  it("uses plugin-namespaced ubiquitous-language names", () => {
    expect(SendMessage.name).toBe("@vtt/comms/SendMessage");
    expect(MessageSent.name).toBe("@vtt/comms/MessageSent");
    expect(ChatMessage.name).toBe("@vtt/comms/ChatMessage");
  });

  it("rejects an unauthenticated dispatch", async () => {
    const res = await pipeline.dispatch({
      id: "m1",
      issuedBy: "tester",
      issuedAt: Date.now(),
      cmd: SendMessage({ body: "hi" }),
      // session intentionally omitted
    });
    expect(res.result.ok).toBe(false);
    expect(world.query([ChatMessage])).toHaveLength(0);
  });

  it("public message → MessageSent → entity carrying ChatMessage + everyone-visible EntityVisibility", async () => {
    const seen: string[] = [];
    bus.onAny((e) => seen.push(e.type));

    const res = await dispatch(pipeline, "m1", SendMessage({ body: "hello world" }));

    expect(res.result.ok).toBe(true);
    expect(seen).toEqual([MessageSent.name]);
    const rows = world.query([ChatMessage, EntityVisibility]);
    expect(rows).toHaveLength(1);
    const v = rows[0]!.values as {
      ChatMessage: { authorUserId: string; authorName: string; body: string; whisperTo?: string[] };
      EntityVisibility: { visibility: { kind: string } };
    };
    expect(v.ChatMessage.authorUserId).toBe(SESSION.userId);
    expect(v.ChatMessage.authorName).toBe(SESSION.name);
    expect(v.ChatMessage.body).toBe("hello world");
    expect(v.ChatMessage.whisperTo).toBeUndefined();
    expect(v.EntityVisibility.visibility.kind).toBe("everyone");
  });

  it("whisper attaches users-only EntityVisibility containing both sender and recipient", async () => {
    await dispatch(
      pipeline,
      "m1",
      SendMessage({ body: "psst", whisperTo: ["user-2"] }),
    );
    const row = world.query([ChatMessage, EntityVisibility])[0]!;
    const v = row.values as {
      ChatMessage: { whisperTo?: string[] };
      EntityVisibility: { visibility: { kind: string; userIds?: string[] } };
    };
    expect(v.EntityVisibility.visibility.kind).toBe("users");
    expect(v.EntityVisibility.visibility.userIds).toEqual(
      expect.arrayContaining([SESSION.userId, "user-2"]),
    );
    expect(v.ChatMessage.whisperTo).toEqual(
      expect.arrayContaining([SESSION.userId, "user-2"]),
    );
  });

  it("whisper event itself is broadcast with users-restricted visibility", async () => {
    let captured: { visibility?: { kind: string; userIds?: string[] } } | null = null;
    bus.on(MessageSent.name, (e) => {
      captured = { visibility: (e as { visibility?: { kind: string; userIds?: string[] } }).visibility };
    });
    await dispatch(
      pipeline,
      "m1",
      SendMessage({ body: "psst", whisperTo: ["user-2"] }),
    );
    expect(captured!.visibility?.kind).toBe("users");
    expect(captured!.visibility?.userIds).toEqual(
      expect.arrayContaining([SESSION.userId, "user-2"]),
    );
  });

  it("rejects messages over the size limit at the schema layer", () => {
    expect(() => SendMessage({ body: "x".repeat(2001) })).toThrow();
  });

  it("rejects empty messages at the schema layer", () => {
    expect(() => SendMessage({ body: "" })).toThrow();
  });
});
