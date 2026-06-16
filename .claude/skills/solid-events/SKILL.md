---
name: solid-events
description: "Use this skill when handling user input or DOM events in Solid (SolidJS): pointer/mouse/keyboard/form/touch events, custom events, capture-phase listeners, listener options. Covers Solid's two event systems — **delegated** (`onClick`, `onInput`, ...) attached at the document and dispatched on bubble, vs **native** (`on:click`, `on:my-event`) attached directly to the element — when each is appropriate, the case-sensitivity rule (delegated is case-insensitive, native is case-sensitive), the array binding form `onClick={[handler, data]}` for cheap currying, the full list of delegated events, the `stopPropagation` gotcha (delegated events listen at the document so `stopPropagation()` on a parent is too late), how Portals propagate events through the component tree (not the DOM tree), and the listener-options object for `once`/`passive`/`capture`/`signal`. Triggers on: event handler, onClick, onInput, on:, on*, event delegation, stopPropagation, custom event, on:custom-event, listener options, once, passive, capture, preventDefault, currentTarget, target."
license: MIT
---

Solid has two event-handler systems: **delegated** (the default, attached at the document) and **native** (attached directly to the element). Pick the right one for each case.

## The two systems

### Delegated — `onClick`, `onInput`, `onKeyDown`...

```tsx
<button onClick={handle}>x</button>
<input onInput={(e) => setValue(e.currentTarget.value)} />
```

- A single listener is added to `document` per event type.
- Events bubble up; Solid dispatches them to the element they originated from (and to ancestors with handlers).
- Listener handlers are stored as a property on the element; replacing them is cheap.
- **Case-insensitive on the JSX side** — `onClick` and `onclick` both work.
- Only certain events are delegated (see below).

### Native — `on:click`, `on:my-event`...

```tsx
<div on:scroll={handleScroll} />
<canvas on:wheel={handleWheel} />
<my-element on:custom-event={handleCustom} />
```

- A real `addEventListener` call for that event on that element.
- **Case-sensitive** — `on:click` works for the native click event; `on:Click` listens for an event literally named `"Click"`.
- Required for events not in Solid's delegated list, custom events, or when you need listener options.
- Slightly more expensive (more listener allocations) but correct in all cases.

## When to use which

| Use delegated (`onClick`...) when                      | Use native (`on:click`...) when                                |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| Standard event from the delegated list.                | Event isn't delegated (`scroll`, `wheel`, `submit`, `change`). |
| Default UI interaction.                                | Custom-element events.                                         |
| You don't need listener options.                       | You need `once`/`passive`/`capture`/`signal`.                  |
| You don't need `stopPropagation` to prevent ancestors. | You do need `stopPropagation` to actually stop.                |

## The delegated event list

Only these events are delegated. All others must use `on:*`.

`beforeinput`, `click`, `dblclick`, `contextmenu`, `focusin`, `focusout`, `input`, `keydown`, `keyup`, `mousedown`, `mousemove`, `mouseout`, `mouseover`, `mouseup`, `pointerdown`, `pointermove`, `pointerout`, `pointerover`, `pointerup`, `touchend`, `touchmove`, `touchstart`.

Notable absences: `scroll`, `wheel`, `submit`, `change`, `focus`, `blur`, `load`, `error`. Use `on:scroll` etc. for those.

## Array binding form — cheap currying

You can pass `[handler, data]` instead of a function. The `data` becomes the **first** argument to the handler; the event is the second.

```tsx
const handle = (id: string, e: MouseEvent) => removeUser(id);
<For each={users()}>{(u) => <button onClick={[handle, u.id]}>delete</button>}</For>;
```

This avoids creating a new closure per row, which can matter inside large lists. Mostly a micro-optimization; readability often wins.

## Listener options on `on:*`

Pass an object that implements `EventListenerObject` (i.e. has `handleEvent`) plus any standard `AddEventListenerOptions`:

```tsx
<button on:click={{ handleEvent: fn, once: true }}>click</button>
<div on:wheel={{ handleEvent: fn, passive: true }} />
<button on:click={{ handleEvent: fn, capture: true }}>capture</button>

const ac = new AbortController();
<button on:click={{ handleEvent: fn, signal: ac.signal }} />
// Later: ac.abort() removes the listener.
```

This replaces the deprecated `oncapture:*` syntax.

## `currentTarget` vs `target`

