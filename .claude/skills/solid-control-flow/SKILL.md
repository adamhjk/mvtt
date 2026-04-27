---
name: solid-control-flow
description: "Use this skill for any conditional rendering, list iteration, dynamic component, portal, error boundary, suspense, or async lazy-loading in Solid (SolidJS). Covers `<Show>` (truthy-conditional with `fallback`, optional `keyed`, function-child accessor for type narrowing), `<Switch>`+`<Match>` (multi-branch, sequential evaluation, optional `fallback`), `<For>` (keyed-by-reference list, `index` is a signal, re-uses DOM nodes when items move), `<Index>` (keyed-by-position list, `item` is a signal, ideal for primitives and stable-length arrays), `<Dynamic>` and `createDynamic` (component selected at runtime), `<Portal>` (mount outside DOM hierarchy, events propagate via component tree), `<ErrorBoundary>` (catches render-time errors, fallback can use `(err, reset)` form), `<Suspense>` (waits for resources, integrates with `createResource`), `<SuspenseList>` (orchestrates multiple Suspenses), `lazy()` (code-split with `.preload()`), and `<NoHydration>` (skip hydration of a subtree). The For-vs-Index decision rule. Triggers on: Show, Switch, Match, For, Index, Dynamic, createDynamic, Portal, ErrorBoundary, Suspense, SuspenseList, lazy, NoHydration, conditional render, list rendering, error boundary, suspend, code split, modal, tooltip."
license: MIT
---

Solid ships components for the rendering control flow you'd otherwise write with `if`/`switch`/`.map` in a re-rendered framework. They're more efficient (no diffing, fine-grained updates) and they enable patterns like keyed reconciliation, function-child narrowing, and async suspension.

## Imports

```ts
import { Show, Switch, Match, For, Index,
         ErrorBoundary, Suspense, SuspenseList, lazy } from "solid-js";

import { Dynamic, Portal, NoHydration } from "solid-js/web";
```

## `<Show>` — single conditional

```tsx
<Show when={cond} fallback={<Loading />}>
  <Result />
</Show>
```

`when` can be a value or a getter; truthy → render children, falsy → render `fallback` (optional).

### Function-child form — auto-narrowing

When `children` is a function, Solid passes a non-nullable accessor for `when`. This is how you avoid optional chaining inside the conditional:

```tsx
<Show when={user()} fallback={<Login />}>
  {(u) => <UserCard name={u().name} />}
  {/* u is Accessor<NonNullable<User>> */}
</Show>
```

### `keyed`

By default, `<Show>` does NOT recreate children when `when` changes from one truthy value to another (it only toggles on truthy/falsy boundary). To force recreation per truthy value, set `keyed`:

```tsx
<Show when={user()} keyed>
  {(u) => <ProfileById id={u.id} />}    {/* u is the value directly, not an accessor */}
</Show>
```

`keyed` is useful for animations or when child setup depends on the specific identity.

## `<Switch>` + `<Match>` — multi-branch conditional

```tsx
<Switch fallback={<NotFound />}>
  <Match when={state() === "loading"}><Loading /></Match>
  <Match when={state() === "error"}><Error err={err()} /></Match>
  <Match when={state() === "ready"}><Data data={data()} /></Match>
</Switch>
```

Evaluated top-to-bottom; first truthy `when` wins. `<Match>` also supports the function-child form for narrowing.

## `<For>` — keyed-by-reference list

```tsx
<For each={items()} fallback={<p>No items</p>}>
  {(item, index) => <Row data={item} pos={index()} />}
</For>
```

