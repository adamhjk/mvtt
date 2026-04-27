---
name: solid-reactive-utilities
description: "Use this skill for the supporting cast of Solid (SolidJS) reactive primitives — the helpers around `createSignal`/`createEffect`/`createMemo` that solve specific control-flow needs. Covers `batch` (group multiple writes into one notification), `untrack` (read without subscribing), `on(deps, fn, { defer })` (explicit dependency declaration with optional defer-first-run), `observable`/`from` (RxJS interop), `createRoot(dispose => ...)` (manual ownership for detached computations), `getOwner`/`runWithOwner` (capture/restore the owner across async hops), `mapArray`/`indexArray` (the primitives behind `<For>`/`<Index>`), `startTransition`/`useTransition` (mark updates as deferred to allow concurrent rendering), `catchError` (programmatic error catching outside `<ErrorBoundary>`), and `mergeProps`/`splitProps`/`children` (props utilities — fully covered in `solid-props`, summarized here for completeness). Triggers on: batch, untrack, on, defer, observable, from, createRoot, getOwner, runWithOwner, ownership, mapArray, indexArray, startTransition, useTransition, catchError, transition, owner."
license: MIT
---

These are the day-to-day helpers around Solid's three core primitives. Most apps need a handful of them; you'll reach for the rest only in advanced scenarios.

## Imports

```ts
import {
  batch, untrack, on,
  observable, from,
  createRoot, getOwner, runWithOwner,
  mapArray, indexArray,
  startTransition, useTransition,
  catchError,
  mergeProps, splitProps, children,
} from "solid-js";
```

## `batch` — group writes

```ts
function batch<T>(fn: () => T): T;
```

Writes inside `batch(...)` notify subscribers exactly once after the function returns. Outside `batch`, every write notifies separately.

```ts
const [a, setA] = createSignal(0);
const [b, setB] = createSignal(0);
const sum = createMemo(() => a() + b());
createEffect(() => console.log(sum()));   // logs 0

setA(1);   // logs 1
setB(2);   // logs 3

batch(() => {
  setA(10);
  setB(20);
});      // logs 30 (one notification)
```

Effects already batch automatically — you only need `batch` from event handlers and async code that writes multiple signals.

If you read a stale memo inside a batch, Solid evaluates it on demand:

```ts
batch(() => {
  setA(5);
  console.log(sum());   // evaluates with a=5, b=2, even though b hasn't been set yet
  setB(50);
});
```

Async caveat: only writes **before the first `await`** are in the batch.

## `untrack` — read without subscribing

```ts
function untrack<T>(fn: () => T): T;
```

```ts
createEffect(() => {
  const a = trackedSignal();
  const b = untrack(() => other());     // does NOT subscribe to `other`
  doSomething(a, b);
});
```

Use to read a signal whose changes shouldn't re-fire the surrounding computation.

`untrack` does NOT change the owner — only the tracking. For both, use `runWithOwner`.

## `on` — explicit dependencies

```ts
function on<T>(
  deps: () => T | Array<() => any>,
  fn: (input: T, prev: T, prevValue?: U) => U,
  options?: { defer?: boolean },
): (prevValue?: U) => U;
```

Writes the dependency declaration explicitly; the body of `fn` runs with everything else untracked.

```ts
createEffect(on(count, c => {
  console.log("count is", c, "and other is", other());
  // `other` is read but does NOT subscribe
}));

// Multi-dep:
createEffect(on([count, name], ([c, n]) => { ... }));

// Skip the initial run — only fire on subsequent changes:
createEffect(on(count, c => { ... }, { defer: true }));
```

`on` is preferable to `untrack` when you want a clean separation of "what to watch" from "what to do".

### `on` with stores

`on(state.x, ...)` evaluates `state.x` once and watches that value. Almost always wrong. Use an arrow:

```ts
createEffect(on(() => state.x, v => console.log(v)));
```

## `observable` and `from` — RxJS interop

```ts
function observable<T>(input: () => T): { subscribe(fn: (value: T) => void): { unsubscribe(): void } };
function from<T>(producer: { subscribe(...): { unsubscribe(): void } }): Accessor<T>;
```

```ts
// Convert a signal-like getter to an Observable.
const obs = observable(count);
obs.subscribe(c => console.log(c));

// Convert an Observable (or anything with `.subscribe`) to a signal.
const value = from(rxjsObservable);
return <p>{value()}</p>;
```

Useful for bridging to RxJS, Apollo, or any external "subscription with cleanup" API.

## `createRoot` — detached ownership

```ts
function createRoot<T>(fn: (dispose: () => void) => T, detachedOwner?: Owner): T;
```

Create a reactive computation that lives outside of any component. Effects/memos created inside live until `dispose()` is called.

```ts
const dispose = createRoot(d => {
  const [count, setCount] = createSignal(0);
  createEffect(() => console.log(count()));
  setInterval(() => setCount(c => c + 1), 1000);
  return d;
});

// Later, to clean up:
dispose();
```

Use cases:
- Tests that need to set up reactive state outside of a `render()`.
- Long-lived background work in modules.
- Custom abstractions that own their own owner tree.

