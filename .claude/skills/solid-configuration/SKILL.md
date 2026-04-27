---
name: solid-configuration
description: "Use this skill when configuring a Solid (SolidJS) project: `tsconfig.json` for JSX, `vite.config.ts` (or `vitest.config.ts` for tests) with `vite-plugin-solid`, environment variables (Vite's `VITE_*` for client-exposed, server-only otherwise), `.env` files and modes, `app.config.ts` in SolidStart (Vinxi), and bundler integration with other tools. Covers required tsconfig keys (`jsx: \"preserve\"`, `jsxImportSource: \"solid-js\"`), vite-plugin-solid options (`hot`, `ssr`, `solid`, `babel`, `typescript`, `extensions`), the env-var rule (Vite exposes only `VITE_*` to the client; everything else is server-only and tree-shaken), how `import.meta.env` works, and SolidStart-specific config in `app.config.ts` (presets, ssr toggle, middleware path, vite plugin pass-through). Triggers on: vite-plugin-solid, vite.config, tsconfig, jsx preserve, jsxImportSource, env vars, VITE_, .env, .env.production, app.config, app.config.ts, vinxi, build configuration, deployment preset, NODE_ENV, mode, importmeta env."
license: MIT
---

Solid runs on Vite. Configuration lives in `tsconfig.json`, `vite.config.ts` (or `app.config.ts` for SolidStart), and `.env` files. Get these right once and the rest of the toolchain Just Works.

## `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "strict": true,
    "moduleResolution": "bundler",
    "target": "ESNext",
    "module": "ESNext",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vite/client"]                    // adds import.meta.env types
  }
}
```

Critical bits:
- `"jsx": "preserve"` — TS leaves JSX untouched; Solid's compiler handles it.
- `"jsxImportSource": "solid-js"` — uses Solid's JSX type defs.
- `"types": ["vite/client"]` — types `import.meta.env`. Add `"@testing-library/jest-dom"` if you're using it.
- `"moduleResolution": "bundler"` — modern, recommended for Vite-based projects.

For mixed Solid+React projects, set `jsxImportSource` per-file:

```ts
/** @jsxImportSource solid-js */
```

## `vite.config.ts`

```ts
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  server: { port: 5173 },
});
```

### `vite-plugin-solid` options

```ts
solid({
  hot: true,                           // enable HMR (default true in dev)
  ssr: false,                          // emit SSR-friendly code (default false; SolidStart sets this true)
  dev: true,                           // dev-mode helpers (default: development)
  solid: { /* solid compiler opts */ }, // passed to babel-preset-solid
  babel: { /* extra babel opts */ },   // additional babel config
  typescript: { onlyRemoveTypeImports: true },  // useful when using directives
  extensions: [".tsx", ".jsx", ".mdx"], // file extensions to transform
})
```

### Common: `onlyRemoveTypeImports`

If you import a `use:*` directive from another file but only reference it via JSX, the bundler may strip the import as type-only. Set:

```ts
solid({ typescript: { onlyRemoveTypeImports: true } })
```

(Or in babel config, `babel-preset-typescript` with the same option.)

### CSS, paths, aliases

Standard Vite config:

```ts
export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: { "~": "/src" },            // ~/components/Foo → /src/components/Foo
  },
  css: {
    modules: { localsConvention: "camelCase" },
  },
});
```

## `vitest.config.ts`

For tests, mirror `vite.config.ts` and add `test`:

```ts
import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test-setup.ts"],
  },
  resolve: {
    conditions: ["development", "browser"],
  },
});
```

The `conditions: ["development", "browser"]` is essential — it tells Vite to load Solid's browser bundle (which exports `render`).

See `solid-testing`.

## Environment variables

### Vite's rule

Vite exposes **only** environment variables prefixed with `VITE_` to the client bundle. Everything else is server-only.

```sh
# .env
VITE_API_BASE=https://api.example.com    # exposed to client
DATABASE_URL=postgres://...              # server-only (NOT in client bundle)
```

Read in code:

```ts
const api = import.meta.env.VITE_API_BASE;     // string, available everywhere
const dbUrl = process.env.DATABASE_URL;        // server-only context (e.g. "use server" function, vite.config)
```

`import.meta.env` is a compile-time constant — Vite inlines the values during build, so unused branches are dead code.

### `.env` file lookup order

```
.env                # always loaded
.env.local          # always loaded; gitignored
.env.[mode]         # loaded for `vite --mode <mode>` (e.g. .env.production)
.env.[mode].local   # gitignored mode-specific
```

### Built-in vars

```ts
import.meta.env.MODE          // "development" | "production" | custom
import.meta.env.DEV           // boolean
import.meta.env.PROD          // boolean
import.meta.env.SSR           // boolean (true in SSR builds)
import.meta.env.BASE_URL      // base URL of the deployment
```

### Typing custom env vars

```ts
// src/env.d.ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
  readonly VITE_FEATURE_X: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

