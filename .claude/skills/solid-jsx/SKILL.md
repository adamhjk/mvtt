---
name: solid-jsx
description: "Use this skill when writing or debugging JSX in Solid (SolidJS): single-root requirement, self-closing tags, dynamic expressions in `{ }`, the difference between HTML attributes and JSX properties, fragments (`<>...</>`), inline styles requiring `{{ }}` (object) or `{`...`}` (string), the order in which expressions are applied to elements (matters for `<input type=\"range\">`), event handler casing, and how Solid compiles JSX into DOM operations directly (no virtual DOM). Triggers on: JSX, fragment, single root, self-closing, expression, JSX in Solid, properties vs attributes, inline style, JSX compiles, DOM nodes, double curly braces."
license: MIT
---

JSX in Solid looks like JSX in React but compiles very differently: it produces real DOM nodes at runtime and binds dynamic expressions through the reactive system. Understanding the rules avoids surprises.

## What JSX is in Solid

Solid's JSX compiler (via `babel-preset-solid` or `vite-plugin-solid`) turns:

```tsx
const el = <h1>Hello {name()}</h1>;
```

into something like:

```ts
const _tmpl = template(`<h1>Hello </h1>`);
const el = _tmpl();
insert(el, name);   // creates a reactive computation that updates the text node when `name` changes
```

Key consequences:

- The result is a real `HTMLElement` (or fragment, or text node).
- Static parts of the template are cloned from a single template element.
- Dynamic `{ expression }` slots are wrapped in fine-grained reactive computations.
- There is no virtual DOM. There is no diffing.

## The five rules

1. **One root.** A component must return a single root JSX expression. Use `<>...</>` for fragments.

   ```tsx
   // ❌
   return <p>a</p><p>b</p>;
   // ✓
   return <><p>a</p><p>b</p></>;
   // ✓
   return <div><p>a</p><p>b</p></div>;
   ```

2. **Self-close every tag.** Even `<img>`, `<br>`, `<hr>`, `<input>`. Unclosed tags are a syntax error.

   ```tsx
   <img src="x.png" />     {/* ✓ */}
   <br />
   ```

3. **Dynamic expressions in `{ }`.** Anything that isn't a static string goes in braces.

   ```tsx
   <p>{name()}</p>
   <button onClick={handle}>x</button>
   <a href={`/users/${id()}`}>profile</a>
   ```

4. **Object literals need double braces.** The first `{` opens JSX expression mode; the inner `{` is the object.

   ```tsx
   <div style={{ color: "red", "font-size": "14px" }} />     {/* ✓ */}
   <div style={"color: red"} />                              {/* ✓ — string */}
   ```

   For style objects, **CSS property names are kebab-case strings**, not camelCase — `"font-size"`, not `fontSize`. (See `solid-jsx-attributes`.)

5. **Capital-letter components, lowercase HTML.** `<MyThing />` calls a component; `<mything />` is an unknown HTML tag. (See `solid-components`.)

## Properties vs attributes

HTML has two related concepts:

- **Attributes** — set on the markup, parsed once.
- **Properties** — JS values on the DOM node.

Solid's JSX maps each prop in JSX to either a property or an attribute, depending on the element and the key. Most of the time you don't care; for control over the choice, use the `attr:`/`prop:`/`bool:` namespace prefixes (see `solid-jsx-attributes`).

Two important consequences:

- **`class` not `className`.** Solid uses HTML's actual attribute name. (`className` was deprecated in 1.4.)
- **Some elements care about attribute order.** A famous case is `<input type="range" min={0} max={100} value={50} />` — set `value` *after* `min`/`max` or browsers will clamp it. Solid emits expressions in source order.

## Static vs dynamic

```tsx
<button class="primary" disabled={isDisabled()}>{label()}</button>
```

Solid's compiler optimizes **static** parts (the `class="primary"`) into the cloned template, and only wires up the **dynamic** parts (the `disabled` and the text) to reactive computations. The more you keep static, the cheaper the component.

