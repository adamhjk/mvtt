---
name: solid-resources
description: "Use this skill when fetching async data in Solid (SolidJS) with `createResource`. Covers the two forms (with and without a reactive source), the `Resource<T>` shape (callable accessor + `state`/`loading`/`error`/`latest` properties), the state machine (`unresolved` → `pending` → `ready` → `refreshing`/`errored`), `ResourceActions` (`mutate` for optimistic updates, `refetch` for re-running the fetcher), the source contract (returning `false`/`null`/`undefined` skips the fetch), options (`initialValue` to start in `ready`, `name`, `deferStream`, `ssrLoadFrom: 'initial' | 'server'`, custom `storage`, `onHydrated`), integration with `<Suspense>` (resources suspend automatically) and `<ErrorBoundary>` (thrown errors propagate), and SSR data flow. Triggers on: createResource, resource, async data, fetch, loading state, suspense, ErrorBoundary, mutate, refetch, deferStream, ssrLoadFrom, initialValue."
license: MIT
---

`createResource` is Solid's primitive for asynchronous data — anything that returns a promise. It auto-tracks a reactive source, exposes loading/error/state metadata, integrates with `<Suspense>` for declarative loading UI, and serializes across the SSR boundary.

## Import

```ts
import { createResource } from "solid-js";
```

## Shape

```ts
// Without a source.
function createResource<T, R = unknown>(
  fetcher: ResourceFetcher<true, T, R>,
  options?: ResourceOptions<T>,
): ResourceReturn<T, R>;

// With a reactive source.
function createResource<T, S, R = unknown>(
  source: ResourceSource<S>,
  fetcher: ResourceFetcher<S, T, R>,
  options?: ResourceOptions<T, S>,
): ResourceReturn<T, R>;

type ResourceReturn<T, R = unknown> = [Resource<T>, ResourceActions<T, R>];

type Resource<T> = {
  (): T | undefined;
  state: "unresolved" | "pending" | "ready" | "refreshing" | "errored";
  loading: boolean;
  error: any;
  latest: T | undefined;
};

type ResourceActions<T, R = unknown> = {
  mutate: (v: T | undefined) => T | undefined;
  refetch: (info?: R) => Promise<T> | T | undefined;
};

type ResourceSource<S> = S | false | null | undefined | (() => S | false | null | undefined);

type ResourceFetcher<S, T, R = unknown> = (
  source: S,
  info: { value: T | undefined; refetching: R | boolean },
) => T | Promise<T>;

interface ResourceOptions<T, S = unknown> {
  initialValue?: T;
  name?: string;
  deferStream?: boolean;
  ssrLoadFrom?: "initial" | "server";
  storage?: (init: T | undefined) => [Accessor<T | undefined>, Setter<T | undefined>];
  onHydrated?: (k: S | undefined, info: { value: T | undefined }) => void;
}
```

## Without a source — fetch once

```tsx
const [data] = createResource(async () => {
  const r = await fetch("/api/data");
  return r.json();
});

return <div>{data()?.title}</div>;
```

`data()` is `undefined` until the promise resolves, then becomes the resolved value. `data.loading` is `true` while pending, `data.state` runs through `unresolved` → `pending` → `ready`.

## With a source — refetch when source changes

The first argument is a reactive accessor (or a value). When it changes, the fetcher is called again with the new source value.

```tsx
const [userId, setUserId] = createSignal(1);

const [user] = createResource(userId, async (id) => {
  const r = await fetch(`/api/users/${id}`);
  return r.json();
});

setUserId(2); // user resource refetches with id=2.
```

### Skipping the fetch

If the source returns `false`, `null`, or `undefined`, the fetcher is **not called**. This is the idiomatic way to gate a fetch on auth state, route params, etc.:

```tsx
const [token, setToken] = createSignal<string | null>(null);

const [me] = createResource(token, async (t) => {
  const r = await fetch("/api/me", { headers: { Authorization: `Bearer ${t}` } });
  return r.json();
});
// Until token() is non-null, the fetcher never runs and me() stays undefined.
```

## The fetcher signature

```ts
type ResourceFetcher<S, T, R = unknown> = (
  source: S, // current source value (or `true` if no source)
  info: { value: T | undefined; refetching: R | boolean },
) => T | Promise<T>;
```

- `source` — the current source value (resolved if it was a function).
- `info.value` — the previous resolved value, useful for incremental fetches.
- `info.refetching` — `false` on the initial call; otherwise the argument passed to `refetch(...)` (or `true` if none).

```ts
const [posts] = createResource(page, async (p, { value, refetching }) => {
  if (refetching) console.log("re-running due to", refetching);
  return fetchPosts(p, { since: value?.[0]?.id });
});
```

## The `Resource<T>` accessor

The return is a callable accessor with extra properties:

| Property           | Type                                                                | Meaning                                                                            |
| ------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `resource()`       | `T \| undefined`                                                    | Current value. `undefined` until first resolution (unless `initialValue` was set). |
| `resource.state`   | `"unresolved" \| "pending" \| "ready" \| "refreshing" \| "errored"` | State machine.                                                                     |
| `resource.loading` | `boolean`                                                           | True while pending or refreshing.                                                  |
| `resource.error`   | `any`                                                               | Set if the fetcher rejected/threw.                                                 |
| `resource.latest`  | `T \| undefined`                                                    | Last successfully resolved value, even while refreshing.                           |

