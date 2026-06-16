---
name: solid-effects
description: "Use this skill when running side effects in Solid (SolidJS): logging, DOM manipulation, network requests, subscriptions, intervals, anything triggered by reactive state changes. Covers `createEffect` (re-runs whenever a tracked signal changes), `onMount` (one-time setup after mount, never re-runs), `onCleanup` (runs when the owner is disposed — component unmount, effect re-run, root dispose), automatic batching of writes inside effects, nested effects (each has its own dependency tree), why writing to signals from inside an effect is usually wrong (use a memo instead), and effect ordering. Triggers on: createEffect, onMount, onCleanup, side effect, lifecycle, useEffect equivalent, cleanup, subscribe, interval, timer, dispose, unmount."
license: MIT
---

Effects are how you connect Solid's reactive system to the outside world: write to the DOM imperatively, log things, fire network requests, set timers, subscribe to external sources. They run after the surrounding component has mounted and re-run whenever the signals they read change.

## Import

```ts
import { createEffect, onMount, onCleanup } from "solid-js";
```

## `createEffect` — runs initially and on every dependency change

```ts
function createEffect<T>(fn: (prev?: T) => T, value?: T, options?: EffectOptions): void;
```

```tsx
const [count, setCount] = createSignal(0);

createEffect(() => {
  console.log("count is", count());
});
// logs "count is 0" immediately
setCount(1);
// logs "count is 1"
```

### Key facts

- The first run happens **after** the component renders (post-paint, in the next microtask). For pre-paint behaviour use `createRenderEffect` (see `solid-secondary-primitives`).
- Solid auto-tracks dependencies — anything that calls a signal getter inside the effect's body becomes a dependency.
- Multiple signals → effect re-runs when **any** of them changes.
- Effect order is **not guaranteed** between sibling effects.
- The callback can return a value, which is passed in as `prev` on the next run. Useful when the new value depends on what the effect saw last time.

```tsx
createEffect<number>((prev = 0) => {
  const c = count();
  console.log("count went from", prev, "to", c);
  return c;
});
```

### Don't write signals inside effects (usually)

Writing to a signal inside an effect is allowed, but it almost always means you wanted a `createMemo` instead.

```tsx
// ❌ usually wrong
createEffect(() => {
  setDoubled(count() * 2);
});

// ✓ better
const doubled = createMemo(() => count() * 2);
```

The exceptions: synchronizing two independent signals (rare) and reactive-async patterns where you can't use a resource. If you do write inside an effect, the writes are **batched automatically** — downstream effects see the final value once.

## `onMount` — one-time post-mount callback

```ts
function onMount(fn: () => void): void;
```

```tsx
onMount(async () => {
  const data = await fetch("/api/data").then((r) => r.json());
  setData(data);
});
```

`onMount` is sugar for `createEffect(() => untrack(fn))` — it runs the callback once after the component mounts and tracks no dependencies. Use when:

- You want to do something exactly once when a component appears.
- You're running async setup whose result you'll dump into a signal.
- You need DOM access through `ref` (refs are populated before `onMount` runs).

`onMount` does **not** run during SSR — it's client-only. For data fetching during SSR use `createResource`.

## `onCleanup` — runs when the owner disposes

```ts
function onCleanup(fn: () => void): void;
```

`onCleanup` schedules a function to run when the surrounding reactive owner is disposed. The owner is:

- The component → cleanup runs when the component unmounts.
- The current `createEffect` run → cleanup runs when the effect re-runs (before the new run) **and** when the effect is finally disposed.
- The current `createRoot` → cleanup runs when `dispose()` is called.

```tsx
function Clock() {
  const [time, setTime] = createSignal(new Date());
  const id = setInterval(() => setTime(new Date()), 1000);
  onCleanup(() => clearInterval(id));
  return <span>{time().toLocaleTimeString()}</span>;
}
```

