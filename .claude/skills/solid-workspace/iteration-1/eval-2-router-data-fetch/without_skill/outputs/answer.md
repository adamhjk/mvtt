## `/users/:id` route — complete file

```tsx
// src/routes/users/[id].tsx
import { Show, Suspense, ErrorBoundary, type Component } from "solid-js";
import {
  type RouteDefinition,
  type RouteSectionProps,
  query,
  createAsync,
  useParams,
  A,
} from "@solidjs/router";

// ---- Server function ---------------------------------------------------
// "use server" makes this a server function in SolidStart. If you're using
// plain @solidjs/router without SolidStart, replace the body with a fetch()
// call to your API; the rest of the file is identical.
async function fetchUser(id: string): Promise<User> {
  "use server";
  const res = await fetch(`https://api.example.com/users/${id}`);
  if (!res.ok) {
    throw new Error(`Failed to load user ${id}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as User;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

// ---- Query (deduped + cached by argument) ------------------------------
// `query` wraps the fetcher so the router caches results keyed by
// (key, ...args). Multiple components calling getUser("42") in the same
// render produce ONE network request. The key string ("user") namespaces
// the cache and is what you pass to `revalidate(...)`.
const getUser = query((id: string) => fetchUser(id), "user");

// ---- Route preload -----------------------------------------------------
// The router calls this on hover/focus of any <A> link that resolves to
// this route, and again on navigation. Because it goes through the same
// `getUser` query, the hover-prefetch and the in-route read share a cache
// entry — no double fetch.
export const route = {
  preload({ params }) {
    void getUser(params.id);
  },
} satisfies RouteDefinition;

// ---- Component ---------------------------------------------------------
const UserRoute: Component<RouteSectionProps> = () => {
  const params = useParams<{ id: string }>();

  // createAsync subscribes the component to the query result. It re-runs
  // whenever params.id changes, suspends while pending, and surfaces
  // thrown errors to the nearest ErrorBoundary.
  const user = createAsync(() => getUser(params.id));

  return (
    <ErrorBoundary
      fallback={(err: Error, reset) => (
        <div role="alert" class="user-error">
          <p>Couldn't load this user.</p>
          <pre>{err.message}</pre>
          <button
            type="button"
            onClick={() => {
              // `reset()` clears the boundary; createAsync will re-run
              // its fetcher on the next read.
              reset();
            }}
          >
            Retry
          </button>
          <A href="/users">Back to users</A>
        </div>
      )}
    >
      <Suspense fallback={<div class="user-loading">Loading user…</div>}>
        <Show when={user()} keyed>
          {(u) => (
            <article class="user-card">
              <h1>{u.name}</h1>
              <p>{u.email}</p>
              <p class="muted">id: {u.id}</p>
            </article>
          )}
        </Show>
      </Suspense>
    </ErrorBoundary>
  );
};

export default UserRoute;
```

### Wiring it up (for reference)

In your route config (or via `<FileRoutes/>` in SolidStart this is automatic):

```tsx
// src/App.tsx
import { Router, Route } from "@solidjs/router";
import UserRoute, { route as userRoute } from "./routes/users/[id]";

export default () => (
  <Router>
    <Route path="/users/:id" component={UserRoute} preload={userRoute.preload} />
  </Router>
);
```

Links elsewhere in the app:

```tsx
<A href={`/users/${id}`}>View user</A>
```

`<A>` triggers `preload` on `pointerover`/`focus` by default (you can tune this via `<Router preload>` and the `<A preload>` prop).

---

### How each requirement is met

| Requirement            | Mechanism                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Hover preload          | `route.preload({ params })` is called by the router on `<A>` hover/focus and on navigation.                                         |
| Deduped fetch          | `query(fn, "user")` caches by `(key, args)`. Hover-preload and in-route `createAsync` hit the same entry.                           |
| Loading state          | `<Suspense fallback={...}>` — `createAsync` participates in Suspense automatically.                                                 |
| Error boundary + retry | `<ErrorBoundary fallback={(err, reset) => …}>`; the `reset` callback clears the boundary so `createAsync` re-runs.                  |
| Server fetch           | `"use server"` directive on `fetchUser` (SolidStart). Without SolidStart, swap for a `fetch()` to your API — the rest is unchanged. |

### Notes

- **Don't destructure `params`** — it's a reactive proxy. `params.id` inside the `createAsync` accessor keeps the resource reactive to URL changes.
- For mutations, pair this with `action(...)` + `revalidate("user")` (or `revalidate(getUser.keyFor(id))`) to invalidate the cache after a write.
- `createAsync` returns `Accessor<T | undefined>`; `<Show when={user()} keyed>` narrows it for the child. Use `createAsyncStore` instead if you want fine-grained property reactivity on the result.
- If the route is also rendered server-side, `query` deduplicates per-request on the server too, so a parent layout calling `getUser` and the child route calling `getUser` produce one fetch per request.