- **`currentTarget`** — the element the handler is attached to. Always typed correctly in Solid (e.g. `HTMLInputElement` for an input's `onInput`).
- **`target`** — the element that originated the event. Could be a child element with looser typing.

```tsx
<input
  onInput={(e) => {
    e.currentTarget.value; // string — typed
    e.target; // EventTarget | null — needs narrowing
  }}
/>
```

Prefer `currentTarget` for accessing properties of the element you bound to.

## `preventDefault` and `stopPropagation`

```tsx
<form onSubmit={(e) => { e.preventDefault(); save(); }}>...</form>
<a onClick={(e) => { e.preventDefault(); navigate(href); }}>x</a>
```

`preventDefault` works the same way as in plain DOM.

`stopPropagation` is **tricky with delegated events**:

```tsx
<div onMouseMove={() => console.log("div")}>
  <button
    onClick={(e) => {
      e.stopPropagation();
      console.log("btn");
    }}
  >
    x
  </button>
</div>
```

If the outer `div` listens for the same event via the same delegated system, `e.stopPropagation()` works because Solid checks per-element handlers in dispatch order. **But if the outer listener is a non-Solid `addEventListener` on a DOM ancestor**, the delegated event has already reached the document, so `stopPropagation` cannot prevent it.

If you need bulletproof stop-propagation, use `on:click={...}` (native), so `stopPropagation` actually stops the bubble at that element.

## Portals propagate through the component tree

```tsx
<div onClick={() => console.log("outer")}>
  <Portal mount={document.body}>
    <button onClick={() => console.log("button")}>x</button>
  </Portal>
</div>
```

Clicking the button logs `button` then `outer`, even though the button is mounted outside the `div` in the DOM. Solid's delegated system propagates events along the **component tree**, not the DOM tree. This is usually what you want.

If you need DOM-tree behaviour, use `on:click` (native).

## Custom events

For events you dispatch yourself (or that custom elements emit):

```tsx
const ref = (el: HTMLElement) => {
  ref = el;
};

<>
  <button onClick={() => ref.dispatchEvent(new CustomEvent("rename", { detail: { id: 1 } }))}>
    rename
  </button>
  <div ref={ref} on:rename={(e: CustomEvent) => console.log(e.detail.id)} />
</>;
```

`on:` is required because the event name is custom (not in the delegated list).

For TypeScript:

```ts
declare module "solid-js" {
  namespace JSX {
    interface CustomEvents {
      rename: CustomEvent<{ id: number }>;
    }
  }
}
```

See `solid-typescript`.

## Event handlers are NOT reactive

Reading a signal inside a handler gives the current value (when the event fires). But assigning a new handler from a signal does **not** swap the listener:

```tsx
<button onClick={handler()} />   // ❌ Reads handler() ONCE, attaches that.
<button onClick={(e) => handler()(e)} />   // ✓ Wrapper reads on every click.
```

If you want a reactive handler, wrap the call:

```tsx
<button onClick={(e) => props.onClick?.(e)} />
```

This is what most parent-passed-prop handlers look like.

## Form events

`onInput` fires on every keystroke; `onChange` on input elements only fires on blur (different from React!). Use `onInput` for live updates.

```tsx
<input onInput={(e) => setQ(e.currentTarget.value)} value={q()} />
```

For checkboxes:

```tsx
<input
  type="checkbox"
  checked={isChecked()}
  onChange={(e) => setChecked(e.currentTarget.checked)}
/>
```

For form submit:

```tsx
<form
  onSubmit={(e) => {
    e.preventDefault(); /* ... */
  }}
>
  ...
</form>
```

(`submit` is **not** delegated; the JSX prop is still `onSubmit`, but it routes through `on:submit`. This pre-handles the case for you.)

## TypeScript event handler types

```ts
import type { JSX } from "solid-js";

type ChangeHandler = JSX.EventHandler<HTMLInputElement, InputEvent>;
type KeyHandler = JSX.EventHandler<HTMLInputElement, KeyboardEvent>;
```

Inline handlers in JSX get inferred for free:

```tsx
<input
  onInput={(e) => {
    /* e is InputEvent, e.currentTarget is HTMLInputElement */
  }}
/>
```

For listener-options form, use `JSX.EventHandlerWithOptions`:

```ts
const h: JSX.EventHandlerWithOptions<HTMLDivElement, Event> = {
  once: true,
  handleEvent(e) { ... },
};
<div on:click={h} />
```

## Common pitfalls

- **Using a non-delegated event with `on*`.** Won't fire. Use `on:` (e.g. `on:scroll`, `on:wheel`).
- **`onChange` for input value.** Fires on blur, not keystroke. Use `onInput`.
- **Handler from a signal.** `onClick={handler()}` reads once. Wrap or pass the function reference.
- **`stopPropagation` on a delegated handler.** Doesn't stop non-Solid ancestor listeners. Use native `on:click` if needed.
- **Wrong case on `on:*`.** Native is exact-case. `on:click` works; `on:Click` listens for an event literally named `"Click"`.

## Related

- `solid-jsx-attributes` — attribute reference.
- `solid-typescript` — `JSX.EventHandler`, `CustomEvents`, `EventHandlerWithOptions`.
- `solid-control-flow` — `<Portal>` propagation behaviour.
- `solid-refs` — refs (often used together with native event listeners in `onMount`).
