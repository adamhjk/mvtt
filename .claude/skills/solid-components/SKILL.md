---
name: solid-components
description: "Use this skill when authoring or organizing components in Solid (SolidJS): the run-once lifecycle, capital-letter naming (lowercase is parsed as a DOM tag), default vs named exports, distinguishing the component **function** from the JSX it returns, and choosing the right TypeScript component type. Covers `Component<P>` (default, no children), `ParentComponent<P>` (`children?` included), `VoidComponent<P>` (children explicitly forbidden), `FlowComponent<P, T>` (children of a specific JSX shape, used by `<Show>`, `<For>`, etc.), generic components (must be a function declaration, not the `Component` type), and conditional rendering inside the return statement. Triggers on: component, function component, capital letter, Component<>, ParentComponent, VoidComponent, FlowComponent, generic component, component lifecycle, Solid component."
license: MIT
---

A Solid component is a function that returns JSX. The function runs **exactly once** when the component is mounted; reactivity flows through signals/JSX expressions, not through re-renders. This is the single biggest mental shift coming from React.

## The shape

```tsx
function Greeting(props: { name: string }) {
  return <p>Hello {props.name}</p>;
}
```

That's it. No `useState`, no re-render, no `memo`. Reactivity is implicit.

## Naming — capital letter is mandatory

```tsx
function Card() { return <p>card</p> }       // ✓ component
function card() { return <p>card</p> }       // ❌ parsed as a lowercase DOM element

return (
  <>
    <Card />     {/* renders the component */}
    <card />     {/* renders an unknown HTML tag — no error, just wrong */}
  </>
);
```

This is JSX-level: the parser uses the leading capital to decide "component" vs "DOM element". Always start component names with a capital.

## Run-once lifecycle

```tsx
function Counter() {
  const [count, setCount] = createSignal(0);
  console.log("Counter setup");           // logs ONCE
  return (
    <button onClick={() => setCount(c => c + 1)}>{count()}</button>
  );
}
```

When `count` changes, the JSX expression `{count()}` re-runs and updates the text node. The function body of `Counter` does not. This means:

- **Setup is permanent.** Anything you write at the top of the component body (signal creation, effect registration, store creation) runs once and stays. Don't put per-update logic there.
- **Conditionals must be inside the return.** `if (somecondition) return <A/> else return <B/>` only runs once and freezes the choice. Use `<Show>` or a ternary inside the JSX.

```tsx
// ❌ frozen at mount
function MaybeShow(props: { show: boolean }) {
  if (props.show) return <A />;
  return <B />;
}

// ✓ reactive
function MaybeShow(props: { show: boolean }) {
  return <Show when={props.show} fallback={<B />}><A /></Show>;
}
```

## Component trees

Components compose hierarchically. Each instance has its own state.

```tsx
function App() {
  return (
    <main>
      <Header />
      <List>
        <Item id="a" />
        <Item id="b" />
      </List>
      <Footer />
    </main>
  );
}
```

Each `<Item>` runs its own `Item` function on first mount, gets its own signals, and is independent of siblings.

## Importing and exporting

### Named exports (preferred)

```tsx
// ./Card.tsx
export function Card(props: { title: string }) {
  return <article><h3>{props.title}</h3></article>;
}

// ./App.tsx
import { Card } from "./Card";
```

### Default exports (for top-level pages, lazy-loaded chunks)

```tsx
// ./Page.tsx
export default function Page() { return <p>page</p>; }

// ./App.tsx
import Page from "./Page";
const LazyPage = lazy(() => import("./Page")); // requires default export
```

`lazy()` requires the loaded module to have a `default` export, so default-exporting is the convention for code-split routes.

## TypeScript component types

```ts
import type { Component, ParentComponent, VoidComponent, FlowComponent } from "solid-js";
```

