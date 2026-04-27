---
name: solid-rendering
description: "Use this skill for any client mounting, hydration, or server-side rendering in Solid (SolidJS): the entry-point APIs and how to pick the right rendering strategy. Covers `render(() => <App />, mountEl)` for client SPA mounting (returns a `dispose` function), `hydrate(() => <App />, mountEl)` for client takeover after SSR (preserves server-rendered DOM), `renderToString(() => <App />)` for synchronous SSR (no async resources), `renderToStringAsync(() => <App />)` for SSR that waits for all `createResource` calls (good for static HTML), `renderToStream(() => <App />)` for streaming SSR with progressive Suspense reveal (best perceived performance), `generateHydrationScript()` and `<HydrationScript>` for serializing resource state to the client, `isServer` (compile-time constant — code branches behind it are tree-shaken from the client bundle), `isDev` / `DEV` (build-mode flag), and the rules for avoiding hydration mismatches. Triggers on: render, hydrate, renderToString, renderToStringAsync, renderToStream, generateHydrationScript, HydrationScript, isServer, isDev, DEV, SSR, SPA, hydration, hydration mismatch, streaming, mount, mount client app."
license: MIT
---

Solid's rendering APIs are split between client (`solid-js/web`) and server (`solid-js/web` exports the same surface — bundlers branch on `isServer`). The client-only `render`/`hydrate` mount into the DOM; the server-only `renderToString*` family produces HTML strings or streams.

## Imports

```ts
import {
  render, hydrate, Portal, Dynamic, NoHydration,
  isServer, isDev, DEV,
  renderToString, renderToStringAsync, renderToStream,
  generateHydrationScript, HydrationScript,
} from "solid-js/web";
```

## Client mounting — `render`

```ts
function render(code: () => JSX.Element, element: MountableElement): () => void;
```

```tsx
import { render } from "solid-js/web";

const dispose = render(() => <App />, document.getElementById("app")!);
```

- The first argument **must be a function**, not the JSX itself. Solid evaluates it inside its root.
- Returns `dispose()` — when called, unmounts the tree, runs all `onCleanup` callbacks, and clears the mount container.
- The mount target is wiped and replaced with the rendered output.
- Most apps call `render` once at boot.

## SSR + client takeover — `hydrate`

```ts
function hydrate(code: () => JSX.Element, element: MountableElement, options?): () => void;
```

```tsx
import { hydrate } from "solid-js/web";

hydrate(() => <App />, document.getElementById("app")!);
```

Use after the server has rendered the same markup. Hydrate doesn't replace the DOM — it walks the existing nodes, attaches event handlers, and resumes reactivity. The server-rendered HTML must match what the client would produce.

If they don't match, you get a "hydration mismatch" — handlers may attach to the wrong nodes or rendering may shift. Common causes:
- Reading `Date.now()` or random values without `isServer` guards.
- Reading from `localStorage`/`window` (which only exists client-side) without guards.
- Different content based on viewport (use CSS or post-mount effects, not server-time conditionals).

## Server rendering — three flavors

### `renderToString` — synchronous

```ts
function renderToString(fn: () => JSX.Element, options?: { nonce?: string; renderId?: string }): string;
```

```ts
const html = renderToString(() => <App />);
```

- Returns the HTML string immediately.
- **Does not wait for resources.** Anything inside `<Suspense>` renders the fallback.
- Fastest synchronous SSR, suitable when you don't need server-fetched data inline.

### `renderToStringAsync` — wait for resources

```ts
function renderToStringAsync(fn: () => JSX.Element, options?): Promise<string>;
```

```ts
const html = await renderToStringAsync(() => <App />);
```

- Waits for all `createResource` calls to resolve before returning HTML.
- Best for static SSR where you want fully-formed HTML at request time.
- Slow under high latency (everything blocks on the slowest resource).

### `renderToStream` — streaming SSR

```ts
function renderToStream(fn: () => JSX.Element, options?: { nonce?: string; renderId?: string; onCompleteShell?: (info: { write: (chunk: string) => void }) => void; onCompleteAll?: (info: { write: (chunk: string) => void }) => void }): {
  pipe(writable: NodeJS.WritableStream): void;
  pipeTo(writable: WritableStream): Promise<void>;
};
```

```ts
const stream = renderToStream(() => <App />);
stream.pipe(response);   // Node response object
// or
await stream.pipeTo(response.writable);   // Web streams
```