### `onCleanup` inside an effect — important pattern

When you call `onCleanup` _inside_ `createEffect`, the cleanup runs **before each re-run** of that effect, not just on dispose. This is exactly how you write a "subscribe to thing X, unsubscribe on next change":

```tsx
createEffect(() => {
  const id = userId();
  const sub = subscribeToUser(id, (payload) => setUser(payload));
  onCleanup(() => sub.unsubscribe());
});
```

Each time `userId()` changes: the previous subscription cleans up, then the effect re-runs and creates a new subscription.

## Lifecycle ordering

For a single component mount:

1. Component function runs (synchronously).
2. JSX is created. Refs are populated.
3. Component is mounted into the DOM.
4. `createRenderEffect` callbacks fire (synchronously, pre-paint).
5. `onMount` and `createEffect` callbacks fire (after the next microtask, post-paint).

For an unmount:

1. All `onCleanup` callbacks registered during the component's lifetime fire (children-first).

## Nested effects

You can put a `createEffect` inside another `createEffect`. Each effect tracks **only the signals it reads**, not its parent's signals. The inner effect is owned by the outer effect, so when the outer re-runs, the inner is disposed and recreated.

```tsx
createEffect(() => {
  console.log("outer");
  createEffect(() => {
    console.log("inner sees count =", count());
  });
});
```

A common refinement is to lift the inner effect into a separate function or `untrack` part of the outer.

## Effect options

```ts
interface EffectOptions {
  name?: string; // dev-tool label
}
```

The `value` parameter to `createEffect(fn, value)` is the seed value passed to `prev` on the first run.

## Common patterns

### Sync external state

```tsx
createEffect(() => {
  document.title = `${count()} unread`;
});
```

### Subscribe to events

```tsx
onMount(() => {
  const handler = (e: MouseEvent) => setMouseX(e.clientX);
  window.addEventListener("mousemove", handler);
  onCleanup(() => window.removeEventListener("mousemove", handler));
});
```

### Persist to localStorage

```tsx
const [theme, setTheme] = createSignal(localStorage.getItem("theme") ?? "light");
createEffect(() => {
  localStorage.setItem("theme", theme());
});
```

### Run an effect _only_ on changes (skip the initial)

Use `on` with `defer: true`:

```tsx
import { createEffect, on } from "solid-js";

createEffect(
  on(
    count,
    (c) => {
      console.log("count changed to", c);
    },
    { defer: true },
  ),
);
```

See `solid-reactive-utilities` for `on`.

## Common pitfalls

- **Calling the signal _outside_ the effect's callback.** `createEffect(count())` is broken — you call `count()` once, get the value, and pass it. The effect body is empty. It must be `createEffect(() => count())`.
- **Reading a signal in `console.log` at the top of a component.** That fires once at mount. To watch it, put the read in `createEffect`.
- **Adding cleanup outside an owner.** `onCleanup` only works inside an effect, root, or component body. Outside any of those it's a no-op (and may warn).
- **Closing over `props.foo` or destructured values.** The same destructure-breaks-reactivity rule applies inside effects. Read `props.foo` _inside_ the effect, not above.
- **Effects that infinitely loop.** Writing to a signal you also read in the same effect re-fires it. Use a memo or carefully untrack.

## Server vs client

`createEffect` and `onMount` only run on the client. During SSR (`renderToString*`) they are skipped. `onCleanup` runs on the client during teardown; during SSR it doesn't run because nothing is teardown.

For "I need this to run during SSR too" use `createRenderEffect` _or_ perform the work inline in the component body. For "I need data on first render including SSR" use `createResource`.

## Related

- `solid-signals` — the reads that drive effects.
- `solid-memos` — for derived values, prefer to writing signals in effects.
- `solid-secondary-primitives` — `createComputed`, `createRenderEffect`, `createReaction`.
- `solid-reactive-utilities` — `batch`, `untrack`, `on`.
