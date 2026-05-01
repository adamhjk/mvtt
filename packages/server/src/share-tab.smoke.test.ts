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
import WebSocket from "ws";
import { startServer, type ServerHandle } from "@vtt/substrate/server";
import {
  defineCommand,
  defineEvent,
  definePlugin,
  defineSystem,
  defineTrait,
  EntityId,
  InMemoryWorldsRepository,
  ok,
  z,
} from "@vtt/substrate";
import { shellWorkbench } from "@vtt/shell-workbench";
import {
  OpenPage,
  ShareTab,
  TabShared,
  WorkspaceState,
  WorkspaceOwner,
  tabSentinelEntityId,
} from "@vtt/shell-workbench/shared";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { OwnedBy } from "@vtt/permissions/shared";
import { notes } from "@vtt/notes";
import { books } from "@vtt/books";
import { pdfBook } from "@vtt/pdf-book";
import {
  PdfReaderState,
  SetPdfReaderState,
} from "@vtt/pdf-book/shared";
import type { AuthSession } from "@vtt/auth";

/**
 * Wire smoke for ShareTab: two authenticated clients in one world. Sender
 * opens a tab, writes a per-tab UI-state trait onto the sender's tab
 * sentinel (simulating "page 11 of the rulebook"), then dispatches
 * ShareTab. Recipient's connection should see a TabShared event whose
 * delivery results in:
 *   - a new tab in the recipient's WorkspaceState
 *   - the recipient's freshly-spawned tab sentinel carrying the snapshot
 *     trait at the same value
 */

const PLAYER_A: AuthSession = {
  userId: "user-a",
  email: "a@test.dev",
  name: "User A",
  role: "player",
};

const PLAYER_B: AuthSession = {
  userId: "user-b",
  email: "b@test.dev",
  name: "User B",
  role: "player",
};

// Stand-in for a per-tab UI-state trait (e.g. @vtt/pdf-book/ReaderState).
// Matches the shape every per-plugin UI trait uses today.
const TestUiState = defineTrait({
  name: "@test/share-smoke/UiState",
  schema: z.object({ page: z.number().int().min(1) }),
});
const TestUiStateChanged = defineEvent({
  name: "@test/share-smoke/UiStateChanged",
  schema: z.object({ entityId: EntityId, value: z.object({ page: z.number().int().min(1) }) }),
  transient: true,
  broadcast: true,
});
const SetTestUiState = defineCommand({
  name: "@test/share-smoke/SetUiState",
  schema: z.object({ entityId: EntityId, value: z.object({ page: z.number().int().min(1) }) }),
  validate: () => ok(),
  apply: ({ cmd }) => [TestUiStateChanged({ entityId: cmd.entityId, value: cmd.value })],
});
const TestUiStateMirror = defineSystem({
  name: "TestUiStateMirror",
  on: TestUiStateChanged,
  reads: [],
  writes: [TestUiState],
  run: ({ event, world }) => {
    if (!world.has(event.entityId)) return [];
    world.set(event.entityId, TestUiState, event.value);
    return [];
  },
});

const shareTabTestPlugin = definePlugin({
  name: "@test/share-tab-smoke",
  version: "0",
  dependsOn: [
    "@vtt/shell-workbench@^0",
    "@vtt/identity@^0",
    "@vtt/permissions@^0",
    // The PDF case is the canonical share-tab use case — depend on
    // books + pdf-book so the active-plugins resolver loads them into
    // the test world's registry. Without this the
    // `@vtt/pdf-book/SetReaderState` command is unknown.
    "@vtt/books@^0",
    "@vtt/pdf-book@^0",
  ],
  traits: [TestUiState],
  events: [TestUiStateChanged],
  commands: [SetTestUiState],
  systems: [TestUiStateMirror],
  gameSystem: true,
});

interface AckMsg { kind: "ack"; commandId: string; ok: boolean; reason?: string }
interface EventMsg {
  kind: "event";
  seq: number;
  event: { type: string; payload: Record<string, unknown> };
}
type Msg =
  | { kind: "hello"; clientId: string }
  | { kind: "snapshot"; atSeq: number }
  | EventMsg
  | AckMsg
  | { kind: "synced" };

