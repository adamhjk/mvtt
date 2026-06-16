---
name: solid-typescript
description: 'Use this skill for any TypeScript-specific question in Solid (SolidJS): tsconfig setup, typing components/props/refs/events/directives, narrowing inside `<Show>`/`<Match>`. Covers the required `tsconfig` settings (`jsx: "preserve"`, `jsxImportSource: "solid-js"`), the four component types (`Component<P>`, `ParentComponent<P>`, `VoidComponent<P>`, `FlowComponent<P, T>`) and when to use each, generic components (must be a function declaration with `<T,>` trailing comma in TSX, `Component` alias can''t carry generics), `JSX.Element` and what counts as one, `JSX.HTMLAttributes<T>` / `JSX.IntrinsicElements`, event handlers via `JSX.EventHandler<TElement, TEvent>` and `JSX.EventHandlerWithOptions`, the `currentTarget` vs `target` typing rule, ref typing with definitive assignment (`let el!: HTMLDivElement`), control-flow narrowing with `<Show keyed>` or function-child accessor (or optional chaining), augmenting `JSX.Directives` / `JSX.DirectiveFunctions` for `use:*`, augmenting `JSX.CustomEvents` for `on:*`, and augmenting `JSX.ExplicitProperties` / `ExplicitAttributes` / `ExplicitBoolAttributes` for `prop:*`/`attr:*`/`bool:*`. Triggers on: TypeScript, TS, types, Component<>, ParentComponent, VoidComponent, FlowComponent, ParentProps, JSX.Element, JSX.EventHandler, JSX.HTMLAttributes, JSX.IntrinsicElements, currentTarget, ref types, definitive assignment, jsxImportSource, jsx preserve, generic component, narrowing, Directives, DirectiveFunctions, CustomEvents, ExplicitProperties, augment JSX namespace.'
license: MIT
---

Solid is written in TypeScript. Most types come automatically from `solid-js`. The few things you'll touch by hand: `tsconfig` once at setup, component types, refs, event handlers, and JSX namespace augmentation for custom directives/events/props.

## `tsconfig.json` essentials

```jsonc
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "strict": true,
    "moduleResolution": "bundler", // or "node16"
    "target": "ESNext",
    "module": "ESNext",
    "noUncheckedIndexedAccess": true, // recommended
    "isolatedModules": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
  },
}
```

Critical:

- `"jsx": "preserve"` — TypeScript leaves JSX intact for Solid's JSX compiler to handle.
- `"jsxImportSource": "solid-js"` — uses Solid's JSX type definitions.

For mixed React + Solid projects, use a per-file pragma:

```ts
/** @jsxImportSource solid-js */
```

## Component types

```ts
import type { Component, ParentComponent, VoidComponent, FlowComponent } from "solid-js";
```

| Type                  | `children`              | When                                                            |
| --------------------- | ----------------------- | --------------------------------------------------------------- |
| `Component<P>`        | not allowed (TS errors) | Most leaf components.                                           |
| `ParentComponent<P>`  | optional `JSX.Element`  | Layouts, cards, wrappers.                                       |
| `VoidComponent<P>`    | forbidden               | Like `Component`, explicit no-children.                         |
| `FlowComponent<P, T>` | required, of type `T`   | Components like `<Show>`, `<For>` whose children are functions. |

```tsx
const Badge: Component<{ count: number }> = (p) => <span>{p.count}</span>;
const Card: ParentComponent<{ title: string }> = (p) => (
  <article>
    <h3>{p.title}</h3>
    {p.children}
  </article>
);
```

There are also `Props`-shaped helpers:

```ts
import type { ParentProps, VoidProps, FlowProps } from "solid-js";

function Card(props: ParentProps<{ title: string }>) {
  return <article>{props.children}</article>;
}
```

## Generic components

The `Component<P>` alias **cannot** carry generics. Use a function declaration:

```tsx
function List<T>(props: { items: T[]; render: (item: T) => JSX.Element }) {
  return <For each={props.items}>{(i) => props.render(i)}</For>;
}
```

