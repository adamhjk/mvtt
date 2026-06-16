---
name: solid-props
description: "Use this skill anytime you handle component props in Solid (SolidJS) — the **most common source of bugs**. Covers the cardinal rule (`props` is a reactive proxy; **never destructure or alias** at the top of a component, or reactivity dies), `mergeProps` for default values that stay reactive, `splitProps` for forwarding subsets while preserving reactivity, the `children` helper for resolving `props.children` exactly once (avoiding duplicate component creation), default-value patterns (`mergeProps`, initial-signal-value, `||`/`??` inline), and prop drilling — when to switch to `<Context>`. Triggers on: props, props.children, destructure props, mergeProps, splitProps, children helper, default props, prop drilling, ParentProps, why are my props stale, prop forwarding, spread props."
license: MIT
---

`props` in a Solid component is a **reactive proxy object**. Each property access (`props.foo`) is itself a reactive read; the access subscribes the surrounding tracking scope to that property. This is what lets a component like `<Greeting name={dynamicName()} />` re-render the text without re-running the component function.

The cost of this design: **destructuring or aliasing `props` at the top of the component freezes the values at mount time and breaks reactivity forever**.

## The cardinal rule

```tsx
function Greeting(props: { name: string }) {
  const { name } = props; // ❌ string, captured once, never updates.
  const name = props.name; // ❌ same problem.
  const name = () => props.name; // ✓ accessor function — re-reads each time it's called.

  return <p>Hello {props.name}</p>; // ✓ reactive — re-evaluates when parent's name changes.
}
```

Why? `props.name` getter runs only when the property is _accessed_. Destructuring accesses it once, at mount, and the local variable is dead reactive-wise.

## `mergeProps` — defaults that stay reactive

```ts
function mergeProps<T extends unknown[]>(...sources: T): MergeProps<T>;
```

Merges multiple objects (each potentially reactive) into one props-like proxy. Each property read goes through the proxy and stays reactive.

```tsx
import { mergeProps } from "solid-js";

function Avatar(props: { name: string; size?: number }) {
  const merged = mergeProps({ size: 48 }, props);
  return <img src={...} width={merged.size} height={merged.size} alt={merged.name} />;
}
```

The defaults object goes **first**; later sources override. If the parent passes `size={undefined}`, the default applies; if it passes `size={32}`, that wins.

Use `mergeProps` over `props.size ?? 48` when the default could have been computed with reactive inputs, or when several defaults are needed.

## `splitProps` — split a props proxy into reactive subsets

```ts
function splitProps<T, K extends Array<keyof T>>(
  props: T,
  ...keys: K[]
): [...partials: { [I in K[number]]: T[I] }[], rest: Omit<T, K[number][]>];
```

Returns one new proxy per key array, plus a final "rest" proxy. **Each remains reactive**.

```tsx
import { splitProps } from "solid-js";

function Button(props: ButtonProps & JSX.HTMLAttributes<HTMLButtonElement>) {
  const [local, rest] = splitProps(props, ["variant", "size"]);
  return <button class={`btn ${local.variant} ${local.size}`} {...rest} />;
}
```

`local.variant` re-reads every time it's accessed; `rest` spreads all the other DOM attributes through.

You can split into multiple groups:

```tsx
const [styling, behavior, rest] = splitProps(
  props,
  ["class", "style", "classList"],
  ["onClick", "onSubmit"],
);
```

## `children` helper — resolve `props.children` once

```ts
function children(
  fn: Accessor<JSX.Element>,
): Accessor<ResolvedChildren> & { toArray(): ResolvedChild[] };
```

`props.children` is itself reactive — accessing it can re-create the children. If you read `props.children` multiple times (or want to inspect what was passed), wrap it in `children`:

```tsx
import { children } from "solid-js";

function List(props: { children: JSX.Element }) {
  const c = children(() => props.children);
  return (
    <ul>
      <For each={c.toArray()}>{(child) => <li>{child}</li>}</For>
    </ul>
  );
}
```

`c()` returns the resolved children. `c.toArray()` flattens fragments and arrays into a single array.

Without `children`, doing `props.children.map(...)` is wrong on multiple counts: `children` is not always an array (could be a single element, a fragment, a function, `null`...), and reading it twice causes the children components to be re-created.

## Default values — three idioms

### 1. `mergeProps` (preferred when you have several defaults or reactive defaults)

```tsx
const merged = mergeProps({ size: 48, theme: "light" }, props);
```

### 2. Initial-signal-value pattern (when the prop is only used to seed local state)

