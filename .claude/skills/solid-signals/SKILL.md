---
name: solid-signals
description: "Use this skill when creating, reading, or updating reactive state in Solid (SolidJS) using `createSignal`. Covers the getter/setter tuple shape, the function-form setter (passing `prev =>`), the `equals` option (default `===`, `false` to always notify, custom comparator function), the `name` debug option, types `Signal<T>` / `Accessor<T>` / `Setter<T>`, storing functions in signals (and why the function-form setter is needed), default values vs explicit type parameters to avoid `| undefined`, and when to reach for a store instead of a signal. Triggers on: createSignal, signal, getter, setter, Signal, Accessor, Setter, [count, setCount], reactive primitive, signal options, signal equals, signal name."
license: MIT
---

`createSignal` is the foundation of Solid's reactivity. A signal is a pair: a **getter function** that returns the current value (and subscribes the surrounding tracking scope), and a **setter function** that updates the value (and notifies subscribers).

## Import

```ts
import { createSignal, type Signal, type Accessor, type Setter } from "solid-js";
```

## Shape

```ts
function createSignal<T>(): Signal<T | undefined>;
function createSignal<T>(value: T, options?: SignalOptions<T>): Signal<T>;

type Signal<T> = [get: Accessor<T>, set: Setter<T>];
type Accessor<T> = () => T;
type Setter<T> = (v?: T | ((prev: T) => T)) => T;

interface SignalOptions<T> {
  equals?: false | ((prev: T, next: T) => boolean);
  name?: string;
}
```

## Reading

The getter is a function. Calling it returns the current value **and** subscribes the surrounding tracking scope (effect, memo, JSX expression).

```tsx
const [count, setCount] = createSignal(0);

count(); // 0 — and subscribes if inside a tracking scope.
count; // ← the function reference (almost never what you want).

return <p>{count()}</p>; // text node updates when count changes.
```

## Writing

Two forms of the setter:

```ts
setCount(5); // direct value.
setCount((prev) => prev + 1); // function form — receives the previous value.
```

Use the function form when:

- The new value depends on the previous one (avoids stale closures).
- You're storing a function in the signal (see "Functions as values" below).

## The `equals` option

By default, the setter only notifies subscribers if the new value is **not** strictly equal (`===`) to the previous one.

```ts
const [name, setName] = createSignal("Ada");
setName("Ada"); // no notification — same reference.
setName("Lin"); // notifies.
```

Override with `equals`:

- `equals: false` — always notify, even if equal. Useful for signals that hold mutable objects you mutate in place (rare; prefer stores).
- `equals: (prev, next) => boolean` — custom comparator. Return `true` if equal (don't notify); `false` if changed (notify).

```ts
// Compare Date objects by time, not reference.
const [d, setD] = createSignal(new Date(), {
  equals: (a, b) => a.getTime() === b.getTime(),
});
```

## The `name` option

A string used in dev tools to label this signal. No runtime effect in production.

```ts
const [count] = createSignal(0, { name: "count" });
```

## Functions as values

Setters distinguish between "a new value" and "a function to compute a new value" by checking if the argument is a function. To **store** a function in a signal, you must pass it via the function form:

```ts
const [handler, setHandler] = createSignal<() => void>(() => console.log("a"));

setHandler(() => console.log("b")); // ❌ This treats your function as the prev=>next callback,
//    immediately invokes it with the previous value, and stores
//    `undefined` (the return) as the new signal value.

setHandler(() => () => console.log("b")); // ✓ The outer arrow returns the function you actually want to store.
```

## Typing

### Default value → type inferred

```ts
const [count, setCount] = createSignal(0); // Signal<number>
const [name, setName] = createSignal(""); // Signal<string>
```

### No default value → `T | undefined`

```ts
const [user, setUser] = createSignal<User>(); // Signal<User | undefined>
```

To avoid the `| undefined`, supply a default value or a different type:

```ts
const [user, setUser] = createSignal<User | null>(null); // Signal<User | null>
```

### Reset to `undefined`

Calling the setter with no args resets to `undefined` (only valid when the type allows it):

```ts
const [user, setUser] = createSignal<User>();
setUser(); // user() === undefined
```

## Reading without subscribing

Sometimes you want to read the latest value without becoming dependent on changes. Use `untrack`:

```ts
import { untrack } from "solid-js";

createEffect(() => {
  const a = trackedSignal(); // subscribes
  const b = untrack(() => other()); // does NOT subscribe to `other`
  doSomething(a, b);
});
```

See `solid-reactive-utilities` for `untrack`, `batch`, `on`.

## When NOT to use a signal — reach for a store

Use a **store** when:

- You have a nested object or array and want fine-grained updates per leaf.
- You want to update a single property without replacing the whole object.

Use a signal when:

- The value is a primitive, or
- The value is an object/array but you replace it whole on each update, or
- You want the simplest reactive handle (signal is lighter than a store).

```ts
// Signal — fine for replace-whole.
const [user, setUser] = createSignal({ name: "Ada", age: 36 });
setUser((u) => ({ ...u, age: 37 }));

// Store — fine for nested fine-grained updates.
const [state, setState] = createStore({ user: { name: "Ada", age: 36 } });
setState("user", "age", 37); // only subscribers of `state.user.age` re-run.
```

See `solid-stores` for the full store API.

## Common pitfalls

- **Forgot the parens.** `<p>{count}</p>` renders the function, not the value, _and_ breaks reactivity. Always `count()` in a tracking scope.
- **Read outside a tracking scope.** `console.log(count())` at the top of a component logs the initial value once and never updates. Wrap in `createEffect` to log on every change.
- **Stale closure in event handler.** `onClick={() => setCount(count() + 1)}` works but is fragile under rapid clicks; `setCount(c => c + 1)` is always correct.
- **Mutating an object signal in place.** `user().age = 37; setUser(user())` doesn't notify because the reference didn't change (default `equals` is `===`). Use a new object, or use a store, or set `equals: false`.

## Examples

### Counter

```tsx
function Counter() {
  const [count, setCount] = createSignal(0);
  return <button onClick={() => setCount((c) => c + 1)}>Count: {count()}</button>;
}
```

### Toggle

```tsx
const [open, setOpen] = createSignal(false);
const toggle = () => setOpen((o) => !o);
```

### Storing a function

```tsx
const [onSave, setOnSave] = createSignal<() => void>(() => {});
setOnSave(() => () => console.log("saving"));
onSave()(); // logs "saving"
```

### Custom equality on objects you replace whole

```tsx
const [profile, setProfile] = createSignal(
  { name: "Ada", age: 36 },
  {
    equals: (a, b) => a.name === b.name && a.age === b.age,
  },
);
setProfile({ name: "Ada", age: 36 }); // does NOT notify — values are deep-equal.
```

## Related

- `solid-effects` — `createEffect`, `onMount`, `onCleanup`.
- `solid-memos` — `createMemo` for derived signals.
- `solid-stores` — when signals aren't enough.
- `solid-reactive-utilities` — `batch`, `untrack`, `on`.
