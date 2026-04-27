---
name: solid-router
description: "Use this skill for any client-side or universal routing in a Solid (SolidJS) app via the `@solidjs/router` package — defining routes, navigating between them, reading params/search, fetching route-scoped data, mutating data, lazy-loading routes, preloading. Covers `<Router>` (root, with optional `root` layout), `<Route path component children matchFilters preload>`, `<A href activeClass inactiveClass end>`, `<Navigate href>`, `<HashRouter>`/`<MemoryRouter>`, dynamic params (`:id`, optional `:id?`, wildcards `*` and `*name`, multiple paths via array), nested routes and layouts (parent route renders children via `props.children`), the primitives `useParams`/`useLocation`/`useNavigate`/`useSearchParams`/`useBeforeLeave`/`useIsRouting`/`useResolvedPath`/`usePreloadRoute`/`useMatch`/`useCurrentMatches`, the data-fetching APIs `query(fetcher, name)` (cached, deduped, revalidated) + `createAsync(() => query(args))` (signal-typed access) + `createAsyncStore` (store-backed for complex data), the mutation APIs `action(fn, name)` + `useAction` + `useSubmission` + `useSubmissions` + `revalidate`, response helpers (`redirect`, `reload`, `json`) for action/query control, automatic revalidation after action completion, route-level `preload` functions, lazy routes, hover/focus-based preloading scheduling, SPA vs SSR rendering modes. Triggers on: solid-router, @solidjs/router, Router, Route, A, useParams, useNavigate, useSearchParams, useLocation, useBeforeLeave, useIsRouting, query, createAsync, createAsyncStore, action, useAction, useSubmission, useSubmissions, redirect, reload, revalidate, preload, layouts, nested routes, dynamic route, matchFilters, route preload, HashRouter, MemoryRouter, Outlet."
license: MIT
---

`@solidjs/router` is the official Solid router. It works for client-only SPAs and universal (SSR + hydration) apps. SolidStart uses it under the hood.

## Install

```sh
npm i @solidjs/router
```

## The big picture

- Routes are declared with `<Router>` and `<Route>` JSX (not config objects).
- Navigation uses `<A>` (or plain `<a>` — Solid Router intercepts it), `useNavigate()`, or `<Navigate>` for redirects.
- Data fetching: wrap a fetcher with `query(fn, name)` for caching/dedup, then read with `createAsync(() => query(args))`.
- Data mutation: wrap a server-bound function with `action(fn, name)`, fire it from `<form action={...} method="post">` or `useAction(...)`. Successful actions automatically revalidate active queries.
- Response helpers (`redirect`, `reload`, `json`) thrown/returned from queries or actions control navigation and revalidation.
- Routes can opt into `preload` functions that seed queries during navigation/hover/focus.

## Setup

### Client-only (SPA)

```tsx
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import { Home } from "./pages/Home";
import { About } from "./pages/About";

render(
  () => (
    <Router>
      <Route path="/" component={Home} />
      <Route path="/about" component={About} />
    </Router>
  ),
  document.getElementById("app")!,
);
```

### With a root layout

```tsx
const Layout = (props: { children?: JSX.Element }) => (
  <>
    <header><nav>...</nav></header>
    <main>{props.children}</main>
    <footer>...</footer>
  </>
);

<Router root={Layout}>
  <Route path="/" component={Home} />
  <Route path="/about" component={About} />
</Router>
```

The `root` layout doesn't unmount as the route changes — only `props.children` swaps.

## `<Route>`

```tsx
<Route path="/users/:id" component={User} />
<Route path={["/login", "/register"]} component={Auth} />
<Route path="/files/*" component={Files} />
<Route path="/files/*name" component={Files} />        // exposes params.name
<Route path="/items/:id?" component={Items} />          // optional segment
<Route
  path="/users/:id"
  component={User}
  matchFilters={{ id: /^\d+$/ }}                        // only digits
/>
```

### Nested routes

A route with children is a layout for those children:

```tsx
<Route path="/users" component={UsersLayout}>
  <Route path="/" component={UsersList} />
  <Route path="/:id" component={UserDetail} />
</Route>

// UsersLayout receives props.children
function UsersLayout(props: { children?: JSX.Element }) {
  return (
    <div>
      <UserSidebar />
      <section>{props.children}</section>
    </div>
  );
}
```

## Navigation

### `<A>` component

```tsx
import { A } from "@solidjs/router";

<A href="/about">About</A>
<A href="users">Users</A>                         {/* relative to current route */}
<A href="/" end>Home</A>                          {/* `end` makes "active" exact-match */}
<A href="/login" activeClass="font-bold" inactiveClass="opacity-70">Login</A>
```