## SolidStart — `app.config.ts`

SolidStart uses Vinxi (Vite + Nitro) and configures both via a single file:

```ts
import { defineConfig } from "@solidjs/start/config";

export default defineConfig({
  ssr: true,                              // false for SPA-only build
  server: {
    preset: "node-server",                // deployment target
    prerender: {
      routes: ["/", "/about"],
      crawlLinks: true,
    },
  },
  middleware: "src/middleware.ts",
  vite: {
    plugins: [/* extra Vite plugins */],
    resolve: { alias: { "~": "/src" } },
  },
});
```

### Available presets

Common presets: `node-server`, `node`, `vercel`, `vercel-edge`, `netlify`, `netlify-edge`, `cloudflare-pages`, `cloudflare-module`, `aws-lambda`, `deno`, `bun`, `static` (SSG). Full list and semantics in Nitro's docs.

### Env vars in SolidStart

Same Vite rules + Nitro's runtime env. `process.env.X` available in server code; `import.meta.env.VITE_X` available everywhere.

For private secrets at runtime (not build-time), set them as deployment env vars; the preset will route them to the runtime appropriately.

## Mixing with other tools

### Tailwind / UnoCSS / PostCSS

Standard Vite/Vinxi PostCSS config — `postcss.config.cjs` or `vite.css.postcss` option. Solid does not interfere.

### MDX

`@mdx-js/rollup` works as a Vite plugin alongside `vite-plugin-solid`:

```ts
import mdx from "@mdx-js/rollup";

export default defineConfig({
  plugins: [
    { enforce: "pre", ...mdx({ jsxImportSource: "solid-js" }) },
    solid({ extensions: [".tsx", ".jsx", ".mdx"] }),
  ],
});
```

### Custom Babel plugins

Pass through `solid({ babel: { plugins: [...] } })`.

## Build commands

| Command | Purpose |
|---|---|
| `vite` / `npm run dev` | Dev server with HMR |
| `vite build` | Production client build |
| `vite preview` | Serve the built output for verification |

For SolidStart:

| Command | Purpose |
|---|---|
| `vinxi dev` | Dev server (SSR + client) |
| `vinxi build` | Build for the configured preset |
| `vinxi start` | Start production server |

## Common pitfalls

- **Wrong `jsx`/`jsxImportSource`.** Solid's compiler can't process JSX TypeScript transformed; or the JSX namespace doesn't match.
- **Server-only secrets in client.** Don't prefix secrets with `VITE_`. They'll end up in the client bundle.
- **Missing `vite/client` in `types`.** `import.meta.env` shows as `any`.
- **Tree-shaken directives.** Set `onlyRemoveTypeImports: true` or reference the directive as a value before the JSX.
- **Wrong test conditions.** Without `conditions: ["development", "browser"]`, vitest loads Solid's SSR build and `render` is undefined.
- **`process.env` in client code.** Use `import.meta.env`. `process.env` works in build/server contexts but is empty in client code.

## Examples

### Minimal SPA `vite.config.ts`

```ts
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
});
```

### SolidStart with Tailwind v4

```ts
// app.config.ts
import { defineConfig } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  vite: { plugins: [tailwindcss()] },
});
```

### SolidStart deploying to Vercel

```ts
import { defineConfig } from "@solidjs/start/config";

export default defineConfig({
  server: {
    preset: "vercel",
  },
});
```

Build: `vinxi build`. Output goes to `.vercel/output/`.

### Per-environment config

```ts
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  return {
    plugins: [solid()],
    define: { __APP_VERSION__: JSON.stringify(env.VITE_APP_VERSION) },
  };
});
```

## Related

- `solid-typescript` — JSX-related tsconfig keys.
- `solid-rendering` — `isServer`/`isDev`/`DEV` are also build-time constants.
- `solid-start` — `app.config.ts` deep dive.
- `solid-testing` — vitest config alignment.