| Type | Children allowed? | When to use |
|---|---|---|
| `Component<P>` | No (TS will error) | Most leaf components — buttons, inputs, badges. |
| `ParentComponent<P>` | Optional `children` | Layouts, cards, anything wrapping content. |
| `VoidComponent<P>` | Forbidden (TS will error) | Like `Component`, but used to make the no-children intent explicit. |
| `FlowComponent<P, T>` | Required, of type `T` | Components like `<Show>`, `<For>` that take a function as `children`. |

```tsx
const Badge: Component<{ count: number }> = (p) => <span>{p.count}</span>;
const Card: ParentComponent<{ title: string }> = (p) => (
  <article><h3>{p.title}</h3>{p.children}</article>
);
const Spacer: VoidComponent = () => <div style={{ height: "1rem" }} />;
```

`Component`/`ParentComponent`/etc. are type aliases over `(props: P) => JSX.Element`. Any function with that shape is a valid component.

## Generic components — DON'T use the `Component` alias

The `Component<P>` alias cannot encode generic parameters. Write a generic function declaration directly:

```tsx
// ❌ doesn't work — T isn't bound on Component
const List: Component<<T>{ items: T[]; render: (t: T) => JSX.Element }> = ...;

// ✓
function List<T>(props: { items: T[]; render: (item: T) => JSX.Element }) {
  return <ul><For each={props.items}>{(item) => <li>{props.render(item)}</li>}</For></ul>;
}

// Or arrow form (note the trailing `,` on the type parameter to disambiguate from JSX):
const List = <T,>(props: { items: T[]; render: (item: T) => JSX.Element }) =>
  <ul><For each={props.items}>{(item) => <li>{props.render(item)}</li>}</For></ul>;
```

In `.tsx` files, `<T>` alone is ambiguous with a JSX tag — use `<T,>` (trailing comma) or `<T extends unknown>`.

See `solid-typescript` for the full TS picture.

## Where to put logic

Because the body runs once, **all reactive work goes through signals/effects**:

```tsx
function Profile(props: { id: string }) {
  // Setup — runs once.
  const [user] = createResource(() => props.id, fetchUser);

  // Derived — function, reactive, recomputed on read.
  const initials = () => user()?.name.split(" ").map(s => s[0]).join("");

  // Side effect — runs on dependency changes.
  createEffect(() => {
    document.title = user()?.name ?? "Loading...";
  });

  return <p>{initials()} — {user()?.name}</p>;
}
```

Notice `() => props.id` — passing the accessor (not the value) to `createResource` is what makes it react to id changes. `createResource(props.id, ...)` would freeze on the initial id.

## Common pitfalls

- **Lowercase component names.** Render as unknown HTML.
- **Top-level `if/return`.** Freezes which subtree renders. Use `<Show>` or ternary inside JSX.
- **Top-level `console.log(props.foo)`.** Logs once at mount. Use `createEffect`.
- **Destructuring `props`.** See `solid-props`.
- **Trying to import everything from `solid-js`.** Web-only utilities (`render`, `Portal`, `Dynamic`, `hydrate`) live in `solid-js/web`. Stores live in `solid-js/store`.

## Imports cheat sheet

```ts
import { createSignal, createEffect, createMemo, createResource,
         onMount, onCleanup, Show, For, Index, Switch, Match,
         ErrorBoundary, Suspense, lazy, createContext, useContext,
         children, mergeProps, splitProps, batch, untrack, on,
         type Component, type ParentComponent, type JSX } from "solid-js";

import { render, hydrate, Portal, Dynamic, NoHydration,
         renderToString, renderToStringAsync, renderToStream } from "solid-js/web";

import { createStore, produce, reconcile, unwrap, createMutable } from "solid-js/store";
```

## Related

- `solid-mental-model` — components run once.
- `solid-props` — never destructure.
- `solid-jsx` — JSX semantics.
- `solid-typescript` — full type story.
- `solid-control-flow` — `<Show>`, `<For>`, etc., for reactive conditionals.
