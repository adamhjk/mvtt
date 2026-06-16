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

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { createEffect, createRoot } from "solid-js";
import {
  defineCommand,
  defineEvent,
  definePlugin,
  defineSystem,
  defineTrait,
  EntityId,
  fail,
  ok,
  z,
} from "./index.js";
import { ClientProvider, createOptimisticTrait } from "./client.js";
import { buildTestClient } from "./client-testing.js";

beforeEach(() => cleanup());

/* -------------------------------------------------------------------------- */
/* Test plugin: a tiny UI-state-shaped trait + a Set command + a mirror       */
/* system. One Reject command that always validates `fail` to exercise the    */
/* rollback path. Lives inside the test file so the substrate package has no  */
/* test-only fixtures shipped in `src/`.                                      */
/* -------------------------------------------------------------------------- */

const UiTrait = defineTrait({
  name: "@vtt/_test-optimistic/Ui",
  schema: z
    .object({
      count: z.number().default(0),
      text: z.string().default(""),
    })
    .default({ count: 0, text: "" }),
});

const NoDefaultTrait = defineTrait({
  name: "@vtt/_test-optimistic/NoDefault",
  schema: z.object({ value: z.number() }),
});

const UiChanged = defineEvent({
  name: "@vtt/_test-optimistic/UiChanged",
  schema: z.object({
    entityId: EntityId,
    value: z.object({ count: z.number(), text: z.string() }),
  }),
});

const SetUi = defineCommand({
  name: "@vtt/_test-optimistic/SetUi",
  schema: z.object({
    entityId: EntityId,
    value: z.object({ count: z.number(), text: z.string() }),
  }),
  validate: () => ok(),
  apply: ({ cmd }) => [UiChanged({ entityId: cmd.entityId, value: cmd.value })],
});

const RejectUi = defineCommand({
  name: "@vtt/_test-optimistic/RejectUi",
  schema: z.object({
    entityId: EntityId,
    value: z.object({ count: z.number(), text: z.string() }),
  }),
  validate: () => fail("nope"),
  apply: () => [],
});

const MirrorUi = defineSystem({
  name: "MirrorUi",
  on: UiChanged,
  reads: [],
  writes: [UiTrait],
  run: ({ event, world }) => {
    world.set(event.entityId, UiTrait, event.value);
    return [];
  },
});

const testPlugin = definePlugin({
  name: "@vtt/_test-optimistic",
  version: "0.0.0",
  traits: [UiTrait, NoDefaultTrait],
  events: [UiChanged],
  commands: [SetUi, RejectUi],
  systems: [MirrorUi],
});

function makeHarness(setupWorld?: Parameters<typeof buildTestClient>[0]["setupWorld"]) {
  return buildTestClient({ plugins: [testPlugin], setupWorld });
}

/* The primitive uses `useClient`, which requires being mounted under a   */
/* ClientProvider. We use a tiny render() instead of bare createRoot so   */
/* the reactive owner tree mirrors how plugins use it in production.     */
function withClient<T>(
  h: ReturnType<typeof makeHarness>,
  fn: () => T,
): { value: T; unmount: () => void } {
  let value!: T;
  const r = render(() => (
    <ClientProvider value={h.client}>
      {
        (() => {
          value = fn();
          return null;
        })() as never
      }
    </ClientProvider>
  ));
  return { value, unmount: r.unmount };
}

/* -------------------------------------------------------------------------- */

