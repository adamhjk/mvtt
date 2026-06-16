---
name: solid-migration
description: "Use this skill when upgrading a Solid (SolidJS) project to a newer version of Solid, `@solidjs/router`, or SolidStart, or when diagnosing breakage after such an upgrade. Covers Solid 1.x deprecations and renamed APIs (`className` → `class`, removed lifecycle quirks), Solid Router migration to the current major (renamed primitives like `useRouteData` → `query` + `createAsync`, `cache` → `query`, old `<Outlet>` patterns vs `props.children` + `<FileRoutes>`), and SolidStart v1 migration (the post-vinxi rewrite — file-routing changes, server-function syntax, removed `routeData` exports). Also: how to read CHANGELOGs, what to grep for after an upgrade, and the rule of thumb that if your code references `cache`, `routeData`, or `serverAction`, you're on an old API. Triggers on: migration, upgrade, breaking changes, deprecated, className, cache, routeData, useRouteData, serverAction, createServerData, post-v1, migrating, upgrading Solid Router, upgrading SolidStart."
license: MIT
---

This skill is for upgrading existing Solid code, not for new projects. The Solid ecosystem has had a few significant API renames; this is a checklist for finding and fixing them.

## Solid core (1.x)

Solid's API is unusually stable for a frontend framework. Major changes between minor versions are rare. Recent notable changes:

| Old                                      | New                                                           | Since |
| ---------------------------------------- | ------------------------------------------------------------- | ----- |
| `className`                              | `class`                                                       | 1.4   |
| `untrack(() => ...)` returning a promise | unchanged but be careful — async callbacks lose ownership     | n/a   |
| `createComputed` use in app code         | strongly discouraged in favour of `createMemo`/`createEffect` | n/a   |

When in doubt, check `node_modules/solid-js/CHANGELOG.md` or the GitHub releases page.

## `@solidjs/router` migration

The router went through a significant rename pass when actions and queries were introduced. If your code uses any of these, it's old:

| Old                                                          | New                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| `useRouteData()`                                             | `createAsync(() => query(...))`                              |
| `cache(fn, name)`                                            | `query(fn, name)`                                            |
| `serverAction(fn)`                                           | `action(fn, name)`                                           |
| `routeData` export from a route                              | `route.preload` export, plus call queries with `createAsync` |
| `createRouteData`                                            | `createAsync`                                                |
| `<Outlet />`                                                 | `props.children` (in layout components)                      |
| `useIsRouting()`                                             | unchanged                                                    |
| `useNavigate`, `useParams`, `useLocation`, `useSearchParams` | unchanged names                                              |

### The data-flow change

Old pattern:

```tsx
// OLD
export function routeData() {
  return createRouteData(() => fetchUser());
}

export default function User() {
  const user = useRouteData<typeof routeData>();
  return <p>{user()?.name}</p>;
}
```

New pattern:

```tsx
// NEW
const getUser = query(() => fetchUser(), "user");

export const route = {
  preload: () => getUser(),
} satisfies RouteDefinition;

export default function User() {
  const user = createAsync(() => getUser());
  return <p>{user()?.name}</p>;
}
```

The mental shift:

- Cache + dedup belongs in `query`, not in the route.
- Route preload triggers the query (via the cache).
- Components read with `createAsync` — a thin reactive wrapper over the query result.

### Action change

```tsx
// OLD
const submit = serverAction(async (form: FormData) => { ... });

// NEW
const submit = action(async (form: FormData) => { ... }, "submit");
```

The `name` argument is now required for SSR.

### Search

After upgrading, grep for: `useRouteData`, `createRouteData`, `cache(`, `serverAction(`, `routeData()`, `<Outlet`. Each match needs a rewrite.

## SolidStart v1 (post-Vinxi)

SolidStart 1.0 was a major rewrite atop Vinxi. The 0.x → 1.x migration involves:

