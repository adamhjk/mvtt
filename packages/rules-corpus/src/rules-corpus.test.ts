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
  definePlugin,
  type CommandInstance,
  type EntityId,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import { Asset } from "@vtt/assets/shared";
import { Permissions, ownedBy } from "@vtt/permissions/shared";
import {
  IndexRules,
  RemoveRulesCorpus,
  RulesCorpus,
  RulesCorpusRemoved,
  RulesIndexingCompleted,
  RulesIndexingFailed,
  RulesIndexingStarted,
  RulesLibrary,
  RulesProfile,
  DEFAULT_RULES_PROFILE,
} from "./shared/index.js";
import {
  CorpusDespawnSystem,
  CorpusFailureMirror,
  CorpusSpawningSystem,
  CorpusStatusMirror,
} from "./server/systems.js";

const serverPlugin = definePlugin({
  name: "@vtt/rules-corpus-test",
  version: "0.1.0",
  traits: [Asset, Permissions, RulesLibrary, RulesCorpus],
  events: [RulesIndexingStarted, RulesIndexingCompleted, RulesIndexingFailed, RulesCorpusRemoved],
  commands: [IndexRules, RemoveRulesCorpus],
  systems: [CorpusSpawningSystem, CorpusStatusMirror, CorpusFailureMirror, CorpusDespawnSystem],
});

const GM: AuthSession = {
  userId: "gm-1",
  email: "gm@test.dev",
  name: "GM",
  role: "gm",
};

const PLAYER: AuthSession = {
  userId: "p-1",
  email: "p@test.dev",
  name: "Player",
  role: "player",
};

function setup() {
  const registry = new Registry();
  registry.load(serverPlugin);
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);
  return { registry, world, bus, pipeline };
}

let cmdSeq = 0;
async function dispatch(pipeline: CommandPipeline, cmd: CommandInstance, session: unknown) {
  return pipeline.dispatch({
    id: `cmd-${++cmdSeq}`,
    issuedBy: "tester",
    issuedAt: Date.now(),
    cmd,
    session,
  });
}

function seedAsset(world: World, mime: string = "application/pdf"): EntityId {
  const id = world.allocateId();
  world.spawnAt(id, [
    Asset({
      mime,
      sizeBytes: 1024,
      sha256: "f".repeat(64),
      filename: "rules.pdf",
      width: null,
      height: null,
      uploadedAt: Date.now(),
    }),
    Permissions(ownedBy(GM.userId)),
  ]);
  return id;
}