describe("createOptimisticTrait — construction", () => {
  it("seeds from the trait's current value when attached", () => {
    const h = makeHarness(({ world }) => {
      world.spawnAt("e1" as EntityId, [UiTrait({ count: 7, text: "hi" })]);
    });
    const { value } = withClient(h, () =>
      createOptimisticTrait("e1" as EntityId, UiTrait, {
        write: (v) => SetUi({ entityId: "e1" as EntityId, value: v }),
      }),
    );
    const [store] = value;
    expect(store.count).toBe(7);
    expect(store.text).toBe("hi");
  });

  it("falls through to the Zod schema default when the trait isn't attached", () => {
    const h = makeHarness(({ world }) => {
      // entity exists but no UiTrait attached
      world.spawnAt("e1" as EntityId, []);
    });
    const { value } = withClient(h, () =>
      createOptimisticTrait("e1" as EntityId, UiTrait, {
        write: (v) => SetUi({ entityId: "e1" as EntityId, value: v }),
      }),
    );
    const [store] = value;
    expect(store.count).toBe(0);
    expect(store.text).toBe("");
  });

  it("uses `initial` when the schema has no default", () => {
    const h = makeHarness(({ world }) => {
      world.spawnAt("e1" as EntityId, []);
    });
    const { value } = withClient(h, () =>
      createOptimisticTrait("e1" as EntityId, NoDefaultTrait, {
        write: () => SetUi({ entityId: "e1" as EntityId, value: { count: 0, text: "" } }),
        initial: { value: 42 },
      }),
    );
    const [store] = value;
    expect(store.value).toBe(42);
  });

  it("throws when the trait has no value, no default, and no initial", () => {
    const h = makeHarness(({ world }) => {
      world.spawnAt("e1" as EntityId, []);
    });
    expect(() =>
      withClient(h, () =>
        createOptimisticTrait("e1" as EntityId, NoDefaultTrait, {
          write: () => SetUi({ entityId: "e1" as EntityId, value: { count: 0, text: "" } }),
        }),
      ),
    ).toThrow(/no Zod default, and no initial/);
  });
});

describe("createOptimisticTrait — local writes", () => {
  it("setStore mutates the local store synchronously", () => {
    const h = makeHarness(({ world }) => {
      world.spawnAt("e1" as EntityId, [UiTrait({ count: 0, text: "" })]);
    });
    const { value } = withClient(h, () =>
      createOptimisticTrait("e1" as EntityId, UiTrait, {
        write: (v) => SetUi({ entityId: "e1" as EntityId, value: v }),
      }),
    );
    const [store, setStore] = value;
    setStore("count", 5);
    expect(store.count).toBe(5);
  });

  it("setStore dispatches the command produced by `write`", () => {
    const h = makeHarness(({ world }) => {
      world.spawnAt("e1" as EntityId, [UiTrait({ count: 0, text: "" })]);
    });
    const { value } = withClient(h, () =>
      createOptimisticTrait("e1" as EntityId, UiTrait, {
        write: (v) => SetUi({ entityId: "e1" as EntityId, value: v }),
      }),
    );
    const [, setStore] = value;
    setStore("count", 5);
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]?.type).toBe(SetUi.name);
    expect((h.dispatched[0]?.payload as { value: { count: number } }).value.count).toBe(5);
  });

  it("path reads are granular — sibling writes don't fire siblings' effects", async () => {
    const h = makeHarness(({ world }) => {
      world.spawnAt("e1" as EntityId, [UiTrait({ count: 0, text: "" })]);
    });

    let countReads = 0;
    let textReads = 0;

    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        render(() => (
          <ClientProvider value={h.client}>
            {
              (() => {
                const [store, setStore] = createOptimisticTrait("e1" as EntityId, UiTrait, {
                  write: (v) => SetUi({ entityId: "e1" as EntityId, value: v }),
                });
                createEffect(() => {
                  store.count;
                  countReads += 1;
                });
                createEffect(() => {
                  store.text;
                  textReads += 1;
                });
                queueMicrotask(() => {
                  expect(countReads).toBe(1);
                  expect(textReads).toBe(1);
                  setStore("text", "hello");
                  queueMicrotask(() => {
                    expect(countReads).toBe(1); // sibling unchanged
                    expect(textReads).toBe(2);
                    dispose();
                    resolve();
                  });
                });
                return null;
              })() as never
            }
          </ClientProvider>
        ));
      });
    });
  });
});

