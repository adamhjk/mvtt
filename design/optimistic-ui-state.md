# Optimistic UI state

**Status:** proposed. Lands as one substrate primitive (`createOptimisticTrait`) plus a per-plugin migration that moves transient UI state out of the workbench's shared `uiState` blob and onto per-plugin traits owned by per-tab sentinel entities. **One small substrate addition** (the primitive); everything else is mechanical refactor inside existing plugins.

## The problem

We have the wrong state-management pattern for transient, per-tab UI state, and it bites us as cross-plugin reflows. Concrete failure: change the active page in a `Note`, the open `PdfReader` re-evaluates and (in the worst case) loses scroll/zoom. Generalise: any setUiState write in any pane on any tab can ripple into every other tab's render path.

The pattern has three reinforcing problems, each of which would already be sufficient on its own.

### Problem 1 — one trait holds every tab's UI state

`WorkspaceState` is a single trait. It carries `tabs: Record<tabId, { …, uiState: unknown }>`. The substrate's reactivity is fine-grained per-trait: when the trait is replaced, every subscriber re-fires. Today every tab's UI state lives inside that one trait, so a write to any tab's `uiState` invalidates the signal that every other tab's view is reading. The granularity of the underlying signal is one-per-workbench, not one-per-tab.

`useTrait` does its job correctly. The bug is upstream: the bag is too big.

### Problem 2 — the accessor gets unwrapped at the provider boundary

`Pane.tsx:298–308` correctly hands the provider a reactive accessor (`uiState: () => tabAcc().uiState`), and the re-mount key in `paneKey()` correctly excludes `uiState`. Both are deliberate. But every existing provider then writes:

```tsx
render: ({ tabId, entityId, uiState, setUiState }) => (
  <BookPage uiState={uiState()} setUiState={setUiState} />
);
```

That `uiState()` call destructures the proxy. From that line down, `uiState` is a static prop, not a reactive read. Solid's fine-grained reactivity is now fully bypassed — the only way to deliver a new value is to re-render the parent, which re-runs the JSX containing `<Surface name={…} context={{ bookId }} />`. Sibling Surface contents go down with it.

### Problem 3 — there is no optimistic apply layer

`command-pipeline.ts:28` is explicit:

> v0 doesn't implement optimistic prediction or rollback; this is just the seam.

So every `setUiState` round-trips to the server before the local trait updates. UI state — the most latency-sensitive state we have — is the _least_ optimistic state we have. Plugins respond by reaching for `sessionStorage` (`PdfReader.tsx:99–134`) or module-level signals (`pendingBookNav`, `pendingScroll`) to side-step the round-trip, which fragments the persistence story and re-introduces the prop-drill problem from a different angle.

## Approach

A small substrate primitive plus a structural rule for plugins. Three properties make the design defensible:

1. **Per-plugin slices.** Each plugin owns a typed UI-state trait on a per-tab sentinel entity it controls. The workbench owns _layout_ (tabs, panes, tree, active pane); it never sees plugin contents. A write to one plugin's slice cannot invalidate any other plugin's signal — by construction, they're different traits on different entities.
2. **Fine-grained reads through a Solid store.** The primitive returns a `createStore` projection of the trait. Path reads (`store.activePageId`) are path-granular; sibling fields can change without invalidating this read. No more accessor-unwrapping at provider boundaries: there's nothing to unwrap.
3. **Optimistic local apply with server reconciliation.** Writes hit the local store immediately and dispatch in parallel. Incoming events from the server reconcile by `reconcile()` against the server value. If the server rejects the command, the local store rolls back to the last server-confirmed value. Latency is removed without abandoning the source-of-truth contract.

Three properties together collapse the original `uiState` bag:

- The shared workbench `uiState` field disappears.
- Plugin views read `store.foo` directly. No prop-drilling.
- Persistence is uniform: the trait _is_ the durable record, no per-plugin sessionStorage shim.

## Considered alternatives

