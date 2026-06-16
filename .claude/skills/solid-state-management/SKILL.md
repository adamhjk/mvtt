---
name: solid-state-management
description: "Use this skill when deciding **where** state should live in a Solid (SolidJS) application: signal vs store vs context vs module-level state vs external library. Cross-cutting guidance distilled from the docs' state-management and complex-state-management guides. Covers the decision tree (primitive → signal; nested object/array → store; subtree-shared → context-with-signal/store; app-wide and SSR-safe → context-with-store; cross-tab → external storage event), patterns for derived state (plain function vs `createMemo`), patterns for async state (`createResource`, queries), patterns for forms (controlled inputs, signals per field, store for whole form), persistence (localStorage with `createEffect`), and SSR pitfalls (module-level signals leak across requests). Triggers on: state management, where to put state, signal vs store, complex state, global state, app state, form state, persisted state, derived state, SSR state, cross-component state."
license: MIT
---

Solid is unopinionated about state architecture — there's no built-in flux/redux equivalent. The framework gives you primitives (signals, stores, context, resources) and lets you compose them. This skill is a decision guide.

## The decision tree

### Step 1 — what shape is the data?

| Shape                                              | Choice                                                     |
| -------------------------------------------------- | ---------------------------------------------------------- |
| Primitive (number/string/boolean) or replace-whole | **Signal**                                                 |
| Nested object/array with fine-grained updates      | **Store**                                                  |
| Async data                                         | **Resource** (or `solid-router`'s `query` + `createAsync`) |

### Step 2 — what's the scope?

| Scope                              | Choice                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Local to one component             | Inline `createSignal`/`createStore`                                                                    |
| Shared by a subtree                | **Context** wrapping a signal/store                                                                    |
| Shared app-wide, no SSR            | **Module-level** signal/store (just `export const [x, setX] = createSignal(...)` in a `state.ts` file) |
| Shared app-wide, with SSR          | **Context** at the root (module-level leaks across requests)                                           |
| Shared across browser tabs/windows | External: localStorage + `storage` event, or a dedicated state library                                 |

### Step 3 — derived data?

| Need                                                          | Choice                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| Simple derived value, single reader                           | Plain function: `const full = () => `${first()} ${last()}` |
| Expensive computation OR many readers OR want custom equality | **`createMemo`**                                           |
| Async derived                                                 | `createResource` with the upstream signal as source        |

## Worked examples

### Form state

For a small form, one signal per field:

```tsx
const [name, setName] = createSignal("");
const [email, setEmail] = createSignal("");
const [submitting, setSubmitting] = createSignal(false);

const isValid = () => name().length > 0 && email().includes("@");
```

For a larger form, a store:

```tsx
const [form, setForm] = createStore({
  name: "",
  email: "",
  password: "",
  terms: false,
  errors: {} as Record<string, string>,
});
```

Then bind inputs:

```tsx
<input value={form.name} onInput={(e) => setForm("name", e.currentTarget.value)} />
```

Validation in a derived function or memo:

```tsx
const errors = createMemo(() => {
  const e: Record<string, string> = {};
  if (!form.email.includes("@")) e.email = "Invalid email";
  return e;
});
```

### Theme

Use context, even if "global" — it makes SSR per-request work, and lets you nest themed subtrees.

```tsx
const ThemeContext = createContext<readonly [Accessor<Theme>, (t: Theme) => void]>();

function ThemeProvider(props: { initial?: Theme; children: JSX.Element }) {
  const [theme, setTheme] = createSignal<Theme>(props.initial ?? "light");
  return <ThemeContext.Provider value={[theme, setTheme]}>{props.children}</ThemeContext.Provider>;
}
```

See `solid-context`.

### App-wide store (SPA, no SSR)

If you're shipping a pure client app, module-level is the simplest answer:

```ts
// state.ts
export const [appState, setAppState] = createStore({
  user: null as User | null,
  notifications: [] as Notification[],
  ui: { sidebarOpen: true },
});
```

Import where needed. Beats Redux for many apps.

### App-wide store (SSR)

Same store but constructed inside a Provider so each request gets its own:

```tsx
const AppContext = createContext<ReturnType<typeof makeApp>>();

function makeApp(initial: AppState) {
  const [state, setState] = createStore(initial);
  return [state, setState] as const;
}

function AppProvider(props: { initial: AppState; children: JSX.Element }) {
  return <AppContext.Provider value={makeApp(props.initial)}>{props.children}</AppContext.Provider>;
}
```

### Async data

Use `createResource`:

```tsx
const [users] = createResource(filter, fetchUsers);
```

Or, in a Solid Router app, prefer queries — they add deduplication, automatic revalidation, and integrate with router actions:

```tsx
const getUsers = query(fetchUsers, "users");
const users = createAsync(() => getUsers());
```

See `solid-resources`, `solid-router`.

### Persisted state

Pair a signal/store with a `createEffect` that writes to storage:

```tsx
const [settings, setSettings] = createStore(JSON.parse(localStorage.getItem("settings") ?? "{}"));
createEffect(() => {
  localStorage.setItem("settings", JSON.stringify(unwrap(settings)));
});
```

For rehydration that triggers re-renders predictably, init with the parsed value at module load (above).

### Cross-tab sync

```tsx
window.addEventListener("storage", (e) => {
  if (e.key === "settings" && e.newValue) {
    setSettings(reconcile(JSON.parse(e.newValue)));
  }
});
```

## When to NOT reach for context

Context has a small overhead per Provider read. If you have one signal that's app-global and you don't care about SSR isolation, just export it from a module:

```ts
export const [user, setUser] = createSignal<User | null>(null);
```

Less ceremony, easier to test, easier to import.

For multi-instance scoping (different users in different tabs of the same app, themed sub-areas, plug-in architectures), use context.

## Reactivity strategies for collections

A list of 1000 items with frequent per-item updates? `<For>` + a store keyed by id, with item updates via path syntax:

```tsx
setItems("list", (id) => id === target, "checked", true);
```

A list of cells in a grid where order is fixed but cell _contents_ change frequently? `<Index>` instead of `<For>` so the index keys are stable.

See `solid-control-flow`.

## Avoid: external state libraries unless you need them

Solid's primitives + context cover what `useReducer`, `redux`, `zustand`, `mobx`, etc. solve in other frameworks. Reach for an external library only when you have a specific feature need:

- **TanStack Query** — for sophisticated cache control, optimistic updates, query invalidation patterns Solid Router's queries don't cover.
- **Solid-friendly state libs** — niche cases.

Most apps are well-served by signals + stores + context.

## Common pitfalls

- **Module-level state in SSR.** Leaks across requests. Use Providers at the root.
- **Putting an object in `createSignal` and mutating in place.** Doesn't notify (default `equals` is `===`). Switch to a store, or set `equals: false`.
- **Reaching for Redux out of habit.** Try a store + context first; it's simpler.
- **`useReducer`-style patterns with signal pairs.** A reducer is just a function — `setState` already takes function updaters. You rarely need a separate reducer abstraction.
- **Persisting a store via deep cloning every effect run.** `JSON.stringify(unwrap(state))` is fine for small stores; for big ones, persist incrementally or reach for IndexedDB.

## Related

- `solid-signals`, `solid-stores`, `solid-context`, `solid-resources` — the building blocks.
- `solid-router` — `query`/`createAsync`/`action` for routed data + mutation.
- `solid-mental-model` — fine-grained reactivity is what makes this all possible.
