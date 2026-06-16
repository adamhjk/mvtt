---
name: solid-mental-model
description: "Use this skill when reasoning about why Solid (SolidJS) code is or is not updating, or before any non-trivial Solid task. Covers Solid's core philosophy: components run **once**, reactivity is **fine-grained**, signals are **getter functions**, props are a **reactive proxy** that must not be destructured, JSX placement determines what is reactive, and tracking scopes (`createEffect`/`createMemo`/JSX) are the only places where signals subscribe. Explains the owner tree, the difference between signals and stores, and why mutating without going through a setter is a no-op. **Almost every Solid bug is a violation of one of these principles** — start here whenever something isn't updating, an effect runs too often or not at all, or you find yourself wishing for a `useEffect`. Triggers on: mental model, fine-grained reactivity, components run once, tracking scope, owner, why isn't this updating, signal vs store, reactive system, Solid philosophy, why doesn't my effect run, why does my prop look stale, destructure props bug."
license: MIT
---

Solid's mental model is short but unfamiliar to anyone arriving from React, Vue, or Svelte. Internalize this before reaching for sub-skills — it prevents almost every common Solid bug.

## The seven things to remember

1. **Components run exactly once per mount.** A component function is invoked one time, when the component is first rendered. It is not re-run when state changes. Subsequent updates happen by re-running specific JSX expressions and effects, not the whole component. Anything you write at the top level of a component executes exactly once.

2. **Reactivity is fine-grained.** Each `{ expression }` in JSX is its own tiny reactive computation. When a signal it reads changes, only that one expression re-evaluates and updates its DOM target — nothing else. There is no virtual DOM and no diffing.

3. **Signals are functions; you must call them to read.**

   ```ts
   const [count, setCount] = createSignal(0);
   count; // ← the function reference (not the value)
   count(); // ← the value, AND establishes a dependency if inside a tracking scope
   ```

   Forgetting `()` is the most common typo. The setter is `setCount(v)` or `setCount(prev => prev + 1)`.

4. **Reactivity only happens inside tracking scopes.** A "tracking scope" is anywhere Solid is collecting dependencies: the body of `createEffect`, `createMemo`, `createComputed`, `createRenderEffect`, the `when=` of `<Show>`, the `each=` of `<For>`, JSX expressions, and a few others. Signals read **outside** a tracking scope simply return a value with no subscription.

   ```ts
   const [count, setCount] = createSignal(0);
   console.log(count()); // logs 0 once. NOT reactive.
   createEffect(() => console.log(count())); // logs 0, then logs again whenever count changes.
   ```

5. **`props` is a reactive proxy.** Each property access (`props.foo`) is itself a reactive read. Destructuring (`const { foo } = props`) or aliasing (`const foo = props.foo`) freezes the value at component-mount time and breaks reactivity forever. The fixes are: pass `props.foo` through directly, wrap in an arrow (`const foo = () => props.foo`), or use `splitProps`/`mergeProps`. See `solid-props`.

6. **Stores update by setter, not by mutation.** `setStore(...)` triggers fine-grained updates to subscribers; mutating an unwrapped object does not. (`createMutable` and `produce` _look_ like mutation but secretly route through setters.) See `solid-stores`.

7. **`<For>` keys by reference; `<Index>` keys by position.** Picking the wrong one wastes DOM work or — worse — silently shows the wrong content for primitive arrays. See `solid-control-flow`.

## How a Solid component actually executes

Take this component:

```tsx
function Counter(props: { initial: number }) {
  const [count, setCount] = createSignal(props.initial);
  console.log("setup");

  createEffect(() => {
    console.log("count is", count());
  });

  return <button onClick={() => setCount((c) => c + 1)}>{count()} clicks</button>;
}
```

What happens, in order:

1. The component function is invoked. `setup` is logged. `count` and `setCount` are bound. The effect is registered. The button element is created.
2. The JSX expression `{count()}` is wrapped in its own tiny reactive computation; reading `count()` subscribes that computation to the signal. The text node updates whenever `count` changes.
3. After the component mounts, the effect runs once: logs `count is 0`. It is now subscribed.
4. User clicks. `setCount` runs. The effect re-fires (logs `count is 1`). The text node re-fires and updates.

Notice what does _not_ happen: the component function is never called again. `setup` is logged once. The button element is never re-created. Only the things that read `count()` re-run.

## Why destructuring props breaks things

```tsx
function Greeting(props: { name: string }) {
  const { name } = props; // ← evaluated ONCE at mount; `name` is a string.
  return <p>Hello {name}</p>; // ← never updates when parent passes a new name.
}
```

