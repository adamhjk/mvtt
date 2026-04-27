---
name: solid-memos
description: "Use this skill when caching a derived/computed value in Solid (SolidJS) with `createMemo`. Covers the difference between a plain derived function (recomputes on every read) and a memo (caches and only recomputes when dependencies change), the `equals` option (default `===`, `false` to always notify, custom comparator), the `value` parameter for the initial `prev`, accessing the previous value (`(prev) => ...`), the `name` debug option, and the decision rule: prefer plain `() => derive()` and only reach for `createMemo` when the computation is expensive, when many places will read it, or when you need custom equality. Triggers on: createMemo, memo, derived value, computed, cache, memoize, equals, custom equality."
license: MIT
---

`createMemo` creates a read-only signal whose value is computed from other reactive values, cached, and only recomputed when its dependencies change. Downstream readers are notified only when the memoized result actually changes (per the `equals` option).

## Import

```ts
import { createMemo } from "solid-js";
```

## Shape

```ts
function createMemo<T>(
  fn: (prev: T) => T,
  value?: T,
  options?: { equals?: false | ((prev: T, next: T) => boolean); name?: string },
): () => T;
```

The return is an `Accessor<T>` — a function you call to read.

## Basic use

```tsx
const [first, setFirst] = createSignal("Ada");
const [last, setLast] = createSignal("Lovelace");

const fullName = createMemo(() => `${first()} ${last()}`);

return <p>{fullName()}</p>;
```

`fullName()` runs once at creation, caches `"Ada Lovelace"`, and only recomputes when `first()` or `last()` changes. Readers (the JSX expression here) only re-run when `fullName()`'s string actually differs.

## When to use a memo vs a plain function

Solid is fast enough that a plain derived function is usually fine:

```ts
const fullName = () => `${first()} ${last()}`;
```

This is **already reactive** — anywhere you call `fullName()` inside a tracking scope, you subscribe to `first` and `last`. The downside is recomputation on every read.

Reach for `createMemo` when one or more of these is true:

- The computation is **expensive** (sorting, filtering large arrays, heavy parsing).
- **Multiple downstream readers** — without a memo, each reader recomputes independently. With a memo, the work happens once and is shared.
- You want **custom equality** — e.g. you compute a `Date` object whose reference changes but whose `getTime()` doesn't.
- You want to **suppress downstream notifications** when the result is unchanged. (Plain functions notify subscribers any time an upstream signal changes, regardless of whether the derived value did.)

## The `equals` option

Default: strict equality (`===`). The memo only notifies subscribers if the new value is `!==` the previous one.

```ts
// Always notify, even if value is identical.
const m = createMemo(() => expensive(input()), undefined, { equals: false });

// Custom comparator.
const dateMemo = createMemo(() => new Date(dateString()), undefined, {
  equals: (prev, next) => prev.getTime() === next.getTime(),
});
```

In the second example, two different `Date` objects with the same time are treated as equal, so subscribers don't re-run.

## Accessing the previous value

The memo callback receives the previous return value. The optional `value` parameter to `createMemo(fn, value)` is the seed.

```ts
const trend = createMemo<{ value: number; label: string }>(
  prev => {
    const v = count();
    if (v === prev.value) return { value: v, label: "Same" };
    return { value: v, label: v > prev.value ? "Up" : "Down" };
  },
  { value: 0, label: "Same" },
);
```

## Memos in JSX

A memo is just an accessor — call it like any signal:

```tsx
return <p>You picked {count()}, doubled = {doubled()}</p>;
```

## Chained memos

Memos can read other memos. Each is a node in the dependency graph; updates flow through.

```ts
const items = createMemo(() => fetchedItems().filter(i => i.active));
const itemCount = createMemo(() => items().length);
```

When `fetchedItems()` changes, `items` recomputes. If its result `=== prev`, `itemCount` doesn't recompute. If different, `itemCount` recomputes; if **its** length is the same, downstream readers don't re-run. This is fine-grained caching.

## Reading without subscribing

Use `untrack` inside the memo to read a signal without making it a dependency:

```ts
const m = createMemo(() => {
  return important() + untrack(() => debugFlag() ? 1 : 0);
});
// m only recomputes when `important` changes, not when `debugFlag` changes.
```

See `solid-reactive-utilities`.

## Typing

```ts
const a = createMemo(() => 1 + 2);                 // Accessor<number>
const b = createMemo<string>(() => `${count()}`);  // Accessor<string> (explicit)
```

When using the previous-value form with no seed, the first call's `prev` is `undefined`:

```ts
const c = createMemo<number | undefined>(prev => (prev ?? 0) + 1);
```

## Common pitfalls

- **Memoizing pure constants.** A memo that doesn't read any signals is just a constant — drop the memo.
- **Reading `props.foo` outside the memo body.** Like effects, you must read inside the callback for the memo to be reactive on it.
- **Setting signals inside a memo.** Don't. A memo's job is to compute and cache — not to cause side effects. Use `createEffect` or `createComputed` if you really need it.
- **Reaching for memo "just in case".** Premature memoization adds overhead for small computations. Default to plain derived functions and promote to memo when profiling shows a hotspot.

## Examples

### Filter list

```tsx
const [query, setQuery] = createSignal("");
const filtered = createMemo(() =>
  items().filter(i => i.name.toLowerCase().includes(query().toLowerCase())),
);

return (
  <>
    <input onInput={e => setQuery(e.currentTarget.value)} />
    <For each={filtered()}>{item => <li>{item.name}</li>}</For>
  </>
);
```

### Custom equality on a derived array

```ts
const ids = createMemo(() => items().map(i => i.id), undefined, {
  equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]),
});
```

Now `ids()` only fires downstream when the **set of ids** changes, not when individual items mutate.

### Sharing expensive work

```tsx
const sorted = createMemo(() => bigList().slice().sort(byPriority));

// All three readers share the single sort.
return (
  <>
    <Top10 list={sorted()} />
    <Bottom10 list={sorted()} />
    <Average list={sorted()} />
  </>
);
```

## Related

- `solid-signals` — the upstream sources memos read.
- `solid-effects` — for side effects, not for caching.
- `solid-secondary-primitives` — `createSelector` for keyed equality, `createDeferred` for debounced derived values.
- `solid-reactive-utilities` — `untrack`, `on`.
