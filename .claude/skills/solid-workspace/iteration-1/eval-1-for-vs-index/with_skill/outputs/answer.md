# Use `<Index>`, not `<For>`

## Recommendation

Use **`<Index>`**. It is the right primitive for a list of input fields where the order is stable.

## Why you are losing focus

You are almost certainly using `<For>` with the field's text value as the array element (e.g. `string[]`). `<For>` keys **by reference**: when a keystroke replaces `items[i]` with a new string, `<For>` sees a brand-new value at that slot, disposes the old row, and creates a new one. The old `<input>` DOM node is destroyed and a fresh one mounts in its place — and a fresh DOM node has no focus, so the caret jumps out as you type.

Note this is not the _whole_ list re-rendering — Solid components run once and the surrounding component never re-runs. What you are seeing is per-row reconciliation: every keystroke writes a new string into the array, `<For>` treats that slot as a new item, and that single row gets torn down and remounted. It looks like "the list re-rendered" because the input you were typing in vanishes.

`<Index>` keys **by position** instead:

- The component for each _position_ is created once when the array grows and disposed when it shrinks.
- The element at each slot is exposed as a **signal** (`item()`), not a value. When `items[i]` changes, the signal updates in place — the row's DOM (including your focused `<input>`) is reused, and only the bound text value changes.
- `index` is a plain number (not a signal), since the position is fixed for that rendered row.

The decision-rule from the skill matches your situation exactly:

| You have                                                  | Use       |
| --------------------------------------------------------- | --------- |
| Array of primitives (strings, numbers, booleans)          | `<Index>` |
| Form fields tied to position                              | `<Index>` |
| Array of objects with stable identity (id), order changes | `<For>`   |
| Sortable/drag-droppable list                              | `<For>`   |

You have primitives, the fields are tied to position, and there is no reordering. `<Index>` it is.

(If you later switch to objects with stable `id`s and add reordering, swap to `<For>` keyed by id — moves will then preserve focus because Solid moves the existing DOM node rather than recreating it.)

## The fix — working example

```tsx
import { createSignal, Index } from "solid-js";

export function FieldList() {
  const [fields, setFields] = createSignal<string[]>([""]);

  const addField = () => setFields((prev) => [...prev, ""]);

  const removeField = (i: number) => setFields((prev) => prev.filter((_, idx) => idx !== i));

  const updateField = (i: number, value: string) =>
    setFields((prev) => prev.map((v, idx) => (idx === i ? value : v)));

  return (
    <div>
      <Index each={fields()}>
        {(value, i) => (
          <div>
            {/* value is a signal: call it. i is a plain number. */}
            <input value={value()} onInput={(e) => updateField(i, e.currentTarget.value)} />
            <button type="button" onClick={() => removeField(i)}>
              Remove
            </button>
          </div>
        )}
      </Index>

      <button type="button" onClick={addField}>
        Add field
      </button>
    </div>
  );
}
```

Key points in the example:

1. `<Index each={fields()}>` — pass the array (call the signal here, in JSX, where it is tracked).
2. `(value, i) => ...` — `value` is `Accessor<string>` (call it: `value()`); `i` is a `number`.
3. `value={value()}` on the `<input>` updates the existing input's `value` property when the slot's string changes — no remount, focus survives.
4. The wrapper `<div>` for each row is also created once per position and reused; only when you `addField`/`removeField` does Solid create or dispose a row.

## Common gotchas to avoid

- **Do not destructure `value` or `i`.** `value` is a signal, not a value; aliasing it at the top of the row breaks reactivity. Always call `value()` at the read site.
- **Do not switch back to `<For>` "to fix a different bug" without keying by a stable id.** Plain `<For each={fields()}>` over strings is exactly what is causing your current focus loss.
- **Do not mutate the array in place** (`fields()[i] = newValue`). Solid's reactivity needs a setter call; use `setFields(prev => prev.map(...))` (or a store with `setStore(i, value)` if you upgrade to a store later).
- **Avoid `.map` instead of `<Index>`/`<For>`.** It works for static lists but loses per-item reconciliation entirely.
