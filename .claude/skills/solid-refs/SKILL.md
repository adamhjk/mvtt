---
name: solid-refs
description: "Use this skill when accessing DOM elements directly in Solid (SolidJS) or building reusable element behaviour: refs (variable form `let el; <div ref={el}>`, callback form `<div ref={(node) => ...}>`, signal-as-ref for elements that mount/unmount), forwarding refs through user-defined components (`<Child ref={r}>` is automatically a callback inside `Child`), TypeScript definitive-assignment (`let el!: HTMLDivElement`), and **directives via `use:*`** — reusable DOM behaviour functions with signature `(element, accessor) => void` that run during render before the element is connected, can register effects and cleanups, and don't forward through user-defined components. Triggers on: ref, DOM element, focus, scrollIntoView, third-party library on element, forward ref, callback ref, signal ref, definitive assignment, use directive, use:foo, custom directive."
license: MIT
---

When you need to talk to a real DOM element — focus, scroll, integrate a third-party library, observe its size — you reach for `ref`. When you need that behaviour to be reusable across many elements, you wrap it in a `use:*` directive.

## Refs

### Variable form

```tsx
let myDiv!: HTMLDivElement;

return <div ref={myDiv}>...</div>;
```

Solid assigns the variable just **before** the element is appended to the DOM. After mount it's the live DOM node. The `!` is TypeScript's definitive-assignment assertion — necessary because the assignment happens through JSX magic, which TS doesn't see.

### Callback form

```tsx
return <div ref={(el) => {
  // el is the DOM node, BEFORE attachment to the DOM.
  observe(el);
}}>...</div>;
```

Use the callback form when you need to do something with the element at creation time, including registering cleanup:

```tsx
<div ref={(el) => {
  const ro = new ResizeObserver(/* ... */);
  ro.observe(el);
  onCleanup(() => ro.disconnect());
}} />
```

`onCleanup` runs when the surrounding owner is disposed (component unmount).

### When to use which

- **Variable form** — most cases. You access the element later, in `onMount`/event handlers.
- **Callback form** — when the *element* needs setup that includes a cleanup. Fine for most third-party-library integration.

### Signal as ref — for elements that come and go

If the element is inside `<Show>` or otherwise conditionally rendered, a plain `let` variable can be `undefined` at the wrong moment. Use a signal:

```tsx
const [el, setEl] = createSignal<HTMLParagraphElement>();

createEffect(() => {
  const node = el();
  if (!node) return;
  // node exists this render
});

return (
  <Show when={open()}>
    <p ref={setEl}>...</p>
  </Show>
);
```

The setter is just a function that takes the element — Solid will call it.

### `onMount` is when the variable is "ready"

```tsx
let el!: HTMLDivElement;

onMount(() => {
  el.focus();             // element is in the DOM here
});

return <input ref={el} />;
```

Pre-`onMount`, the element exists but is not attached to the DOM. For most "set up a third-party widget" flows, do it in `onMount`. For setting up things on the un-attached element (initial properties, IO observers), do it in the callback form of `ref`.

## Forwarding refs through components

When a user-defined component receives a `ref` prop, Solid converts it to a callback under the hood. Inside the component you can pass it to a child element:

```tsx
function MyInput(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;     // props.ref is forwarded automatically through spread
}

// or explicitly:
function MyInput(props: { ref?: HTMLInputElement | ((el: HTMLInputElement) => void) } & ...) {
  return <input ref={props.ref} {...rest} />;
}

// Parent:
let r!: HTMLInputElement;
<MyInput ref={r} />
```

Because Solid normalizes `ref` to callback form when it crosses a component boundary, you don't need a `forwardRef` helper.

## TypeScript

```tsx
let el!: HTMLDivElement;
let canvas!: HTMLCanvasElement;
let svg!: SVGElement;
```

For SVG sub-elements, use the specific interface (`SVGCircleElement`, etc.).

For callback refs:

```tsx
const setRef = (el: HTMLDivElement) => { /* ... */ };
<div ref={setRef} />
```

## Directives — `use:*`

A directive is a function `(element: Element, accessor: () => any) => void` that runs at element creation time. It receives the element and an accessor function for the directive's argument; it can register effects, cleanups, and listeners.

```tsx
function autoFocus(el: HTMLElement) {
  setTimeout(() => el.focus());
}

<input use:autoFocus />              // accessor returns true (no value form)
<input use:autoFocus={shouldFocus()} /> // accessor returns the value
```

Two-argument form (with a value):

```tsx
import { createRenderEffect, onCleanup } from "solid-js";

function clickOutside(el: HTMLElement, accessor: () => () => void) {
  const handler = (e: MouseEvent) => {
    if (!el.contains(e.target as Node)) accessor()();
  };
  document.addEventListener("click", handler);
  onCleanup(() => document.removeEventListener("click", handler));
}

<div use:clickOutside={() => setOpen(false)}>...</div>
```

The directive runs **during render, before the element is attached**, so it can register effects and listeners that are cleaned up automatically when the element's owner disposes.

### Two-way input model

The classic example — a custom `model` directive that two-way-binds an input to a signal:

```tsx
import { createRenderEffect, onCleanup, type Signal, type Setter, type Accessor } from "solid-js";

function model(el: HTMLInputElement, accessor: () => Signal<string>) {
  const [value, setValue] = accessor();
  createRenderEffect(() => (el.value = value()));
  const onInput = (e: Event) => setValue((e.target as HTMLInputElement).value);
  el.addEventListener("input", onInput);
  onCleanup(() => el.removeEventListener("input", onInput));
}

const [name, setName] = createSignal("");
<input type="text" use:model={[name, setName]} />
```

### Directives don't forward through user-defined components

`use:foo` only attaches to **native elements** (HTML/SVG, including custom elements). Putting `use:foo` on `<MyComponent />` does nothing. To carry directive-like behaviour through a component, expose a `ref` callback prop instead.

### TypeScript typing for `use:*`

Augment `JSX.Directives`:

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

Or use `DirectiveFunctions` to derive types from the directive function signature:

```ts
declare module "solid-js" {
  namespace JSX {
    interface DirectiveFunctions {
      model: typeof model;
    }
  }
}
```

See `solid-typescript`.

### Tree-shaking gotcha for directives

If your directive is imported from another file but only referenced via `use:foo` (not as a value), the bundler may treat the import as type-only and tree-shake it. Either:
- Configure `babel-preset-typescript` with `onlyRemoveTypeImports: true`.
- For `vite-plugin-solid`: `solidPlugin({ typescript: { onlyRemoveTypeImports: true } })`.
- Or add a no-op reference: `directive; <input use:directive />`.

## Common pitfalls

- **Reading the ref before mount.** `console.log(el)` at the top of the component logs `undefined`. Read in `onMount` or event handlers.
- **Variable ref inside `<Show>`.** May be unset when you try to read it. Use a signal-as-ref.
- **`use:foo` on a component.** No effect. Use `ref` callback prop instead.
- **Directive imported but tree-shaken.** Configure your bundler or add an explicit reference.
- **Forgetting `!` in TS.** `let el: HTMLDivElement` errors because TS thinks it's never assigned. Use `let el!: HTMLDivElement`.

## Related

- `solid-jsx-attributes` — `ref` and `use:` syntax.
- `solid-effects` — `onMount`, `onCleanup` (refs are commonly used with these).
- `solid-typescript` — typing directives, custom events, refs.