| Option                                                       | Shape                                                                                                           | Rejected because                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stop destructuring `uiState`, keep the blob**              | Pass the accessor through, never call it at the boundary.                                                       | Doesn't fix Problem 1 — one trait still backs every tab's state. Sibling tabs still invalidate one another.                                                                                                                                                                                                             |
| **Per-tab `createStore` in the workbench, indexed by tabId** | Workbench keeps owning UI state but stores it as a `createStore` keyed by tab.                                  | Solves the granularity problem inside one process, but commits the workbench to knowing the schema of every plugin's UI state. Bounded contexts blur.                                                                                                                                                                   |
| **Module-level signals everywhere**                          | Each plugin keeps its own UI state in module-level `createSignal`s, doesn't persist it through the trait spine. | Loses durability; loses multi-device sync; fragments the persistence story; can't replay. We already did this for `pendingBookNav` and accept it for _transient hints_ — but persistent UI state belongs in traits.                                                                                                     |
| **Generic optimistic apply in the substrate**                | Pipeline runs `validate`+`apply` locally on dispatch, predicted-events get rolled back if the server diverges.  | Right answer eventually; worth doing for game-mechanics commands where round-trip latency hurts. Out of scope for this proposal — the per-plugin store wrapper unblocks the UI-state problem without the substrate bookkeeping (predicted-event ledger, server-allocated id reconciliation, predicted/canonical merge). |

The chosen design is the minimum patternable thing: one primitive, a structural rule, and a mechanical migration.

## The substrate primitive

One new export from `@vtt/substrate/client`:

```ts
export function createOptimisticTrait<T extends TraitMeta>(
  entityId: EntityId,
  trait: T,
  options: {
    /**
     * How to persist a write. Called with the next value (already applied
     * to the local store) and must return a CommandInstance that will
     * cause the same trait to land server-side. Typical shape:
     *   write: (next) => SetMyUiState({ entityId, value: next })
     */
    write: (next: TraitValue<T>) => CommandInstance;
    /**
     * Initial value override for first construction. Used only when the
     * trait isn't attached AND the schema has no default. Discipline:
     * UI-state traits should declare a Zod default; `initial` is the
     * escape hatch for context-dependent initial values.
     */
    initial?: TraitValue<T>;
    /**
     * If set, command dispatch is trailing-edge debounced by this many
     * milliseconds. The local store still updates synchronously on every
     * setStore call — only the network write coalesces. Pending dispatch
     * is flushed synchronously on `onCleanup`. Default 0 (dispatch every
     * setter call). Use for high-frequency writes like sliders.
     */
    debounceMs?: number;
  },
): readonly [Store<TraitValue<T>>, SetStoreFunction<TraitValue<T>>];
```

### Constraints

- **One trait, one entity, one call.** The primitive writes `trait` on `entityId`. No multi-trait fanout. Multiple panes editing the same trait each construct their own primitive; reconciliation through `world.subscribe` keeps them in sync.
- **No id allocation in the command.** The command returned by `write` MUST NOT call `world.allocateId()` in its `apply`. This primitive is for writes to an already-existing entity (typically a per-tab sentinel). Predicting server-allocated ids on the client is silently broken under filtered events (CLAUDE.md, "Entity ids are server-authoritative"); a substrate-wide optimistic apply would be required to handle that, and is out of scope here.
- **The trait must declare a Zod default OR the call must pass `initial`.** Otherwise the constructor throws with a clear message. This guarantees the store has a stable, fully-typed shape from first read; consumers never write `store.foo?.bar`.

### Construction

1. Read current value via `readTraitWithDefault(world, entityId, trait)`.
2. If `undefined`, fall through to `options.initial`.
3. If still `undefined`, throw: `createOptimisticTrait: trait <name> has no value on <entityId>, no Zod default, and no initial. Add a .default(...) to the schema or pass initial.`
4. Build `createStore(seed)`. Capture `lastServerValue = seed` in a closure.
5. Subscribe `world.subscribe((id, name) => …)` filtered to this `(entityId, trait.name)`. On every fire, re-read, set `lastServerValue`, call `rawSet(reconcile(newValue))`.
6. `onCleanup` releases the subscription AND flushes any pending debounced dispatch.

### Rollback state machine

Single source of truth: `lastServerValue`, last value seen on `world.subscribe`. The local store is allowed to diverge optimistically; the server reconciles.

| Event                                    | Effect                                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local `setStore(...)`                    | Local store updates immediately. Schedule (or fire, if `debounceMs === 0`) a dispatch of `options.write(unwrap(store))`.                                             |
| Dispatch flush                           | `handle = client.dispatch(cmd)`. Wire `handle.ack.then(ack => ack.ok ? noop : rollback())`. Don't await.                                                             |
| Server event for our `(entityId, trait)` | `lastServerValue = newValue`. `rawSet(reconcile(lastServerValue))`. Idempotent if the new value matches the predicted state.                                         |
| `ack.ok === false`                       | `rawSet(reconcile(lastServerValue))`. The server rejected (or the connection dropped — `reason: "disconnected"` resolves the same way).                              |
| `ack.ok === true`                        | No-op. The corresponding event has already (or will shortly) reconcile.                                                                                              |
| `onCleanup`                              | Cancel the trait subscription. If a debounced dispatch is pending, fire it synchronously (losing the most recent edit on unmount is worse than the round-trip cost). |