### State machine

| State        | When                                           | `loading` | `error`     | `latest`    |
| ------------ | ---------------------------------------------- | --------- | ----------- | ----------- |
| `unresolved` | Initial, no fetch yet (source returned falsy)  | `false`   | `undefined` | `undefined` |
| `pending`    | Fetching, no previous value                    | `true`    | `undefined` | `undefined` |
| `ready`      | Fetched successfully                           | `false`   | `undefined` | `T`         |
| `refreshing` | Fetching again, previous value still available | `true`    | `undefined` | `T`         |
| `errored`    | Fetcher rejected                               | `false`   | `any`       | `undefined` |

Use `latest` when you want to keep showing the previous data while a refresh runs:

```tsx
return <p>{user.latest?.name ?? "Loading..."}</p>;
```

## Resource actions

```ts
const [user, { mutate, refetch }] = createResource(userId, fetchUser);
```

### `mutate` — optimistic update

Overwrites the resource value locally without calling the fetcher. Useful for optimistic UI:

```ts
mutate((prev) => ({ ...prev!, name: "New name" }));
await api.updateName("New name");
// (then refetch to confirm)
refetch();
```

### `refetch` — re-run without changing source

```ts
await refetch(); // re-run with the same source
await refetch("manual"); // re-run; info.refetching === "manual"
```

## Integration with `<Suspense>`

Reading a resource accessor inside `<Suspense>` automatically suspends the boundary while the resource is pending.

```tsx
import { createResource, Suspense } from "solid-js";

function Profile() {
  const [user] = createResource(fetchUser);
  return <p>{user()?.name}</p>; // suspends until ready
}

<Suspense fallback={<p>Loading...</p>}>
  <Profile />
</Suspense>;
```

Multiple resources under one `<Suspense>` all suspend together — the boundary doesn't reveal until **all** are ready (or `latest` is available across a refresh, depending on options).

## Integration with `<ErrorBoundary>`

If the fetcher throws, the error propagates up to the nearest `<ErrorBoundary>` whose `fallback` is rendered:

```tsx
<ErrorBoundary
  fallback={(err, reset) => (
    <div>
      Failed: {String(err)} <button onClick={reset}>Retry</button>
    </div>
  )}
>
  <Suspense fallback={<p>Loading...</p>}>
    <Profile />
  </Suspense>
</ErrorBoundary>
```

For finer control, check `resource.error` directly without an error boundary.

## Options

### `initialValue`

When provided, the resource starts in `ready` and the type narrows to exclude `undefined`:

```ts
const [user] = createResource(fetchUser, { initialValue: { name: "...", id: 0 } });
user(); // never undefined
```

### `name`

Debug label.

### `deferStream` (SSR)

By default, streaming SSR may flush before this resource is ready. With `deferStream: true`, the response is held until the resource resolves — useful when the resource sets headers or affects above-the-fold content.

### `ssrLoadFrom`

- `"server"` (default) — use the server-fetched value during hydration.
- `"initial"` — re-fetch on the client after hydration.

### `storage` (advanced)

Custom storage. Defaults to `createSignal`. Useful for persisting the resource value somewhere else (e.g. an external store).

### `onHydrated`

Callback invoked after client hydration receives the SSR-fetched value.

## Common patterns

### Search-as-you-type with debounce

Use `createDeferred` (see `solid-secondary-primitives`) on the source:

```ts
const [query, setQuery] = createSignal("");
const deferred = createDeferred(query, { timeoutMs: 300 });
const [results] = createResource(deferred, fetchResults);
```

### Pagination

```ts
const [page, setPage] = createSignal(1);
const [items] = createResource(page, fetchPage);
```

### Optimistic update + refetch

```ts
async function rename(newName: string) {
  mutate((u) => ({ ...u!, name: newName }));
  await api.rename(newName);
  refetch();
}
```

### Conditional fetching (gating)

```ts
const [auth] = createResource(loggedIn, async (yes) => (yes ? fetchUser() : null));
```

## Common pitfalls

- **Forgot the source is reactive.** `createResource(userId(), fetcher)` evaluates `userId()` once. Pass `userId` (the accessor) so it re-runs.
- **Reading `resource()` outside a tracking scope.** Same as any signal — outside an effect/JSX/memo, you get a snapshot.
- **Throwing inside the fetcher and expecting `data()` to stay defined.** When the fetcher rejects, `data()` becomes `undefined`. Use `data.latest` to keep the prior value.
- **Setting headers/cookies after streaming starts.** During SSR, once the stream begins, headers can't change. Use `deferStream: true` or move header-modifying calls earlier (or in middleware).
- **Forgetting `<Suspense>`.** Without one, a still-pending resource just renders `undefined`. Suspense is what gives you a fallback UI.

## Related

- `solid-control-flow` — `<Suspense>`, `<SuspenseList>`, `<ErrorBoundary>`.
- `solid-secondary-primitives` — `createDeferred` for debouncing the source.
- `solid-router` — `query` + `createAsync` build on resource semantics with deduplication and revalidation.
- `solid-rendering` — SSR variants (`renderToStringAsync`, `renderToStream`) and how resources serialize.
