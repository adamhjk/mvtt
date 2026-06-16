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
  type CommandInstance,
  substrateCorePlugin,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import { permissions } from "@vtt/permissions";
import { shellWorkbench } from "@vtt/shell-workbench";
import { assets } from "@vtt/assets";
import {
  noteLinkKind,
  buildLinkKindIndex,
  parseLinks,
  AddPage,
  BeginEdit,
  CreateNote,
  RenameNote,
  RenamePage,
  Note,
  Page,
  BelongsToNote,
  SetPageBody,
} from "./shared/index.js";
import type { EntityId } from "@vtt/substrate";
import { assetLinkKind, RegisterAsset } from "@vtt/assets/shared";
import { notes } from "./manifest.js";

const GM: AuthSession = {
  userId: "gm-1",
  email: "gm@test.dev",
  name: "GM",
  role: "gm",
};

function setup() {
  const registry = new Registry();
  registry.load(substrateCorePlugin);
  registry.load(permissions);
  registry.load(shellWorkbench);
  registry.load(notes);
  registry.load(assets);
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
  opts: { actor?: string } = {},
) {
  return pipeline.dispatch({
    id: `cmd-${++cmdSeq}`,
    issuedBy: (opts.actor ?? "tester") as never,
    issuedAt: Date.now(),
    cmd,
    session,
  });
}