Race notes:

- **Server event arrives before ack.** Normal. The event already reconciled the store. A subsequent `ack.ok === true` is a no-op; `ack.ok === false` rolls back to `lastServerValue` (which now equals the server's current value), so it's idempotent.
- **Multiple in-flight writes (no debounce).** Each `setStore` fires its own dispatch. Server applies them in order; events arrive in order; `lastServerValue` advances monotonically. The store only diverges from `lastServerValue` while predictions are in flight.
- **Multiple in-flight writes (with debounce).** Only the most recent value is dispatched on flush. Intermediate values exist locally only — that's the point of debouncing.

### Implementation sketch

```ts
import { createStore, reconcile, unwrap } from "solid-js/store";
import { onCleanup } from "solid-js";

export function createOptimisticTrait<T extends TraitMeta>(
  entityId: EntityId,
  trait: T,
  options: {
    write: (next: TraitValue<T>) => CommandInstance;
    initial?: TraitValue<T>;
    debounceMs?: number;
  },
) {
  const client = useClient();
  const seed =
    (readTraitWithDefault(client.world, entityId, trait) as TraitValue<T> | undefined) ??
    options.initial;
  if (seed === undefined) {
    throw new Error(
      `createOptimisticTrait: trait ${trait.name} has no value on ${entityId}, no Zod default, and no initial. Add a .default(...) to the schema or pass initial.`,
    );
  }
  const [store, rawSet] = createStore<TraitValue<T>>(seed);
  let lastServerValue: TraitValue<T> = seed;

  const off = client.world.subscribe((id, name) => {
    if (id !== entityId || name !== trait.name) return;
    const next = readTraitWithDefault(client.world, entityId, trait) as TraitValue<T> | undefined;
    if (next === undefined) return;
    lastServerValue = next;
    rawSet(reconcile(next));
  });

  let pending: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
    const handle = client.dispatch(options.write(unwrap(store) as TraitValue<T>));
    handle.ack.then((ack) => {
      if (!ack.ok) rawSet(reconcile(lastServerValue));
    });
  };

  const set: SetStoreFunction<TraitValue<T>> = ((...args: unknown[]) => {
    (rawSet as (...a: unknown[]) => void)(...args);
    if ((options.debounceMs ?? 0) <= 0) {
      flush();
    } else {
      if (pending) clearTimeout(pending);
      pending = setTimeout(flush, options.debounceMs);
    }
  }) as SetStoreFunction<TraitValue<T>>;

  onCleanup(() => {
    off();
    if (pending) flush(); // synchronous flush; setTimeout already cleared inside flush
  });

  return [store, set] as const;
}
```

Notes:

- `handle.ack` never rejects (per `client.ts:34`); disconnect resolves to `{ ok: false, reason: "disconnected" }` which goes through the rollback path. No `.catch` needed.
- `reconcile` preserves identity for unchanged subtrees, which keeps `<For>` keys stable across server reconciliation.
- `unwrap` returns a plain JS value for the dispatched payload — the proxy never escapes the store.
- The primitive is opinionated: one trait per call. Multi-trait optimism is a separate primitive if we ever need it.

## How plugins use it

A plugin defines its own UI-state trait once:

```ts
// packages/books/src/shared/ui-state.ts
export const BookUiState = defineTrait({
  name: "@vtt/books/UiState",
  schema: z.object({
    bookDockOpen: z.boolean().default(false),
    bookDockActive: z.string().nullable().default(null),
  }),
});

export const SetBookUiState = defineCommand({
  name: "@vtt/books/SetUiState",
  schema: z.object({ entityId: EntityId, value: BookUiStateSchema }),
  validate: (cmd, { world, session }) => /* owner-only */,
  apply: (cmd, { emit }) => emit(BookUiStateChanged({ entityId: cmd.entityId, value: cmd.value })),
});
```

A universal-mirror system writes the trait on the event:

```ts
defineSystem({
  name: "@vtt/books/MirrorUiState",
  on: BookUiStateChanged,
  run: (event, { world }) => world.set(event.entityId, BookUiState, event.value),
});
```

The view reads/writes via the primitive:

```tsx
function BooksDock(props: { tabSentinelId: EntityId }) {
  const [ui, setUi] = createOptimisticTrait(props.tabSentinelId, BookUiState, {
    write: (value) => SetBookUiState({ entityId: props.tabSentinelId, value }),
  });

  return (
    <DockShell open={ui.bookDockOpen}>
      {/* path-granular read: bookDockActive can change without re-firing the open computation */}
      <Show when={ui.bookDockActive}>{(activeAcc) => <BookView bookId={activeAcc()} />}</Show>
      <button onClick={() => setUi("bookDockOpen", (v) => !v)}>toggle</button>
    </DockShell>
  );
}
```

No `props.uiState`. No `setUiState` ladder. The store is the API.

## Per-tab sentinel entities

Each `(tabId, plugin)` pair gets a sentinel entity. The workbench knows tabs; plugins attach UI traits to the per-tab sentinel for that tab. Two ways to do this; we'll pick one in implementation:

**Option A — workbench spawns one sentinel per tab.** The workbench creates a `TabSentinel { tabId }` entity when a tab opens, despawns when the tab closes. Plugins look up the sentinel by `tabId` and attach their own traits to it. Pros: one entity per tab, all plugins share it; closure semantics are obvious. Cons: workbench has to know about per-tab lifecycle.

**Option B — each plugin spawns its own sentinel per tab.** When a plugin's view first mounts for a given tab, it allocates a sentinel via a command (`EnsureBookUiSentinel({ tabId })`) and stores `entityId` in… nowhere — it derives via `useQuery([BookUiState, TabRef])`. Pros: plugins fully own their lifecycle. Cons: more bookkeeping, and a `TabRef { tabId }` trait reintroduces a workbench coupling.

**Recommendation: Option A.** The workbench already knows tabs exist; spawning one sentinel per tab is a small, symmetric extension. Plugins look up the sentinel via a typed accessor (`useTabSentinel(tabId)`) and attach traits at first write. EntityVisibility scoped to the owning user keeps it private the same way `WorkspaceOwner` already is.

## Migration plan

Five phases. Each phase is independently shippable; tests stay green throughout.

### Phase 1 — substrate primitive

- Add `createOptimisticTrait` to `@vtt/substrate/client`.
- Unit tests in `packages/substrate/src/reactivity.test.tsx` covering every transition in the rollback state machine:
  - Initial read from trait value, from Zod default, from `initial` opt; throws when none.
  - Local `setStore` updates the store synchronously and dispatches the command.
  - Server event reconciles the store; matching server event is an effective no-op against predicted state.
  - Server divergence wins (server event whose value differs from the prediction snaps the store).
  - `ack.ok === false` rolls the store back to `lastServerValue`.
  - Disconnect (`reason: "disconnected"`, `ok: false`) goes through the same rollback path.
  - `debounceMs > 0` coalesces multiple synchronous writes into one dispatch with the latest value.
  - `onCleanup` flushes a pending debounced dispatch synchronously.
  - Race: server event arrives before the corresponding ack — the subsequent `ack.ok === true` is a no-op; `ack.ok === false` rolls back to the (now-current) server value, idempotently.
- One `*.smoke.test.ts` in `packages/server/src/` spinning up a real server + ws client, covering local-set → command-dispatch → server-event → store-converged round-trip with a throwaway test plugin.

No plugin changes; the primitive lands unused.

### Phase 2 — workbench tab sentinels

- Workbench spawns/despawns a `TabSentinel { tabId }` entity on tab open/close.
- New `useTabSentinel(tabId): EntityId` accessor.
- `EntityVisibility{actors:[ownerId]}` mirrors `WorkspaceOwner`.
- `WorkspaceTab.uiState` is **kept** through this phase to allow plugin-by-plugin migration.

### Phase 3 — migrate notes (cleanest target)

- New trait `@vtt/notes/UiState { activePageId, pendingHeadingId }`.
- New command `@vtt/notes/SetUiState`.
- `NoteView` reads/writes via `createOptimisticTrait(useTabSentinel(tabId), NotesUiState, …)`.
- `NotesPageProvider.render()` no longer reads `uiState` / `setUiState` from `PageRenderArgs`.
- Existing scroll/page tests updated to read state via the new trait. `pendingScroll` module signal stays — it's a transient hint, not persistent state.

### Phase 4 — migrate books, scene, pdf-book

Same shape as notes. Each plugin defines a UI trait, a `Set…UiState` command, a mirror system, and converts its views. Specific plugin notes:

- **books** — straightforward. Drops `uiState` plumbing through `BookPage` → `BookBody` → `BooksDock`.
- **scene** — same shape; `ScenePage`/`SceneDock` lose their `uiState` props.
- **pdf-book** — currently uses `sessionStorage` as a side-channel (page, zoom, scroll). Move that into a `@vtt/pdf-book/ReaderState` trait on the per-tab sentinel. Persistence is now uniform with everything else; the `STORAGE_PREFIX` code path is deleted. `urlMemo` stays — the trait change is orthogonal.

### Phase 5 — drop `uiState` from `WorkspaceTab`

- Remove `uiState` from `TabSchema` in `packages/shell-workbench/src/shared/traits.ts`.
- Remove `setUiState` / `uiState` from `PageRenderArgs`.
- Remove `SetTabUiState` command.
- Update workbench tests; the schemaVersion stays at 1 (pre-launch, no compat shim per CLAUDE.md).

## Tests required

Per CLAUDE.md, every change ships with tests. For this proposal specifically:

- **Substrate unit tests** for `createOptimisticTrait` — every state transition above.
- **Per-plugin unit tests** for the `Set…UiState` commands (given/when/then) and mirror systems.
- **jsdom component tests** with the canonical harness verifying:
  - Path-granular read: a sibling field changing does NOT cause the test view to re-render. Use a render-counting child.
  - Cross-plugin isolation: with `buildTestClient({ plugins: [notes, pdfBook] })`, change the notes UI state and assert the PDF view's render count is unchanged.
  - Optimistic apply: the local store updates synchronously on `setStore`, before the server event arrives.
  - Server rejection rollback: a rejected command snaps the store back.
- **Smoke tests** stay roughly the same — wire format hasn't changed for any plugin, just the trait names.

The cross-plugin isolation test is the _defining_ test for this proposal. If it can fail, we've reverted.

## Anti-patterns this proposal makes loud

In addition to the existing list in CLAUDE.md:

- **Storing a plugin's UI state in another plugin's trait.** Each plugin owns its own UI trait; the workbench's trait is layout only.
- **Passing UI state down through component props.** Read it from the trait via `createOptimisticTrait` at the point of use. There is no provider-level prop drilling for state.
- **Reaching for `sessionStorage`/`localStorage` for state that should round-trip through commands.** Use a trait + `createOptimisticTrait`. `sessionStorage` is for browser-platform fallbacks (e.g. theme during initial paint), not domain state.
- **Calling a setter accessor from a parent component when the child can read the trait directly.** Optimism + path-granular reads make almost all UI-state prop drilling unnecessary; if you're tempted to add a `set…` callback to props, you probably want the child to mount its own `createOptimisticTrait`.

## Resolved design questions

- **Defaults when the trait isn't attached** → **throw at construction.** The primitive falls through `world.get` → schema default → `initial` → throw with a clear message. Discipline: every UI-state trait declares a Zod default; `initial` is the escape hatch for context-dependent values. Stable, fully-typed shape from first read; consumers never write `store.foo?.bar`.
- **Coalescing high-frequency writes** → **opt-in `debounceMs`.** Default 0 (dispatch every setter call), so taps and toggles round-trip immediately and there is no surprise behavior. When set, the local store still updates synchronously on every `setStore` call — only the dispatch debounces, trailing-edge, with a synchronous flush on `onCleanup`. The thing we want to coalesce is the network write, not the visual feedback.
- **Server-allocated ids** → **out of scope; documented constraint.** This primitive writes one trait on one already-existing entity (per-tab sentinel). The command's `apply` MUST NOT call `world.allocateId()`. Predicting server-allocated ids on the client is silently broken under filtered events; that's a substrate-wide optimistic-apply concern, not this primitive's. The constraint is documented on the primitive's contract; runtime detection is not feasible without introspecting `apply` bodies.
- **Rollback mechanics with async ack** → **server events always win, ack rejection rolls back to `lastServerValue`.** `client.dispatch()` is asynchronous (`handle.ack: Promise<DispatchAck>`, never rejects, disconnect resolves to `{ ok: false, reason: "disconnected" }`). The primitive does not await; it wires `handle.ack.then` to roll back on `!ok`. Server events that arrive before or after the ack reconcile via the trait subscription path; idempotent under all orderings.

## When in doubt

Find the closest existing exemplar:

- For the primitive: `useTrait` in `packages/substrate/src/reactivity.tsx`.
- For a per-plugin trait: `WorkspaceState` in `packages/shell-workbench/src/shared/traits.ts`.
- For a sentinel pattern: `WorkspaceOwner` in the same file.
- For the optimism shape: every UI library doing local-first sync (Linear, Replicache) uses last-write-wins reconciliation against a server canonical value. The version here is the minimum that suits a single-trait scope.