`<A>` is HTML `<a>` plus base-URL handling, relative-href support, and `activeClass`/`inactiveClass`.

Plain `<a href="/x">` also works — Solid Router intercepts it for soft navigation. Set `target="_self"` on a link to opt out (or set `explicitLinks` on `<Router>` to require `<A>`).

### `useNavigate` — programmatic

```ts
const navigate = useNavigate();

navigate("/dashboard");
navigate("/dashboard", { replace: true });        // replace history entry
navigate(-1);                                     // back
navigate("/x", { state: { from: "..." } });       // pass state
navigate("/x", { scroll: false });                // skip scroll restore
```

### `<Navigate>` — declarative redirect

```tsx
<Route path="/old" component={() => <Navigate href="/new" />} />
```

### `redirect` — from queries/actions

Throwing `redirect(path)` from a query or action sends a server-aware navigation:

```ts
const logout = action(async () => {
  await api.logout();
  throw redirect("/login");
});
```

## Reading the URL

| Primitive | Returns | Use for |
|---|---|---|
| `useParams<T>()` | reactive object | path params (`:id`, etc.) |
| `useLocation<T>()` | reactive `Location` | full URL info: `pathname`, `search`, `hash`, `state`, `query` |
| `useSearchParams<T>()` | `[search, setSearch]` | query string get/set |
| `useNavigate()` | `(to, options?) => void` | imperative navigation |
| `useIsRouting()` | `Accessor<boolean>` | true while a navigation is in flight |
| `useBeforeLeave(fn)` | — | guard nav (confirm, save) |
| `useResolvedPath(path)` | resolved string | resolve a path against current route |
| `usePreloadRoute()` | `(path) => void` | imperative preload |
| `useMatch(path)` | reactive match info | check if a path matches current location |
| `useCurrentMatches()` | reactive array of matches | full match chain |

```tsx
function User() {
  const params = useParams<{ id: string }>();
  return <p>User {params.id}</p>;
}

function Search() {
  const [search, setSearch] = useSearchParams<{ q?: string }>();
  return (
    <input
      value={search.q ?? ""}
      onInput={e => setSearch({ q: e.currentTarget.value })}
    />
  );
}
```

## Data fetching — `query` + `createAsync`

`query` wraps a fetcher with caching, deduplication, and automatic revalidation on action success.

```ts
import { query, createAsync } from "@solidjs/router";

const getUser = query(async (id: string) => {
  const r = await fetch(`/api/users/${id}`);
  if (!r.ok) throw new Error("Failed");
  return r.json();
}, "user");

function UserPage() {
  const params = useParams<{ id: string }>();
  const user = createAsync(() => getUser(params.id));
  return <Show when={user()}>{u => <p>{u().name}</p>}</Show>;
}
```

`createAsync` returns an Accessor; reads suspend the nearest `<Suspense>`. Errors throw to the nearest `<ErrorBoundary>`.

