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
import { Readable } from "node:stream";
import {
  defineTrait,
  definePlugin,
  Registry,
  World,
  type WorldsRegistry,
  type WorldRuntime,
  z,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import { permissions } from "@vtt/permissions";
import {
  Note,
  NoteOrdering,
  Page,
  PageOrdering,
  BelongsToNote,
  PageBodySet,
  MarkdownPostRenderSlot,
  EditorCompletionSourcesSlot,
  NotesReferenceSlot,
} from "@vtt/notes/shared";
import { adventures } from "./manifest.js";
import { BlockKindsSlot, defineBlockKind } from "./shared/index.js";
import { bundleToZip, zipToBundle } from "./server/index.js";
import {
  handleAdventureExport,
  handleAdventureImport,
  handleAdventureCheckUpdate,
} from "./server/routes.js";

const Stat = defineTrait({
  name: "@vtt/adventures-routes-test/Stat",
  schema: z.object({ label: z.string(), value: z.number() }),
});

const statKind = defineBlockKind({
  name: "stat",
  description: "A stat block",
  schema: z.object({ label: z.string().min(1), value: z.number().int() }),
  project: (parsed) => {
    const p = parsed as { label: string; value: number };
    return { traits: [{ trait: Stat, value: p }] };
  },
});

const stubKindPlugin = definePlugin({
  name: "@vtt/adventures-routes-test-stub",
  version: "0",
  dependsOn: ["@vtt/adventures@^0"],
  traits: [Stat],
  fills: { [BlockKindsSlot.name]: [statKind as never] },
});

const notesStub = definePlugin({
  name: "@vtt/notes",
  version: "0.1.0",
  traits: [Note, NoteOrdering, BelongsToNote, Page, PageOrdering],
  events: [PageBodySet],
  slots: [MarkdownPostRenderSlot, EditorCompletionSourcesSlot, NotesReferenceSlot],
});

function buildRuntime(): WorldRuntime {
  // Minimal in-memory WorldRuntime substitute. Enough surface for the
  // route handlers (registry.acquire returns this; routes use
  // runtime.world + runtime.registry).
  const r = new Registry();
  r.load(permissions);
  r.load(notesStub);
  r.load(adventures);
  r.load(stubKindPlugin);
  r.validate();
  const w = new World();
  return {
    world: w,
    registry: r,
    worldId: "test-world",
  } as never;
}

function buildRegistry(runtime: WorldRuntime): WorldsRegistry {
  return {
    acquire: async () => runtime,
  } as never;
}

const gmSession: AuthSession = {
  userId: "gm",
  email: "gm@test.dev",
  name: "GM",
  role: "gm",
};

function fakeReq(method: string, body: Buffer): import("node:http").IncomingMessage {
  const r = Readable.from([body]) as unknown as import("node:http").IncomingMessage & {
    method: string;
    headers: Record<string, string>;
  };
  r.method = method;
  r.headers = { "content-type": "application/zip" };
  return r;
}

function fakeRes(): {
  res: import("node:http").ServerResponse;
  body: () => Buffer;
  status: () => number;
  headers: () => Record<string, string>;
} {
  let statusCode = 200;
  const chunks: Buffer[] = [];
  const headers: Record<string, string> = {};
  const r = {
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    end(payload?: string | Buffer) {
      if (payload) {
        chunks.push(typeof payload === "string" ? Buffer.from(payload) : payload);
      }
    },
    get statusCode() {
      return statusCode;
    },
    set statusCode(v: number) {
      statusCode = v;
    },
  } as never;
  return {
    res: r,
    body: () => Buffer.concat(chunks),
    status: () => statusCode,
    headers: () => headers,
  };
}

describe("adventure HTTP routes", () => {
  let runtime: WorldRuntime;
  let deps: { registry: WorldsRegistry; authenticate: () => Promise<AuthSession | null> };

  beforeEach(() => {
    runtime = buildRuntime();
    deps = {
      registry: buildRegistry(runtime),
      authenticate: async () => gmSession,
    };
  });

  it("import: rejects non-GM with 403", async () => {
    deps.authenticate = async () => ({ ...gmSession, role: "player" });
    const { res, status, body } = fakeRes();
    await handleAdventureImport(
      fakeReq("POST", Buffer.alloc(0)),
      res,
      "test-world" as never,
      deps as never,
    );
    expect(status()).toBe(403);
    expect(body().toString()).toContain("GM");
  });

  it("import: rejects on bad zip with 400", async () => {
    const { res, status } = fakeRes();
    await handleAdventureImport(
      fakeReq("POST", Buffer.from([0, 0, 0, 0])),
      res,
      "test-world" as never,
      deps as never,
    );
    expect(status()).toBe(400);
  });

  it("export → import round-trip via the routes", async () => {
    // Seed a note in the world.
    runtime.world.spawn([Note({ title: "Bywater", createdAt: 0 }), NoteOrdering({ ordinal: 0 })]);
    const noteId = runtime.world.query([Note])[0]!.id;
    runtime.world.spawn([
      Page({
        title: "Intro",
        body: ["```stat foo", "label: a", "value: 1", "```"].join("\n"),
        bodyRev: 1,
      }),
      BelongsToNote({ noteId }),
      PageOrdering({ ordinal: 0 }),
    ]);

    // Export
    const exportReq = fakeReq(
      "POST",
      Buffer.from(
        JSON.stringify({
          bundleId: "u-routes-1",
          name: "Bywater",
          version: "1.0.0",
          noteIds: [noteId],
        }),
      ),
    );
    const { res: exRes, body: exBody, status: exStatus, headers: exHeaders } = fakeRes();
    await handleAdventureExport(exportReq, exRes, "test-world" as never, deps as never);
    expect(exStatus()).toBe(200);
    expect(exHeaders()["content-type"]).toBe("application/zip");
    const zipBytes = exBody();
    expect(zipBytes.length).toBeGreaterThan(0);
    // Round-trip the zip back into a bundle struct.
    const bundle = zipToBundle(new Uint8Array(zipBytes));
    expect(bundle.manifest.bundleId).toBe("u-routes-1");
    expect(bundle.manifest.notes[0]!.title).toBe("Bywater");
    void bundleToZip; // sanity import

    // Import the same zip into a fresh runtime.
    const targetRuntime = buildRuntime();
    const targetDeps = {
      registry: buildRegistry(targetRuntime),
      authenticate: async () => gmSession,
    };
    const importReq = fakeReq("POST", zipBytes);
    const { res: imRes, body: imBody, status: imStatus } = fakeRes();
    await handleAdventureImport(importReq, imRes, "test-world" as never, targetDeps as never);
    expect(imStatus()).toBe(200);
    const imJson = JSON.parse(imBody().toString());
    expect(imJson.bundleId).toBe("u-routes-1");
    expect(imJson.notesCreated).toBe(1);
    expect(imJson.pagesCreated).toBe(1);
    expect(targetRuntime.world.query([Stat])).toHaveLength(1);
  });

  it("export → import round-trips asset bytes when both hooks are wired", async () => {
    const { Asset } = await import("@vtt/assets/shared");
    // Spawn an asset entity in the source world (no real bytes on disk —
    // the loadAssetBytes hook returns a fixed buffer for it).
    const sourceAssetId = runtime.world.spawn([
      Asset({
        mime: "image/png",
        sizeBytes: 5,
        sha256: "c".repeat(64),
        filename: "art.png",
        width: null,
        height: null,
        uploadedAt: 0,
      }),
    ]);
    runtime.world.spawn([Note({ title: "WithArt", createdAt: 0 }), NoteOrdering({ ordinal: 0 })]);
    const noteId = runtime.world.query([Note])[0]!.id;
    runtime.world.spawn([
      Page({
        title: "p",
        body: `Some art: ![[asset:${sourceAssetId}]]`,
        bodyRev: 1,
      }),
      BelongsToNote({ noteId }),
      PageOrdering({ ordinal: 0 }),
    ]);
    const fakeBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const sourceDeps = {
      ...deps,
      loadAssetBytes: async (_w: string, aid: string) => (aid === sourceAssetId ? fakeBytes : null),
    };

    const exReq = fakeReq(
      "POST",
      Buffer.from(
        JSON.stringify({
          bundleId: "u-asset-routes",
          name: "WithArt",
          version: "1.0.0",
          noteIds: [noteId],
        }),
      ),
    );
    const exOut = fakeRes();
    await handleAdventureExport(exReq, exOut.res, "test-world" as never, sourceDeps as never);
    expect(exOut.status()).toBe(200);
    const zipBytes = exOut.body();
    expect(zipBytes.length).toBeGreaterThan(0);

    // Import into a fresh runtime with a saveAssetBytes hook that mints a new id.
    const targetRuntime = buildRuntime();
    let mintedId = "newId-after-import";
    const targetDeps = {
      registry: buildRegistry(targetRuntime),
      authenticate: async () => gmSession,
      saveAssetBytes: async (_w: string, bytes: Uint8Array, descriptor: { sha256: string }) => {
        // Verify bytes survived the round-trip
        expect(bytes).toEqual(fakeBytes);
        expect(descriptor.sha256).toBe("c".repeat(64));
        return mintedId as never;
      },
    };
    const imOut = fakeRes();
    await handleAdventureImport(
      fakeReq("POST", zipBytes),
      imOut.res,
      "test-world" as never,
      targetDeps as never,
    );
    expect(imOut.status()).toBe(200);
    const imJson = JSON.parse(imOut.body().toString());
    expect(imJson.assetsUploaded).toBe(1);
    // Body in target world has the rewritten id.
    const pages = targetRuntime.world.query([Page]);
    const body = (pages[0]!.values.Page as { body: string }).body;
    expect(body).toContain(`![[asset:${mintedId}]]`);
    expect(body).not.toContain(sourceAssetId);
  });

  it("check-update: returns a UpdateDiff JSON for a re-uploaded bundle", async () => {
    runtime.world.spawn([Note({ title: "Bywater", createdAt: 0 }), NoteOrdering({ ordinal: 0 })]);
    const noteId = runtime.world.query([Note])[0]!.id;
    runtime.world.spawn([
      Page({
        title: "p",
        body: ["```stat foo", "label: a", "value: 1", "```"].join("\n"),
        bodyRev: 1,
      }),
      BelongsToNote({ noteId }),
      PageOrdering({ ordinal: 0 }),
    ]);
    // Build & import v1
    const v1Req = fakeReq(
      "POST",
      Buffer.from(
        JSON.stringify({
          bundleId: "u-routes-2",
          name: "Bywater",
          version: "1.0.0",
          noteIds: [noteId],
        }),
      ),
    );
    const v1Out = fakeRes();
    await handleAdventureExport(v1Req, v1Out.res, "test-world" as never, deps as never);
    const v1Zip = v1Out.body();
    const targetRuntime = buildRuntime();
    const targetDeps = {
      registry: buildRegistry(targetRuntime),
      authenticate: async () => gmSession,
    };
    await handleAdventureImport(
      fakeReq("POST", v1Zip),
      fakeRes().res,
      "test-world" as never,
      targetDeps as never,
    );
    expect(targetRuntime.world.query([Stat])).toHaveLength(1);

    // Modify the source world's body and re-export as v2.
    const pageRow = runtime.world.query([Page, BelongsToNote])[0]!;
    runtime.world.set(pageRow.id, Page, {
      title: "p",
      body: ["```stat foo", "label: a", "value: 99", "```"].join("\n"),
      bodyRev: 2,
    });
    const v2Req = fakeReq(
      "POST",
      Buffer.from(
        JSON.stringify({
          bundleId: "u-routes-2",
          name: "Bywater",
          version: "2.0.0",
          noteIds: [noteId],
        }),
      ),
    );
    const v2Out = fakeRes();
    await handleAdventureExport(v2Req, v2Out.res, "test-world" as never, deps as never);
    const v2Zip = v2Out.body();

    // Check-update against the target world.
    const cuReq = fakeReq("POST", v2Zip);
    const cuOut = fakeRes();
    await handleAdventureCheckUpdate(cuReq, cuOut.res, "test-world" as never, targetDeps as never);
    expect(cuOut.status()).toBe(200);
    const diff = JSON.parse(cuOut.body().toString()) as {
      bundleId: string;
      newVersion: string;
      notes: Array<{ kind: string }>;
    };
    expect(diff.bundleId).toBe("u-routes-2");
    expect(diff.newVersion).toBe("2.0.0");
    expect(diff.notes[0]!.kind).toBe("fast-forward");
  });
});
