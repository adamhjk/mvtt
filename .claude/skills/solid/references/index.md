# Solid skill collection — index

Long-form descriptions and trigger keywords for every skill in the Solid collection. The router (`solid/SKILL.md`) is the entry point; this file is referenced from there for sub-skill metadata at a glance.

## Foundations

### solid-mental-model
Solid's reactive philosophy: components run **once**, reactivity is fine-grained, props are reactive proxies, signals are getter functions. Tracking scopes, owner tree, the difference between a signal and a store. **The starting point for any non-trivial Solid task** — almost every Solid bug is a violation of one of these principles.

Triggers on: mental model, fine-grained reactivity, components run once, tracking scope, owner, reactive system, why isn't this updating, signal vs store.

### solid-signals
`createSignal<T>(initial, options?)`: getter/setter shape, function-form setter, `equals` option (default `===`, `false` to always notify, custom comparator), `name`, types `Signal<T>`/`Accessor<T>`/`Setter<T>`. When NOT to use — use stores for objects/arrays where you want fine-grained nested reactivity.

Triggers on: createSignal, signal, getter, setter, Signal, Accessor, Setter, [count, setCount], reactive primitive.

### solid-effects
`createEffect`, `onMount`, `onCleanup`. Why effects shouldn't typically write to signals (use memos instead). Lifecycle ordering — effects run after render. Nested effects. Automatic batching of writes inside effects. Cleanup of subscriptions/timers/listeners.

Triggers on: createEffect, onMount, onCleanup, side effect, lifecycle, useEffect equivalent, cleanup, subscribe.

### solid-memos
`createMemo<T>(fn, value?, options?)`: derived/cached values, custom `equals`, accessing previous value, `name`. When a plain `() => derived()` is enough vs when memoization actually pays off (expensive computation OR multiple downstream readers OR custom equality).

Triggers on: createMemo, memo, derived value, computed, cache, memoize.

### solid-resources
`createResource` for async data. Two forms (with/without source). `Resource<T>` shape: callable + `state`/`loading`/`error`/`latest`. State machine: `unresolved` → `pending` → `ready` → `refreshing`/`errored`. `ResourceActions`: `mutate` (optimistic), `refetch`. `initialValue`, `deferStream`, `ssrLoadFrom`, `storage`, `onHydrated`. Integration with `<Suspense>` and `<ErrorBoundary>`.

Triggers on: createResource, async, fetch, loading state, suspense, data fetching, mutate, refetch.

## Components & props

### solid-components
Component basics: capital-letter naming (lowercase is a DOM tag), run-once lifecycle, default vs named exports, the difference between a component function and the JSX it returns. `Component<P>` / `ParentComponent<P>` / `VoidComponent<P>` / `FlowComponent` types. Generic components.

Triggers on: component, function component, capitalize, Component<>, ParentComponent, VoidComponent, FlowComponent.

### solid-props
**Props are a reactive proxy — never destructure them.** `mergeProps` for defaults, `splitProps` for forwarding subsets, `children` helper for resolving `props.children` once. Ways to break reactivity (the assignment, the destructure, the early call). Default values via `mergeProps` or initial-signal-value pattern. Prop drilling and when context wins.

Triggers on: props, props.children, destructure props, mergeProps, splitProps, children helper, default props, prop drilling, ParentProps.

### solid-jsx
JSX semantics specific to Solid: single-root requirement, self-closing tags, dynamic expressions in `{ }`, properties vs attributes, fragments `<>...</>`, the order in which expressions are applied (matters for `<input type="range">` etc.).

Triggers on: JSX, fragment, single root, self-closing, expression, JSX in Solid.

### solid-jsx-attributes
Every JSX attribute prefix Solid recognizes: `class` (preferred over `className`), `classList`, `style` (string or object with kebab-case keys + CSS variables), `ref`, `attr:*`, `prop:*`, `bool:*`, `on:*` (native, case-sensitive), `on*` (delegated), `oncapture:*` (deprecated), `use:*`, `innerHTML`, `textContent`, `once` (event listener once option).

Triggers on: classList, class, style, attr:, prop:, bool:, innerHTML, textContent, JSX attributes, jsx-attributes.

### solid-events
Event handler model: delegated (`on*`, attached at document, lowercase or camelCase) vs native (`on:*`, attached to element, case-sensitive). Array binding form `onClick={[handler, data]}`. Event delegation list. `stopPropagation` gotcha with delegation. Portal event flow follows the component tree, not the DOM.

