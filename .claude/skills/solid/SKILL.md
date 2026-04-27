---
name: solid
description: "Use this skill first for ANY Solid (SolidJS) task; it routes to the right specialized skill for the job. Covers the full Solid surface: reactivity primitives (createSignal, createEffect, createMemo, createResource), components and props, JSX semantics, JSX attributes (class/classList/style/ref/use:/on:/attr:/prop:/bool:), events and delegation, refs and directives, stores (createStore, produce, reconcile, createMutable), context, control flow (Show, Switch/Match, For, Index, Dynamic, Portal, ErrorBoundary, Suspense, lazy), reactive utilities (batch, untrack, on, splitProps, mergeProps, children, observable, createRoot, getOwner, runWithOwner, indexArray, mapArray, startTransition, useTransition, catchError), secondary primitives (createComputed, createDeferred, createReaction, createRenderEffect, createSelector), rendering (render, hydrate, renderToString, renderToStringAsync, renderToStream, generateHydrationScript, isServer, isDev), Solid Router (Router/Route/A, params, queries, actions, preloading, layouts), SolidStart (file routing, server functions, data fetching/mutation, middleware, sessions, websockets, deployment), Solid Meta (Title, Meta, Link, MetaProvider, useHead), testing with @solidjs/testing-library, TypeScript (Component types, JSX.EventHandler, Directives), configuration (tsconfig jsx preserve, jsxImportSource, vite-plugin-solid), and migration. Triggers on: solid, solidjs, solid-js, SolidJS, createSignal, createEffect, createMemo, createResource, createStore, createContext, useContext, Show, For, Index, Switch, Match, Dynamic, Portal, ErrorBoundary, Suspense, lazy, render, hydrate, renderToString, signal, effect, memo, resource, store, reactive primitive, fine-grained reactivity, JSX in Solid, classList, ref, use directive, on:, on*, splitProps, mergeProps, batch, untrack, onMount, onCleanup, @solidjs/router, solid-router, Router, Route, useParams, useNavigate, useSearchParams, query, createAsync, action, useAction, useSubmission, @solidjs/start, SolidStart, solid-start, server function, use server, createMiddleware, useSession, app.config, @solidjs/meta, MetaProvider, Title, Meta, jsxImportSource, vite-plugin-solid, how do I in Solid, Solid component, SolidJS reactivity."
license: MIT
---

Entry point for the Solid (SolidJS) skill collection. Solid is a declarative, fine-grained reactive JavaScript framework for building user interfaces. Components run **once**; reactivity flows through signals, memos, and effects rather than re-running components.

## How to use this skill

1. Find the specialized skill in the router below that best matches the task.
2. Load that skill's `SKILL.md` and follow its guidance.
3. If the task is broad or crosses multiple areas, **start with `solid-mental-model`**. Its principles (components run once, props are reactive proxies, never destructure, signals are getter functions, JSX placement determines reactivity) underpin everything else and prevent the most common bugs.
4. If no sub-skill fits a specific API surface, the canonical sources are:
   - Solid core docs: `https://docs.solidjs.com/`
   - Solid Router docs: `https://docs.solidjs.com/solid-router`
   - SolidStart docs: `https://docs.solidjs.com/solid-start`
   - Source: `solid-js`, `@solidjs/router`, `@solidjs/start`, `@solidjs/meta` on npm

For the long-form description and trigger keywords of every skill, see [references/index.md](references/index.md).

## Skill router

### Foundations

| Skill | Load when... |
|---|---|
| [solid-mental-model](../solid-mental-model/SKILL.md) | Reasoning about Solid's reactive model: components run once, tracking scopes, fine-grained updates, owner tree, props as reactive proxies, signals vs stores. **Start here for any non-trivial Solid task.** |
| [solid-signals](../solid-signals/SKILL.md) | Calling `createSignal`, reading via getter, writing via setter (incl. function form), typing with `Signal<T>`, choosing signal vs store. |
| [solid-effects](../solid-effects/SKILL.md) | `createEffect`, `onMount`, `onCleanup`, why effects shouldn't write to signals, lifecycle ordering, nested effects, automatic batching inside effects. |
| [solid-memos](../solid-memos/SKILL.md) | `createMemo` for derived/cached values, custom `equals`, deciding between memo and plain `() => derive()`. |
| [solid-resources](../solid-resources/SKILL.md) | `createResource` for async data: with/without source, `mutate`/`refetch`, state machine (`unresolved`/`pending`/`ready`/`refreshing`/`errored`), Suspense integration, `initialValue`, `deferStream`, `ssrLoadFrom`. |

