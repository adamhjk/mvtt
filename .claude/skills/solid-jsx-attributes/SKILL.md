---
name: solid-jsx-attributes
description: "Use this skill for any non-event JSX attribute in Solid (SolidJS) — what each one does, how it merges, when to use which prefix. Covers `class` (preferred over deprecated `className`), `classList` (object of `{ name: bool }`, applied per-class), `style` (string or kebab-case object including CSS variables `--my-var`), `ref` (variable or callback), the namespace prefixes `attr:*` (force HTML attribute), `prop:*` (force DOM property — preserves objects/arrays), `bool:*` (boolean attribute), `on:*` (native event, case-sensitive), `on*` (delegated event), `oncapture:*` (deprecated capture form), `use:*` (custom directive), and content attributes `innerHTML`, `textContent`, `innerText`. Also: when reactive `class` and `classList` conflict, the SSR merge behavior, and the special `once` flag in `on:` listener options. Triggers on: classList, class, style, ref, attr:, prop:, bool:, innerHTML, textContent, innerText, JSX attributes, jsx-attributes, kebab case style, CSS variables in JSX, on:, oncapture:, use:."
license: MIT
---

Solid recognizes a small but specific set of JSX attribute prefixes. Knowing them prevents weird behaviour around classes, properties, custom elements, and TypeScript-typed directives.

## Quick reference

