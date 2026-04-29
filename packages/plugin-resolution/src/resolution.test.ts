import { describe, it, expect, beforeEach } from "vitest";
import {
  CommandPipeline,
  EventBus,
  Registry,
  World,
  definePlugin,
  type EntityId,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import { EntityVisibility, OwnedBy } from "@vtt/permissions/shared";
import { Character } from "@vtt/characters/shared";
import {
  Formula,
  RequestRoll,
  RolledBy,
  RollResolved,
  RollResult,
} from "./shared/index.js";
import {
  RollChatHandler,
  RollChatHandlerLong,
} from "./shared/chat-handler.js";
import { RollRecordingSystem } from "./server/systems.js";

const serverPlugin = definePlugin({
  name: "@vtt/resolution",
  version: "0.3.0",
  traits: [Formula, RollResult, RolledBy, EntityVisibility, Character, OwnedBy],
  events: [RollResolved],
  commands: [RequestRoll],
  systems: [RollRecordingSystem],
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
  cmd: ReturnType<typeof RequestRoll>,
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

describe("@vtt/resolution", () => {
  let pipeline: CommandPipeline;
  let world: World;
  let bus: EventBus;

  beforeEach(() => {
    ({ pipeline, world, bus } = setup());
  });

  it("uses plugin-namespaced ubiquitous-language names", () => {
    expect(RequestRoll.name).toBe("@vtt/resolution/RequestRoll");
    expect(RollResolved.name).toBe("@vtt/resolution/RollResolved");
    expect(Formula.name).toBe("@vtt/resolution/Formula");
    expect(RollResult.name).toBe("@vtt/resolution/RollResult");
    expect(RolledBy.name).toBe("@vtt/resolution/RolledBy");
  });

  it("rejects an unauthenticated dispatch", async () => {
    const res = await pipeline.dispatch({
      id: "r1",
      issuedBy: "tester",
      issuedAt: Date.now(),
      cmd: RequestRoll({ notation: "1d20", visibility: "public" }),
      // session intentionally omitted
    });
    expect(res.result.ok).toBe(false);
    if (!res.result.ok) expect(res.result.reason).toMatch(/not authenticated/);
    expect(world.query([Formula])).toHaveLength(0);
  });

  it("rejects malformed dice notation in validate", async () => {
    const res = await dispatch(
      pipeline,
      "r1",
      RequestRoll({ notation: "not-a-roll", visibility: "public" }),
    );
    expect(res.result.ok).toBe(false);
    if (!res.result.ok) expect(res.result.reason).toMatch(/invalid notation/);
    expect(world.query([Formula])).toHaveLength(0);
  });

  it("RequestRoll → RollResolved → spawned entity carrying Formula + RollResult + RolledBy + EntityVisibility", async () => {
    const seen: string[] = [];
    bus.onAny((e) => seen.push(e.type));

    const res = await dispatch(
      pipeline,
      "r1",
      RequestRoll({ notation: "1d20", visibility: "public" }),
    );

    expect(res.result.ok).toBe(true);
    expect(seen).toEqual([RollResolved.name]);
    const rows = world.query([Formula, RollResult, RolledBy, EntityVisibility]);
    expect(rows).toHaveLength(1);
    const v = rows[0]!.values as {
      Formula: { notation: string };
      RollResult: { total: number; output: string };
      RolledBy: { userId: string; displayName: string };
      EntityVisibility: { visibility: { kind: string } };
    };
    expect(v.Formula.notation).toBe("1d20");
    expect(v.RollResult.total).toBeGreaterThanOrEqual(1);
    expect(v.RollResult.total).toBeLessThanOrEqual(20);
    expect(v.RollResult.output).toContain("1d20");
    expect(v.EntityVisibility.visibility.kind).toBe("everyone");
    expect(v.RolledBy.userId).toBe(SESSION.userId);
    expect(v.RolledBy.displayName).toBe(SESSION.name);
  });

  it("gm-only roll attaches role-restricted EntityVisibility", async () => {
    await dispatch(
      pipeline,
      "r1",
      RequestRoll({ notation: "1d20", visibility: "gm-only" }),
    );
    const row = world.query([EntityVisibility])[0]!;
    expect(row.values.EntityVisibility).toEqual({
      visibility: { kind: "role", role: "gm" },
    });
  });

  it("private roll restricts EntityVisibility to the rolling user", async () => {
    await dispatch(
      pipeline,
      "r1",
      RequestRoll({ notation: "1d20", visibility: "private" }),
    );
    const row = world.query([EntityVisibility])[0]!;
    expect(row.values.EntityVisibility).toEqual({
      visibility: { kind: "users", userIds: [SESSION.userId] },
    });
  });

  it("respects modifiers in the notation", async () => {
    await dispatch(
      pipeline,
      "r1",
      RequestRoll({ notation: "1d1+5", visibility: "public" }),
    );
    const row = world.query([RollResult])[0]!;
    expect((row.values.RollResult as { total: number }).total).toBe(6);
  });

  it("each roll spawns a distinct entity", async () => {
    for (let i = 0; i < 4; i++) {
      await dispatch(
        pipeline,
        `r-${i}`,
        RequestRoll({ notation: "1d6", visibility: "public" }),
      );
    }
    const rows = world.query([Formula, RollResult]);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.id)).size).toBe(4);
  });

  it("RollResolved event payload carries the full server-authoritative result", async () => {
    let captured: {
      total: number;
      output: string;
      notation: string;
      rolledByUserId: string;
      rolledByName: string;
    } | null = null;
    bus.on(RollResolved.name, (e) => {
      captured = e.payload as typeof captured;
    });
    await dispatch(
      pipeline,
      "r1",
      RequestRoll({ notation: "1d1", visibility: "public" }),
    );
    expect(captured).toBeTruthy();
    expect(captured!.total).toBe(1);
    expect(captured!.notation).toBe("1d1");
    expect(captured!.output).toContain("1d1");
    expect(captured!.rolledByUserId).toBe(SESSION.userId);
    expect(captured!.rolledByName).toBe(SESSION.name);
  });

  it("RollResolved.dice carries one entry per individual die for animation", async () => {
    let captured: {
      dice: { sides: number | "F"; value: number }[];
      total: number;
    } | null = null;
    bus.on(RollResolved.name, (e) => {
      captured = e.payload as typeof captured;
    });
    await dispatch(
      pipeline,
      "r-dice",
      RequestRoll({ notation: "3d6+2d20", visibility: "public" }),
    );
    expect(captured).toBeTruthy();
    expect(captured!.dice).toHaveLength(5);
    const d6s = captured!.dice.filter((d) => d.sides === 6);
    const d20s = captured!.dice.filter((d) => d.sides === 20);
    expect(d6s).toHaveLength(3);
    expect(d20s).toHaveLength(2);
    for (const d of d6s) {
      expect(d.value).toBeGreaterThanOrEqual(1);
      expect(d.value).toBeLessThanOrEqual(6);
    }
    for (const d of d20s) {
      expect(d.value).toBeGreaterThanOrEqual(1);
      expect(d.value).toBeLessThanOrEqual(20);
    }
    // The sum of die values plus the +2 modifier should equal total.
    const sum = captured!.dice.reduce((acc, d) => acc + d.value, 0);
    // The notation has no constant — total is just the dice sum.
    expect(sum).toBe(captured!.total);
  });

  it("RollResolved.dice supports Fudge dice (sides: 'F')", async () => {
    let captured: { dice: { sides: number | "F"; value: number }[] } | null =
      null;
    bus.on(RollResolved.name, (e) => {
      captured = e.payload as typeof captured;
    });
    await dispatch(
      pipeline,
      "r-fudge",
      RequestRoll({ notation: "4dF", visibility: "public" }),
    );
    expect(captured).toBeTruthy();
    expect(captured!.dice).toHaveLength(4);
    for (const d of captured!.dice) {
      expect(d.sides).toBe("F");
      expect([-1, 0, 1]).toContain(d.value);
    }
  });

  describe("speakingAsCharacterId", () => {
    function spawnCharacter(
      world: World,
      args: { name: string; ownerUserId: string; playerUserId?: string },
    ): EntityId {
      return world.spawn([
        Character({ name: args.name, playerUserId: args.playerUserId }),
        OwnedBy({ userId: args.ownerUserId }),
      ]);
    }

    it("uses the character's name as RolledBy.displayName when speaking as it", async () => {
      const charId = spawnCharacter(world, {
        name: "Tarn",
        ownerUserId: SESSION.userId,
        playerUserId: SESSION.userId,
      });
      const res = await dispatch(
        pipeline,
        "r-as",
        RequestRoll({
          notation: "1d20",
          visibility: "public",
          speakingAsCharacterId: charId,
        }),
      );
      expect(res.result.ok).toBe(true);
      const row = world.query([RolledBy]).at(-1)!;
      const v = row.values.RolledBy as {
        userId: string;
        displayName: string;
        speakingAsCharacterId?: string;
      };
      expect(v.userId).toBe(SESSION.userId);
      expect(v.displayName).toBe("Tarn");
      expect(v.speakingAsCharacterId).toBe(charId);
    });

    it("rejects roll-as on a character assigned to another player", async () => {
      const charId = spawnCharacter(world, {
        name: "Foe",
        ownerUserId: "u2",
        playerUserId: "u2",
      });
      const player: AuthSession = {
        userId: "player-x",
        email: "p@x.dev",
        name: "PX",
        role: "player",
      };
      const res = await dispatch(
        pipeline,
        "r-spoof",
        RequestRoll({
          notation: "1d6",
          visibility: "public",
          speakingAsCharacterId: charId,
        }),
        player,
      );
      expect(res.result.ok).toBe(false);
      expect(world.query([RolledBy])).toHaveLength(0);
    });

    it("rejects roll-as on a non-existent entity", async () => {
      const res = await dispatch(
        pipeline,
        "r-ghost",
        RequestRoll({
          notation: "1d6",
          visibility: "public",
          speakingAsCharacterId: "ghost" as EntityId,
        }),
      );
      expect(res.result.ok).toBe(false);
    });
  });

  it("RollResolved.dice is empty for a notation with no dice", async () => {
    let captured: { dice: { sides: number | "F"; value: number }[] } | null =
      null;
    bus.on(RollResolved.name, (e) => {
      captured = e.payload as typeof captured;
    });
    // A bare modifier — degenerate but accepted by the parser.
    await dispatch(
      pipeline,
      "r-bare",
      RequestRoll({ notation: "5", visibility: "public" }),
    );
    expect(captured).toBeTruthy();
    expect(captured!.dice).toEqual([]);
  });

  describe("slash-command handlers", () => {
    const baseCtx = {
      myUserId: SESSION.userId,
      myRole: SESSION.role,
      onlineByName: new Map<string, string>(),
      speakingAsCharacterId: null,
      gmOnly: false,
    };

    it("/r is registered with the right prefix and describe text", () => {
      expect(RollChatHandler.prefix).toBe("/r ");
      expect(RollChatHandler.describe).toMatch(/\/r/);
    });

    it("/roll is registered with the right prefix and describe text", () => {
      expect(RollChatHandlerLong.prefix).toBe("/roll ");
      expect(RollChatHandlerLong.describe).toMatch(/\/roll/);
    });

    it("/r 1d20 produces a RequestRoll with the right notation", () => {
      const cmd = RollChatHandler.handle("/r 1d20", baseCtx);
      expect(cmd?.type).toBe(RequestRoll.name);
      expect((cmd?.payload as { notation: string }).notation).toBe("1d20");
    });

    it("/roll 1d20 produces a RequestRoll with the right notation", () => {
      const cmd = RollChatHandlerLong.handle("/roll 1d20", baseCtx);
      expect(cmd?.type).toBe(RequestRoll.name);
      expect((cmd?.payload as { notation: string }).notation).toBe("1d20");
    });

    it("forwards gmOnly from the chat composer to RequestRoll.visibility", () => {
      const cmd = RollChatHandler.handle("/r 1d20", {
        ...baseCtx,
        gmOnly: true,
      });
      expect((cmd?.payload as { visibility: string }).visibility).toBe(
        "gm-only",
      );
    });

    it("forwards speakingAsCharacterId when set", () => {
      const cmd = RollChatHandlerLong.handle("/roll 1d6", {
        ...baseCtx,
        speakingAsCharacterId: "char-1",
      });
      expect(
        (cmd?.payload as { speakingAsCharacterId?: string })
          .speakingAsCharacterId,
      ).toBe("char-1");
    });

    it("returns null on an empty notation", () => {
      expect(RollChatHandler.handle("/r ", baseCtx)).toBeNull();
      expect(RollChatHandlerLong.handle("/roll ", baseCtx)).toBeNull();
    });
  });
});