This means **don't bother memoizing tiny static JSX** — Solid already turned it into a one-time clone.

## Conditional content

Use control-flow components, not raw `if`:

```tsx
<Show when={user()} fallback={<Loading />}>
  <UserCard user={user()!} />
</Show>

<Switch fallback={<NotFound />}>
  <Match when={state() === "loading"}><Loading /></Match>
  <Match when={state() === "error"}><Error /></Match>
  <Match when={state() === "ready"}><Data /></Match>
</Switch>
```

A ternary in JSX also works for simple cases but loses some of `<Show>`'s features (function child accessor, `keyed`):

```tsx
<div>{user() ? <UserCard user={user()!} /> : <Loading />}</div>
```

See `solid-control-flow`.

## Lists

Use `<For>` or `<Index>`, never raw `.map`:

```tsx
<ul>
  <For each={items()}>
    {(item, i) => <li>{i()}: {item.name}</li>}
  </For>
</ul>
```

`.map` works but creates a non-keyed list and updates badly when items move.

See `solid-control-flow`.

## Fragments

```tsx
<>
  <p>a</p>
  <p>b</p>
</>
```

Fragments emit their children directly to the parent, no wrapper element. They are fine in Solid; they compile to an array of DOM nodes.

## Spread

```tsx
<input {...inputProps} value={v()} />
```

Spreads merge with later props. Solid preserves reactive proxies under spread, so you can spread a `props` object you received and reactivity flows through.

## Children as functions

For control-flow components like `<For>`, `<Show keyed>`, the children **must be a function**, not raw JSX. The function receives the item/value:

```tsx
<For each={items()}>
  {(item, index) => <Row data={item} pos={index()} />}
</For>

<Show when={user()} keyed>
  {(u) => <p>{u.name}</p>}
</Show>
```

This is JSX-as-function-child, and it's how Solid avoids creating children until they're needed.

## Dynamic component types

To pick a component at runtime, use `<Dynamic>`:

```tsx
import { Dynamic } from "solid-js/web";

const map = { red: RedView, blue: BlueView };
return <Dynamic component={map[selected()]} someProp="x" />;
```

See `solid-control-flow`.

## Refs in JSX

```tsx
let el!: HTMLDivElement;
return <div ref={el}>...</div>;
```

The `ref` attribute is a write target — Solid assigns the element to your variable just before mount. See `solid-refs`.

## TypeScript setup

```jsonc
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "solid-js"
  }
}
```

Solid's compiler does the JSX transform at build time; TypeScript only needs to type-check the JSX, not transform it. See `solid-typescript`.

## Common pitfalls

- **Multi-root return.** Wrap in `<>...</>`.
- **Forgetting `()` on a signal in JSX.** `<p>{count}</p>` renders the function reference, not the value (and Solid treats it as a static node — won't react). Always `count()`.
- **Inline arrow as a component.** `<Foo>{() => <p/>}</Foo>` is a function child, only valid for components that expect functions (control-flow ones). For normal components, use `<Foo>{props.children}</Foo>` directly.
- **Style as camelCase object.** Use kebab-case strings: `{ "font-size": "1rem" }`.
- **`class={...}` overwriting `classList`.** A reactive `class` value can stomp on `classList`-managed classes. Pick one (or read both as a single computed string).
- **Putting markup-affecting code in the body, expecting re-runs.** The body runs once. Move it inside JSX or `createEffect`.

## Related

- `solid-components` — capitalization, run-once lifecycle.
- `solid-jsx-attributes` — every prefix and attribute (`class`, `classList`, `style`, `attr:`, `prop:`, `bool:`, `on:`, `use:`).
- `solid-events` — event handlers.
- `solid-control-flow` — `<Show>`, `<For>`, `<Index>`, `<Switch>`, `<Dynamic>`, `<Portal>`, `<Suspense>`, `<ErrorBoundary>`.
- `solid-typescript` — JSX type setup and JSX.Element.