describe("createOptimisticTrait — server reconciliation", () => {
  it("server event reconciles the store via subscribe", async () => {
    const h = makeHarness(({ world }) => {
      world.spawnAt("e1" as EntityId, [UiTrait({ count: 0, text: "" })]);
    });
    const { value } = withClient(h, () =>
      createOptimisticTrait("e1" as EntityId, UiTrait, {
        write: (v) => SetUi({ entityId: "e1" as EntityId, value: v }),
      }),
    );
    const [store] = value;

    // Pump the trait directly via the pipeline as if from another writer.
    const handle = h.client.dispatch(
      SetUi({ entityId: "e1" as EntityId, value: { count: 99, text: "remote" } }),
    );
    await handle.ack;

    expect(store.count).toBe(99);
    expect(store.text).toBe("remote");
  });

  it("server divergence wins over an optimistic prediction", async () => {
    const h = makeHarness(({ world }) => {
      world.spawnAt("e1" as EntityId, [UiTrait({ count: 0, text: "" })]);
    });

    // Hand-rolled harness: register an optimistic trait, do a local prediction,
    // then have the world receive a divergent server value, and assert.
    let latestStore!: ReturnType<typeof createOptimisticTrait<typeof UiTrait>>[0];
    let latestSet!: ReturnType<typeof createOptimisticTrait<typeof UiTrait>>[1];
    const r = render(() => (
      <ClientProvider value={h.client}>
        {
          (() => {
            const [s, set] = createOptimisticTrait("e1" as EntityId, UiTrait, {
              write: (v) => SetUi({ entityId: "e1" as EntityId, value: v }),
            });
            latestStore = s;
            latestSet = set;
            return null;
          })() as never
        }
      </ClientProvider>
    ));

    // Predict locally — but DON'T let the dispatch's resulting event propagate
    // before we shove a divergent value in. The pipeline runs synchronously
    // inside dispatch, so to simulate divergence we just await the dispatch
    // (which mirrors `count: 5`) and then send a second command with a
    // different value, the way a separate client would.
    latestSet("count", 5);
    expect(latestStore.count).toBe(5);

    // The first dispatch's event has already landed — store now reflects 5.
    // Second dispatch from "elsewhere" with a divergent value:
    const handle = h.client.dispatch(
      SetUi({ entityId: "e1" as EntityId, value: { count: 12, text: "from-other-client" } }),
    );
    await handle.ack;
    expect(latestStore.count).toBe(12);
    expect(latestStore.text).toBe("from-other-client");

    r.unmount();
  });
});

async function flushPromises() {
  // Pipeline dispatch chains pipeline.inFlight → dispatchInternal (async) →
  // harness .then transform → primitive's ack.then. A macrotask gives all
  // microtask queues time to drain even when an effect re-arms a microtask.
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
}

describe("createOptimisticTrait — rollback", () => {
  it("rolls back to lastServerValue when the dispatch ack reports !ok", async () => {
    const h = makeHarness(({ world }) => {
      world.spawnAt("e1" as EntityId, [UiTrait({ count: 0, text: "ok" })]);
    });

    let store!: ReturnType<typeof createOptimisticTrait<typeof UiTrait>>[0];
    const r = render(() => (
      <ClientProvider value={h.client}>
        {
          (() => {
            const [s, set] = createOptimisticTrait("e1" as EntityId, UiTrait, {
              write: (v) => RejectUi({ entityId: "e1" as EntityId, value: v }),
            });
            store = s;
            set("count", 999);
            return null;
          })() as never
        }
      </ClientProvider>
    ));

    // Optimistic predicted state.
    expect(store.count).toBe(999);

    // The dispatch is fire-and-forget from the primitive's perspective; the
    // .then(ack => rollback) callback runs after the pipeline's promise
    // chain settles. Allow a few microtasks plus a macrotask.
    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    expect(store.count).toBe(0);
    expect(store.text).toBe("ok");

    r.unmount();
  });
});