### Components & props

| Skill | Load when... |
|---|---|
| [solid-components](../solid-components/SKILL.md) | Component basics: capital-letter naming, run-once lifecycle, exports/imports, organizing component trees. |
| [solid-props](../solid-props/SKILL.md) | Anything to do with `props`: **never destructure**, `mergeProps`, `splitProps`, `children` helper, default values, prop drilling — the most common Solid bug source. |
| [solid-jsx](../solid-jsx/SKILL.md) | JSX semantics in Solid: single-root, self-closing, dynamic expressions, properties vs attributes, fragments, ordering of expressions. |
| [solid-jsx-attributes](../solid-jsx-attributes/SKILL.md) | Specific JSX attribute prefixes: `class`, `classList`, `style`, `ref`, `attr:`, `prop:`, `bool:`, `on:`, `on*`, `oncapture:`, `use:`, `innerHTML`, `textContent`, `once`. |
| [solid-events](../solid-events/SKILL.md) | Event handlers: delegated (`on*`) vs native (`on:`), case sensitivity, array binding form, delegated event list, `stopPropagation` gotcha, Portal event flow. |
| [solid-refs](../solid-refs/SKILL.md) | DOM access: `ref` variable form, callback form, signal refs, forwarding through components, custom directives via `use:`. |

### State

| Skill | Load when... |
|---|---|
| [solid-stores](../solid-stores/SKILL.md) | `createStore` for nested reactive state, path syntax (key, array of keys, `{from,to,by}` ranges, filter functions), `produce`, `reconcile`, `unwrap`, `createMutable`, `modifyMutable`. |
| [solid-context](../solid-context/SKILL.md) | `createContext`, `useContext`, custom Provider/hook patterns, default values, throwing on undefined, typing context with `ReturnType`, signals-in-context. |
| [solid-state-management](../solid-state-management/SKILL.md) | Cross-cutting decision: signal vs store vs context vs external store. When to reach for what. |

### Control flow

| Skill | Load when... |
|---|---|
| [solid-control-flow](../solid-control-flow/SKILL.md) | All built-in flow components: `<Show>`, `<Switch>`/`<Match>`, `<For>`, `<Index>` (incl. For-vs-Index decision), `<Dynamic>`, `<Portal>`, `<ErrorBoundary>`, `<Suspense>`, `<SuspenseList>`, `lazy`, `<NoHydration>`, `createDynamic`. |

### Reactive utilities

| Skill | Load when... |
|---|---|
| [solid-reactive-utilities](../solid-reactive-utilities/SKILL.md) | `batch`, `untrack`, `on` (with `defer`), `observable`, `from`, `createRoot`, `getOwner`, `runWithOwner`, `indexArray`, `mapArray`, `startTransition`, `useTransition`, `catchError`, `mergeProps`, `splitProps`, `children`. |
| [solid-secondary-primitives](../solid-secondary-primitives/SKILL.md) | `createComputed`, `createDeferred`, `createReaction`, `createRenderEffect`, `createSelector` — when and why to choose these over `createEffect`/`createMemo`. |

### Rendering & SSR

| Skill | Load when... |
|---|---|
| [solid-rendering](../solid-rendering/SKILL.md) | `render` (client mount), `hydrate`, `renderToString`, `renderToStringAsync`, `renderToStream`, `generateHydrationScript`/`<HydrationScript>`, `isServer`, `isDev`, `DEV` — picking a rendering strategy and avoiding hydration mismatches. |

### Routing