- `item` — the array element (NOT a signal; it's the value).
- `index` — a signal (call as `index()`) — useful because items can move.
- The component for each item is created when it appears in the array and disposed when it leaves.
- Items that move keep their state (DOM, signals, refs) — Solid moves the existing nodes.

Use `<For>` when:
- You're rendering complex objects.
- Order can change.
- You want per-item state to persist across moves.

## `<Index>` — keyed-by-position list

```tsx
<Index each={inputs()}>
  {(input, index) => <Field value={input()} pos={index} />}
</Index>
```

- `input` — a signal (call as `input()`).
- `index` — a number (NOT a signal — fixed for a given element).
- The component for each *position* is created when the array grows and disposed when it shrinks.
- Items that swap don't move; only their `value` accessor changes.

Use `<Index>` when:
- The array is mostly stable in length.
- Order doesn't really matter (or items are interchangeable).
- Items are primitives (no id to key on).

## For-vs-Index decision rule

| You have | Use |
|---|---|
| Array of objects with stable identity (id), order changes | `<For>` |
| Array of primitives (strings, numbers, booleans) | `<Index>` |
| Form fields tied to position | `<Index>` |
| Sortable/drag-droppable list | `<For>` |
| Big array with mostly content updates | `<Index>` |

Default to `<For>`. Switch to `<Index>` for primitive arrays or when you find `<For>` is recreating items unnecessarily.

## `<Dynamic>` — component selected at runtime

```tsx
import { Dynamic } from "solid-js/web";

const map = { red: RedView, blue: BlueView };
return <Dynamic component={map[selected()]} title="hi" />;
```

`component` can be a component function or an HTML tag string (`"div"`). Other props are forwarded.

`createDynamic` is the same thing as a creation primitive (used internally; you almost always use `<Dynamic>`).

## `<Portal>` — mount outside the DOM tree

```tsx
import { Portal } from "solid-js/web";

<Show when={modalOpen()}>
  <Portal>           {/* defaults to document.body */}
    <div class="modal">...</div>
  </Portal>
</Show>
```

### Props

- `mount` — `Node` (default `document.body`).
- `useShadow` — `boolean` to attach a shadow root.
- `isSVG` — render an SVG `<g>` instead of an HTML `<div>` container.
- `ref` — receive the container element.

### Event propagation

Events in a portal propagate **through the component tree**, not the DOM tree:

```tsx
<div onClick={() => console.log("outer")}>
  <Portal mount={document.body}>
    <button onClick={() => console.log("inner")}>x</button>
  </Portal>
</div>
// Click logs "inner" then "outer".
```

This is usually what you want.

### SSR

Portals don't render during SSR — they output nothing on the server and hydrate client-side. For modal-like UI that needs SSR HTML, render in place and use CSS to position.

## `<ErrorBoundary>` — catch render errors

```tsx
<ErrorBoundary fallback={(err, reset) => (
  <div>
    <p>Something broke: {String(err)}</p>
    <button onClick={reset}>Try again</button>
  </div>
)}>
  <App />
</ErrorBoundary>
```

Catches errors thrown:
- During rendering.
- In reactive computations under the boundary (effects, memos).
- That bubble up from resources (`createResource` rejection becomes a thrown error inside the suspense path).

Does **not** catch:
- Errors in event handlers (handle with try/catch).
- Errors in callbacks scheduled outside Solid's flow (timeouts, custom event listeners). Use `catchError` for these.

`fallback` can be JSX (no-args) or a function `(err, reset) => JSX.Element`. `reset()` clears the error and re-renders the children.

## `<Suspense>` — wait for async work

```tsx
<Suspense fallback={<Loading />}>
  <Profile />     {/* reads a createResource that's pending */}
</Suspense>
```

A `<Suspense>` boundary delays rendering its children until all suspending resources within it are ready. Multiple resources under one boundary suspend together. Nested boundaries suspend independently.

```tsx
<Suspense fallback={<PageSkeleton />}>
  <Title />
  <Suspense fallback={<DetailsSkeleton />}>
    <Details />
  </Suspense>
</Suspense>
```

`<Suspense>` is the partner of `createResource` and routerquery `createAsync`.

## `<SuspenseList>` — orchestrate multiple Suspenses

```tsx
<SuspenseList revealOrder="forwards" tail="collapsed">
  <Suspense fallback={<S />}><A /></Suspense>
  <Suspense fallback={<S />}><B /></Suspense>
  <Suspense fallback={<S />}><C /></Suspense>
</SuspenseList>
```

`revealOrder`:
- `"forwards"` — show suspenses in order they appear, even if later ones resolve first.
- `"backwards"` — reverse order.
- `"together"` — wait for all to resolve, then show all at once.

`tail`:
- `"collapsed"` — only the first un-resolved suspense's fallback shows.
- `"hidden"` — un-resolved suspenses don't render their fallback at all.

Useful for predictable loading sequences.

## `lazy` — code-split a component

```tsx
import { lazy } from "solid-js";

const Editor = lazy(() => import("./Editor"));     // module must default-export the component

return (
  <Suspense fallback={<p>loading editor...</p>}>
    <Editor />
  </Suspense>
);
```

The lazy component starts loading on first render. While loading, the nearest `<Suspense>` shows its fallback (or — without one — nothing renders).

### Preloading

```tsx
<button
  onMouseEnter={() => Editor.preload()}
  onClick={() => setShowEditor(true)}
>
  Open editor
</button>
```

`.preload()` starts the module fetch without rendering. Pair with `<Show>` + click to render once loaded.

## `<NoHydration>` — skip hydration

```tsx
import { NoHydration } from "solid-js/web";

<NoHydration>
  <ServerOnly />
</NoHydration>
```

The subtree is rendered on the server and **not hydrated** on the client — useful for static islands, server-rendered widgets, or content that doesn't need interactivity.

## Common pitfalls

- **`.map` instead of `<For>`/`<Index>`.** Works, but reactivity per item is broken (the array recomputes, no key reconciliation). Always use the components.
- **Wrong For/Index choice.** Primitives in `<For>` cause unnecessary re-renders. Sortable objects in `<Index>` cause loss of per-item state.
- **Show without function-child for nullable values.** `<Show when={user()}>{...user().name...}</Show>` — TS still complains it might be undefined. Use `<Show when={user()}>{(u) => u().name}</Show>`.
- **Forgetting `<Suspense>` around lazy/resource.** Without one, lazy renders nothing and resource shows `undefined`.
- **`<ErrorBoundary>` not catching event-handler errors.** Wrap event-handler code in try/catch.
- **Portal events not bubbling to a non-Solid ancestor.** Portal events follow the component tree only.

## Examples

### Loading-error-success pattern

```tsx
const [data] = createResource(fetchData);

return (
  <Switch fallback={<Spinner />}>
    <Match when={data.error}><Error err={data.error} /></Match>
    <Match when={data()}>{(d) => <Result data={d()} />}</Match>
  </Switch>
);
```

### Modal with portal

```tsx
const [open, setOpen] = createSignal(false);

return (
  <>
    <button onClick={() => setOpen(true)}>open</button>
    <Show when={open()}>
      <Portal>
        <div class="modal-backdrop" onClick={() => setOpen(false)} />
        <div class="modal-content">...</div>
      </Portal>
    </Show>
  </>
);
```

### Dynamic component selection

```tsx
const widgets = { chart: ChartWidget, table: TableWidget };
const [type, setType] = createSignal<keyof typeof widgets>("chart");

return <Dynamic component={widgets[type()]} data={data()} />;
```

### Lazy route component

```tsx
const Settings = lazy(() => import("./Settings"));
<Route path="/settings" component={Settings} />
```

## Related

- `solid-resources` — feeds `<Suspense>`/`<ErrorBoundary>`.
- `solid-router` — its lazy/preload/queries integrate with these primitives.
- `solid-rendering` — SSR behavior of `<Portal>`/`<NoHydration>`.
- `solid-typescript` — narrowing inside `<Show>`/`<Match>`.
