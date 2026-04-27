---
name: solid-start
description: "Use this skill for any SolidStart task — the official meta-framework for Solid (SolidJS) covering CSR/SSR/SSG, file-based routing, server functions, data fetching/mutation, middleware, sessions, websockets, API routes, and deployment. Covers `app.config.ts` (Vinxi config; presets, server middleware, ssr toggle), file routing under `src/routes` with `<FileRoutes>` (segments, layouts via `[group]`/`_layout` files, dynamic `[id].tsx`, catch-all `[...rest].tsx`, route groups `(group)`), the `\"use server\"` directive (top of file = whole file is server-only; top of function = that function only) for server functions usable as query/action fetchers, `createMiddleware` for request middleware, `useSession` (from `vinxi/http`) for cookie-based sessions, request/response helpers via `getRequestEvent`, websockets, API routes (`src/routes/api/...` exporting `GET`/`POST`/etc.), route prerendering via `route.preload` and config, head/metadata via `solid-meta`, CSS/styling, static assets in `public/`, single-flight mutations (action + preloaded query in one round-trip), deployment presets (`netlify`/`vercel`/`cloudflare`/`node`), and migrating from v1. Triggers on: SolidStart, solid-start, @solidjs/start, app.config, app.config.ts, FileRoutes, server function, \"use server\", createMiddleware, useSession, getRequestEvent, API route, deployment preset, single-flight mutation, prerendering, file-based routing, layout group, [id].tsx, vinxi."
license: MIT
---

SolidStart is Solid's official meta-framework. It pairs Vinxi (Vite + Nitro) with Solid Router and Solid Meta to give you file-based routing, server functions, request/response handling, sessions, websockets, and deploy presets out of the box.

## Install

```sh
npm i @solidjs/start solid-js @solidjs/router @solidjs/meta vinxi
```

Or scaffold a fresh project:

```sh
npm create solid@latest
```

## Project shape

```
.
├── app.config.ts              # Vinxi config — presets, plugins, ssr toggle
├── src/
│   ├── app.tsx                # Root component (Router + FileRoutes)
│   ├── entry-client.tsx       # Client mount (uses hydrate)
│   ├── entry-server.tsx       # Server entry (renderToString*)
│   └── routes/
│       ├── index.tsx          # /
│       ├── about.tsx          # /about
│       ├── users.tsx          # /users (layout if it has a child folder)
│       ├── users/
│       │   ├── (overview).tsx # /users  (route group)
│       │   ├── [id].tsx       # /users/:id
│       │   └── [...rest].tsx  # catch-all
│       ├── api/
│       │   └── ping.ts        # API route → GET /api/ping
│       └── _components/...    # underscore folders are NOT routes
└── public/                    # static assets
```

## `app.config.ts`

```ts
import { defineConfig } from "@solidjs/start/config";

export default defineConfig({
  ssr: true,                          // false for SPA-only build
  server: {
    preset: "vercel",                 // or "netlify", "cloudflare-pages", "node-server", ...
  },
  vite: {
    plugins: [/* additional vite plugins */],
  },
  middleware: "src/middleware.ts",    // path to your createMiddleware export
});
```

The `preset` is what tells Vinxi/Nitro which deployment target to build for. Available presets cover Node, Vercel, Netlify, Cloudflare Pages/Workers, AWS Lambda, Deno, Bun, and more.

## File-based routing

Files under `src/routes` define routes. The path mirrors the file path, with these rules:

| File | Route |
|---|---|
| `routes/index.tsx` | `/` |
| `routes/about.tsx` | `/about` |
| `routes/users/[id].tsx` | `/users/:id` |
| `routes/users/[id]/edit.tsx` | `/users/:id/edit` |
| `routes/files/[...rest].tsx` | `/files/*rest` |
| `routes/(marketing)/about.tsx` | `/about` (group `(marketing)` is path-less) |
| `routes/users/(list).tsx` | `/users` (sibling of `[id].tsx`) |
| `routes/_components/Foo.tsx` | NOT a route (underscore prefix) |

### Layouts

A folder with a same-named layout file becomes a layout. The convention varies by version; the most common pattern is:

```
routes/
  users.tsx             # layout for /users/*
  users/
    index.tsx           # /users
    [id].tsx            # /users/:id
```

`users.tsx` receives `props.children` and renders the matched child. Or use route groups:

```
routes/
  (app)/
    _layout.tsx         # layout for everything in (app)
    dashboard.tsx
    settings.tsx
```

Different SolidStart versions vary slightly; check the current docs at `https://docs.solidjs.com/solid-start/building-your-application/routing`.

### Wiring `<FileRoutes>`

