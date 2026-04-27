---
name: solid-context
description: "Use this skill when sharing data across a Solid (SolidJS) component tree without prop drilling: theme, current user, i18n, design-system tokens, anything that many components in a subtree need. Covers `createContext` (with optional default value to avoid `| undefined`), `<MyContext.Provider value={...}>` to scope the data, `useContext` to read it (returns the default if no Provider, or `undefined` if no default), the standard pattern of putting **signals or stores** into context (not raw values, so consumers see updates), custom Provider components for ergonomics, custom `useMyContext()` hooks that throw on missing Provider for crisp error messages, typing context with `ReturnType<typeof factoryFn>`, and the rule that components above a Provider don't see its value. Triggers on: createContext, useContext, Provider, context API, prop drilling, theme, current user, i18n, shared state, useMyContext, custom hook."
license: MIT
---

Context lets you make a value available to a subtree without threading it through every component as a prop. In Solid, the value is **set once when the Provider mounts** (or when the Provider's `value` prop changes) — for changing data, put a signal or store in the context.

## Import

```ts
import { createContext, useContext } from "solid-js";
```

## Shape

```ts
function createContext<T>(defaultValue?: T): Context<T>;

interface Context<T> {
  Provider: (props: { value: T; children: JSX.Element }) => JSX.Element;
  defaultValue: T | undefined;
}
```

## Basic use

```tsx
const ThemeContext = createContext<"light" | "dark">("light");

function App() {
  return (
    <ThemeContext.Provider value="dark">
      <Header />
    </ThemeContext.Provider>
  );
}

function Header() {
  const theme = useContext(ThemeContext);
  return <header data-theme={theme}>...</header>;
}
```

`useContext(MyContext)` returns:
- The `value` of the nearest ancestor `<MyContext.Provider>`, if any.
- The `defaultValue` passed to `createContext`, otherwise.
- `undefined` if you didn't pass a default.

## Putting signals/stores in context (the common case)

A raw value `<ThemeContext.Provider value="dark">` works for static data. For mutable data, put a signal or store in the context:

```tsx
type ThemeApi = readonly [Accessor<"light" | "dark">, (t: "light" | "dark") => void];
const ThemeContext = createContext<ThemeApi>();

function ThemeProvider(props: { children: JSX.Element; initial?: "light" | "dark" }) {
  const [theme, setTheme] = createSignal(props.initial ?? "light");
  return (
    <ThemeContext.Provider value={[theme, setTheme]}>
      {props.children}
    </ThemeContext.Provider>
  );
}

// Consumer:
function ThemeToggle() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("ThemeToggle must be inside ThemeProvider");
  const [theme, setTheme] = ctx;
  return (
    <button onClick={() => setTheme(theme() === "light" ? "dark" : "light")}>
      {theme()}
    </button>
  );
}
```

Now consumers see updates whenever `setTheme` is called.

For richer APIs, return a tuple of `[state, actions]`:

```tsx
function makeCounter(initial = 0) {
  const [count, setCount] = createSignal(initial);
  return [
    { count },
    {
      increment: () => setCount(c => c + 1),
      decrement: () => setCount(c => c - 1),
      reset: () => setCount(initial),
    },
  ] as const;
}

type CounterApi = ReturnType<typeof makeCounter>;
const CounterContext = createContext<CounterApi>();
```

## Custom hook with helpful error

The classic ergonomic wrapper:

```tsx
function useCounter() {
  const ctx = useContext(CounterContext);
  if (!ctx) throw new Error("useCounter must be used inside CounterProvider");
  return ctx;
}

function Counter() {
  const [{ count }, { increment }] = useCounter();
  return <button onClick={increment}>{count()}</button>;
}
```

This narrows the type so consumers don't have to deal with `| undefined`, and makes missing-Provider failures legible.

## Typing context

If you pass a default value, the type is inferred:

```ts
const Theme = createContext<"light" | "dark">("light");   // Context<"light" | "dark">
useContext(Theme);   // "light" | "dark"
```

If you don't, you get `T | undefined`:

```ts
const Theme = createContext<"light" | "dark">();          // Context<"light" | "dark" | undefined>
useContext(Theme);   // "light" | "dark" | undefined
```

For factory-built contexts (signals, stores), use `ReturnType`:

```ts
const make = () => createSignal(0);
type CounterApi = ReturnType<typeof make>;
const CounterContext = createContext<CounterApi>();
```

## Stores in context

```tsx
type AppStore = ReturnType<typeof makeAppStore>;
const AppContext = createContext<AppStore>();

function makeAppStore() {
  const [state, setState] = createStore({ ... });
  return { state, setState } as const;
}

function AppProvider(props: { children: JSX.Element }) {
  return <AppContext.Provider value={makeAppStore()}>{props.children}</AppContext.Provider>;
}
```

## Multiple Providers

Nesting is fine and common:

```tsx
<ThemeProvider>
  <AuthProvider>
    <RouterProvider>
      <App />
    </RouterProvider>
  </AuthProvider>
</ThemeProvider>
```

The order matters only if a Provider depends on a parent's value (e.g. AuthProvider may need theme tokens). When in doubt, put more "global" Providers higher.

## Provider scopes — components above don't see the value

```tsx
<App />
<ThemeProvider>
  <Header />
</ThemeProvider>
```

`<App />` (sibling, not descendant) doesn't see the theme. Only the subtree under `<ThemeProvider>` does.

## When NOT to use context

Context is for **subtree-shared** data. If you only need one piece of state imported into a few components, just export the signal from a module:

```tsx
// store.ts
export const [user, setUser] = createSignal<User | null>(null);

// any component
import { user } from "./store";
return <p>{user()?.name}</p>;
```

This is "module-level state" — simpler than context for app-wide data. Choose context when you need to scope state per-subtree (e.g. multiple Providers with different values), or when SSR needs request-isolated state.

## SSR considerations

In SSR, **module-level state leaks across requests** — a signal exported from `store.ts` is shared between concurrent renders, which is almost always wrong. Use Provider per request to isolate:

```tsx
// In your SSR render function:
renderToString(() => (
  <UserProvider initial={requestUser}>
    <App />
  </UserProvider>
));
```

This is why context is preferred over module state for app-shared data when SSR is in play.

## Common pitfalls

- **`useContext` without a Provider and no default.** Returns `undefined`; later code crashes. Throw a helpful error in a custom hook.
- **Reading context outside a component.** `useContext` only works inside a component (or any owner). At module top level it returns `undefined`.
- **Putting a primitive (not a signal) in context for changing data.** Consumers won't see updates. Wrap in a signal or store.
- **Forgetting to memoize an expensive value.** A new object literal in `value={{ ... }}` creates a fresh reference per render of the Provider. Solid components run once, so this is rarely an issue (the JSX runs once), but if the Provider's body re-runs reactively, wrap in `createMemo`.
- **Module-level state in SSR.** Leaks across requests. Use Providers.

## Examples

### i18n

```tsx
type I18n = { t: (key: string) => string; lang: Accessor<string> };

const I18nContext = createContext<I18n>();

function I18nProvider(props: { messages: Record<string, Record<string, string>>; children: JSX.Element }) {
  const [lang, setLang] = createSignal("en");
  const t = (key: string) => props.messages[lang()]?.[key] ?? key;
  return <I18nContext.Provider value={{ t, lang }}>{props.children}</I18nContext.Provider>;
}

function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
```

### Auth

```tsx
type AuthApi = readonly [Resource<User | null>, { logout: () => void }];
const AuthContext = createContext<AuthApi>();

function AuthProvider(props: { children: JSX.Element }) {
  const [user, { mutate }] = createResource(fetchMe);
  const logout = async () => { await api.logout(); mutate(null); };
  return <AuthContext.Provider value={[user, { logout }]}>{props.children}</AuthContext.Provider>;
}

function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
```

## Related

- `solid-signals`, `solid-stores` — what you'll typically put in context.
- `solid-state-management` — choosing context vs signal vs module state.
- `solid-typescript` — context typing, `ReturnType`.
