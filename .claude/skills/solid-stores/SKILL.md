---
name: solid-stores
description: "Use this skill when modeling nested reactive state in Solid (SolidJS) — anything more complex than a flat primitive. Covers `createStore` (proxy-based, fine-grained per-property reactivity, lazy signal creation), the **path syntax** for setters: `setStore(key, value)` for top-level, `setStore(key, subkey, value)` for nested, `setStore(key, [a, b, c], 'field', v)` for multi-index, `setStore(key, { from, to, by }, 'field', v)` for ranges, `setStore(key, predicate, 'field', v)` for filter functions, plus shallow-merge semantics when the new value is an object. `produce` for Immer-style mutable drafts (objects/arrays only), `reconcile` for diff-and-update from a fetched snapshot, `unwrap` for non-reactive access, `createMutable` (proxy-based, mutate directly — convenient but harder to debug), `modifyMutable`. Decision rule: signal for primitives or whole-replace; store for nested reactive trees. Triggers on: createStore, store, produce, reconcile, unwrap, createMutable, modifyMutable, path syntax, nested state, multi-index, range update, filter update, shallow merge."
license: MIT
---

Stores are Solid's primitive for **nested reactive state**. Each property access is a reactive read; each setter call sends fine-grained updates to only the subscribers of changed paths. Use them when a signal would force you to write `setX({ ...x, a: { ...x.a, b: 1 } })`.

## Import

```ts
import { createStore, produce, reconcile, unwrap, createMutable, modifyMutable } from "solid-js/store";
```

## `createStore`

```ts
function createStore<T extends object>(state: T, options?): [Store<T>, SetStoreFunction<T>];
```

```tsx
const [state, setState] = createStore({
  user: { name: "Ada", age: 36 },
  items: [{ id: 1, done: false }, { id: 2, done: true }],
});
```

`state` is a JavaScript proxy. Reading `state.user.name` inside a tracking scope subscribes to that exact path. The signal infrastructure is created **lazily** the first time a path is read.

### Reading

You read store values directly — no `()` like signals:

```tsx
return <p>Hello {state.user.name}</p>;        // reactive
console.log(state.items[0].done);             // outside tracking — snapshot only
```

Inside `createEffect`, `createMemo`, JSX, or any tracking scope, the read subscribes. Outside, it doesn't.

### Writing — path syntax

The setter takes a **path** followed by the new value (or an updater).

```ts
// Top-level
setState({ user: newUser });          // shallow-merges newUser into state.

// Single key + value
setState("user", { name: "Lin" });    // shallow-merges into state.user (preserves age!)

// Nested key + value
setState("user", "name", "Grace");

// Updater function (receives current value)
setState("user", "age", a => a + 1);

// Array index
setState("items", 0, "done", true);
```

### Multi-key updates (one batch)

```ts
// Update multiple indices at once.
setState("items", [0, 1], "done", true);

// Update a range — { from, to } inclusive, optional step `by`.
setState("items", { from: 0, to: 3 }, "done", true);
setState("items", { from: 0, to: 9, by: 2 }, "done", true);   // every other

// Filter function — receives item (and index for arrays).
setState("items", (it) => !it.done, "done", true);
```

A single `setState` call automatically wraps in `batch`, so all the affected leaves notify subscribers once.

### Shallow merge when value is an object

```ts
setState("user", { name: "Grace" });
// equivalent to:
setState("user", u => ({ ...u, name: "Grace" }));
// state.user.age is preserved.
```

This is the single most ergonomic feature of stores. To **replace** instead of merge, set explicit keys:

```ts
setState("user", "name", "Grace");
setState("user", "age", undefined);     // remove
```

### Adding to arrays

```ts
// Append by length
setState("items", state.items.length, { id: 3, done: false });

// Or by spread (whole-array replacement)
setState("items", items => [...items, { id: 3, done: false }]);
```

The first form is more efficient — only `state.items.length` and the new index notify; existing elements aren't re-evaluated.

### Removing

```ts
setState("items", items => items.filter(i => i.id !== 1));
```

Whole-array replacement — fine for small arrays. For surgical deletion in big arrays, switch to `produce`.

## `produce` — Immer-style updates

Lets you mutate a draft. Only works on plain objects and arrays (not `Set`/`Map`).

```ts
import { produce } from "solid-js/store";

setState("items", produce(items => {
  items.push({ id: 3, done: false });
  items[0].done = true;
}));

setState("user", produce(u => {
  u.name = "Grace";
  u.age = 80;
}));
```

`produce` records the mutations and replays them through the proper setters internally, so every changed path notifies its subscribers.

Use `produce` when:
- You're updating multiple fields at once and the merge syntax gets noisy.
- You're doing array mutations beyond simple push/replace.
- You're working with deeply nested data and the path syntax becomes hard to read.

## `reconcile` — diff and update

When you receive a fresh snapshot (e.g. from a refetch), naively replacing the store discards all the fine-grained signals and forces every subscriber to re-run. `reconcile` instead diffs the old and new and only triggers updates for changed paths.

