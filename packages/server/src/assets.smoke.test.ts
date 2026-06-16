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

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve as pathResolve } from "node:path";
import { startServer, type ServerHandle } from "@vtt/substrate/server";
import {
  definePlugin,
  InMemoryWorldsRepository,
  type EntityId,
  type WorldId,
  type WorldsRegistry,
} from "@vtt/substrate";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { notes } from "@vtt/notes";
import { assets } from "@vtt/assets";
import { handleAssetFetch, handleAssetUpload } from "@vtt/assets/server";
import { Asset, RegisterAsset, DeleteAsset } from "@vtt/assets/shared";
import { SetPermissions } from "@vtt/permissions/shared";
import type { AuthSession } from "@vtt/auth";
import type { IncomingMessage } from "node:http";

/**
 * HTTP smoke for the asset upload + fetch + visibility-enforced fetch
 * flow. Doesn't go over WS — assets is HTTP-only at the boundary, with
 * commands dispatched server-side internally.
 */

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
const SESSIONS: Record<string, AuthSession> = {
  gm: GM,
  alice: ALICE,
  bob: BOB,
};

const assetsTestSystem = definePlugin({
  name: "@vtt/assets-test-system",
  version: "0",
  dependsOn: ["@vtt/assets@^0"],
  gameSystem: true,
});

