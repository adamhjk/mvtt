---
name: solid-meta
description: "Use this skill when setting `<head>` tags reactively in Solid (SolidJS) — page title, meta description, canonical link, OpenGraph/Twitter cards, theme color, RSS feed link, inline `<style>`/`<script>`, etc. Covers `@solidjs/meta`: wrap your app in `<MetaProvider>` (root-level once), then anywhere in the tree use `<Title>`, `<Meta>`, `<Link>`, `<Style>`, `<Base>` for declarative head tags that update reactively, or `useHead` for low-level imperative access. Server-side setup uses a tags array; client-side mounts under `<MetaProvider>` directly. The deepest rendered tag wins for `<Title>` (so a route's title overrides an app-default). Triggers on: solid-meta, @solidjs/meta, MetaProvider, Title, Meta, Link, Style, Base, useHead, head tags, document title, SEO, OpenGraph, og:, twitter:card, canonical, theme-color, favicon."
license: MIT
---

`@solidjs/meta` lets you declaratively set head tags from anywhere in the component tree. The tags update reactively and (with `<MetaProvider>` and the right server setup) work correctly under SSR.

## Install

```sh
npm i @solidjs/meta
```

## Setup

### Client

```tsx
import { MetaProvider } from "@solidjs/meta";

render(
  () => (
    <MetaProvider>
      <Router>...</Router>
    </MetaProvider>
  ),
  document.getElementById("app")!,
);
```

`<MetaProvider>` wraps the whole app once. Without it, the meta components don't know where to write tags.

### Server

```tsx
import { renderToStringAsync } from "solid-js/web";
import { MetaProvider } from "@solidjs/meta";

const tags: any[] = [];
const html = await renderToStringAsync(() => (
  <MetaProvider tags={tags}>
    <App />
  </MetaProvider>
));

// `tags` now contains the head tags rendered as part of this request.
// Inject into the response HTML's <head> alongside the body.
```

In SolidStart, this wiring is automatic — just put `<MetaProvider>` at the root.

## The components

```tsx
import { Title, Meta, Link, Style, Base } from "@solidjs/meta";
```

### `<Title>`

```tsx
<Title>My Page</Title>
<Title>{`User: ${user()?.name}`}</Title>
```

The deepest mounted `<Title>` wins. Use this for an app-wide default at the root, then per-route titles deeper in the tree.

### `<Meta>`

```tsx
<Meta charset="utf-8" />
<Meta name="description" content="A great app." />
<Meta name="viewport" content="width=device-width, initial-scale=1" />

<Meta property="og:title" content={`User: ${user()?.name}`} />
<Meta property="og:image" content={user()?.avatar} />
<Meta property="og:url" content={location.pathname} />

<Meta name="twitter:card" content="summary_large_image" />
<Meta name="theme-color" content="#0ea5e9" />
```

### `<Link>`

```tsx
<Link rel="canonical" href={`https://example.com${location.pathname}`} />
<Link rel="icon" href="/favicon.svg" />
<Link rel="alternate" type="application/rss+xml" href="/rss.xml" title="RSS" />
<Link rel="preconnect" href="https://fonts.googleapis.com" />
```

### `<Style>` / `<Base>`

```tsx
<Style>{`body { background: ${themeBg()} }`}</Style>
<Base href="/app/" />
```

Less common, but available.

## `useHead` — low-level imperative

For dynamic tags whose key/value vary at runtime in ways the static components don't capture:

```ts
import { useHead } from "@solidjs/meta";

useHead({
  tag: "meta",
  props: { name: "color-scheme", content: "dark" },
  setting: { close: true },
  id: "color-scheme", // de-dupe key
  name: undefined,
});
```

Most apps don't need this — the components handle 99% of cases.

## Tag merging

Multiple `<Meta>` tags with the same `name` or `property` produce multiple head tags. If you want only one to win (e.g. one `og:title`), give them the same `name` — but Solid Meta currently emits all and lets the browser pick the last. To enforce single-instance semantics, render the tag conditionally so only one is mounted at a time.

`<Title>` is the exception: only the deepest mounted one renders.

## Reactive content

Tags update reactively whenever their inputs change:

```tsx
function ProfilePage() {
  const params = useParams<{ id: string }>();
  const user = createAsync(() => getUser(params.id));

  return (
    <>
      <Title>{user()?.name ?? "Loading..."} | My App</Title>
      <Meta name="description" content={user()?.bio} />
      <Meta property="og:image" content={user()?.avatar} />
      <ProfileBody user={user()} />
    </>
  );
}
```

## Common pitfalls

- **No `<MetaProvider>`.** Tags don't appear (client) or aren't included in SSR output.
- **Multiple `<MetaProvider>`s.** Use one at the root; nested providers create independent contexts.
- **Server tags array not collected.** In SSR, ensure you pass `tags={tagsArray}` and inject `tagsArray` into your response HTML.
- **Forgetting `<Title>` is "deepest wins."** A `<Title>` in your root layout will be overridden by a more specific page title — that's intentional.
- **Tag updates after streaming.** Once headers and the head are flushed, late head writes don't appear. Use `deferStream` on queries that drive head content if you need them in the initial flush (see `solid-resources`).

## Examples

### App-default title with per-route override

```tsx
// Root
<MetaProvider>
  <Title>My App</Title>
  <App />
</MetaProvider>

// /about
<Title>About — My App</Title>
```

### OG card per article

```tsx
<Title>{article()?.title}</Title>
<Meta name="description" content={article()?.summary} />
<Meta property="og:title" content={article()?.title} />
<Meta property="og:description" content={article()?.summary} />
<Meta property="og:image" content={article()?.coverImage} />
<Meta name="twitter:card" content="summary_large_image" />
```

## Related

- `solid-start` — wires `<MetaProvider>` automatically.
- `solid-rendering` — SSR head injection details.
- `solid-router` — pair with `useLocation` for canonical URLs.