describe("@vtt/rules-corpus", () => {
  let pipeline: CommandPipeline;
  let world: World;

  beforeEach(() => {
    ({ pipeline, world } = setup());
  });

  describe("IndexRules", () => {
    it("GM indexes a PDF asset; mirror spawns library + corpus in pending", async () => {
      const assetId = seedAsset(world);
      const res = await dispatch(pipeline, IndexRules({ assetId, tags: ["torchbearer"] }), GM);
      expect(res.result.ok).toBe(true);
      const startedEvents = res.events.filter((e) => e.type === RulesIndexingStarted.name);
      expect(startedEvents).toHaveLength(1);
      // The runner needs the dispatcher's identity to issue follow-up
      // completion / failure dispatches; verify the apply embedded it.
      const startedPayload = startedEvents[0]!.payload as {
        issuedBy: { userId: string; email: string; name: string };
      };
      expect(startedPayload.issuedBy).toEqual({
        userId: GM.userId,
        email: GM.email,
        name: GM.name,
      });
      // Library sentinel exists
      expect(world.query([RulesLibrary])).toHaveLength(1);
      // Corpus entity exists with status pending and our tags
      const corpora = world.query([RulesCorpus]);
      expect(corpora).toHaveLength(1);
      const c = corpora[0]!.values.RulesCorpus as {
        assetId: EntityId;
        status: string;
        tags: string[];
      };
      expect(c.assetId).toBe(assetId);
      expect(c.status).toBe("pending");
      expect(c.tags).toEqual(["torchbearer"]);
    });

    it("rejects a player dispatch", async () => {
      const assetId = seedAsset(world);
      const res = await dispatch(pipeline, IndexRules({ assetId, tags: [] }), PLAYER);
      expect(res.result.ok).toBe(false);
    });

    it("rejects an asset whose mime is not application/pdf", async () => {
      const imageAsset = seedAsset(world, "image/png");
      const res = await dispatch(pipeline, IndexRules({ assetId: imageAsset, tags: [] }), GM);
      expect(res.result.ok).toBe(false);
    });

    it("rejects re-indexing the same asset", async () => {
      const assetId = seedAsset(world);
      const r1 = await dispatch(pipeline, IndexRules({ assetId, tags: [] }), GM);
      expect(r1.result.ok).toBe(true);
      const r2 = await dispatch(pipeline, IndexRules({ assetId, tags: [] }), GM);
      expect(r2.result.ok).toBe(false);
    });

    it("rejects when the assetId does not exist", async () => {
      const res = await dispatch(
        pipeline,
        IndexRules({ assetId: "ghost-asset" as EntityId, tags: [] }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });
  });

  describe("RemoveRulesCorpus", () => {
    it("GM removes a corpus; corpus entity despawns", async () => {
      const assetId = seedAsset(world);
      await dispatch(pipeline, IndexRules({ assetId, tags: [] }), GM);
      const corpus = world.query([RulesCorpus])[0]!;
      const res = await dispatch(pipeline, RemoveRulesCorpus({ corpusId: corpus.id }), GM);
      expect(res.result.ok).toBe(true);
      expect(res.events.map((e) => e.type)).toContain(RulesCorpusRemoved.name);
      expect(world.has(corpus.id)).toBe(false);
    });

    it("rejects a player dispatch", async () => {
      const assetId = seedAsset(world);
      await dispatch(pipeline, IndexRules({ assetId, tags: [] }), GM);
      const corpus = world.query([RulesCorpus])[0]!;
      const res = await dispatch(pipeline, RemoveRulesCorpus({ corpusId: corpus.id }), PLAYER);
      expect(res.result.ok).toBe(false);
    });
  });

  describe("RulesProfile", () => {
    it("default profile parses to expected shape", () => {
      expect(DEFAULT_RULES_PROFILE.columns).toBe(2);
      expect(DEFAULT_RULES_PROFILE.pageNumber.strategy).toBe("footerScan");
      expect(DEFAULT_RULES_PROFILE.dehyphenate).toBe(true);
      expect(DEFAULT_RULES_PROFILE.chunkSizeTokens).toBe(2000);
    });

    it("accepts a custom profile with overrides", () => {
      const p = RulesProfile.parse({
        columns: 1,
        pageNumber: { strategy: "outline", frontMatterPdfPages: 6 },
      });
      expect(p.columns).toBe(1);
      expect(p.pageNumber.strategy).toBe("outline");
      expect(p.pageNumber.frontMatterPdfPages).toBe(6);
      // Inherited defaults
      expect(p.pageNumber.band).toBe("bottom");
      expect(p.dehyphenate).toBe(true);
    });

    it("rejects nonsense inputs", () => {
      expect(() => RulesProfile.parse({ columns: 7 })).toThrow();
      expect(() => RulesProfile.parse({ pageNumber: { strategy: "banana" } })).toThrow();
    });
  });

  describe("CorpusStatusMirror", () => {
    it("flips status to ready and fills metadata on RulesIndexingCompleted", async () => {
      const assetId = seedAsset(world);
      await dispatch(pipeline, IndexRules({ assetId, tags: ["tb"] }), GM);
      const corpus = world.query([RulesCorpus])[0]!;
      // Hand-fire the completed event through the bus by re-dispatching;
      // since we can't dispatch events directly, reuse the system
      // imperatively for the mirror semantics.
      CorpusStatusMirror.run({
        event: {
          corpusId: corpus.id,
          pageCount: 312,
          title: "Torchbearer 2nd Edition",
          indexedAt: 1234567890,
        } as never,
        world,
        registry: undefined as never,
      });
      const after = world.get(corpus.id, [RulesCorpus]) as {
        RulesCorpus: { status: string; pageCount: number | null; title: string | null };
      };
      expect(after.RulesCorpus.status).toBe("ready");
      expect(after.RulesCorpus.pageCount).toBe(312);
      expect(after.RulesCorpus.title).toBe("Torchbearer 2nd Edition");
    });
  });
});