- Sends HTML as it becomes available — the page shell first, then each `<Suspense>` boundary as its resources resolve.
- Best perceived performance: users see *something* immediately.
- Requires HTTP streaming on the server.

This is what SolidStart uses by default.

## Hydration script

The server needs to ship the data the client uses to hydrate without re-fetching:

```tsx
import { HydrationScript } from "solid-js/web";

function ServerHTML() {
  return (
    <html>
      <head>
        <HydrationScript />     {/* renders to a <script> with the hydration payload */}
      </head>
      <body><div id="app"><App /></div></body>
    </html>
  );
}
```

Or use `generateHydrationScript()` to get the script string for manual insertion.

The hydration script:
- Sets up the data structures resources need to find their server-fetched values.
- Provides nonce support for strict CSP.

## `isServer`, `isDev`, `DEV`

### `isServer`

```ts
import { isServer } from "solid-js/web";
```

A constant. The bundler tree-shakes branches:

```ts
if (isServer) {
  // server-only code; removed from client bundle
} else {
  // client-only code; removed from server bundle
}
```

Use this to gate `window`/`document` access, `localStorage`, `Date.now()` for randomness, etc.

### `isDev` / `DEV`

```ts
import { isDev, DEV } from "solid-js/web";
```

- `isDev` — `boolean` indicating dev vs prod build.
- `DEV` — exposes dev-mode helpers (e.g. registering signals for devtools).

Use `if (isDev) { ... }` for debug-only code that's stripped from production.

## Avoiding hydration mismatches

The cardinal rule: **the server-rendered output must match what the client would render on first pass.**

Common gotchas and fixes:

| Problem | Fix |
|---|---|
| `if (typeof window !== "undefined")` for client-only content | `<Show when={!isServer}>` or `onMount` |
| `Math.random()` / `Date.now()` for ids | Pass an id from the parent, or use `createUniqueId` |
| Reading `localStorage` for initial state | Render a default; correct in `onMount` |
| Browser-only libraries imported at module top level | `if (isServer) return null` early, or import lazily |
| Different viewport-based markup | Use CSS media queries instead of JS-conditional output |

## `<NoHydration>` — opt-out subtree

```tsx
<NoHydration>
  <ServerOnlyWidget />
</NoHydration>
```

The subtree is rendered on the server and **not hydrated** on the client. Useful for static islands or content that doesn't need interactivity.

## `Portal` and SSR

`<Portal>` doesn't render during SSR — its content appears only after client hydration. For modal-like UI that needs SSR HTML, render in place and position with CSS.

## Examples

### Minimal SPA boot

```tsx
// main.tsx
import { render } from "solid-js/web";
import { App } from "./App";

render(() => <App />, document.getElementById("app")!);
```

### Static SSR

```ts
// server.ts (Node)
import { renderToStringAsync } from "solid-js/web";
import { App } from "./App";

const html = await renderToStringAsync(() => <App />);
res.setHeader("Content-Type", "text/html");
res.end(`<!doctype html>${html}`);
```

### Streaming SSR (Node)

```ts
import { renderToStream } from "solid-js/web";

const { pipe } = renderToStream(() => <App />, {
  onCompleteShell({ write }) {
    write("<!doctype html>");
  },
});
pipe(res);
```

### Hydration on the client

```tsx
// client.tsx
import { hydrate } from "solid-js/web";
import { App } from "./App";

hydrate(() => <App />, document.getElementById("app")!);
```

### Server-only logic

```tsx
function App() {
  if (isServer) {
    // build initial data on the server
    const data = loadFromDb();
    return <Page initial={data} />;
  }
  return <Page />;
}
```

## Common pitfalls

- **Passing JSX directly to `render`.** `render(<App />, ...)` won't work — must be `render(() => <App />, ...)`.
- **Mounting into a non-empty container.** `render` wipes the container. Use a separate target or call `dispose` before re-mounting.
- **Mismatched server/client output.** See the gotchas table above.
- **Forgetting `<HydrationScript>`.** Resources fetched on the server need it to wire up on the client.
- **Using `onMount` for SSR-needed setup.** `onMount` is client-only. For both, use `createRenderEffect` or compute in component body.
- **Module-level signals shared across SSR requests.** They leak. Use Providers.

## Related

- `solid-resources` — what resources are and why SSR cares.
- `solid-control-flow` — `<Suspense>`, `<NoHydration>`.
- `solid-start` — the meta-framework that automates all of this.
- `solid-router` — its data primitives integrate with SSR.