The fix:

```tsx
function Greeting(props: { name: string }) {
  return <p>Hello {props.name}</p>; // ← reactive; updates when parent changes name.
}
```

For multiple props, `splitProps` preserves the proxy:

```tsx
const [local, rest] = splitProps(props, ["name"]);
// local.name is still reactive; rest.* is still reactive.
```

For defaults, `mergeProps` preserves reactivity:

```tsx
const merged = mergeProps({ name: "World" }, props);
return <p>Hello {merged.name}</p>;
```

See `solid-props` for the full set.

## The owner tree

Every reactive computation (effect, memo, root) has an **owner** — the parent reactive context. When the owner is disposed (e.g. a component unmounts), all its descendant computations are disposed too: their `onCleanup` runs, their subscriptions are released. This is how Solid avoids leaks without garbage collection.

You normally don't think about owners. You need to in two cases:

- **Detached work** — running a computation outside a component that you want to live independently. Use `createRoot(dispose => { ... })`.
- **Restoring an owner** — running async-or-callback code that lost its owner (e.g. inside a `setTimeout`, after `await`, inside a non-reactive callback). Capture `getOwner()` and re-enter via `runWithOwner`.

See `solid-reactive-utilities`.

## Signals vs stores — the two-line decision

- **Signal** — for primitives, single objects you replace whole, or anything where "the value changed" maps cleanly to "this whole thing is now different".
- **Store** — for nested objects/arrays where you want updates to one leaf to NOT invalidate sibling leaves. Stores expose a JavaScript proxy whose every property access is its own fine-grained reactive read.

Rule of thumb: if you find yourself writing `setObj({ ...obj, foo: { ...obj.foo, bar: 1 } })`, switch to a store. See `solid-stores`.

## Effects vs memos vs derived signals

Three ways to express "compute Y from X":

- **Plain function** — `const fullName = () => `${first()} ${last()}`. Re-evaluates on every read. Reactive (subscribers track its signals). No caching. Use this by default.
- **`createMemo(() => ...)`** — same, but caches the result and only notifies downstream readers when the result changes (per `equals`). Use when the computation is expensive _or_ when many places will read it _or_ when you want custom equality.
- **`createEffect(() => ...)`** — runs after render, for side effects (DOM, network, logging). **Don't write signals inside effects** unless you've thought about it — that's usually a memo's job.

See `solid-effects` and `solid-memos`.

## Why `console.log(signal())` at the top of a component shows nothing changing

Because the component body runs once. There is no re-render. To watch a signal, put the read inside a tracking scope:

```tsx
createEffect(() => console.log("count is", count()));
```

## What "untrack" means

Sometimes inside an effect you want to _read_ a signal without subscribing to it. `untrack(() => signal())` does that. Useful for "reading the latest value without causing this effect to re-fire when it changes". See `solid-reactive-utilities`.

## What "batch" means

Multiple signal writes inside `batch(() => { ... })` notify subscribers exactly once after the batch ends, instead of once per write. Effects already batch internally; you mostly need `batch` when writing several signals from an event handler. See `solid-reactive-utilities`.

## Server vs client

`isServer` is a compile-time constant — code branches behind `if (isServer)` are tree-shaken from the client bundle. `onMount` and `createEffect` only run on the client. Resources serialize across the SSR boundary. See `solid-rendering` and (if using SolidStart) `solid-start`.

## Common bug → cause cheat sheet

| Symptom                                             | Likely cause                                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| "My UI doesn't update when I change state"          | Read outside tracking scope, or destructured props, or mutated without a setter, or used a signal without `()`              |
| "My effect runs once and never again"               | Read happens before tracking is established; check that the signal call happens _inside_ the effect callback, not before it |
| "My effect runs twice on mount"                     | Vite StrictMode-equivalent isn't a thing in Solid; check for nested effects or duplicate mounts                             |
| "My memo never updates"                             | The body doesn't actually read any signals (e.g. you cached `props.foo` outside the memo)                                   |
| "My `<Show when={x()}>` child still sees old value" | Use the function-child form `{(x) => ...}` to get a narrowed accessor                                                       |
| "My event handler sees stale state"                 | You're reading a captured value instead of calling the signal — call `signal()` inside the handler                          |
| "Tests don't see updates"                           | Wrap the test in `createRoot(dispose => { ... ; dispose() })` so effects can run, or use `@solidjs/testing-library`         |

## Where to go next

Once this model feels natural, jump to the specific sub-skill for the API you need. The router (`solid/SKILL.md`) maps every topic to its sub-skill.