Triggers on: event handler, onClick, on:, on*, event delegation, stopPropagation, custom event, on:custom-event.

### solid-refs
DOM access: variable form (`let el; <div ref={el}>`), callback form, signal-as-ref (when the element appears/disappears), forwarding refs through components (`props.ref` is automatically a callback). TypeScript: definitive assignment `let el!: HTMLDivElement`. Custom directives via `use:*`.

Triggers on: ref, DOM element, forward ref, callback ref, signal ref, definitive assignment, use directive.

## State

### solid-stores
`createStore<T>` for nested reactive state. Path syntax: `setStore(key, value)`, `setStore(key, subkey, value)`, `setStore(key, [i, j, k], "loggedIn", false)` (multi-index), `setStore(key, { from, to, by }, ...)` (range), `setStore(key, predicate, ...)` (filter function). Shallow-merge for object updates. `produce` for mutable-style updates (object/array only). `reconcile` for diff-based replacement. `unwrap` for non-reactive snapshot. `createMutable` (proxy-based, simpler API but harder to debug). `modifyMutable`.

Triggers on: createStore, store, produce, reconcile, unwrap, createMutable, modifyMutable, path syntax, nested state.

### solid-context
`createContext`, `<MyContext.Provider value={...}>`, `useContext`, default values, custom Provider components, custom `useMyContext` hooks that throw on missing provider, putting signals/stores into context for shared state.

Triggers on: createContext, useContext, Provider, context API, prop drilling.

### solid-state-management
Cross-cutting decision tree: signal (single value or simple atomic state) vs store (nested objects/arrays needing fine-grained reactivity) vs context (cross-tree shared state) vs external state library. Patterns from the docs guides on state-management and complex-state-management.

Triggers on: state management, where to put state, signal vs store, complex state, global state.

## Control flow

### solid-control-flow
`<Show when={...} fallback={...} keyed?>` (with function-child accessor or keyed value), `<Switch fallback>` + `<Match when>`, `<For each>` (keyed by reference, `index` is a signal), `<Index each>` (keyed by position, `item` is a signal), `<Dynamic component={...}>`, `<Portal mount>`, `<ErrorBoundary fallback={(err, reset) => ...}>`, `<Suspense fallback>`, `<SuspenseList>`, `lazy(() => import(...))`, `<NoHydration>`, `createDynamic`. The For-vs-Index decision tree.

Triggers on: Show, Switch, Match, For, Index, Dynamic, Portal, ErrorBoundary, Suspense, SuspenseList, lazy, conditional render, list rendering, error boundary.

## Reactive utilities

### solid-reactive-utilities
`batch`, `untrack`, `on(deps, fn, { defer })`, `observable` (RxJS interop), `from`, `createRoot`, `getOwner`, `runWithOwner`, `indexArray`, `mapArray`, `startTransition`, `useTransition`, `catchError`, `mergeProps`, `splitProps`, `children`. When to reach for each.

Triggers on: batch, untrack, on, observable, createRoot, getOwner, runWithOwner, indexArray, mapArray, startTransition, useTransition, catchError.

### solid-secondary-primitives
`createComputed` (synchronous, dangerous — runs before render, used for upstream tracking), `createDeferred` (debounced via idle callback), `createReaction` (one-shot, manually re-tracked), `createRenderEffect` (synchronous, tied to render phase, used for refs/directives), `createSelector` (memoized equality check, useful for highlighting selected items in a list).

Triggers on: createComputed, createDeferred, createReaction, createRenderEffect, createSelector.

## Rendering & SSR

### solid-rendering
Client mounting (`render`), hydration (`hydrate`), SSR variants — `renderToString` (sync), `renderToStringAsync` (waits for resources), `renderToStream` (streaming, suspense-aware). `generateHydrationScript`/`<HydrationScript>`. `isServer` compile-time constant. `isDev`/`DEV`. Choosing a rendering strategy. Avoiding hydration mismatches.

Triggers on: render, hydrate, renderToString, renderToStringAsync, renderToStream, HydrationScript, isServer, isDev, SSR, hydration mismatch.

## Routing

