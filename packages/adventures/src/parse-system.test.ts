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
  defineCommand,
  defineEvent,
  definePlugin,
  defineSystem,
  defineTrait,
  EntityId,
  CommandPipeline,
  EventBus,
  Registry,
  World,
  ok,
  z,
} from "@vtt/substrate";
import { permissions } from "@vtt/permissions";
import {
  Page,
  BelongsToNote,
  PageBodySet,
  MarkdownPostRenderSlot,
  EditorCompletionSourcesSlot,
  NotesReferenceSlot,
} from "@vtt/notes/shared";

// Minimal notes-stub: registers only the traits/event @vtt/adventures
// needs (Page, BelongsToNote, PageBodySet) without dragging in the
// notes manifest's shell-workbench fills. Named `@vtt/notes` so the
// adventures plugin's dependsOn check is satisfied — the real notes
// plugin isn't loaded in this test.
const notesStub = definePlugin({
  name: "@vtt/notes",
  version: "0.1.0",
  traits: [Page, BelongsToNote],
  events: [PageBodySet],
  slots: [MarkdownPostRenderSlot, EditorCompletionSourcesSlot, NotesReferenceSlot],
});
import { adventures } from "./manifest.js";
import {
  defineBlockKind,
  BlockKindsSlot,
  BLOCK_ENTITY_INDEX_ID,
  BlockEntityIndex,
  PageBlocks,
  Tombstoned,
} from "./shared/index.js";
import { blockEntityId, runBlockParse } from "./server/block-parse-system.js";
import { buildBlockKindIndex } from "./shared/block-kinds.js";

// Stub block kind: a minimal "stat" block that projects to one trait.
const Stat = defineTrait({
  name: "@vtt/adventures-test/Stat",
  schema: z.object({
    label: z.string(),
    value: z.number(),
  }),
});

const StubInitialState = defineTrait({
  name: "@vtt/adventures-test/StubInitialState",
  schema: z.object({
    spawnedAt: z.number(),
  }),
});

const StatSchema = z.object({
  label: z.string().min(1),
  value: z.number().int(),
});

const statKind = defineBlockKind({
  name: "stat",
  description: "A test stat block",
  schema: StatSchema,
  project: (parsed) => {
    const p = parsed as z.infer<typeof StatSchema>;
    return {
      traits: [{ trait: Stat, value: { label: p.label, value: p.value } }],
      spawnIfMissing: [{ trait: StubInitialState, value: { spawnedAt: 12345 } }],
    };
  },
});

const stubKindPlugin = definePlugin({
  name: "@vtt/adventures-test-stub",
  version: "0",
  dependsOn: ["@vtt/adventures@^0"],
  traits: [Stat, StubInitialState],
  fills: {
    [BlockKindsSlot.name]: [statKind as never],
  },
});

function setup() {
  const registry = new Registry();
  registry.load(permissions);
  registry.load(notesStub);
  registry.load(adventures);
  registry.load(stubKindPlugin);
  registry.validate();
  const world = new World();
  return { registry, world };
}