describe("assets HTTP smoke", () => {
  let handle: ServerHandle;
  let worldId: WorldId;
  let pluginDataDir: string;
  let registryRef: { value: WorldsRegistry | null };

  beforeAll(async () => {
    pluginDataDir = mkdtempSync(pathResolve(tmpdir(), "assets-smoke-"));
    const worldsRepo = new InMemoryWorldsRepository();
    await worldsRepo.migrate();
    const world = await worldsRepo.insert({
      id: "assets-smoke",
      name: "Assets smoke",
      gameSystemPlugin: assetsTestSystem.name,
      ownerUserId: GM.userId,
    });
    worldId = world.id;

    registryRef = { value: null };

    const authenticate = async (
      req: IncomingMessage,
      _worldId: WorldId,
    ): Promise<AuthSession | null> => {
      const userKey = (req.headers["x-test-user"] ?? "").toString();
      return SESSIONS[userKey] ?? null;
    };

    const httpHandler = async (
      req: import("node:http").IncomingMessage,
      res: import("node:http").ServerResponse,
    ): Promise<boolean> => {
      const url = req.url ?? "/";
      const path = url.split("?")[0]!;
      if (!registryRef.value) return false;
      const uploadMatch = /^\/api\/worlds\/([^/]+)\/assets\/upload$/.exec(path);
      if (uploadMatch && req.method === "POST") {
        await handleAssetUpload(req, res, decodeURIComponent(uploadMatch[1]!) as WorldId, {
          registry: registryRef.value,
          pluginDataDir,
          authenticate,
        });
        return true;
      }
      const fetchMatch = /^\/plugin-data\/([^/]+)\/assets\/([^/?#]+)$/.exec(path);
      if (fetchMatch && req.method === "GET") {
        await handleAssetFetch(
          req,
          res,
          decodeURIComponent(fetchMatch[1]!) as WorldId,
          decodeURIComponent(fetchMatch[2]!) as EntityId,
          {
            registry: registryRef.value,
            pluginDataDir,
            authenticate,
          },
        );
        return true;
      }
      return false;
    };

    handle = await startServer({
      port: 0,
      infrastructure: [shellWorkbench, identity, permissions, notes, assets],
      optional: [assetsTestSystem],
      worldsRepo,
      httpHandler,
      authenticateUpgrade: async () => GM,
      extractRecipient: (s) => {
        const sess = s as AuthSession | null;
        return sess ? { userId: sess.userId, role: sess.role } : null;
      },
    });
    registryRef.value = handle.worldsRegistry;
    // Pre-acquire so the world exists for asset queries
    await handle.worldsRegistry.acquire(worldId);
  });

  afterAll(async () => {
    if (handle) await handle.close();
    if (pluginDataDir && existsSync(pluginDataDir)) {
      rmSync(pluginDataDir, { recursive: true, force: true });
    }
  });

  const baseUrl = (): string => `http://127.0.0.1:${handle.port}`;
  const upload = async (
    user: keyof typeof SESSIONS,
    bytes: Uint8Array,
    mime: string,
    filename = "test.webp",
  ) =>
    fetch(`${baseUrl()}/api/worlds/${worldId}/assets/upload`, {
      method: "POST",
      headers: {
        "content-type": mime,
        "x-test-user": user,
        "x-filename": filename,
      },
      body: Buffer.from(bytes),
    });
  const fetchAsset = async (user: keyof typeof SESSIONS | null, assetId: string) =>
    fetch(`${baseUrl()}/plugin-data/${worldId}/assets/${assetId}`, {
      headers: user ? { "x-test-user": user } : {},
    });

  it("rejects unauthenticated upload", async () => {
    const bytes = new TextEncoder().encode("data");
    const res = await fetch(`${baseUrl()}/api/worlds/${worldId}/assets/upload`, {
      method: "POST",
      headers: { "content-type": "image/webp" },
      body: Buffer.from(bytes),
    });
    expect(res.status).toBe(401);
  });

  it("rejects disallowed mime", async () => {
    const bytes = new TextEncoder().encode("hi");
    const res = await upload("alice", bytes, "application/octet-stream");
    expect(res.status).toBe(415);
  });

  it("rejects empty body", async () => {
    const res = await upload("alice", new Uint8Array(0), "image/webp");
    expect(res.status).toBe(400);
  });

  it("uploads, dedups, and fetches", async () => {
    const bytes = new TextEncoder().encode("FAKE-WEBP-DATA-1");

    // First upload by Alice
    const r1 = await upload("alice", bytes, "image/webp", "cave.webp");
    expect(r1.status).toBe(200);
    const body1 = (await r1.json()) as { assetId: string; url: string; deduped: boolean };
    expect(body1.assetId).toBeTruthy();
    expect(body1.deduped).toBe(false);
    expect(body1.url).toBe(`/plugin-data/${worldId}/assets/${body1.assetId}`);

    // Same bytes from Alice → deduped to same id
    const r2 = await upload("alice", bytes, "image/webp", "different-name.webp");
    expect(r2.status).toBe(200);
    const body2 = (await r2.json()) as { assetId: string; deduped: boolean };
    expect(body2.assetId).toBe(body1.assetId);
    expect(body2.deduped).toBe(true);

    // Same bytes from Bob → also dedup (sha256 match across users)
    const r3 = await upload("bob", bytes, "image/webp");
    expect(r3.status).toBe(200);
    const body3 = (await r3.json()) as { assetId: string; deduped: boolean };
    expect(body3.assetId).toBe(body1.assetId);
    expect(body3.deduped).toBe(true);

    // Fetch as Alice — visible (default everyone)
    const f1 = await fetchAsset("alice", body1.assetId);
    expect(f1.status).toBe(200);
    const buf = new Uint8Array(await f1.arrayBuffer());
    expect(buf.length).toBe(bytes.length);
    expect([...buf]).toEqual([...bytes]);
    expect(f1.headers.get("content-type")).toBe("image/webp");
    expect(f1.headers.get("cache-control")).toContain("immutable");

    // Fetch as Bob — also visible
    const f2 = await fetchAsset("bob", body1.assetId);
    expect(f2.status).toBe(200);

    // Fetch unauthenticated → 401
    const f3 = await fetchAsset(null, body1.assetId);
    expect(f3.status).toBe(401);

    // Now lock to gmOnly via the world's command pipeline (Alice owns it)
    const runtime = handle.worldsRegistry.get(worldId)!;
    const lockResult = await runtime.pipeline.dispatch({
      id: "lock-1",
      issuedBy: "tester" as never,
      issuedAt: Date.now(),
      cmd: SetPermissions({
        entityId: body1.assetId as EntityId,
        read: { kind: "role", role: "gm" },
      }),
      session: ALICE,
    });
    expect(lockResult.result.ok).toBe(true);

    // Bob now denied
    const f4 = await fetchAsset("bob", body1.assetId);
    expect(f4.status).toBe(403);

    // GM still allowed
    const f5 = await fetchAsset("gm", body1.assetId);
    expect(f5.status).toBe(200);

    // Delete — file should disappear from fetch
    const delResult = await runtime.pipeline.dispatch({
      id: "del-1",
      issuedBy: "tester" as never,
      issuedAt: Date.now(),
      cmd: DeleteAsset({ assetId: body1.assetId as EntityId }),
      session: ALICE,
    });
    expect(delResult.result.ok).toBe(true);
    const f6 = await fetchAsset("alice", body1.assetId);
    expect(f6.status).toBe(404); // entity gone

    // After delete, the same bytes can be re-uploaded (sha was orphaned)
    const r4 = await upload("alice", bytes, "image/webp");
    expect(r4.status).toBe(200);
    const body4 = (await r4.json()) as { assetId: string; deduped: boolean };
    expect(body4.assetId).not.toBe(body1.assetId);
    expect(body4.deduped).toBe(false);
  });

  it("404s a missing assetId", async () => {
    const res = await fetchAsset("alice", "ghost-asset");
    expect(res.status).toBe(404);
  });

  it("accepts small PDFs under the default cap", async () => {
    // application/pdf is in the default mime allowlist; a tiny fake
    // PDF body should upload like any image asset.
    const bytes = new TextEncoder().encode("%PDF-1.4 fake pdf bytes");
    const res = await upload("alice", bytes, "application/pdf", "rules.pdf");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assetId: string; url: string };
    expect(body.assetId).toBeTruthy();
    expect(body.url).toBe(`/plugin-data/${worldId}/assets/${body.assetId}`);
    const fetchRes = await fetchAsset("alice", body.assetId);
    expect(fetchRes.status).toBe(200);
    expect(fetchRes.headers.get("content-type")).toBe("application/pdf");
  });

  it("dispatched RegisterAsset directly creates an entity (sanity check)", async () => {
    const runtime = handle.worldsRegistry.get(worldId)!;
    const result = await runtime.pipeline.dispatch({
      id: "direct-reg-1",
      issuedBy: "tester" as never,
      issuedAt: Date.now(),
      cmd: RegisterAsset({
        mime: "image/png",
        sizeBytes: 100,
        sha256: "c".repeat(64),
        filename: "direct.png",
        width: null,
        height: null,
      }),
      session: ALICE,
    });
    expect(result.result.ok).toBe(true);
    const rows = runtime.world.query([Asset]);
    const direct = rows.find(
      (r) => (r.values.Asset as { sha256: string }).sha256 === "c".repeat(64),
    );
    expect(direct).toBeDefined();
  });
});