In `.tsx` files, generic arrow functions need a trailing comma to disambiguate from JSX:

```tsx
const List = <T,>(props: { items: T[] }) => <ul>...</ul>;
// or
const List = <T extends unknown>(props: { items: T[] }) => <ul>...</ul>;
```

## `JSX.Element`

Anything Solid can render: a DOM node, an array of nodes, a string, a number, a Solid component result, `null`, `undefined`. Use as the return type of functions that return JSX.

## `JSX.HTMLAttributes<T>` / `JSX.IntrinsicElements`

```ts
import type { JSX } from "solid-js";

type MyButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
};

function MyButton(props: MyButtonProps) {
  const [local, rest] = splitProps(props, ["variant"]);
  return <button class={local.variant} {...rest} />;
}
```

The `*HTMLAttributes` types include all standard HTML attributes plus Solid's `class`/`classList`/`style`/event handlers.

For SVG: `JSX.SVGAttributes<T>` and `JSX.SVGSVGAttributes` for the root.

## Event handler types

```ts
import type { JSX } from "solid-js";

const handle: JSX.EventHandler<HTMLInputElement, InputEvent> = (e) => {
  e.currentTarget.value; // string
};
```

`JSX.EventHandler<TElement, TEvent>` is `(e: TEvent & { currentTarget: TElement; target: DOMElement }) => void`.

Inline handlers infer for free:

```tsx
<input
  onInput={(e) => {
    /* e is fully typed */
  }}
/>
```

For listener-options form:

```ts
import type { JSX } from "solid-js";

const h: JSX.EventHandlerWithOptions<HTMLDivElement, Event> = {
  once: true,
  handleEvent(e) { ... },
};
<div on:click={h} />
```

## `currentTarget` vs `target`

- `currentTarget` is typed as `T` (the element you bound to).
- `target` is typed as `Element | null` — needs narrowing.

Always prefer `currentTarget` when reading the value of _the element with the listener_.

## Ref typing

```ts
let el!: HTMLDivElement;       // definitive-assignment assertion
return <div ref={el}>...</div>;
```

The `!` tells TS that `el` will be assigned through magic (Solid does it before mount). Without `!`, TS errors that `el` is used before assignment.

For nullable refs (e.g. ref inside `<Show>`):

```ts
const [el, setEl] = createSignal<HTMLDivElement>();
return <Show when={open()}><div ref={setEl}>...</div></Show>;
```

For SVG sub-elements use the specific interface (`SVGCircleElement`, `SVGGElement`, etc.).

## Narrowing inside `<Show>` / `<Match>`

Solid accessors don't narrow via control-flow analysis. Three strategies:

### Optional chaining

```tsx
<Show when={user()}>{user()?.name}</Show>
```

### Function-child accessor (preferred)

```tsx
<Show when={user()}>
  {(u) => <p>{u().name}</p>} {/* u: Accessor<NonNullable<User>> */}
</Show>
```

### `keyed` form

```tsx
<Show when={user()} keyed>
  {(u) => <p>{u.name}</p>} {/* u: NonNullable<User>, value (not accessor) */}
</Show>
```

Same pattern for `<Match>`. To distinguish a union (`Admin | RegularUser`), compute a narrowed memo:

```ts
const admin = createMemo(() => {
  const u = user();
  return u && u.type === "admin" ? u : undefined;
});
return <Show when={admin()}>{a => <AdminPanel admin={a()} />}</Show>;
```

## Augmenting the JSX namespace

For custom JSX prefixes, augment the relevant interface in `solid-js`:

### `use:*` directives

```ts
declare module "solid-js" {
  namespace JSX {
    interface Directives {
      autoFocus: boolean;
      clickOutside: () => void;
      model: Signal<string>;
    }
  }
}
```

Or use `DirectiveFunctions` to derive from the function signature:

```ts
declare module "solid-js" {
  namespace JSX {
    interface DirectiveFunctions {
      model: typeof model;
    }
  }
}
```

Both make `<input use:model={...} />` type-check.

