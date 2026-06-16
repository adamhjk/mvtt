# Why the greeting doesn't update

In Solid, `props` is a **reactive proxy**, not a plain object. Each property is a getter that subscribes the caller to the underlying signal at the moment it is read. Solid components also run **once** — the function body is not re-executed when state changes; only the JSX bindings re-evaluate.

When you write:

```tsx
const { name } = props;
```

…you read `props.name` exactly once, at component creation time, and store that one value (`'Ada'`) in a local `const`. From that point on `name` is a plain string with no connection to the parent's signal. The JSX `{name}` is a static reference to that captured string, so updates to the parent never reach it.

The same is true for aliasing (`const name = props.name;`) or default-via-destructure (`const { name = 'Ada' } = props`) — anything that reads the prop outside of a tracking scope freezes its value.

Note: passing `name={name()}` from the parent is **fine**. The parent's JSX is a tracking scope, so when `name` changes the parent re-binds the `name` prop on `<Greeting>`. The bug is purely in the child destructuring that prop.

## The fix

Read the prop **inside the JSX** (or inside an effect/memo) so the access happens in a tracking scope:

```tsx
function Greeting(props) {
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

If you genuinely need to pull several props apart while preserving reactivity (e.g. to forward a subset), use `splitProps`:

```tsx
import { splitProps } from "solid-js";

function Greeting(props) {
  const [local, others] = splitProps(props, ["name"]);
  return <p {...others}>Hello {local.name}!</p>;
}
```

And for default values, use `mergeProps` instead of `=` in a destructure:

```tsx
import { mergeProps } from "solid-js";

function Greeting(props) {
  const merged = mergeProps({ name: "Ada" }, props);
  return <p>Hello {merged.name}!</p>;
}
```

## Rule of thumb

Never destructure or alias `props` at the top of a Solid component. Always go through `props.x`, `splitProps`, or `mergeProps` — they preserve the getter, which is what keeps reactivity alive.
