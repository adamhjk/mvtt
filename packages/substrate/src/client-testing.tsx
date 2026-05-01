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

import {
  CommandPipeline,
  EventBus,
  Registry,
  World,
  substrateCorePlugin,
  type ClientId,
  type CommandInstance,
  type PluginDef,
} from "./index.js";
import { ClientProvider, type ClientHandle, type DispatchHandle } from "./client.js";
import { render } from "@solidjs/testing-library";
import { type JSX } from "solid-js";

/**
 * Build a fake `ClientHandle` backed by a real `CommandPipeline` and
 * `World`, with no WebSocket. Dispatched commands are pushed onto the
 * returned `dispatched` array AND piped through the pipeline so trait
 * subscriptions see the after-effects — this mirrors how a real client
 * behaves once the server's ack lands.
 *
 * Designed for `*.test.tsx` (jsdom) integration tests of plugin views
 * and kit components. Substrate-level (no knowledge of any specific
 * plugin); plugins compose their own harnesses on top via the
 * `setupWorld` callback.
 *
 * Usage:
 *   const h = buildTestClient({
 *     plugins: [characters, myPlugin],
 *     setupWorld: ({ world }) => {
 *       world.spawn([Character({ name: "Tarn" }), ...]);
 *     },
 *     session: { userId: "me", email: "me@x.dev", name: "Me", role: "player" },
 *   });
 *   render(() => mountWith(h, () => <MyComponent />));
 *   expect(h.dispatched).toHaveLength(0);
 *   ...
 *   await h.dispose(); // optional — cleanup() also covers it
 */
export interface TestClientHarness {
  readonly client: ClientHandle;
  readonly world: World;
  readonly registry: Registry;
  readonly bus: EventBus;
  readonly pipeline: CommandPipeline;
  /**
   * Every command the test mounted UI dispatched, in order. Each entry
   * is the bare `CommandInstance` (type + payload), not the envelope.
   */
  readonly dispatched: CommandInstance[];
  /**
   * Called by `afterEach` if you wire it up; idempotent. Currently a
   * no-op (no resources to release) but reserved so future versions can
   * tear down in-process state without changing test code.
   */
  dispose(): void;
}

export interface BuildTestClientOptions {
  /**
   * Plugins to load into the registry. The pipeline + reactive systems
   * inside the harness see the same plugin set the production client
   * would. Order doesn't matter; the registry validates after load.
   */
  readonly plugins: ReadonlyArray<PluginDef>;
  /**
   * Run after the world is constructed but before the harness is
   * returned. Use to spawn entities, attach traits, or otherwise seed
   * world state the test relies on.
   */
  readonly setupWorld?: (args: { world: World; registry: Registry }) => void;
  /**
   * Synthetic auth session attached to every dispatched command.
   * Plugins like @vtt/characters validate against this; supply a
   * shape compatible with whatever auth schema your plugins expect.
   */
  readonly session?: unknown;
  /**
   * The synthetic clientId reported by `client.clientId()`. Defaults
   * to `"test-client-1"`. Useful when a test needs to spawn an
   * Online entity bound to this clientId.
   */
  readonly clientId?: string;
  /**
   * The synthetic worldId reported by `client.worldId()`. Defaults to
   * `"test-world"`.
   */
  readonly worldId?: string;
}

export function buildTestClient(opts: BuildTestClientOptions): TestClientHarness {
  const registry = new Registry();
  // Load the substrate core plugin first — it declares RootSurface and
  // the connection-lifecycle events, which production clients always
  // have. Without it, any plugin whose views target RootSurface (the
  // shell-default Chrome) fails registry validation.
  registry.load(substrateCorePlugin);
  for (const p of opts.plugins) registry.load(p);
  registry.validate();

  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);

  if (opts.setupWorld) opts.setupWorld({ world, registry });

  const dispatched: CommandInstance[] = [];
  const clientId = (opts.clientId ?? "test-client-1") as ClientId;
  const worldId = opts.worldId ?? "test-world";
  let cmdSeq = 0;

  const client: ClientHandle = {
    registry,
    world,
    bus,
    presence: {
      publish: () => {},
      subscribe: () => () => {},
    },
    clientId: () => clientId,
    worldId: () => worldId,
    connected: () => true,
    lastAppliedSeq: () => 0,
    synced: () => true,
    dispatch: (cmd: CommandInstance): DispatchHandle => {
      dispatched.push(cmd);
      cmdSeq += 1;
      const id = `test-cmd-${cmdSeq}`;
      const ack = pipeline
        .dispatch({
          id,
          issuedBy: clientId,
          issuedAt: Date.now(),
          cmd,
          session: opts.session,
        })
        .then((res) => ({
          ok: res.result.ok,
          reason: res.result.ok ? undefined : res.result.reason,
        }));
      return { id, ack };
    },
    onConnect: () => () => {},
    onSynced: () => () => {},
    close: () => {},
  };

  return {
    client,
    world,
    registry,
    bus,
    pipeline,
    dispatched,
    dispose: () => {},
  };
}

/**
 * Mount a Solid component under a `ClientProvider` bound to the test
 * harness. Returns the same `RenderResult` `@solidjs/testing-library`
 * gives you (`container`, `unmount`, queries).
 */
export function mountWithClient(
  harness: TestClientHarness,
  component: () => JSX.Element,
): ReturnType<typeof render> {
  return render(() => (
    <ClientProvider value={harness.client}>{component() as JSX.Element}</ClientProvider>
  ));
}