| Attribute / prefix | Type | Purpose |
|---|---|---|
| `class` | `string` | Set the `class` attribute. Replaces `className` (deprecated). |
| `classList` | `Record<string, boolean \| undefined>` | Toggle classes individually from a map. |
| `style` | `string \| CSSProperties` | Inline styles. Object keys must be **kebab-case**. |
| `ref` | `T \| (el: T) => void` | Capture the DOM element. |
| `attr:foo` | `string \| boolean \| number` | Force `setAttribute("foo", ...)`. Useful for custom attributes. |
| `prop:foo` | `any` | Force property assignment. Preserves objects, arrays, etc. |
| `bool:foo` | `boolean` | Boolean attribute (presence-based) — equivalent to `attr:foo` with toggle semantics. |
| `on:foo` | `(e) => void \| EventListenerObject` | Native event listener (`addEventListener`). Case-sensitive. |
| `onfoo` / `onFoo` | `(e) => void \| [handler, data]` | Delegated event listener (Solid's synthetic event system). |
| `oncapture:foo` | `(e) => void` | **Deprecated.** Native capture-phase listener. Use `on:foo` with `{ capture: true, handleEvent }`. |
| `use:dir` | directive arg | Apply a custom directive. |
| `innerHTML` / `textContent` / `innerText` | `string` | Content properties. `innerHTML` does not parse JSX — pass HTML as a string. |
| `once` | `boolean` (in event-listener objects) | Run the listener once. |

Plus all standard HTML attributes (`id`, `href`, `disabled`, `value`, etc.).

## `class` and `classList`

`class` sets the whole `class` attribute. `classList` toggles individual classes from a map.

```tsx
<div class="card primary" />

<div classList={{
  active: state.active,
  editing: state.editingId === row.id,
  disabled: state.disabled,
}} />
```

### Multiple classes per key

Keys can be space-separated; each is toggled independently:

```tsx
<div classList={{ "btn primary": true, danger: hasError() }} />
```

### Dynamic key

```tsx
<div classList={{ [variant()]: true }} />
```

### Combining `class` and `classList`

If both are present, `classList` runs after `class`. But a **reactive** `class` write *re-sets* the whole attribute and can clobber `classList`-managed classes mid-flight. Pick one as your source of truth, or compute a single class string and pass it to `class`.

```tsx
// Safe: class is static, classList is dynamic.
<div class="card" classList={{ active: isActive() }} />

// Risky: both reactive.
<div class={cls()} classList={{ active: isActive() }} />
```

### `className` is deprecated

Use `class`. (Solid 1.4+ tolerates `className` but warns.)

## `style`

Two forms.

### String form

```tsx
<div style={`color: ${color()}; height: ${h()}px`} />
```

Cheap to write; replaces the whole inline style on each update.

### Object form (kebab-case keys)

```tsx
<div style={{
  color: "red",
  "background-color": bg(),
  "font-size": `${size()}px`,
}} />
```

Each property is set with `element.style.setProperty(...)`. Only changed properties are re-set. **Keys must be kebab-case** — `fontSize` won't work.

### CSS variables

```tsx
<div style={{ "--accent": "tomato", "--space": `${s()}px` }} />
```

CSS custom properties pass through unchanged.

### Removing properties

A `null` or `undefined` value removes the property:

```tsx
<div style={{ color: condition() ? "red" : null }} />
```

If the entire `style` is falsy, the `style` attribute is removed.

## `ref`

Two forms — variable assignment or callback.

```tsx
// variable form
let el!: HTMLDivElement;
return <div ref={el}>...</div>;

// callback form (runs before insertion)
return <div ref={(node) => { el = node; }} />;
```

In the variable form, Solid assigns the variable just before insertion. In TypeScript, use `let el!: HTMLDivElement` (definitive assignment) so the type is non-undefined.

For refs to elements that come and go (e.g. inside `<Show>`), use a signal as the ref destination. See `solid-refs`.

## `attr:*`

Force `setAttribute`. Useful for:
- Custom data attributes that should appear in markup.
- Custom-element attributes that aren't typed as DOM properties.
- ARIA attributes.

```tsx
<my-element attr:custom-data="value" />
<button attr:aria-pressed={pressed()} />
```

A `boolean` value is coerced to the string `"true"`/`"false"`. To remove, pass `false`/`null`/`undefined` and use `bool:` instead if you want presence-based semantics.

## `prop:*`

Force property assignment, bypassing the attribute layer. Preserves objects, arrays, dates, etc.

```tsx
<canvas prop:dataset={{ id: "1" }} />        {/* sets el.dataset reference */}
<input prop:valueAsNumber={n()} />           {/* sets the JS property directly */}
<my-element prop:complexConfig={{ foo: 1 }} />
```

Use when:
- An attribute serializes incorrectly (e.g. arrays).
- A custom element exposes a property that doesn't have a string-form attribute.

## `bool:*`

Boolean (presence-based) attribute.

```tsx
<input bool:disabled={isDisabled()} />
```

`true` adds the attribute (with empty string value); `false` removes it. This is more correct than `attr:disabled={isDisabled()}` (which sets the literal string `"true"`/`"false"`).

For most native boolean attributes (`disabled`, `readonly`, `required`, `checked`...), the standard `disabled={isDisabled()}` already does the right thing — you only need `bool:` for custom elements.

## `on:*` and `on*` and `oncapture:*`

See `solid-events` for the full event story. Quick summary:

- `onClick={...}` — delegated, lowercase or camelCase, attached at document.
- `on:click={...}` — native, case-sensitive, attached to the element.
- `oncapture:click={...}` — **deprecated**. Use `on:click={{ handleEvent: fn, capture: true }}`.

```tsx
<div on:my-event={handler} />                     {/* custom event, exact case */}
<button on:click={{ handleEvent: f, once: true }} /> {/* listener options */}
```

## `use:*`

Apply a custom directive — a function with signature `(element, accessor) => void` invoked at element creation time. Used for reusable element setup (focus management, intersection observers, two-way binding, etc.).

```tsx
function autoFocus(el: HTMLElement) {
  setTimeout(() => el.focus());
}

<input use:autoFocus />
```

With an argument:

```tsx
function model(el: HTMLInputElement, accessor: () => Signal<string>) {
  const [v, setV] = accessor();
  createRenderEffect(() => (el.value = v()));
  el.addEventListener("input", e => setV((e.target as HTMLInputElement).value));
}

<input use:model={[name, setName]} />
```

Directives are NOT forwarded through user-defined components — they only attach to native elements. For TypeScript typing, augment `JSX.Directives` (see `solid-typescript`).

See `solid-refs` for refs and directives, `solid-typescript` for typing them.

## `innerHTML`, `textContent`, `innerText`

```tsx
<div innerHTML={trustedMarkup()} />
<p textContent={text()} />
```

These set the corresponding DOM property. **`innerHTML` is unsafe** — only use for content you trust or have sanitized. Solid does not sanitize for you.

When you set any of these, the children of the element should be empty in JSX:

```tsx
<div innerHTML={html()}></div>      {/* fine */}
<div innerHTML={html()}>x</div>     {/* the "x" is overwritten on every update */}
```

## SSR notes

When rendering on the server, `class`, `className`, and `classList` are all merged into the emitted `class` attribute. `style` objects are serialized into the `style` attribute. `prop:*` and `use:*` are not serialized (they apply only to live DOM).

## TypeScript

Solid's JSX types are exposed via `solid-js`. Standard HTML/SVG attributes are covered. For custom prefixes, augment the corresponding interface — see `solid-typescript`:

- `JSX.Directives` — for `use:foo`.
- `JSX.CustomEvents` — for `on:Foo`.
- `JSX.ExplicitProperties` — for `prop:foo`.
- `JSX.ExplicitAttributes` — for `attr:foo`.
- `JSX.ExplicitBoolAttributes` — for `bool:foo`.

## Common pitfalls

- **camelCase style keys.** Use `"font-size"`, not `fontSize`.
- **Reactive `class` clobbering `classList`.** Avoid mixing reactive class strings with classList.
- **`oncapture:foo`.** Deprecated; use `on:foo={{ handleEvent, capture: true }}`.
- **`use:foo` on a component.** Doesn't forward — directives only apply to native elements.
- **`innerHTML` with user content.** XSS. Sanitize first.
- **`prop:` for ordinary attributes that already work.** Unnecessary; just write `value={v()}`.

## Related

- `solid-events` — event handlers in depth.
- `solid-refs` — refs and directives.
- `solid-jsx` — JSX semantics.
- `solid-typescript` — typing directives, custom events, explicit prop maps.