describe("ShareTab wire smoke", () => {
  let handle: ServerHandle;
  let worldId: string;
  const aMessages: Msg[] = [];
  const bMessages: Msg[] = [];
  let aWs: WebSocket | undefined;
  let bWs: WebSocket | undefined;

  beforeAll(async () => {
    const worldsRepo = new InMemoryWorldsRepository();
    await worldsRepo.migrate();
    const world = await worldsRepo.insert({
      id: "share-tab-smoke",
      name: "Share Tab smoke",
      gameSystemPlugin: shareTabTestPlugin.name,
      ownerUserId: PLAYER_A.userId,
    });
    worldId = world.id;
    handle = await startServer({
      port: 0,
      infrastructure: [shellWorkbench, identity, permissions, notes],
      optional: [shareTabTestPlugin, books, pdfBook],
      worldsRepo,
      // Pull the user out of the upgrade URL so two simultaneous WS
      // connections can present different sessions.
      authenticateUpgrade: (req) => {
        const url = new URL(req.url ?? "/", "http://x");
        const u = url.searchParams.get("u");
        if (u === PLAYER_A.userId) return PLAYER_A;
        if (u === PLAYER_B.userId) return PLAYER_B;
        return null;
      },
      extractRecipient: (s) => {
        const sess = s as AuthSession | null;
        return sess ? { userId: sess.userId, role: sess.role } : null;
      },
    });
  });

  afterAll(async () => {
    if (aWs && aWs.readyState === aWs.OPEN) aWs.close();
    if (bWs && bWs.readyState === bWs.OPEN) bWs.close();
    if (handle) await handle.close();
  });

  async function connect(user: string, sink: Msg[]): Promise<WebSocket> {
    const ws = new WebSocket(
      `ws://127.0.0.1:${handle.port}/ws?worldId=${encodeURIComponent(worldId)}&u=${encodeURIComponent(user)}`,
    );
    ws.on("message", (raw) => sink.push(JSON.parse(raw.toString()) as Msg));
    await new Promise<void>((r) => ws.on("open", () => r()));
    return ws;
  }

  it("delivers a tab + per-tab UI-state snapshot to the recipient over the wire", async () => {
    aWs = await connect(PLAYER_A.userId, aMessages);
    bWs = await connect(PLAYER_B.userId, bMessages);
    // Let both helloes + bootstrap (PlayerJoined → WorkspaceOwner spawn)
    // settle before the sender starts dispatching.
    await new Promise((r) => setTimeout(r, 80));

    const sendA = (env: object): void => aWs!.send(JSON.stringify(env));

    // 1. Sender opens a tab.
    const KIND = "@test/share-smoke/page";
    sendA({
      kind: "command",
      id: "open-tab",
      issuedAt: Date.now(),
      cmd: { type: OpenPage.name, payload: OpenPage({ pageKind: KIND }).payload },
    });
    await new Promise((r) => setTimeout(r, 60));

    // Look up the sender's tab id from the server's world.
    const rt = handle.worldsRegistry.get(worldId)!;
    const aOwnerRow = rt.world
      .query([WorkspaceOwner, OwnedBy, WorkspaceState])
      .find((r) => (r.values.OwnedBy as { userId: string }).userId === PLAYER_A.userId);
    expect(aOwnerRow).toBeDefined();
    const aState = aOwnerRow!.values.WorkspaceState as { tabs: Record<string, unknown> };
    const senderTabId = Object.keys(aState.tabs)[0]!;
    expect(senderTabId).toBeDefined();

    // 2. Sender writes per-tab UI state onto their sentinel.
    sendA({
      kind: "command",
      id: "set-ui",
      issuedAt: Date.now(),
      cmd: {
        type: SetTestUiState.name,
        payload: SetTestUiState({
          entityId: tabSentinelEntityId(senderTabId),
          value: { page: 11 },
        }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 60));

    // 3. Sender shares with player B.
    sendA({
      kind: "command",
      id: "share",
      issuedAt: Date.now(),
      cmd: {
        type: ShareTab.name,
        payload: ShareTab({
          tabId: senderTabId,
          recipientUserIds: [PLAYER_B.userId],
        }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 100));

    // Server-side: B's workspace now has a fresh tab.
    const bOwnerRow = rt.world
      .query([WorkspaceOwner, OwnedBy, WorkspaceState])
      .find((r) => (r.values.OwnedBy as { userId: string }).userId === PLAYER_B.userId);
    expect(bOwnerRow).toBeDefined();
    const bState = bOwnerRow!.values.WorkspaceState as {
      tabs: Record<string, { id: string; pageKind: string }>;
    };
    const bTabIds = Object.keys(bState.tabs);
    expect(bTabIds).toHaveLength(1);
    const bTabId = bTabIds[0]!;
    expect(bState.tabs[bTabId]!.pageKind).toBe(KIND);
    expect(bTabId).not.toBe(senderTabId);

    // Snapshot landed on B's sentinel: page 11 travelled.
    const bSentinel = tabSentinelEntityId(bTabId);
    const ui = rt.world.get(bSentinel, [TestUiState]) as
      | { UiState: { page: number } }
      | undefined;
    expect(ui?.UiState.page).toBe(11);

    // Wire-side: B's connection received the TabShared event; A's didn't
    // (visibility was scoped to actors([recipientUserId])).
    const bShared = bMessages.filter(
      (m): m is EventMsg => m.kind === "event" && m.event.type === TabShared.name,
    );
    expect(bShared).toHaveLength(1);
    const aShared = aMessages.filter(
      (m): m is EventMsg => m.kind === "event" && m.event.type === TabShared.name,
    );
    expect(aShared).toHaveLength(0);

    // The ack for the share command is success.
    const shareAck = aMessages.find(
      (m): m is AckMsg => m.kind === "ack" && m.commandId === "share",
    );
    expect(shareAck?.ok).toBe(true);
  });

  it("delivers a PDF tab + PdfReaderState (page 95) to the recipient", async () => {
    // Fresh wsockets — the previous test consumed worldId.
    const aMessages2: Msg[] = [];
    const bMessages2: Msg[] = [];
    const aWs2 = await new Promise<WebSocket>((resolve) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${handle.port}/ws?worldId=${encodeURIComponent(worldId)}&u=${encodeURIComponent(PLAYER_A.userId)}`,
      );
      ws.on("message", (raw) => aMessages2.push(JSON.parse(raw.toString()) as Msg));
      ws.on("open", () => resolve(ws));
    });
    const bWs2 = await new Promise<WebSocket>((resolve) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${handle.port}/ws?worldId=${encodeURIComponent(worldId)}&u=${encodeURIComponent(PLAYER_B.userId)}`,
      );
      ws.on("message", (raw) => bMessages2.push(JSON.parse(raw.toString()) as Msg));
      ws.on("open", () => resolve(ws));
    });
    await new Promise((r) => setTimeout(r, 80));

    const sendA = (env: object): void => aWs2.send(JSON.stringify(env));

    // Sender opens a Books tab.
    sendA({
      kind: "command",
      id: "pdf-open",
      issuedAt: Date.now(),
      cmd: { type: OpenPage.name, payload: OpenPage({ pageKind: "@vtt/books/books" }).payload },
    });
    await new Promise((r) => setTimeout(r, 60));

    const rt = handle.worldsRegistry.get(worldId)!;
    const aOwnerRow = rt.world
      .query([WorkspaceOwner, OwnedBy, WorkspaceState])
      .find((r) => (r.values.OwnedBy as { userId: string }).userId === PLAYER_A.userId);
    const aTabs = (aOwnerRow!.values.WorkspaceState as {
      tabs: Record<string, { id: string; pageKind: string }>;
    }).tabs;
    // Find the books tab (the previous test left an unrelated tab on
    // this same world / user).
    const senderTabId = Object.values(aTabs).find(
      (t) => t.pageKind === "@vtt/books/books",
    )!.id;

    // Sender sets PdfReaderState directly on their sentinel — simulating
    // the mid-flight state PdfReader's persist() would write. scrollTop
    // is set to a large pixel offset to surface the cross-container bug:
    // the same pixel offset lands on different pages when the recipient's
    // container is sized differently from the sender's.
    sendA({
      kind: "command",
      id: "pdf-page",
      issuedAt: Date.now(),
      cmd: {
        type: SetPdfReaderState.name,
        payload: SetPdfReaderState({
          entityId: tabSentinelEntityId(senderTabId),
          value: {
            page: 95,
            scale: "page-width",
            scrollTop: 50000,
            query: "",
            outlineOpen: false,
          },
        }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 60));

    // Confirm the sender's sentinel has page 95 server-side.
    const senderState = rt.world.get(tabSentinelEntityId(senderTabId), [PdfReaderState]) as
      | { ReaderState: { page: number } }
      | undefined;
    expect(senderState?.ReaderState.page).toBe(95);

    // Share with recipient.
    sendA({
      kind: "command",
      id: "pdf-share",
      issuedAt: Date.now(),
      cmd: {
        type: ShareTab.name,
        payload: ShareTab({
          tabId: senderTabId,
          recipientUserIds: [PLAYER_B.userId],
        }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 100));

    // Recipient's new tab.
    const bOwnerRow = rt.world
      .query([WorkspaceOwner, OwnedBy, WorkspaceState])
      .find((r) => (r.values.OwnedBy as { userId: string }).userId === PLAYER_B.userId);
    const bState = bOwnerRow!.values.WorkspaceState as {
      tabs: Record<string, { id: string; pageKind: string }>;
    };
    const bBookTab = Object.values(bState.tabs).find(
      (t) => t.pageKind === "@vtt/books/books",
    );
    expect(bBookTab).toBeDefined();
    const bTabId = bBookTab!.id;

    // Critical: recipient's sentinel has PdfReaderState with page 95.
    const recipientReader = rt.world.get(tabSentinelEntityId(bTabId), [PdfReaderState]) as
      | { ReaderState: { page: number; scale: string; scrollTop: number } }
      | undefined;
    expect(recipientReader?.ReaderState.page).toBe(95);
    expect(recipientReader?.ReaderState.scale).toBe("page-width");
    // scrollTop must NOT travel — it's a pixel offset whose meaning
    // depends on the renderer's container width at "page-width" scale.
    // Replaying the sender's pixel offset on a differently-sized
    // recipient container lands on a different page (this is the live
    // bug: GM at page 119 shares, recipient lands on page 106 because
    // the rAF scrollTop restore overrides the page restore).
    expect(recipientReader?.ReaderState.scrollTop).toBe(0);

    aWs2.close();
    bWs2.close();
  });
});