### solid-router
`@solidjs/router`: `<Router>`, `<Route path component>`, `<A href>`, `<Navigate href>`, `<HashRouter>`, `<MemoryRouter>`, `<Outlet>`, dynamic `:id`, `matchFilters`, optional `:id?`, wildcard `*` and `*name`, multiple paths, layouts (parent route renders `<Outlet>`), nested routes. Primitives: `useParams`, `useLocation`, `useNavigate`, `useSearchParams`, `useBeforeLeave`, `useIsRouting`, `useResolvedPath`, `usePreloadRoute`. Data: `query(fetcher, name)`, `createAsync(() => query(args))`, `createAsyncStore`. Mutations: `action(fn, name)`, `useAction`, `useSubmission`, `useSubmissions`, response helpers (`redirect`, `reload`, `json`), automatic revalidation. Lazy routes via `lazy`. Preloading via `route.preload` and `usePreloadRoute`. SPA vs SSR. Migration from earlier router versions.

Triggers on: solid-router, @solidjs/router, Router, Route, useParams, useNavigate, useSearchParams, useLocation, query, createAsync, action, useAction, useSubmission, redirect, reload, preload, layouts.

## Meta-framework

### solid-start
SolidStart full surface. `app.config.ts` (Vinxi). File-based routing under `src/routes` with `<FileRoutes>`. Layouts (`(group)`, `_layout` files). Server functions (`"use server"` directive — top of file or top of function). `createMiddleware` for request middleware. `useSession` (vinxi/http) for sessions. Request events / `getRequestEvent`, response helpers, websockets via SolidStart's hooks. API routes (`src/routes/api/...`). Route prerendering. Head & metadata (paired with `solid-meta`). CSS & styling. Static assets in `public/`. Single-flight mutations. Deployment presets (Netlify, Vercel, Cloudflare, AWS). Auth patterns. Service workers. Serialization. Migrating from v1.

Triggers on: SolidStart, solid-start, @solidjs/start, server function, "use server", FileRoutes, app.config, createMiddleware, useSession, getRequestEvent, API route, deployment preset, single-flight mutation.

### solid-meta
`@solidjs/meta`: wrap the app in `<MetaProvider>`, then anywhere in the tree use `<Title>`, `<Meta>`, `<Link>`, `<Style>`, `<Base>` to set head tags reactively. `useHead` for low-level access. SSR setup uses a separate tags array.

Triggers on: solid-meta, @solidjs/meta, MetaProvider, Title, Meta, Link, useHead, head tags, SEO.

## Tooling & types

### solid-typescript
`tsconfig` (`jsx: "preserve"`, `jsxImportSource: "solid-js"`). `Component<P>` / `ParentComponent<P>` / `VoidComponent<P>` / `FlowComponent<P, T>`. Generic components (must use function declaration, not the `Component` type). `JSX.Element`. `JSX.EventHandler<TElement, TEvent>`, `JSX.EventHandlerWithOptions`. `currentTarget` vs `target`. Ref definitive assignment. Narrowing with `<Show>`/optional chaining/keyed Show. `Directives` and `DirectiveFunctions` for `use:*`. `CustomEvents` for `on:*` typing. `ExplicitProperties`/`ExplicitAttributes`/`ExplicitBoolAttributes` for `prop:*`/`attr:*`/`bool:*`.

Triggers on: TypeScript, types, Component<>, JSX.Element, JSX.EventHandler, currentTarget, ref types, Directives, CustomEvents, jsxImportSource.

### solid-configuration
Project setup: `vite-plugin-solid` options (`hot`, `ssr`, `solid`, `babel`, `typescript`), env vars (Vite: `VITE_*` exposed to client, server-only otherwise; SolidStart: see docs), `.env` files, build config, `app.config` in SolidStart, `tsconfig` essentials.

Triggers on: vite-plugin-solid, env vars, VITE_, .env, app.config, tsconfig, build configuration.

### solid-testing
Testing setup: `vitest`, `@solidjs/testing-library` (`render`, `screen`, `fireEvent`), jsdom env, testing reactive logic in isolation (`createRoot` for setup), testing routes via `<MemoryRouter>`.

Triggers on: testing, vitest, @solidjs/testing-library, render in tests, fireEvent, jsdom.

### solid-migration
Upgrade paths: Solid 1.x major changes, `@solidjs/router` migration (renamed APIs), SolidStart v1 migration. Common migrations like `className` → `class`, etc.

Triggers on: migration, upgrade, breaking changes, deprecated, className.
