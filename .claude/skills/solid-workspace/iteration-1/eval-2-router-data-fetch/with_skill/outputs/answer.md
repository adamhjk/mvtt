## Explanation

The route file below uses the `@solidjs/router` data-fetching pipeline:

- **`query(fetcher, "user")`** wraps the server fetch with a named cache. Every call with the same arg is automatically deduped, and the entry revalidates on action success. The name is required for SSR identity.
- **`route.preload`** is exported as a `RouteDefinition`-shaped object. The router invokes it during navigation **and** when the user hovers/focuses a matching `<A>` link, seeding the query cache before the component mounts. Because the preload calls the same `getUser` query, the in-flight promise is reused — no second request.
- **`createAsync(() => getUser(params.id))`** reads the cached query reactively (note the **thunk** — passing `getUser(params.id)` eagerly would freeze the arg). Reads under it suspend the nearest `<Suspense>`; thrown errors bubble to the nearest `<ErrorBoundary>`.
- **`<Suspense>`** renders the loading fallback while the resource is pending.
- **`<ErrorBoundary>`** catches the thrown `Error`, exposes a `reset` function which we wire to a Retry button. We also call `revalidate(getUser.keyFor(params.id))` so retry actually re-runs the fetcher (otherwise the cached error would replay).
- The `"use server"` directive turns `fetchUserFromDb` into a SolidStart server function — it only runs on the server, even when called from client code.

The `<A href={...}>` in the demo nav is enough to trigger hover/focus preloading automatically; no extra wiring is needed beyond exporting `route.preload`.

## `src/routes/users/[id].tsx`

```tsx
import { Show, Suspense, ErrorBoundary } from "solid-js";
import {
  A,
  createAsync,
  query,
  revalidate,
  useParams,
  type RouteDefinition,
} from "@solidjs/router";

// --- Server function -------------------------------------------------------
// "use server" makes this run only on the server (SolidStart). In a
// non-Start SPA, replace the body with a fetch() to your API.
async function fetchUserFromDb(id: string) {
  "use server";
  // Pretend this is a DB call.
  const res = await fetch(`https://api.example.com/users/${id}`);
  if (!res.ok) {
    throw new Error(`Failed to load user ${id}: ${res.status}`);
  }
  return (await res.json()) as { id: string; name: string; email: string };
}

// --- Cached, deduped query -------------------------------------------------
// `query(fn, name)` gives us:
//   - automatic deduplication of concurrent calls with the same args
//   - a cache that the router seeds via preload
//   - automatic revalidation after a successful action
// The name ("user") is required so SSR and the client agree on the cache key.
const getUser = query((id: string) => fetchUserFromDb(id), "user");

// --- Route preload ---------------------------------------------------------
// Exported so we can attach it to the <Route> declaration. The router runs
// this on navigation AND on hover/focus of any <A> that matches this path,
// which seeds the query cache before the component mounts.
export const route = {
  preload: ({ params }) => getUser(params.id),
} satisfies RouteDefinition;

// --- Component -------------------------------------------------------------
export default function UserPage() {
  const params = useParams<{ id: string }>();

  // IMPORTANT: pass a thunk, not getUser(params.id). The thunk is what makes
  // this reactive to params.id changes.
  const user = createAsync(() => getUser(params.id));

  return (
    <ErrorBoundary
      fallback={(err: Error, reset) => (
        <div role="alert" class="user-error">
          <p>Failed to load user: {err.message}</p>
          <button
            type="button"
            onClick={async () => {
              // Drop the cached error for this arg so the fetcher actually
              // re-runs, then let the boundary re-render.
              await revalidate(getUser.keyFor(params.id));
              reset();
            }}
          >
            Retry
          </button>
        </div>
      )}
    >
      <Suspense fallback={<p class="user-loading">Loading user…</p>}>
        <Show when={user()} keyed>
          {(u) => (
            <article class="user-card">
              <h1>{u.name}</h1>
              <p>{u.email}</p>
              <nav>
                {/* Hovering this link automatically calls route.preload
                    for /users/2 and warms the query cache. */}
                <A href="/users/2">Next user</A>
              </nav>
            </article>
          )}
        </Show>
      </Suspense>
    </ErrorBoundary>
  );
}
```

## How to wire it into the router

If you're using SolidStart's `<FileRoutes>`, the file path `src/routes/users/[id].tsx` plus the exported `route` object is all you need.

For a manual `<Router>` setup:

```tsx
import { Router, Route } from "@solidjs/router";
import UserPage, { route as userRoute } from "./routes/users/[id]";

<Router>
  <Route path="/users/:id" component={UserPage} preload={userRoute.preload} />
</Router>;
```

## Why each requirement is satisfied

| Requirement               | How it's met                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Server function fetch     | `fetchUserFromDb` with `"use server"`                                                                                                |
| Hover preloading          | `route.preload` + `<A>` (router auto-runs preload on hover/focus)                                                                    |
| Automatic dedup           | `query(fn, "user")` — concurrent/repeat calls share the same in-flight promise and cached result                                     |
| Loading state             | `<Suspense fallback={…}>` wrapping the `createAsync` reader                                                                          |
| Error boundary + retry    | `<ErrorBoundary fallback={(err, reset) => …}>` with a Retry button that calls `revalidate(getUser.keyFor(params.id))` then `reset()` |
| Reactive to `:id` changes | `createAsync(() => getUser(params.id))` (thunk form, not eager)                                                                      |
