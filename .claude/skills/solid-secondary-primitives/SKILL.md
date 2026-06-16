---
name: solid-secondary-primitives
description: "Use this skill when the everyday `createSignal`/`createEffect`/`createMemo` aren't quite right and you need one of Solid (SolidJS)'s lower-level primitives. Covers `createComputed` (synchronous, runs immediately, runs *during* the parent's update phase — used for upstream reactive setup; rarely needed in app code), `createRenderEffect` (synchronous, tied to the render phase, used for refs and directives where DOM writes must happen before commit), `createReaction` (returns a `track(fn)` you call once to subscribe; the reaction fires the *next* time any dependency changes; useful for one-shot or manually re-armed observation), `createDeferred` (debounce-style derived signal that updates during browser idle time, with optional `timeoutMs`), and `createSelector` (a memoized equality predicate; given a key signal it returns `(value) => boolean` that only re-runs the consumers whose key matches/unmatches — efficient for highlighting selected items in large lists). Triggers on: createComputed, createRenderEffect, createReaction, createDeferred, createSelector, secondary primitives, render effect, synchronous effect, debounced derived, idle, key selector, selected item highlight."
license: MIT
---

`createSignal`/`createEffect`/`createMemo` cover ~95% of needs. The five primitives here are for the rest — synchronous flows, controlled observation, debouncing, large-list selection.

## Imports

```ts
import {
  createComputed,
  createRenderEffect,
  createReaction,
  createDeferred,
  createSelector,
} from "solid-js";
```

## `createComputed` — synchronous effect

```ts
function createComputed<T>(fn: (prev: T) => T, value?: T, options?: { name?: string }): void;
```

Like `createEffect`, but runs **synchronously** when its dependencies change, during the same update flush. It runs **before** `createEffect` and `createRenderEffect`.

When to use:

- Setting up a synchronous reactive chain that downstream effects depend on.
- Library/framework code that needs upstream-aware setup before render.

When **not** to use:

- App-level side effects. Use `createEffect`.
- Caching a value. Use `createMemo`.
- DOM writes timed to render. Use `createRenderEffect`.

```ts
createComputed(() => {
  // runs immediately and on every dep change, synchronously
  someLibrary.update(input());
});
```

In day-to-day Solid code you rarely write `createComputed`. If you find yourself reaching for it, double-check whether `createMemo` or `createEffect` would be better.

## `createRenderEffect` — DOM-timed effect

```ts
function createRenderEffect<T>(fn: (prev: T) => T, value?: T, options?: { name?: string }): void;
```

Runs synchronously, **after** `createComputed`s and **before** the DOM is committed. Use this when you need to write DOM _during_ the render phase — typically refs and directives.

The classic use is in custom directives:

```ts
function model(el: HTMLInputElement, accessor: () => Signal<string>) {
  const [v, setV] = accessor();
  createRenderEffect(() => (el.value = v())); // writes el.value before commit
  el.addEventListener("input", (e) => setV((e.target as HTMLInputElement).value));
}
```

Or for setting properties on an element when a reactive value changes — without the post-paint delay of `createEffect`.

App code rarely uses `createRenderEffect` directly; library and directive code reaches for it.

## `createReaction` — manual one-shot

```ts
function createReaction(fn: () => void): (track: () => void) => void;
```

Returns a `track` function. The first time you call `track(() => ...)`, the inner reads are subscribed. The next time any of those signals changes, `fn` runs **once**. Then the reaction is disarmed — call `track` again to re-arm.

```ts
const [count, setCount] = createSignal(0);

const track = createReaction(() => {
  console.log("count moved");
});

track(() => count()); // subscribes to count
setCount(1); // logs "count moved" — and reaction stops listening.
setCount(2); // nothing logged.
track(() => count()); // re-armed
setCount(3); // logs "count moved" again.
```

Use cases:

- "Dirty" tracking — fire once when a form field changes from its initial value.
- Reactive subscriptions that should re-arm on demand.
- Custom observation primitives.

## `createDeferred` — idle-time derived