describe("createOptimisticTrait — debounce", () => {
  it("coalesces multiple rapid setStore calls into a single dispatch", () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness(({ world }) => {
        world.spawnAt("e1" as EntityId, [UiTrait({ count: 0, text: "" })]);
      });
      const { value } = withClient(h, () =>
        createOptimisticTrait("e1" as EntityId, UiTrait, {
          write: (v) => SetUi({ entityId: "e1" as EntityId, value: v }),
          debounceMs: 50,
        }),
      );
      const [, setStore] = value;
      setStore("count", 1);
      setStore("count", 2);
      setStore("count", 3);
      expect(h.dispatched).toHaveLength(0);
      vi.advanceTimersByTime(60);
      expect(h.dispatched).toHaveLength(1);
      expect((h.dispatched[0]?.payload as { value: { count: number } }).value.count).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes a pending debounced dispatch on cleanup", () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness(({ world }) => {
        world.spawnAt("e1" as EntityId, [UiTrait({ count: 0, text: "" })]);
      });
      const r = render(() => (
        <ClientProvider value={h.client}>
          {
            (() => {
              const [, set] = createOptimisticTrait("e1" as EntityId, UiTrait, {
                write: (v) => SetUi({ entityId: "e1" as EntityId, value: v }),
                debounceMs: 1000,
              });
              set("count", 7);
              return null;
            })() as never
          }
        </ClientProvider>
      ));
      expect(h.dispatched).toHaveLength(0);
      r.unmount();
      // onCleanup runs synchronously at unmount; the pending dispatch flushes.
      expect(h.dispatched).toHaveLength(1);
      expect((h.dispatched[0]?.payload as { value: { count: number } }).value.count).toBe(7);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createOptimisticTrait — disposal", () => {
  it("releases the world subscription on cleanup", async () => {
    const h = makeHarness(({ world }) => {
      world.spawnAt("e1" as EntityId, [UiTrait({ count: 0, text: "" })]);
    });

    let lastSeen = -1;
    const r = render(() => (
      <ClientProvider value={h.client}>
        {
          (() => {
            const [s] = createOptimisticTrait("e1" as EntityId, UiTrait, {
              write: (v) => SetUi({ entityId: "e1" as EntityId, value: v }),
            });
            createEffect(() => {
              lastSeen = s.count;
            });
            return null;
          })() as never
        }
      </ClientProvider>
    ));
    // Sanity: subscription works.
    await h.client.dispatch(SetUi({ entityId: "e1" as EntityId, value: { count: 11, text: "" } }))
      .ack;
    expect(lastSeen).toBe(11);

    r.unmount();

    // After cleanup, further server events must not update the disposed store.
    const beforeDispose = lastSeen;
    await h.client.dispatch(SetUi({ entityId: "e1" as EntityId, value: { count: 22, text: "" } }))
      .ack;
    expect(lastSeen).toBe(beforeDispose);
  });
});

/* -------------------------------------------------------------------------- */
/* Per-client optimistic-flush registry — the seam ShareTab and other         */
/* cross-cutting verbs hook into to coalesce pending writes before reading    */
/* the trait server-side.                                                     */
/* -------------------------------------------------------------------------- */