| Old (0.x)                                     | New (1.x)                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `solid-start.config.js`                       | `app.config.ts` (uses `defineConfig` from `@solidjs/start/config`)                      |
| `routeData` named export                      | `route.preload` export (RouteDefinition shape)                                          |
| `server$(fn)`                                 | `"use server"` directive (top of file or function)                                      |
| `createServerData$` / `createServerAction$`   | `query` + `createAsync` / `action` (from `@solidjs/router`, with `"use server"` inside) |
| `<Routes>`                                    | `<FileRoutes>` from `@solidjs/start/router`                                             |
| `~start/entry-client` etc. import paths       | `entry-client.tsx` / `entry-server.tsx` are first-class files in `src/`                 |
| Adapter packages (`solid-start-vercel`, etc.) | Vinxi presets via `app.config.ts` (`server: { preset: "vercel" }`)                      |

### File-routing changes

Older SolidStart used JSX route nesting; the v1 system is purely file-based with `<FileRoutes />`. If your routes were defined imperatively, replace the JSX with files under `src/routes/`.

### Server functions

Old:

```ts
import server$ from "solid-start/server";

const getThing = server$(async (id: string) => { ... });
```

New:

```ts
async function getThing(id: string) {
  "use server";
  return ...;
}
```

Or wrap in `query` for caching:

```ts
const getThing = query(async (id: string) => {
  "use server";
  return ...;
}, "thing");
```

### Sessions

Old: SolidStart-specific session helpers.

New: `useSession` from `vinxi/http`.

### Adapters → presets

Replace `solid-start-vercel` and friends with `app.config.ts`:

```ts
export default defineConfig({
  server: { preset: "vercel" },
});
```

## How to migrate

The general approach:

1. **Read the CHANGELOG.** Each ecosystem package keeps a CHANGELOG.md. Skim major releases for breaking changes.
2. **Bump one package at a time.** Don't update Solid + Router + Start simultaneously. One at a time, run tests, fix breaks, commit.
3. **Grep for renamed APIs.** Use the tables above.
4. **Run typecheck.** `tsc --noEmit` finds most mechanical breakages — renamed exports, changed signatures.
5. **Run tests.** Should catch behavioural breakages.
6. **Test SSR explicitly.** Some breakages only surface during server render (hydration mismatches, missing `name` arguments to actions).
7. **Update tooling.** Vitest config, `vite-plugin-solid`, tsconfig may need bumps too.

## Common upgrade issues

- **Hydration mismatch after upgrade.** Check that no module-level state (signals exported from a module) is used by SSR — those leak across requests. Move into Providers.
- **"Action requires a name."** Pass a string as the second arg to `action(fn, "name")`.
- **Tree-shaken directive imports.** Set `vite-plugin-solid`'s `typescript: { onlyRemoveTypeImports: true }` or reference the directive as a value.
- **`useRouteData` not found.** It was renamed; rewrite as a `query` + `createAsync`.
- **Server function returns `undefined` to client.** Server functions are RPC; their return value is JSON-serialized. Make sure you're returning serializable data, not Date objects with prototype methods, etc.
- **Route preload hook missing.** Old style was top-level `routeData` export. New style is `export const route = { preload: ... } satisfies RouteDefinition;`.

## When in doubt

- **Solid core docs:** `https://docs.solidjs.com/`
- **Solid Router docs:** `https://docs.solidjs.com/solid-router`
- **SolidStart docs:** `https://docs.solidjs.com/solid-start`
- **Solid Router migration guide:** `https://docs.solidjs.com/solid-router/guides/migration`
- **SolidStart migration guide:** `https://docs.solidjs.com/solid-start/migrating-from-v1`
- **Each package's CHANGELOG.md** in `node_modules/`.

## Related

- `solid-router` — current router APIs.
- `solid-start` — current SolidStart APIs.
- `solid-resources`, `solid-mental-model` — the underlying primitives that don't change between versions.
- `solid-configuration` — `app.config.ts` and presets.