```ts
function createDeferred<T>(
  source: () => T,
  options?: { equals?: false | ((a: T, b: T) => boolean); name?: string; timeoutMs?: number },
): () => T;
```

Returns a derived signal that mirrors `source` — but updates during the browser's idle time (via `requestIdleCallback`), or after `timeoutMs` if provided. Useful for de-prioritizing expensive UI updates that don't need to happen on the same frame.

```ts
const [query, setQuery] = createSignal("");
const deferredQuery = createDeferred(query, { timeoutMs: 250 });

const [results] = createResource(deferredQuery, fetchResults);
```

Now `setQuery("a")` from a keystroke doesn't trigger an immediate fetch; the resource source only changes when the browser is idle (or 250ms have passed). Acts like a built-in debounce that adapts to system load.

## `createSelector` — efficient equality across many readers

```ts
function createSelector<T, U>(
  source: () => T,
  equals?: (a: U, b: T) => boolean,
): (value: U) => boolean;
```

Returns a function that takes a value and returns `true` iff it equals the source.

The point: when you have a selected-item-id signal and a list of items, the naive way is:

```tsx
<For each={items()}>{(item) => <Row selected={item.id === selectedId()} />}</For>
```

Every time `selectedId()` changes, **every row** re-evaluates `item.id === selectedId()`. With many rows, that's wasteful — only two rows actually changed (the previously selected and the newly selected).

`createSelector` solves this:

```tsx
const isSelected = createSelector(selectedId);

<For each={items()}>{(item) => <Row selected={isSelected(item.id)} />}</For>;
```

Now only the two affected rows recompute when `selectedId` changes. The selector internally memoizes, comparing the new and old source value and only notifying the consumer whose passed-in value matched/unmatched the change.

Custom equality:

```ts
const isCurrent = createSelector(currentVersion, (a, b) => a === b);
```

The first argument to the selector function (call site) is your value; the second arg of `equals` is the source value (it's flipped from what you might expect — see the docs).

## Effect-ordering reference

Within a single update flush:

1. `createComputed` runs (synchronously, in order of registration).
2. `createRenderEffect` runs (synchronously).
3. DOM is committed.
4. `createEffect` and `onMount` run (after the next microtask).
5. (Browser paints.)
6. `createDeferred` re-evaluations happen at idle.

This is rarely visible to app code, but it explains the differences between the primitives.

## Common pitfalls

- **`createComputed` for app-level effects.** Use `createEffect`. Computed primarily exists for library authors building reactive chains.
- **`createRenderEffect` for non-DOM work.** It's specifically for "I need to write the DOM before commit". Otherwise use `createEffect`.
- **`createDeferred` instead of resource debouncing.** `createDeferred` defers everywhere the result is read; if you only want to delay a fetch, debouncing the source is more targeted.
- **`createSelector` for tiny lists.** Adds overhead. For lists under, say, 50 items, the plain `===` is fine.
- **`createReaction` track called outside its own block.** The track must be invoked to subscribe; it's not auto-tracked.

## Examples

### Custom directive with `createRenderEffect`

```ts
function autoSize(el: HTMLTextAreaElement, accessor: () => string) {
  createRenderEffect(() => {
    el.value = accessor();
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  });
}
```

### Dirty tracking

```ts
const [original] = createSignal(loadInitial());
const [draft, setDraft] = createSignal(original());

const [dirty, setDirty] = createSignal(false);
const track = createReaction(() => setDirty(true));
track(() => draft()); // arm
// after first change to draft, dirty becomes true.
```

### Idle-deferred large render

```ts
const [filter, setFilter] = createSignal("");
const deferredFilter = createDeferred(filter);

return <BigList filter={deferredFilter()} />;
```

### Selected item highlight

```tsx
const isSelected = createSelector(selectedId);

<For each={items()}>
  {(item) => <li classList={{ selected: isSelected(item.id) }}>{item.label}</li>}
</For>;
```

## Related

- `solid-signals`, `solid-effects`, `solid-memos` — when these everyday primitives suffice.
- `solid-refs` — `createRenderEffect` is commonly used in directives.
- `solid-reactive-utilities` — `batch`, `untrack`, `on`, `startTransition` for related concerns.