```tsx
// src/app.tsx
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";

export default function App() {
  return (
    <Router root={(props) => (
      <>
        <Header />
        <Suspense>{props.children}</Suspense>
      </>
    )}>
      <FileRoutes />
    </Router>
  );
}
```

`<FileRoutes />` expands to `<Route>` JSX for each file under `src/routes`.

## Server functions — `"use server"`

A function marked `"use server"` runs **only** on the server. SolidStart compiles client-side calls into RPCs; the body is stripped from the client bundle and the call becomes a fetch to the matching server endpoint.

### Whole-file form

```tsx
"use server";

import { db } from "./db";

export async function getUser(id: string) {
  return db.users.get(id);
}
```

Every export is a server function.

### Per-function form

```ts
import { query } from "@solidjs/router";

const getUser = query(async (id: string) => {
  "use server";
  return db.users.get(id);
}, "user");
```

The directive must be the **first statement** of the function. Above (or alongside) you can have client-callable code.

### Why use server functions

- Direct database access without an HTTP middle layer.
- Reading session/cookies on the server.
- Calling internal services with private credentials.

Server functions integrate with Solid Router queries and actions transparently — you typically wrap them in `query` or `action`.

## Request events

Inside a server function (or middleware), you can read the current request:

```ts
import { getRequestEvent } from "solid-js/web";

async function logRequest() {
  "use server";
  const event = getRequestEvent();
  console.log(event?.request.url);
}
```

The event exposes the `Request`, response helpers, and a `locals` object you can populate from middleware.

## Middleware — `createMiddleware`

```ts
// src/middleware.ts
import { createMiddleware } from "@solidjs/start/middleware";

export default createMiddleware({
  onRequest: [(event) => {
    // before each request
    event.locals.requestId = crypto.randomUUID();
  }],
  onBeforeResponse: [(event) => {
    // before sending response
  }],
});
```

Wire it via `app.config.ts`'s `middleware: "src/middleware.ts"`.

## Sessions — `useSession`

```ts
import { useSession } from "vinxi/http";

async function login(userId: string) {
  "use server";
  const session = await useSession({
    password: process.env.SESSION_SECRET!,
    name: "session",
  });
  await session.update({ userId });
}

async function getMe() {
  "use server";
  const session = await useSession({
    password: process.env.SESSION_SECRET!,
    name: "session",
  });
  return session.data.userId ?? null;
}
```

Session data is encrypted in a cookie (no server-side store). For server-side sessions, store an opaque token in the cookie and look it up in your DB.

## Data fetching + mutation in SolidStart

The Solid Router patterns just work — wrap a server function with `query` or `action`:

```ts
import { query, action, redirect } from "@solidjs/router";
import { db } from "./db";

export const getUser = query(async (id: string) => {
  "use server";
  return db.users.get(id);
}, "user");

export const renameUser = action(async (id: string, formData: FormData) => {
  "use server";
  await db.users.update(id, { name: formData.get("name") as string });
  throw redirect(`/users/${id}`);
}, "renameUser");
```

The `"use server"` makes them server-only; the client code becomes an RPC call.

### Single-flight mutations

If a route preloads a query, and an action redirects to the same route, SolidStart can perform the mutation **and** revalidate the destination's query in a **single round-trip** — the new data streams back with the redirect.

Conditions:
1. Action runs server-side (`"use server"` inside the action).
2. The destination's preload runs the same query.

```tsx
// routes/users/[id].tsx
export const route = {
  preload: ({ params }) => getUser(params.id),
} satisfies RouteDefinition;

export default function UserPage(props: RouteSectionProps) {
  const user = createAsync(() => getUser(props.params.id));
  return ...;
}
```

When `renameUser` redirects to `/users/:id`, the response includes the updated user data. No second fetch.

### `deferStream` — header-modifying queries

If a query sets headers (cookies, redirects), it must run before streaming begins. Use `deferStream`:

```ts
const user = createAsync(() => getCurrentUser(), { deferStream: true });
```

## API routes

Files under `src/routes/api/` (or anywhere) that export HTTP method handlers become API routes:

```ts
// src/routes/api/users/[id].ts
import type { APIEvent } from "@solidjs/start/server";

export async function GET(event: APIEvent) {
  const user = await db.users.get(event.params.id);
  return new Response(JSON.stringify(user), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(event: APIEvent) {
  const body = await event.request.json();
  const user = await db.users.update(event.params.id, body);
  return Response.json(user);
}
```

## Websockets

```ts
// src/routes/api/ws.ts
import { eventHandler } from "vinxi/http";

export default eventHandler({
  handler() {},
  websocket: {
    open(peer) { peer.send("hello"); },
    message(peer, message) { peer.send(`echo: ${message}`); },
    close(peer) {},
  },
});
```

