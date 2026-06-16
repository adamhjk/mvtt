# Why the greeting doesn't update

In Solid, `props` is a **reactive proxy object**, not a plain object. Reactivity flows through _property accesses_: `props.name` is itself a tracked read, and the access subscribes the surrounding tracking scope (e.g. JSX) to that property. That is what makes `<p>Hello {props.name}!</p>` re-render when the parent's signal changes — even though the component function only ever runs once.

The line

```tsx
const { name } = props;
```

destructures the proxy at the top of the component. Destructuring **accesses the getter once, at mount time**, copies the resulting string into a plain local variable `name`, and never reads `props.name` again. From that moment on, `name` is a frozen string `"Ada"`. The setter in the parent updates the signal and the parent's JSX re-evaluates `name()`, but the value flowing into `Greeting` is read by the destructure exactly once, so the child never sees the new value.

This is the cardinal rule of Solid props: **never destructure or alias `props` at the top of a component**. The same trap applies to `const name = props.name` — it is the same single, non-reactive read.

A few ways to fix this, all of them equivalent in behavior:

1. Just read `props.name` directly inside JSX (simplest, idiomatic).
2. If you want a local name, make it an _accessor function_ — `const name = () => props.name` — so each call re-reads the proxy.

Note that Solid components only run once. There is no "re-render of `Greeting`" the way React would do it; instead, the JSX expression `{props.name}` is its own tiny tracked computation that re-runs whenever the proxy's `name` property changes.

# Corrected component

```tsx
import { createSignal } from "solid-js";

function Greeting(props: { name: string }) {
  // Read props.name directly in JSX — the access is reactive.
  return <p>Hello {props.name}!</p>;
}

function App() {
  const [name, setName] = createSignal("Ada");
  return (
    <>
      <button onClick={() => setName("Lin")}>Change</button>
      <Greeting name={name()} />
    </>
  );
}
```

If you really want a local alias inside `Greeting`, make it a function:

```tsx
function Greeting(props: { name: string }) {
  const name = () => props.name; // accessor — re-reads the proxy each call
  return <p>Hello {name()}!</p>;
}
```

Both versions update correctly when the parent calls `setName("Lin")`.
