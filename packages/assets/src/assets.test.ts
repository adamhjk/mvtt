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

import { describe, it, expect, beforeEach } from "vitest";
import {
  CommandPipeline,
  EventBus,
  Registry,
  World,
  type CommandInstance,
  type EntityId,
  substrateCorePlugin,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import { permissions } from "@vtt/permissions";
import { EntityVisibility, OwnedBy } from "@vtt/permissions/shared";
import { shellWorkbench } from "@vtt/shell-workbench";
import { notes } from "@vtt/notes";
import {
  Asset,
  AssetDeleted,
  AssetRegistered,
  AssetRenamed,
  AssetVisibilityChanged,
  DeleteAsset,
  RegisterAsset,
  RenameAsset,
  SetAssetVisibility,
} from "./shared/index.js";
import { assets as assetsPlugin } from "./manifest.js";
import {
  AssetDespawnSystem,
  AssetRenameSystem,
  AssetSpawningSystem,
  AssetVisibilityChangeSystem,
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

const SHA = {
  one: "a".repeat(64),
  two: "b".repeat(64),
};

function setup() {
  const registry = new Registry();
  registry.load(substrateCorePlugin);
  registry.load(permissions);
  registry.load(shellWorkbench); // declares PagesSlot that notes fills
  registry.load(notes); // declares the LinkKindsSlot that assets fills
  registry.load(assetsPlugin);
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
) {
  return pipeline.dispatch({
    id: `cmd-${++cmdSeq}`,
    issuedBy: "tester",
    issuedAt: Date.now(),
    cmd,
    session,
  });
}

async function register(
  pipeline: CommandPipeline,
  session: AuthSession,
  overrides: Partial<{
    sha256: string;
    mime: string;
    sizeBytes: number;
    filename: string | null;
  }> = {},
) {
  return dispatch(
    pipeline,
    RegisterAsset({
      mime: overrides.mime ?? "image/webp",
      sizeBytes: overrides.sizeBytes ?? 1234,
      sha256: overrides.sha256 ?? SHA.one,
      filename: overrides.filename ?? "cave.webp",
      width: null,
      height: null,
    }),
    session,
  );
}

describe("@vtt/assets", () => {
  let pipeline: CommandPipeline;
  let world: World;
  let bus: EventBus;
  let registry: Registry;

  beforeEach(() => {
    ({ pipeline, world, bus, registry } = setup());
  });

  it("uses plugin-namespaced ubiquitous-language names", () => {
    expect(Asset.name).toBe("@vtt/assets/Asset");
    expect(RegisterAsset.name).toBe("@vtt/assets/RegisterAsset");
    expect(RenameAsset.name).toBe("@vtt/assets/RenameAsset");
    expect(SetAssetVisibility.name).toBe("@vtt/assets/SetAssetVisibility");
    expect(DeleteAsset.name).toBe("@vtt/assets/DeleteAsset");
    expect(AssetRegistered.name).toBe("@vtt/assets/AssetRegistered");
    expect(AssetRenamed.name).toBe("@vtt/assets/AssetRenamed");
    expect(AssetVisibilityChanged.name).toBe(
      "@vtt/assets/AssetVisibilityChanged",
    );
    expect(AssetDeleted.name).toBe("@vtt/assets/AssetDeleted");
  });

  describe("RegisterAsset", () => {
    it("authenticated dispatch spawns Asset + OwnedBy + EntityVisibility", async () => {
      const seen: string[] = [];
      bus.onAny((e) => seen.push(e.type));
      const res = await register(pipeline, ALICE);
      expect(res.result.ok).toBe(true);
      expect(res.events.map((e) => e.type)).toEqual([AssetRegistered.name]);
      expect(seen).toEqual([AssetRegistered.name]);
      const rows = world.query([Asset]);
      expect(rows).toHaveLength(1);
      const id = rows[0]!.id;
      const asset = rows[0]!.values.Asset as { mime: string; sha256: string; filename: string | null };
      expect(asset.mime).toBe("image/webp");
      expect(asset.sha256).toBe(SHA.one);
      expect(asset.filename).toBe("cave.webp");
      const owned = world.get(id, [OwnedBy]) as { OwnedBy: { userId: string } };
      expect(owned.OwnedBy.userId).toBe("alice");
      const vis = world.get(id, [EntityVisibility]) as
        | { EntityVisibility: { visibility: { kind: string } } }
        | undefined;
      expect(vis?.EntityVisibility.visibility.kind).toBe("everyone");
    });

    it("rejects unauthenticated dispatch", async () => {
      const res = await register(pipeline, undefined as unknown as AuthSession);
      expect(res.result.ok).toBe(false);
      expect(world.query([Asset])).toHaveLength(0);
    });

    it("each register produces a distinct entity", async () => {
      await register(pipeline, ALICE, { sha256: SHA.one });
      await register(pipeline, BOB, { sha256: SHA.two });
      expect(world.query([Asset])).toHaveLength(2);
    });
  });

  describe("RenameAsset", () => {
    it("owner renames", async () => {
      await register(pipeline, ALICE);
      const id = world.query([Asset])[0]!.id;
      const res = await dispatch(
        pipeline,
        RenameAsset({ assetId: id, filename: "renamed.webp" }),
        ALICE,
      );
      expect(res.result.ok).toBe(true);
      const a = world.get(id, [Asset]) as { Asset: { filename: string | null } };
      expect(a.Asset.filename).toBe("renamed.webp");
    });

    it("GM renames any asset", async () => {
      await register(pipeline, ALICE);
      const id = world.query([Asset])[0]!.id;
      const res = await dispatch(
        pipeline,
        RenameAsset({ assetId: id, filename: "by-gm.webp" }),
        GM,
      );
      expect(res.result.ok).toBe(true);
      const a = world.get(id, [Asset]) as { Asset: { filename: string | null } };
      expect(a.Asset.filename).toBe("by-gm.webp");
    });

    it("non-owner non-GM is rejected", async () => {
      await register(pipeline, ALICE);
      const id = world.query([Asset])[0]!.id;
      const res = await dispatch(
        pipeline,
        RenameAsset({ assetId: id, filename: "hax.webp" }),
        BOB,
      );
      expect(res.result.ok).toBe(false);
      const a = world.get(id, [Asset]) as { Asset: { filename: string | null } };
      expect(a.Asset.filename).toBe("cave.webp");
    });

    it("ghost id is rejected", async () => {
      const res = await dispatch(
        pipeline,
        RenameAsset({ assetId: "ghost" as EntityId, filename: "x" }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });
  });

  describe("SetAssetVisibility", () => {
    it("owner can change to gmOnly", async () => {
      await register(pipeline, ALICE);
      const id = world.query([Asset])[0]!.id;
      const res = await dispatch(
        pipeline,
        SetAssetVisibility({
          assetId: id,
          visibility: { kind: "role", role: "gm" },
        }),
        ALICE,
      );
      expect(res.result.ok).toBe(true);
      const v = world.get(id, [EntityVisibility]) as {
        EntityVisibility: { visibility: { kind: string; role?: string } };
      };
      expect(v.EntityVisibility.visibility).toEqual({ kind: "role", role: "gm" });
    });

    it("GM can change visibility on any asset", async () => {
      await register(pipeline, ALICE);
      const id = world.query([Asset])[0]!.id;
      const res = await dispatch(
        pipeline,
        SetAssetVisibility({
          assetId: id,
          visibility: { kind: "users", userIds: ["alice", "bob"] },
        }),
        GM,
      );
      expect(res.result.ok).toBe(true);
    });

    it("non-owner non-GM is rejected", async () => {
      await register(pipeline, ALICE);
      const id = world.query([Asset])[0]!.id;
      const res = await dispatch(
        pipeline,
        SetAssetVisibility({
          assetId: id,
          visibility: { kind: "role", role: "gm" },
        }),
        BOB,
      );
      expect(res.result.ok).toBe(false);
    });

    it("ghost id is rejected", async () => {
      const res = await dispatch(
        pipeline,
        SetAssetVisibility({
          assetId: "ghost" as EntityId,
          visibility: { kind: "everyone" },
        }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });
  });

  describe("DeleteAsset", () => {
    it("owner deletes; entity is despawned", async () => {
      await register(pipeline, ALICE);
      const id = world.query([Asset])[0]!.id;
      expect(world.has(id)).toBe(true);
      const res = await dispatch(pipeline, DeleteAsset({ assetId: id }), ALICE);
      expect(res.result.ok).toBe(true);
      expect(res.events.map((e) => e.type)).toEqual([AssetDeleted.name]);
      expect(world.has(id)).toBe(false);
    });

    it("GM deletes any asset", async () => {
      await register(pipeline, ALICE);
      const id = world.query([Asset])[0]!.id;
      const res = await dispatch(pipeline, DeleteAsset({ assetId: id }), GM);
      expect(res.result.ok).toBe(true);
      expect(world.has(id)).toBe(false);
    });

    it("non-owner non-GM is rejected", async () => {
      await register(pipeline, ALICE);
      const id = world.query([Asset])[0]!.id;
      const res = await dispatch(pipeline, DeleteAsset({ assetId: id }), BOB);
      expect(res.result.ok).toBe(false);
      expect(world.has(id)).toBe(true);
    });

    it("ghost id is rejected", async () => {
      const res = await dispatch(
        pipeline,
        DeleteAsset({ assetId: "ghost" as EntityId }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });
  });

  describe("schema validation", () => {
    it("rejects malformed sha256", () => {
      expect(() =>
        RegisterAsset({
          mime: "image/png",
          sizeBytes: 1,
          sha256: "not-hex",
          filename: null,
          width: null,
          height: null,
        }),
      ).toThrow();
    });

    it("rejects negative sizeBytes", () => {
      expect(() =>
        RegisterAsset({
          mime: "image/png",
          sizeBytes: -1,
          sha256: SHA.one,
          filename: null,
          width: null,
          height: null,
        }),
      ).toThrow();
    });

    it("rejects empty mime", () => {
      expect(() =>
        RegisterAsset({
          mime: "",
          sizeBytes: 1,
          sha256: SHA.one,
          filename: null,
          width: null,
          height: null,
        }),
      ).toThrow();
    });

    it("rejects 0-length filename", () => {
      expect(() =>
        RenameAsset({ assetId: "x" as EntityId, filename: "" }),
      ).toThrow();
    });

    it("rejects unknown visibility kind", () => {
      expect(() =>
        SetAssetVisibility({
          assetId: "x" as EntityId,
          visibility: { kind: "weird" } as never,
        }),
      ).toThrow();
    });
  });

  describe("systems wiring", () => {
    it("AssetSpawningSystem listens to AssetRegistered", () => {
      expect(AssetSpawningSystem.on.name).toBe(AssetRegistered.name);
      expect(AssetSpawningSystem.writes.map((t) => t.name)).toEqual(
        expect.arrayContaining([Asset.name, OwnedBy.name, EntityVisibility.name]),
      );
    });

    it("AssetRenameSystem listens to AssetRenamed and read/writes Asset", () => {
      expect(AssetRenameSystem.on.name).toBe(AssetRenamed.name);
      expect(AssetRenameSystem.reads.map((t) => t.name)).toContain(Asset.name);
      expect(AssetRenameSystem.writes.map((t) => t.name)).toContain(Asset.name);
    });

    it("AssetVisibilityChangeSystem writes EntityVisibility", () => {
      expect(AssetVisibilityChangeSystem.on.name).toBe(
        AssetVisibilityChanged.name,
      );
      expect(AssetVisibilityChangeSystem.writes.map((t) => t.name)).toContain(
        EntityVisibility.name,
      );
    });

    it("AssetDespawnSystem listens to AssetDeleted", () => {
      expect(AssetDespawnSystem.on.name).toBe(AssetDeleted.name);
    });

    it("AssetRenameSystem is a no-op on a despawned id", () => {
      const events = AssetRenameSystem.run({
        event: { assetId: "ghost" as EntityId, filename: "x" } as never,
        world,
        registry,
      });
      expect(events).toEqual([]);
    });

    it("AssetVisibilityChangeSystem is a no-op on a despawned id", () => {
      const events = AssetVisibilityChangeSystem.run({
        event: {
          assetId: "ghost" as EntityId,
          visibility: { kind: "everyone" },
        } as never,
        world,
        registry,
      });
      expect(events).toEqual([]);
    });

    it("AssetDespawnSystem is a no-op on a despawned id", () => {
      const events = AssetDespawnSystem.run({
        event: { assetId: "ghost" as EntityId } as never,
        world,
        registry,
      });
      expect(events).toEqual([]);
    });
  });

  it("entity-visibility resolver picks up the asset's EntityVisibility", async () => {
    await register(pipeline, ALICE);
    const id = world.query([Asset])[0]!.id;
    const traits: Record<string, unknown> = {};
    for (const [name, def] of registry.traits) {
      const got = world.get(id, [def]);
      if (got !== undefined) {
        const short = name.split("/").pop()!;
        const v = (got as Record<string, unknown>)[short];
        if (v !== undefined) traits[name] = v;
      }
    }
    const vis = registry.resolveEntityVisibility(traits);
    expect(vis).toEqual({ kind: "everyone" });
  });
});