describe("OptimisticFlushRegistry", () => {
  it("registers on createOptimisticTrait and unregisters on cleanup", async () => {
    const h = makeHarness(({ world }) => {
      world.spawnAt("e1" as EntityId, [UiTrait({ count: 0, text: "" })]);
    });
    // No flushers registered yet — flushFor is a no-op.
    await h.client.optimisticFlushes.flushFor("e1" as EntityId);
    expect(h.dispatched).toHaveLength(0);

    const { unmount } = withClient(h, () =>
      createOptimisticTrait("e1" as EntityId, UiTrait, {
        write: (v) => SetUi({ entityId: "e1" as EntityId, value: v }),
        debounceMs: 100,
      }),
    );

    // Mounted but never written — flushFor short-circuits via dirty=false,
    // dispatching nothing.
    await h.client.optimisticFlushes.flushFor("e1" as EntityId);
    expect(h.dispatched).toHaveLength(0);

    unmount();

    // After unmount the unregister fires — even if a future caller tries
    // to flush this entity, the flusher is gone and nothing happens.
    await h.client.optimisticFlushes.flushFor("e1" as EntityId);
    expect(h.dispatched).toHaveLength(0);
  });

  it("flushFor coalesces a pending debounced write into one dispatch", async () => {
    const h = makeHarness(({ world }) => {
      world.spawnAt("e1" as EntityId, [UiTrait({ count: 0, text: "" })]);
    });
    let setStore!: (v: { count: number; text: string }) => void;
    const { unmount } = withClient(h, () => {
      const [, set] = createOptimisticTrait("e1" as EntityId, UiTrait, {
        write: (v) => SetUi({ entityId: "e1" as EntityId, value: v }),
        debounceMs: 250,
      });
      setStore = (v) => set(v);
      return null;
    });

    // Three rapid writes inside the debounce window.
    setStore({ count: 7, text: "" });
    setStore({ count: 8, text: "" });
    setStore({ count: 11, text: "" });

    // Nothing has been dispatched yet — debounce hasn't fired.
    expect(h.dispatched).toHaveLength(0);

    // The flush forces the latest pending value through immediately.
    await h.client.optimisticFlushes.flushFor("e1" as EntityId);
    expect(h.dispatched).toHaveLength(1);
    expect((h.dispatched[0]!.payload as { value: { count: number } }).value.count).toBe(11);

    // A second flush with no fresh writes is a no-op.
    await h.client.optimisticFlushes.flushFor("e1" as EntityId);
    expect(h.dispatched).toHaveLength(1);

    unmount();
  });

  it("prepareFlush syncs external state into the store before each dispatch (the PdfReader case)", async () => {
    const h = makeHarness(({ world }) => {
      world.spawnAt("e1" as EntityId, [UiTrait({ count: 0, text: "" })]);
    });

    // External state we don't own: the user has navigated to "page 95"
    // without our setStore being called. flushFor must dispatch *95*,
    // not the last value persist() landed via setStore. This is exactly
    // the bug the bug report described — "shared page 95, recipient
    // gets page 62" because the optimistic store had the previous
    // pagechanging event's value, not the current viewer.currentPageNumber.
    let externalCount = 0;

    const { unmount } = withClient(h, () => {
      const [, set] = createOptimisticTrait("e1" as EntityId, UiTrait, {
        write: (v) => SetUi({ entityId: "e1" as EntityId, value: v }),
        debounceMs: 250,
        prepareFlush: () => {
          // Mirror the PdfReader pattern: write the external library's
          // current value into the store right before dispatch.
          set({ count: externalCount, text: "" });
        },
      });
      return null;
    });

    // Simulate a user-driven navigation in the underlying library:
    // external state moves from 0 → 95 without the writer being told.
    externalCount = 95;

    // No setStore call has happened. dispatched should be empty so far.
    expect(h.dispatched).toHaveLength(0);

    await h.client.optimisticFlushes.flushFor("e1" as EntityId);

    // prepareFlush ran, copied externalCount=95 into the store, dirty
    // became true, the dispatch fired with the latest value.
    expect(h.dispatched).toHaveLength(1);
    expect((h.dispatched[0]!.payload as { value: { count: number } }).value.count).toBe(95);

    // A second flush with no further external changes is a no-op
    // (dirty=false, and prepareFlush re-writing the same value is a
    // no-op store update — Solid's reconcile dedupes by reference, but
    // even if it set dirty, the dispatched value would still be 95).
    h.dispatched.length = 0;
    await h.client.optimisticFlushes.flushFor("e1" as EntityId);
    // Either zero dispatches (ideal) or one with the same value 95;
    // both are correct. Assert at most one and the value is 95.
    expect(h.dispatched.length).toBeLessThanOrEqual(1);
    if (h.dispatched.length === 1) {
      expect((h.dispatched[0]!.payload as { value: { count: number } }).value.count).toBe(95);
    }

    unmount();
  });

  it("flushFor on a different entity doesn't trigger this entity's pending write", async () => {
    const h = makeHarness(({ world }) => {
      world.spawnAt("e1" as EntityId, [UiTrait({ count: 0, text: "" })]);
      world.spawnAt("e2" as EntityId, [UiTrait({ count: 0, text: "" })]);
    });
    let setE1!: (v: { count: number; text: string }) => void;
    const { unmount } = withClient(h, () => {
      const [, set] = createOptimisticTrait("e1" as EntityId, UiTrait, {
        write: (v) => SetUi({ entityId: "e1" as EntityId, value: v }),
        debounceMs: 250,
      });
      setE1 = (v) => set(v);
      return null;
    });

    setE1({ count: 99, text: "" });
    await h.client.optimisticFlushes.flushFor("e2" as EntityId);
    // e1's pending write didn't get pulled by an e2 flush.
    expect(h.dispatched).toHaveLength(0);

    unmount();
  });
});