For complex data (lists, objects you'll mutate locally), `createAsyncStore` returns a Solid store instead of a plain accessor:

```ts
const items = createAsyncStore(() => getItems());
```

## Data mutation — `action`

```ts
import { action, useSubmission } from "@solidjs/router";

const updateUser = action(async (formData: FormData) => {
  await api.update({
    name: formData.get("name") as string,
  });
  return { ok: true };
}, "updateUser");
```

### Trigger via form (recommended — works without JS)

```tsx
<form action={updateUser} method="post">
  <input name="name" />
  <button>Save</button>
</form>
```

The `name` argument to `action(fn, name)` is **required for SSR** so Solid can serialize/identify the action between client and server.

### Trigger via `useAction` (programmatic)

```tsx
const update = useAction(updateUser);

<button onClick={() => update(someFormData)}>Save</button>
```

### Pass extra args via `.with`

```tsx
<form action={updateUser.with(userId)} method="post">
  ...
</form>
// fn receives (userId, formData)
```

### Track submission state

```tsx
import { useSubmission } from "@solidjs/router";

const sub = useSubmission(updateUser);

<button disabled={sub.pending}>
  {sub.pending ? "Saving..." : "Save"}
</button>
<Show when={sub.result?.ok === false}>Error: {sub.result.error}</Show>
```

For multiple concurrent submissions (e.g. multi-file upload), `useSubmissions` returns an array.

### Response helpers

Return or throw these from inside an action (or query):

```ts
import { redirect, reload, json } from "@solidjs/router";

throw redirect("/somewhere");                    // navigate; revalidates queries
throw reload({ revalidate: ["user", "posts"] });  // revalidate just these queries
return json({ ok: true }, { revalidate: [] });   // return data; skip revalidation
```

Default behaviour after a successful action: all queries used in the same page revalidate. Pass `revalidate: []` to opt out.

### Manual revalidation

```ts
import { revalidate } from "@solidjs/router";

await revalidate(getUser.key);                   // revalidate a specific query
await revalidate(getUser.keyFor(userId));        // ...for specific args
await revalidate();                              // revalidate everything
```

## Route-level `preload`

Each route can export or accept a `preload` function that runs:
- During SSR for the initial render.
- On the client when the route is hovered, focused, or navigated to.

```tsx
const route = {
  preload: ({ params }) => getUser(params.id),
} satisfies RouteDefinition;

<Route path="/users/:id" component={User} preload={route.preload} />
```

The preload function seeds the query cache. By the time `User` renders, the data is already loading (or ready). This is what makes route transitions feel instant.

### Hover/focus preloading

Solid Router watches `<A>` (and intercepted `<a>`) for hover (debounced ~20ms) and focus events, and runs the matching route's `preload` proactively.

### Imperative preloading

```ts
const preload = usePreloadRoute();
onMouseEnter={() => preload("/users/123")}
```

## Lazy routes

```tsx
import { lazy } from "solid-js";

const Settings = lazy(() => import("./pages/Settings"));
<Route path="/settings" component={Settings} />
```

Routes loaded with `lazy()` participate in the same hover/focus preload pipeline.

## SPA vs SSR

Same router, different mounts:

- **Client-only:** `render(() => <Router>...</Router>, ...)`
- **SSR:** `renderToStringAsync(() => <Router url={ctx.url}>...</Router>)` — pass `url` for the initial path.

For SolidStart apps, this is wired automatically (with `<FileRoutes>`); see `solid-start`.

### `<HashRouter>` and `<MemoryRouter>`

```tsx
<HashRouter>...</HashRouter>           // routes encoded in `#fragment` (no server config)
<MemoryRouter>...</MemoryRouter>       // in-memory only — useful for tests/storybook
```

## `useBeforeLeave` — confirm navigation

```ts
useBeforeLeave((e) => {
  if (formIsDirty() && !confirm("Discard changes?")) e.preventDefault();
});
```

Called every time a navigation begins. Call `e.preventDefault()` to cancel.

## Common patterns

### Protected route

```tsx
function ProtectedRoute(props: { children?: JSX.Element }) {
  const auth = useAuth();
  return (
    <Show when={auth.user()} fallback={<Navigate href="/login" />}>
      {props.children}
    </Show>
  );
}

<Router>
  <Route path="/dashboard" component={ProtectedRoute}>
    <Route path="/" component={Dashboard} />
    <Route path="/settings" component={Settings} />
  </Route>
</Router>
```

### Search-as-you-type with URL state

```tsx
const [search, setSearch] = useSearchParams<{ q?: string }>();

<input
  value={search.q ?? ""}
  onInput={e => setSearch({ q: e.currentTarget.value })}
/>

const results = createAsync(() => searchQuery(search.q ?? ""));
```

The URL becomes the source of truth; back/forward navigation just works.

### Optimistic mutation

```tsx
const [items] = createAsync(() => getItems());
const sub = useSubmission(addItem);

const optimistic = createMemo(() => {
  if (!sub.pending) return items() ?? [];
  const formData = sub.input[0] as FormData;
  return [...(items() ?? []), { id: -1, name: formData.get("name") as string }];
});

return <For each={optimistic()}>{i => <li>{i.name}</li>}</For>;
```

## Common pitfalls

- **No `name` on `action()` used with `<form>`.** SSR breaks. Always pass a name string for forms.
- **Passing args eagerly to `createAsync`.** `createAsync(getUser(params.id))` evaluates once; reactive updates don't fire. Use `createAsync(() => getUser(params.id))`.
- **Calling `query()` inline without naming.** The name keys the cache; reusing the same fetcher with different names = duplicate fetches; reusing the same name with different fetchers = collisions.
- **Action returns `undefined`.** Solid Router treats undefined as "submission removed"; previous error state may stick. Always `return { ok: true }` or similar.
- **Returning `redirect` instead of throwing.** Both work, but throwing avoids type-narrowing pain.
- **Using `<a>` to non-router targets without `target`.** Router will intercept. Add `target="_self"` (or any value) to opt out per link.

## Related

- `solid-resources` — `query`/`createAsync` build on resource semantics.
- `solid-control-flow` — `<Show>`, `<Suspense>`, `<ErrorBoundary>` go hand in hand with router data.
- `solid-start` — the meta-framework that integrates this with file routing and server functions.
- `solid-rendering` — SSR with `<Router url={...}>`.