| Skill | Load when... |
|---|---|
| [solid-router](../solid-router/SKILL.md) | `@solidjs/router`: `<Router>`/`<Route>`/`<A>`/`<Navigate>`/`<HashRouter>`/`<MemoryRouter>`, dynamic params, `matchFilters`, optional/wildcard, layouts, nested routes, `useParams`/`useLocation`/`useNavigate`/`useSearchParams`/`useBeforeLeave`/`useIsRouting`/`useResolvedPath`/`usePreloadRoute`, `query`, `createAsync`, `createAsyncStore`, `action`, `useAction`, `useSubmission`(`s`), response helpers (`redirect`, `reload`, `json`), revalidation, lazy routes, preloading, SPA vs SSR. |

### Meta-framework

| Skill | Load when... |
|---|---|
| [solid-start](../solid-start/SKILL.md) | SolidStart: `app.config.ts`, file-based routing under `src/routes`, `<FileRoutes>`, layouts, server functions (`"use server"`), `createMiddleware`, `useSession`, request/response helpers, websockets, API routes, prerendering, head & metadata, CSS/styling, static assets, single-flight mutations, deployment presets, migrating from v1. |
| [solid-meta](../solid-meta/SKILL.md) | `@solidjs/meta`: `<MetaProvider>`, `<Title>`, `<Meta>`, `<Link>`, `<Style>`, `<Base>`, `useHead`, server vs client setup. |

### Tooling & types

| Skill | Load when... |
|---|---|
| [solid-typescript](../solid-typescript/SKILL.md) | TS in Solid: `tsconfig` (`jsx: "preserve"`, `jsxImportSource: "solid-js"`), `Component`/`ParentComponent`/`VoidComponent`/`FlowComponent`, generic components, `JSX.Element`, `JSX.EventHandler<T,E>`, `currentTarget` typing, ref definitive assignment, narrowing with `<Show>`/optional chaining, `Directives`/`DirectiveFunctions`, `CustomEvents`, `ExplicitProperties`/`Attributes`/`BoolAttributes`. |
| [solid-configuration](../solid-configuration/SKILL.md) | Project setup: env vars (`VITE_*`/`PUBLIC_*`), `.env` files, `vite-plugin-solid` options, build configuration, `app.config` in SolidStart. |
| [solid-testing](../solid-testing/SKILL.md) | Testing Solid: `vitest` + `@solidjs/testing-library` setup, `render`, `screen` queries, `fireEvent`, jsdom config, testing reactive logic and routes. |
| [solid-migration](../solid-migration/SKILL.md) | Upgrades: Solid major versions, `@solidjs/router` migration (renamed APIs), SolidStart v1 migration, deprecated `className` → `class`, etc. |

## Cross-cutting principles (read these once, internalize them)

These principles apply everywhere; the sub-skills assume them.

1. **Components run once.** A Solid component function is invoked exactly once per mount. Re-renders never happen at the component level — only at the JSX expression level.
2. **Reactivity is fine-grained.** When a signal changes, only the JSX expressions and effects that read it re-execute, not the surrounding component.
3. **`props` is a reactive proxy.** Reading `props.foo` inside JSX or a function is reactive; reading it once at the top of the component captures a stale value. **Never destructure `props`** at the top of a component.
4. **Signals are functions.** `count` is the signal; `count()` is the read. Forgetting the parentheses gives you the function reference, not the value, and breaks reactivity.
5. **Reactivity dies outside a tracking scope.** Reading a signal in `console.log` at the top of a component logs the initial value once and never updates. Wrap in `createEffect` or use it inside JSX.
6. **Mutations don't trigger updates — replacements do.** `setStore` and signal setters trigger updates; mutating an unwrapped object does not. (`createMutable` and `produce` work because they wrap mutations in setter calls.)
7. **`<For>` keys by reference, `<Index>` keys by position.** Choose deliberately — see `solid-control-flow`.
8. **Server vs client code.** `isServer` is a compile-time constant; tree-shaken. `onMount` and `createEffect` only run on the client. SSR uses `renderToString*`. Server-only logic in SolidStart goes inside `"use server"` functions.

## When in doubt

1. Check the closest existing exemplar in the codebase you're working in.
2. Re-read this router and `solid-mental-model` first.
3. Then load the targeted sub-skill.
4. If the API isn't covered (rare — file an issue), fall back to `https://docs.solidjs.com/`.