If you create signals/effects without an owner (no component, no `createRoot`), Solid warns about a leak.

## `getOwner` and `runWithOwner` — restore ownership across async

```ts
function getOwner(): Owner | null;
function runWithOwner<T>(owner: Owner | null, fn: () => T): T;
```

After `await` (or in `setTimeout`, custom callbacks), the current owner is gone. Effects/cleanups created in those callbacks have no owner. Capture and restore:

```ts
async function doStuff() {
  const owner = getOwner();
  const data = await fetchData();
  runWithOwner(owner, () => {
    onCleanup(() => abortController.abort());   // now properly tied to the original component
  });
}
```

Most code doesn't need this — but it shows up in custom directives, custom hooks, and library code.

## `mapArray` and `indexArray` — what `<For>`/`<Index>` use

```ts
function mapArray<T, U>(list: () => T[], mapFn: (v: T, i: Accessor<number>) => U): () => U[];
function indexArray<T, U>(list: () => T[], mapFn: (v: Accessor<T>, i: number) => U): () => U[];
```

The non-component versions of `<For>` and `<Index>`. Use when you need a derived array (not for rendering):

```ts
const sortedRows = mapArray(() => rows(), (row) => row);
const cellSignals = indexArray(() => cells(), (cell) => cell);
```

Most apps don't reach for these — `<For>`/`<Index>` cover rendering. But these primitives let you build custom keyed structures.

## `startTransition` and `useTransition` — deferred updates

```ts
function startTransition(fn: () => void): Promise<void>;
function useTransition(): [Accessor<boolean>, (fn: () => void) => Promise<void>];
```

Mark updates as low-priority. While the transition is pending, the previous UI keeps showing; the new state appears once transition work completes. Resources within a transition can suspend without flashing the suspense fallback.

```tsx
const [pending, start] = useTransition();

return (
  <>
    <input onInput={(e) => start(() => setQuery(e.currentTarget.value))} />
    {pending() && <span>Loading...</span>}
    <Results query={query()} />
  </>
);
```

`startTransition` is the imperative equivalent (no `pending` accessor).

Use cases:
- Search-as-you-type: don't show a loading flash on every keystroke.
- Tab/route switches that involve async fetches.
- Keeping the previous list visible while filters update.

## `catchError` — catch errors imperatively

```ts
function catchError<T>(fn: () => T, handler: (err: unknown) => void): T;
```

Like `<ErrorBoundary>`, but inline:

```ts
const value = catchError(
  () => somethingThatMightThrow(),
  (err) => { console.error(err); reportError(err); },
);
```

Useful in code that runs outside JSX rendering (event handlers, async callbacks).

## `mergeProps` / `splitProps` / `children`

These are fully covered in `solid-props`. Quick reference:

- `mergeProps(...objects)` — merge props with reactivity preserved (defaults pattern).
- `splitProps(props, ...keyArrays)` — split a props proxy into reactive subsets.
- `children(() => props.children)` — resolve `props.children` exactly once into a stable accessor.

## Common pitfalls

- **`batch` outside an event handler.** Effects already batch — calling `batch` inside one is redundant.
- **`untrack` to "fix" a missing dependency.** If you wrote `untrack(...)` and now your effect doesn't fire when the signal changes, that was the goal. If it should fire, drop the `untrack`.
- **`on(state.x, ...)`.** Watches the value at definition, not a path. Use `on(() => state.x, ...)`.
- **Effects in callbacks without owner.** Capture `getOwner()` before the await or callback, then `runWithOwner`.
- **`createRoot` without `dispose()`.** Leak. Always call `dispose()` when the work is done.
- **Forgetting `startTransition` returns a Promise.** Awaitable — handy for sequencing.

## Examples

### Bulk update inside an event handler

```tsx
const onSubmit = () => {
  batch(() => {
    setSubmitting(true);
    setErrors({});
    setLastSavedAt(Date.now());
  });
};
```

### Run an effect only on signal changes (skip initial)

```ts
createEffect(on(query, q => fetchAnalytics(q), { defer: true }));
```

### Subscribe to RxJS in a component

```ts
const message = from(websocketObservable);
return <p>{message()}</p>;
```

### Custom hook that needs owner-aware async

```ts
export function useFetcher<T>(fn: () => Promise<T>) {
  const owner = getOwner();
  const [value, setValue] = createSignal<T>();
  fn().then(v => runWithOwner(owner, () => setValue(() => v)));
  return value;
}
```

### Pending UI for slow filter

```tsx
const [pending, start] = useTransition();
const [filter, setFilter] = createSignal("");

return (
  <>
    <input onInput={e => start(() => setFilter(e.currentTarget.value))} />
    <span>{pending() ? "..." : ""}</span>
    <FilteredList filter={filter()} />
  </>
);
```

## Related

- `solid-signals`, `solid-effects`, `solid-memos` — what these utilities support.
- `solid-secondary-primitives` — `createComputed`/`createReaction`/`createDeferred` for advanced flows.
- `solid-control-flow` — `<For>`/`<Index>` use `mapArray`/`indexArray` under the hood.
- `solid-props` — `mergeProps`, `splitProps`, `children` in detail.