### `on:*` custom events

```ts
declare module "solid-js" {
  namespace JSX {
    interface CustomEvents {
      "my-event": CustomEvent<{ payload: number }>;
    }
  }
}
// <div on:my-event={(e) => e.detail.payload} />
```

To include native events under `on:*` typing (since they're not in the default custom-events map):

```ts
declare module "solid-js" {
  namespace JSX {
    interface CustomEvents extends HTMLElementEventMap {}
  }
}
```

### `prop:*` / `attr:*` / `bool:*`

```ts
declare module "solid-js" {
  namespace JSX {
    interface ExplicitProperties {
      complexConfig: { foo: number };
    }
    interface ExplicitAttributes {
      "custom-data": string;
    }
    interface ExplicitBoolAttributes {
      hidden: boolean;
    }
  }
}
```

## Typing context

```ts
import type { Accessor } from "solid-js";

type ThemeApi = readonly [Accessor<"light" | "dark">, (t: "light" | "dark") => void];
const ThemeContext = createContext<ThemeApi>();
```

For factory-built contexts:

```ts
const make = () => makeStore();
type AppApi = ReturnType<typeof make>;
const AppContext = createContext<AppApi>();
```

See `solid-context`.

## Typing stores

`createStore` infers the type from the initial value:

```ts
const [state, setState] = createStore({ count: 0 }); // SetStoreFunction inferred
```

For empty initializers:

```ts
const [state, setState] = createStore<MyState>({} as MyState);
```

The setter has a complex but mostly-correct type — path-syntax overloads are typed.

## Typing resources

```ts
const [data] = createResource<User>(fetchUser);
data; // Resource<User>
data(); // User | undefined
data.loading; // boolean
data.error; // any
```

With a source:

```ts
const [data] = createResource<User, string>(userId, fetchUser);
//                              ^---- value type
//                                   ^---- source type
```

## Common pitfalls

- **`jsx: "react-jsx"` instead of `"preserve"`.** TS transforms JSX with React's runtime, breaking Solid.
- **`jsxImportSource` not set.** JSX is typed via React's defs; Solid-specific types missing.
- **`Component<>` for generics.** Use function declarations.
- **Reading `props` after destructure for typed defaults.** Reactivity dies; use `mergeProps`.
- **Asserting non-null on accessors.** `user()!.name` works at runtime but tells TS to ignore the maybe-undefined; prefer `<Show>` or `?.`.
- **Forgetting to augment for `use:*`.** TS errors about unknown JSX attribute. Augment `JSX.Directives` or `JSX.DirectiveFunctions`.
- **Trailing comma on `<T,>` missing.** Generic arrow functions in `.tsx` get parsed as JSX without it.

## Examples

### Forwarded ref typed

```tsx
function MyInput(props: JSX.InputHTMLAttributes<HTMLInputElement> & { variant?: string }) {
  const [local, rest] = splitProps(props, ["variant"]);
  return <input class={local.variant} {...rest} />;
}

let r!: HTMLInputElement;
<MyInput ref={r} />;
```

### Custom event with detail

```tsx
class RenameEvent extends CustomEvent<{ id: number; name: string }> {
  constructor(id: number, name: string) {
    super("rename", { detail: { id, name } });
  }
}

declare module "solid-js" {
  namespace JSX {
    interface CustomEvents {
      rename: RenameEvent;
    }
  }
}

<div on:rename={(e) => console.log(e.detail.id, e.detail.name)} />;
```

### Generic list

```tsx
function List<T>(props: { items: T[]; render: (item: T) => JSX.Element }) {
  return (
    <ul>
      <For each={props.items}>{props.render}</For>
    </ul>
  );
}

<List items={users()} render={(u) => <li>{u.name}</li>} />;
```

## Related

- `solid-jsx-attributes` — `use:*`/`on:*`/`prop:*` syntax.
- `solid-events` — runtime event semantics.
- `solid-refs` — ref typing in depth.
- `solid-components` — component types overview.
- `solid-configuration` — full tsconfig and vite-plugin-solid setup.
