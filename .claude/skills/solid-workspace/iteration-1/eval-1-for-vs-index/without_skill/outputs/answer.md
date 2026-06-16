# Use `<Index>`, not `<For>`

## Recommendation

For a list of input fields where the order is stable and you only add/remove at the ends (or even by splice), **use `<Index>`**. That alone will fix the focus-loss problem.

## Why

Solid's two list helpers key items differently, and that keying decides whether the underlying DOM node is reused or thrown away.

- **`<For each={items}>`** keys by **identity of the item value** (reference equality). When an item value changes, the DOM row tied to that old value is disposed and a new row is created for the new value. If your items are **primitives** (strings, numbers) — like the current text in each input — every keystroke replaces the value at that index, so `<For>` thinks "old item is gone, new item arrived," tears down the `<input>`, and mounts a fresh one. That fresh `<input>` is a brand-new DOM node, so the browser's focus is lost.
- **`<Index>` keys by **position** (the array index). The DOM row at position `i` is reused as long as the array has something at position `i`; only the *contents* update reactively. The child callback receives a **signal\*\* for the value (`item()`), not a plain value, because the value at that slot can change over time without the row being rebuilt. This is exactly what you want for a stable-order list of editable primitives — the `<input>` element survives across keystrokes and keeps focus.

Rule of thumb:

| Situation                                                                    | Use       |
| ---------------------------------------------------------------------------- | --------- |
| List of objects with stable identity, items can move/reorder                 | `<For>`   |
| List of primitives, or stable order, or you mostly edit in place             | `<Index>` |
| Each row owns an `<input>`/`<textarea>`/`<select>` you don't want to remount | `<Index>` |

A secondary cause of focus loss, even with `<For>`, is **recreating the array on every keystroke with new object identities** (e.g. `setItems(items().map(...))` rebuilding everything). `<Index>` sidesteps that too because it doesn't care about identity — but if you stay on `<For>` you must mutate immutably _and_ keep stable keys. `<Index>` is simpler.

## The fix

### Before (broken — focus is lost on every keystroke)

```tsx
import { createSignal, For } from "solid-js";

export function FieldList() {
  const [fields, setFields] = createSignal<string[]>([""]);

  const update = (i: number, value: string) => {
    setFields((prev) => prev.map((v, idx) => (idx === i ? value : v)));
  };

  const add = () => setFields((prev) => [...prev, ""]);
  const remove = (i: number) => setFields((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <div>
      <For each={fields()}>
        {(value, i) => (
          <div>
            {/* `value` is a plain string. When it changes, <For> sees a new
                identity at this slot and remounts the <input>, blowing focus. */}
            <input value={value} onInput={(e) => update(i(), e.currentTarget.value)} />
            <button onClick={() => remove(i())}>x</button>
          </div>
        )}
      </For>
      <button onClick={add}>add</button>
    </div>
  );
}
```

### After (fixed — focus is preserved)

```tsx
import { createSignal, Index } from "solid-js";

export function FieldList() {
  const [fields, setFields] = createSignal<string[]>([""]);

  const update = (i: number, value: string) => {
    setFields((prev) => {
      const next = prev.slice();
      next[i] = value;
      return next;
    });
  };

  const add = () => setFields((prev) => [...prev, ""]);
  const remove = (i: number) => setFields((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <div>
      {/* Index keys by position. The <input> at slot i is reused across
          keystrokes; only its `value` updates reactively. Focus survives. */}
      <Index each={fields()}>
        {(value, i) => (
          <div>
            {/* Note the two API differences vs <For>:
                - `value` is a SIGNAL: call it as `value()`
                - `i` is a plain number, not a signal */}
            <input value={value()} onInput={(e) => update(i, e.currentTarget.value)} />
            <button onClick={() => remove(i)}>x</button>
          </div>
        )}
      </Index>
      <button onClick={add}>add</button>
    </div>
  );
}
```

### Even nicer with a store

If you'd rather mutate the array in place (and get fine-grained reactivity per slot for free), pair `<Index>` with `createStore`:

```tsx
import { Index } from "solid-js";
import { createStore, produce } from "solid-js/store";

export function FieldList() {
  const [state, setState] = createStore<{ fields: string[] }>({ fields: [""] });

  return (
    <div>
      <Index each={state.fields}>
        {(value, i) => (
          <div>
            <input value={value()} onInput={(e) => setState("fields", i, e.currentTarget.value)} />
            <button
              onClick={() =>
                setState(
                  "fields",
                  produce((arr) => {
                    arr.splice(i, 1);
                  }),
                )
              }
            >
              x
            </button>
          </div>
        )}
      </Index>
      <button
        onClick={() =>
          setState(
            "fields",
            produce((arr) => {
              arr.push("");
            }),
          )
        }
      >
        add
      </button>
    </div>
  );
}
```

The store path syntax `setState("fields", i, value)` updates exactly that slot, so other slots aren't even notified — the inputs that aren't being typed in don't re-evaluate at all.

## Quick mental checklist when this happens again

1. Is the row's child a primitive? -> `<Index>`.
2. Is the child callback's first argument a plain value (not a signal)? -> you're on `<For>`; consider `<Index>`.
3. Does an action that should be in-place edit cause a remount? -> keying mismatch; switch to `<Index>` or stop creating fresh object identities in `<For>`.
4. Need both reorder _and_ in-place edit? -> use `<For>` with stable object identities (don't `.map()` to new objects on every keystroke), or model the list with `createStore` so individual slots update without a parent-array replacement.