Connect from the client via the standard `WebSocket` constructor; SolidStart routes the upgrade.

## Head & metadata

Pair with `solid-meta`:

```tsx
// src/app.tsx
import { MetaProvider } from "@solidjs/meta";

<MetaProvider>
  <Router>...</Router>
</MetaProvider>
```

```tsx
// any route
import { Title, Meta } from "@solidjs/meta";

export default function About() {
  return (
    <>
      <Title>About — My App</Title>
      <Meta name="description" content="..." />
      <h1>About</h1>
    </>
  );
}
```

See `solid-meta`.

## CSS & styling

Standard Vite asset pipeline: `import "./style.css"` (global), or `import s from "./style.module.css"` (CSS Modules). Tailwind, UnoCSS, Sass — see the SolidStart styling guides; configured via standard Vite plugins in `app.config.ts`.

## Static assets

Anything under `public/` is served as-is from the root. Use absolute paths in JSX: `<img src="/logo.png" />`.

## Prerendering

Pages can be pre-rendered to HTML at build time:

```ts
// app.config.ts
export default defineConfig({
  server: {
    prerender: {
      routes: ["/", "/about", "/blog"],
      crawlLinks: true,
    },
  },
});
```

Combined with SSR off (`ssr: false`) for static-site generation, or `ssr: true` for hybrid.

## Auth

Standard pattern:
1. `useSession` to read/write session cookie.
2. Middleware or query that throws `redirect("/login")` if missing.
3. Login action that validates and writes the session.
4. Logout action that clears it.

```ts
const requireUser = query(async () => {
  "use server";
  const session = await useSession({ password: ..., name: "session" });
  if (!session.data.userId) throw redirect("/login");
  return await db.users.get(session.data.userId);
}, "currentUser");
```

## Migrating from v1

SolidStart 1.0 changed several APIs: `routeData` removed in favour of `query` + `createAsync` + route-level `preload`, `serverAction` renamed to `action`, fetching APIs reorganized. The official migration guide at `https://docs.solidjs.com/solid-start/migrating-from-v1` is the source of truth.

## Common pitfalls

- **`"use server"` not at the top.** Must be the first statement of the file or function. Otherwise it's just a string literal.
- **Importing server-only modules from client code.** If you `import { db } from "./db"` at module top of a route, the bundler tries to ship `db` to the client. Wrap in `"use server"` or split the file.
- **Forgetting `name` on actions/queries.** Required for SSR identification.
- **Mutations without revalidation.** Default behaviour revalidates active queries — but if you used `json({...}, { revalidate: [] })` you need `revalidate(...)` manually.
- **Modifying headers after streaming starts.** Use `deferStream: true` on queries that set cookies or redirect.
- **Using `onMount` for server work.** `onMount` is client-only. Use server functions or route preload.

## Examples

### Login flow

```ts
// src/routes/login.tsx
import { action, redirect } from "@solidjs/router";
import { useSession } from "vinxi/http";

const login = action(async (formData: FormData) => {
  "use server";
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const user = await db.users.findByLogin(email, password);
  if (!user) return { error: "Invalid credentials" };
  const session = await useSession({ password: process.env.SECRET!, name: "session" });
  await session.update({ userId: user.id });
  throw redirect("/dashboard");
}, "login");

export default function LoginPage() {
  const sub = useSubmission(login);
  return (
    <form action={login} method="post">
      <input name="email" type="email" />
      <input name="password" type="password" />
      <button disabled={sub.pending}>Sign in</button>
      <Show when={sub.result?.error}><p>{sub.result.error}</p></Show>
    </form>
  );
}
```

### Streaming dashboard with multiple queries

```tsx
const getOverview = query(async () => { "use server"; return db.overview(); }, "overview");
const getRecent = query(async () => { "use server"; return db.recent(); }, "recent");

export const route = {
  preload: () => { getOverview(); getRecent(); },
} satisfies RouteDefinition;

export default function Dashboard() {
  const overview = createAsync(() => getOverview());
  const recent = createAsync(() => getRecent());
  return (
    <>
      <Suspense fallback={<OverviewSkeleton />}><Overview data={overview()!} /></Suspense>
      <Suspense fallback={<RecentSkeleton />}><Recent data={recent()!} /></Suspense>
    </>
  );
}
```

Streaming SSR sends the shell + skeletons immediately; each suspense reveals when its query resolves.

## Related

- `solid-router` — the routing primitives SolidStart wires into file routing.
- `solid-meta` — head/metadata.
- `solid-resources` — what `query`+`createAsync` build on.
- `solid-rendering` — the underlying SSR mechanics.
- `solid-configuration` — env vars, tsconfig.