```tsx
function Counter(props: { initial?: number }) {
  const [count, setCount] = createSignal(props.initial ?? 0);
  return <p>{count()}</p>;
}
```

Reading `props.initial` once at mount is fine here because that's the intent — seed initial state, ignore later changes.

### 3. Inline default at each access

```tsx
return <img width={props.size ?? 48} />;
```

Fine for one-off reads. Falls apart if you read `props.size` in many places — switch to `mergeProps` then.

## Forwarding props through

When wrapping a component, forward unknown props with `splitProps` + spread:

```tsx
function PrimaryButton(props: { label: string } & JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [local, rest] = splitProps(props, ["label"]);
  return (
    <button class="primary" {...rest}>
      {local.label}
    </button>
  );
}
```

This preserves reactivity for every forwarded property.

## `props.children`

`props.children` is the JSX between the opening and closing tags of your component:

```tsx
<MyCard>
  <p>hi</p>
  <p>there</p>
</MyCard>
// inside MyCard, props.children is an array of two <p> elements
```

**Don't iterate `props.children` directly.** It's a reactive expression that may create the children when read. Use the `children` helper above, or just splat: `<div>{props.children}</div>`.

## Typing children with `ParentProps` / `ParentComponent`

```tsx
import type { ParentComponent, ParentProps } from "solid-js";

const Card: ParentComponent<{ title: string }> = (props) => (
  <article><h3>{props.title}</h3>{props.children}</article>
);

// or, for function declarations:
function Card(props: ParentProps<{ title: string }>) { ... }
```

`ParentProps<P>` is `P & { children?: JSX.Element }`.

For components requiring children, use `ParentProps`. For components that explicitly forbid them, use `VoidProps`/`VoidComponent`.

For components that take **specific child shapes** (a function child, exactly one element, etc.), use `FlowComponent`/`FlowProps`:

```tsx
import type { FlowComponent } from "solid-js";

const Show: FlowComponent<{ when: unknown }, JSX.Element> = ...; // sketch
```

## Prop drilling — when to switch to context

If you find yourself passing the same prop through three or more layers, consider context:

```tsx
const ThemeContext = createContext<Accessor<"light" | "dark">>();

function App() {
  const [theme, setTheme] = createSignal<"light" | "dark">("dark");
  return <ThemeContext.Provider value={theme}>... deep tree ...</ThemeContext.Provider>;
}

function DeepChild() {
  const theme = useContext(ThemeContext)!;
  return <div data-theme={theme()}>...</div>;
}
```

See `solid-context`.

## Common pitfalls

- **Destructuring at the top of a component.** The single biggest Solid bug source.
- **`onClick={() => doThing(props.id)}` — fine.** The handler reads `props.id` at click time, which is inside an event handler scope (not tracked, but the read is fresh). Don't be fooled into thinking _all_ destructure-like patterns are bad — it's specifically aliasing into a non-reactive variable that breaks things.
- **Spreading `{...props}` directly into another component.** This works (Solid preserves the proxy under spread) — but it can cause unexpected propagation. Use `splitProps` to isolate the props you want to forward.
- **Reading `props.children` more than once.** Use `children()` helper.
- **Computing children at the top of the component.** Same destructure problem; wrap in `children(() => props.children)` or compute in JSX.

## Examples

### Forwarding ref through a wrapper

```tsx
function Input(props: JSX.InputHTMLAttributes<HTMLInputElement> & { variant?: string }) {
  const [local, rest] = splitProps(props, ["variant"]);
  return <input class={`input ${local.variant ?? ""}`} {...rest} />;
}
// Parent: <Input ref={r} value={v()} onInput={e => set(e.currentTarget.value)} variant="big" />
```

### Resolving children for inspection

```tsx
function Tabs(props: { children: JSX.Element }) {
  const tabs = children(() => props.children);
  // tabs.toArray() is now a stable array of the tab children.
  return (
    <div role="tablist">
      <For each={tabs.toArray()}>{(tab) => tab}</For>
    </div>
  );
}
```

### Defaults via `mergeProps`

```tsx
function Slider(props: { value: number; min?: number; max?: number; step?: number }) {
  const merged = mergeProps({ min: 0, max: 100, step: 1 }, props);
  return (
    <input type="range" min={merged.min} max={merged.max} step={merged.step} value={merged.value} />
  );
}
```

## Related

- `solid-components` — component shape and types.
- `solid-context` — when prop drilling is too much.
- `solid-typescript` — `Component`, `ParentComponent`, `JSX.HTMLAttributes`.
- `solid-reactive-utilities` — `mergeProps`, `splitProps`, `children` (full reference).