```ts
import { reconcile } from "solid-js/store";

const fresh = await fetchUsers();
setState("users", reconcile(fresh));
```

`reconcile` keeps stable references where data hasn't changed, so sub-views don't re-run.

### `key` option

For keyed reconcile (matching by id rather than by index), pass `{ key: "id" }`:

```ts
setState("users", reconcile(fresh, { key: "id" }));
```

Now reorderings and middle-inserts are correctly matched.

### `merge` option

By default, reconcile *replaces*. With `{ merge: true }`, it shallow-merges incoming changes into existing items.

## `unwrap` — non-reactive access

Returns the underlying plain object/array. Useful for:
- Passing data to a non-Solid library that doesn't like proxies.
- Logging without surprising side effects.
- Computing snapshots.

```ts
import { unwrap } from "solid-js/store";

const snapshot = unwrap(state);
console.log(JSON.stringify(snapshot, null, 2));
```

The unwrapped data is a regular object; mutating it does NOT notify the store.

## `createMutable` — proxy with direct mutation

Same proxy semantics, but no setter. You mutate directly.

```ts
import { createMutable } from "solid-js/store";

const state = createMutable({ count: 0 });

state.count++;     // notifies subscribers
state.user = { name: "Ada" };
```

Trade-offs:
- **Pro:** Less ceremony. Reads ergonomic, writes ergonomic.
- **Con:** Harder to track *where* mutations come from. Anyone with a reference to `state` can mutate it; tests and devtools can't intercept the writes.

The Solid team recommends `createStore` for most cases (the read/write separation makes debugging easier) and `createMutable` when ergonomics outweigh that.

### `modifyMutable` — bulk update wrapper

```ts
import { modifyMutable, produce, reconcile } from "solid-js/store";

modifyMutable(state, produce(s => {
  s.user.name = "Grace";
  s.user.age = 80;
}));
```

Works just like calling `produce` on `setState`, but for mutables.

## Stores in components

Stores are NOT auto-disposed. Created once at module level, they last forever. Created inside a component, they're scoped to that component (disposed via `onCleanup`).

```tsx
function Counter() {
  const [state, setState] = createStore({ count: 0 });
  // disposed automatically when Counter unmounts.
}
```

Stores in context — common pattern:

```tsx
const StoreContext = createContext<ReturnType<typeof createStoreApi>>();

function createStoreApi() {
  const [state, setState] = createStore({ ... });
  return [state, { increment: () => setState("count", c => c + 1) }] as const;
}

<StoreContext.Provider value={createStoreApi()}>{children}</StoreContext.Provider>
```

See `solid-context`.

## Lazy signal creation — the gotcha

```tsx
const [state, setState] = createStore({ users: [...] });

console.log(state.users.at(-1));      // not in tracking scope — snapshot
createEffect(() => console.log(state.users.at(-1)));   // tracks; logs on each change
```

Because store signals are created lazily on first read inside a tracking scope, reads outside one don't establish dependencies. This is fine; just be aware.

## Common pitfalls

- **Mutating an unwrapped store.** `unwrap(state).count = 5` does not notify subscribers (the proxy is gone).
- **Forgetting shallow-merge.** `setState("user", { name: "x" })` keeps other user keys. To wipe-and-replace, use `produce` or set keys individually.
- **Tracking scope confusion.** `console.log(state.x)` at the top of a component doesn't track. Wrap in effect.
- **Reading inside `on()` outside an arrow.** `on(state.x, ...)` doesn't work — `state.x` evaluates once. Use `on(() => state.x, ...)`.
- **Naive replace after fetch.** Use `reconcile` instead of dropping the whole tree.
- **Stores for primitives.** Overkill — use a signal.

## Examples

### Todo list

```tsx
const [todos, setTodos] = createStore({
  list: [] as Array<{ id: number; text: string; done: boolean }>,
  filter: "all" as "all" | "active" | "done",
});

const addTodo = (text: string) =>
  setTodos("list", l => [...l, { id: Date.now(), text, done: false }]);

const toggle = (id: number) =>
  setTodos("list", t => t.id === id, "done", d => !d);

const remove = (id: number) =>
  setTodos("list", l => l.filter(t => t.id !== id));

const setFilter = (f: typeof todos.filter) => setTodos("filter", f);
```

### Optimistic update + reconcile

```tsx
async function rename(id: number, newName: string) {
  setStore("users", u => u.id === id, "name", newName);  // optimistic
  try {
    const fresh = await api.rename(id, newName);
    setStore("users", reconcile(fresh, { key: "id" }));
  } catch {
    // rollback by refetching
  }
}
```

### Persisted store

```tsx
const init = JSON.parse(localStorage.getItem("state") ?? "{}");
const [state, setState] = createStore({ count: 0, ...init });
createEffect(() => localStorage.setItem("state", JSON.stringify(unwrap(state))));
```

## Related

- `solid-signals` — when a single primitive will do.
- `solid-context` — sharing a store across components.
- `solid-state-management` — when to choose store vs signal vs context.
- `solid-reactive-utilities` — `batch`, `untrack`, `on`.