describe("link-kind registry", () => {
  let pipeline: CommandPipeline;
  let world: World;
  let registry: Registry;

  beforeEach(() => {
    cmdSeq = 0;
    ({ pipeline, world, registry } = setup());
  });

  it("collects every kind contributed via LinkKindsSlot fills", () => {
    const idx = buildLinkKindIndex(registry);
    expect(idx.byName.has("note")).toBe(true);
    expect(idx.byName.has("asset")).toBe(true);
    expect(idx.knownKinds.has("note")).toBe(true);
    expect(idx.knownKinds.has("asset")).toBe(true);
  });

  it("note kind is the default kind", async () => {
    await dispatch(pipeline, CreateNote({ title: "Goblin Cave" }), GM);
    const noteId = world.query([Note])[0]!.id;

    const idx = buildLinkKindIndex(registry);
    const refs = parseLinks("see [[Goblin Cave]] and [[note:" + noteId + "]]", {
      sigils: idx.sigils,
      knownKinds: idx.knownKinds,
    });
    expect(refs).toHaveLength(2);
    expect(refs[0]!.kind).toBe("note");
    expect(refs[1]!.kind).toBe("note");
  });

  it("note kind resolves a typed title to an entityId", async () => {
    await dispatch(pipeline, CreateNote({ title: "Goblin Cave" }), GM);
    const noteId = world.query([Note])[0]!.id;
    const ref = noteLinkKind.parse("Goblin Cave", null, world);
    expect(ref).toEqual({ noteId, anchor: null, pageId: null });
  });

  it("note kind returns null for an unknown title", () => {
    const ref = noteLinkKind.parse("Nonexistent", null, world);
    expect(ref).toBeNull();
  });

  it("note kind display is reactive over RenameNote", async () => {
    await dispatch(pipeline, CreateNote({ title: "Original" }), GM);
    const noteId = world.query([Note])[0]!.id;
    const ref = noteLinkKind.parse("Original", null, world)!;
    expect(noteLinkKind.display(ref, world)).toBe("Original");

    await dispatch(pipeline, RenameNote({ noteId, title: "Renamed" }), GM);
    expect(noteLinkKind.display(ref, world)).toBe("Renamed");
  });

  it("note kind autocomplete returns matching titles", async () => {
    await dispatch(pipeline, CreateNote({ title: "Goblin Cave" }), GM);
    await dispatch(pipeline, CreateNote({ title: "Mossfen Tree" }), GM);
    await dispatch(pipeline, CreateNote({ title: "Krell" }), GM);

    const suggestions = noteLinkKind.autocomplete("gob", world);
    expect(suggestions.map((s) => s.display)).toContain("Goblin Cave");
    expect(suggestions.map((s) => s.display)).not.toContain("Mossfen Tree");
  });

  describe("note > page > heading path syntax", () => {
    async function buildCave() {
      await dispatch(pipeline, CreateNote({ title: "Goblin Cave" }), GM);
      const noteId = world.query([Note])[0]!.id;
      await dispatch(pipeline, AddPage({ noteId, title: "Inhabitants" }), GM);
      const pages = world.query([Page, BelongsToNote]);
      const inhabitants = pages.find(
        (r) =>
          (r.values.BelongsToNote as { noteId: string }).noteId === noteId &&
          (r.values.Page as { title: string }).title === "Inhabitants",
      )!;
      // Lock the page to write a body with a heading we can search.
      await dispatch(pipeline, BeginEdit({ pageId: inhabitants.id }), GM, {
        actor: "client-A",
      });
      await dispatch(
        pipeline,
        SetPageBody({
          pageId: inhabitants.id,
          body: "# Tactics\n\nAmbush parties.",
        }),
        GM,
        { actor: "client-A" },
      );
      return { noteId: noteId as EntityId, pageId: inhabitants.id as EntityId };
    }

    it("resolves Note > Page", async () => {
      const { noteId, pageId } = await buildCave();
      const ref = noteLinkKind.parse("Goblin Cave > Inhabitants", null, world);
      expect(ref).toEqual({ noteId, pageId, anchor: null });
    });

    it("resolves Note > Page > Heading by text", async () => {
      const { noteId, pageId } = await buildCave();
      const ref = noteLinkKind.parse("Goblin Cave > Inhabitants > Tactics", null, world);
      expect(ref!.noteId).toBe(noteId);
      expect(ref!.pageId).toBe(pageId);
      expect(ref!.anchor).toMatch(/^hd:/);
    });

    it("display renders Note › Page › Heading", async () => {
      await buildCave();
      const ref = noteLinkKind.parse("Goblin Cave > Inhabitants > Tactics", null, world)!;
      expect(noteLinkKind.display(ref, world)).toBe("Goblin Cave › Inhabitants › Tactics");
    });

    it("target points at the page when one is in the path", async () => {
      const { pageId } = await buildCave();
      const ref = noteLinkKind.parse("Goblin Cave > Inhabitants", null, world)!;
      expect(noteLinkKind.target(ref, world)).toEqual({ entityId: pageId });
    });

    it("falls back to note when page in path doesn't resolve", async () => {
      const { noteId } = await buildCave();
      const ref = noteLinkKind.parse("Goblin Cave > Phantom Page", null, world)!;
      expect(ref.noteId).toBe(noteId);
      expect(ref.pageId).toBeNull();
      // Display drops the unresolved page segment.
      expect(noteLinkKind.display(ref, world)).toBe("Goblin Cave");
    });

    it("autocomplete after `Note >` suggests pages of that note", async () => {
      await buildCave();
      const suggestions = noteLinkKind.autocomplete("Goblin Cave > ", world);
      const inh = suggestions.find((s) => s.display.endsWith("Inhabitants"));
      expect(inh).toBeDefined();
      // Name-based body — survives bundle import. Stored as
      // `<NoteTitle>>>>>... ` (split on ">").
      expect(inh!.body).toBe("Goblin Cave>Inhabitants");
      expect(inh!.badge).toBe("Page");
    });

    it("autocomplete after `Note > Page >` suggests headings", async () => {
      await buildCave();
      const suggestions = noteLinkKind.autocomplete("Goblin Cave > Inhabitants > tact", world);
      expect(suggestions.length).toBe(1);
      expect(suggestions[0]!.display).toBe("Goblin Cave › Inhabitants › Tactics");
      // Heading body is the heading text, not the `hd:<slug>` id —
      // the parser's `resolveHeadingOnPage` handles text fallback.
      expect(suggestions[0]!.body).toBe("Goblin Cave>Inhabitants>Tactics");
    });

    it("rename Note > Page → display reflects the new page title", async () => {
      const { pageId } = await buildCave();
      const ref = noteLinkKind.parse("Goblin Cave > Inhabitants", null, world)!;
      expect(noteLinkKind.display(ref, world)).toBe("Goblin Cave › Inhabitants");
      await dispatch(pipeline, RenamePage({ pageId, title: "Residents" }), GM);
      // The ref is still valid; display picks up the new page title.
      expect(noteLinkKind.display(ref, world)).toBe("Goblin Cave › Residents");
    });

    it("storage form note:e>e>hd:x parses round-trip", async () => {
      const { noteId, pageId } = await buildCave();
      const ref = noteLinkKind.parse("Goblin Cave > Inhabitants > Tactics", null, world)!;
      const stored = `${noteId}>${pageId}>${ref.anchor}`;
      const reparsed = noteLinkKind.parse(stored, null, world);
      expect(reparsed).toEqual(ref);
    });
  });

  it("asset kind resolves entity-id body and auto-completes filenames", async () => {
    const reg = await dispatch(
      pipeline,
      RegisterAsset({
        mime: "image/webp",
        sizeBytes: 100,
        sha256: "a".repeat(64),
        filename: "cave-map.webp",
        width: null,
        height: null,
      }),
      GM,
    );
    expect(reg.result.ok).toBe(true);
    const assetId = (reg.events[0]!.payload as { assetId: string }).assetId;

    const ref = assetLinkKind.parse(assetId, null, world);
    expect(ref).toEqual({ assetId });
    expect(assetLinkKind.display(ref!, world)).toBe("cave-map.webp");

    const suggestions = assetLinkKind.autocomplete("cave", world);
    expect(suggestions.map((s) => s.display)).toContain("cave-map.webp");
  });

  it("buildLinkKindIndex exposes sigil → kind map", () => {
    // Neither note nor asset registers a sigil, so the map is empty.
    // (The character plugin would later register `@`.)
    const idx = buildLinkKindIndex(registry);
    expect(idx.sigils).toEqual({});
  });

  it("indexEvents lists the events each kind cares about", () => {
    expect(noteLinkKind.indexEvents.length).toBeGreaterThan(0);
    expect(assetLinkKind.indexEvents.length).toBeGreaterThan(0);
    expect(noteLinkKind.indexEvents).toContain("@vtt/notes/NoteRenamed");
    expect(assetLinkKind.indexEvents).toContain("@vtt/assets/AssetRegistered");
  });
});