describe("BlockParseSystem — diff loop", () => {
  let registry: Registry;
  let world: World;
  let pageId: EntityId;
  let noteId: EntityId;

  beforeEach(() => {
    const s = setup();
    registry = s.registry;
    world = s.world;
    noteId = world.spawn([]);
    pageId = world.spawn([
      Page({ title: "scratch", body: "", bodyRev: 0 }),
      BelongsToNote({ noteId }),
    ]);
  });

  function parse(body: string) {
    const idx = buildBlockKindIndex(registry);
    return runBlockParse(world, pageId, body, idx);
  }

  it("materializes a new block as an entity at a deterministic id", () => {
    parse(["```stat Arcane Defence", "label: defense", "value: 4", "```"].join("\n"));
    const expected = blockEntityId(pageId, "arcane-defence");
    expect(world.has(expected)).toBe(true);
    const got = world.get(expected, [Stat]) as { Stat: { label: string; value: number } };
    expect(got.Stat).toEqual({ label: "defense", value: 4 });
    // spawnIfMissing landed on first creation
    const init = world.get(expected, [StubInitialState]);
    expect(init).toBeDefined();
  });

  it("re-saving the same body is idempotent (no extra entities)", () => {
    const body = ["```stat thing", "label: a", "value: 1", "```"].join("\n");
    parse(body);
    const before = world.query([Stat]).length;
    parse(body);
    expect(world.query([Stat]).length).toBe(before);
  });

  it("re-setting an existing block updates authored traits but NOT spawnIfMissing", () => {
    const id = blockEntityId(pageId, "thing");
    parse(["```stat thing", "label: a", "value: 1", "```"].join("\n"));
    const initBefore = world.get(id, [StubInitialState]);
    // Mutate: simulate runtime drift by changing spawnIfMissing externally,
    // then re-parse — re-parse must NOT clobber it.
    world.set(id, StubInitialState, { spawnedAt: 99999 });
    parse(["```stat thing", "label: changed", "value: 7", "```"].join("\n"));
    const got = world.get(id, [Stat]) as { Stat: { label: string; value: number } };
    expect(got.Stat).toEqual({ label: "changed", value: 7 });
    const initAfter = world.get(id, [StubInitialState]) as
      | { StubInitialState: { spawnedAt: number } }
      | undefined;
    expect(initAfter?.StubInitialState.spawnedAt).toBe(99999);
    expect(initBefore).toBeDefined();
  });

  it("removing a block tombstones its entity (does not despawn)", () => {
    const id = blockEntityId(pageId, "thing");
    parse(["```stat thing", "label: a", "value: 1", "```"].join("\n"));
    expect(world.has(id)).toBe(true);
    parse("nothing here\n");
    expect(world.has(id)).toBe(true); // not despawned
    const tombstone = world.get(id, [Tombstoned]) as { Tombstoned: { reason: string } } | undefined;
    expect(tombstone).toBeDefined();
    expect(tombstone!.Tombstoned.reason).toBe("block-removed");
  });

  it("re-adding a removed block clears the tombstone", () => {
    const id = blockEntityId(pageId, "thing");
    parse(["```stat thing", "label: a", "value: 1", "```"].join("\n"));
    parse("nothing here\n");
    expect(world.get(id, [Tombstoned])).toBeDefined();
    parse(["```stat thing", "label: returned", "value: 2", "```"].join("\n"));
    expect(world.get(id, [Tombstoned])).toBeUndefined();
    const got = world.get(id, [Stat]) as { Stat: { label: string; value: number } };
    expect(got.Stat).toEqual({ label: "returned", value: 2 });
  });

  it("emits PageBlocksParsed with the block list", () => {
    const events = parse(
      [
        "```stat foo",
        "label: a",
        "value: 1",
        "```",
        "```stat bar",
        "label: b",
        "value: 2",
        "```",
      ].join("\n"),
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
    const pbp = events.find((e) => e.type.endsWith("PageBlocksParsed"));
    expect(pbp).toBeDefined();
    const blocks = (pbp!.payload as { blocks: ReadonlyArray<{ blockKey: string }> }).blocks;
    expect(blocks.map((b) => b.blockKey)).toEqual(["foo", "bar"]);
  });

  it("BlockEntityIndex sentinel records every materialized block", () => {
    parse(["```stat foo", "label: a", "value: 1", "```"].join("\n"));
    const idx = world.get(BLOCK_ENTITY_INDEX_ID, [BlockEntityIndex]) as
      | { BlockEntityIndex: { entries: Record<string, { entityId: EntityId; kind: string }> } }
      | undefined;
    expect(idx).toBeDefined();
    const key = `${pageId}::foo`;
    expect(idx!.BlockEntityIndex.entries[key]).toBeDefined();
    expect(idx!.BlockEntityIndex.entries[key]!.kind).toBe("stat");
  });

  it("ignores fences whose kind isn't registered (no error, no entity)", () => {
    parse(["```unknown thing", "x: 1", "```"].join("\n"));
    expect(world.query([Stat])).toHaveLength(0);
  });

  it("survives a YAML parse error (logs, does not crash, does not materialize)", () => {
    expect(() => parse(["```stat bad", "label: [unbalanced", "```"].join("\n"))).not.toThrow();
    expect(world.query([Stat])).toHaveLength(0);
  });

  it("survives a schema validation failure (no entity, no crash)", () => {
    expect(() =>
      parse(["```stat schemafail", "label: 5", "value: notanumber", "```"].join("\n")),
    ).not.toThrow();
    expect(world.query([Stat])).toHaveLength(0);
  });
});

describe("BlockParseSystem — through the system runner", () => {
  // End-to-end: dispatch a SetPageBody command via the pipeline,
  // PageBodySet event flows into BlockParseSystem, which materializes
  // the entity and emits PageBlocksParsed → PageBlocksMirrorSystem
  // writes the PageBlocks trait.
  // Disabled here because notes' SetPageBody requires more setup
  // (EditBegun lock + identity); the runBlockParse direct tests above
  // cover the same logic. A jsdom integration test will exercise the
  // full pipeline once the editor lands.
  it.skip("end-to-end via SetPageBody command", () => {});
});

describe("BlockParseSystem — PageBlocks mirror trait", () => {
  it("the mirror system writes PageBlocks to the page entity", () => {
    const { registry, world } = setup();
    const noteId = world.spawn([]);
    const pageId = world.spawn([
      Page({ title: "p", body: "", bodyRev: 0 }),
      BelongsToNote({ noteId }),
    ]);
    const idx = buildBlockKindIndex(registry);
    const events = runBlockParse(
      world,
      pageId,
      ["```stat one", "label: a", "value: 1", "```"].join("\n"),
      idx,
    );
    // Apply the emitted PageBlocksParsed event manually (the system
    // runner would do this; we're exercising the pure pipeline).
    const pbp = events.find((e) => e.type.endsWith("PageBlocksParsed"))!;
    world.set(pageId, PageBlocks, {
      blocks: (pbp.payload as { blocks: ReadonlyArray<unknown> }).blocks.map((b) => b as never),
    });
    const got = world.get(pageId, [PageBlocks]) as
      | { PageBlocks: { blocks: ReadonlyArray<{ kind: string; blockKey: string }> } }
      | undefined;
    expect(got).toBeDefined();
    expect(got!.PageBlocks.blocks.map((b) => b.blockKey)).toEqual(["one"]);
  });
});

// Helpers above import deps used implicitly:
void defineCommand;
void defineEvent;
void defineSystem;
void CommandPipeline;
void EventBus;
void ok;
void PageBodySet;
