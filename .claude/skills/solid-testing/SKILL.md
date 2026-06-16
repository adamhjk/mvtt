---
name: solid-testing
description: 'Use this skill when writing tests for Solid (SolidJS) code: components, reactive logic, custom hooks/factories, routes, stores. Covers the recommended stack — `vitest` + `@solidjs/testing-library` + `@testing-library/jest-dom` + `jsdom` (or `happy-dom`) — vite-plugin-solid in test mode (`solid({ ssr: false })` + `test: { environment: ''jsdom'' }`), the `render(() => <Comp />)` API (returns `{ container, unmount, ...queries }`), event simulation via `fireEvent` / `userEvent`, screen queries (`getByRole`, `getByText`, `findByText` for async, `queryByText` for assertions of absence), testing reactive logic without mounting (`createRoot(dispose => { ...; dispose() })`), testing components that use the router (`<MemoryRouter url="/foo"><Comp /></MemoryRouter>`), waiting for resources/Suspense (`findBy*`), and the rule that effects don''t fire outside an owner so tests must use `render` or `createRoot`. Triggers on: testing, vitest, jest, @solidjs/testing-library, render in tests, fireEvent, userEvent, screen, jsdom, happy-dom, MemoryRouter, test reactive logic, test custom hook, test signal.'
license: MIT
---

The Solid team's recommended test stack is `vitest` + `@solidjs/testing-library`. Both are well-supported, fast, and integrate cleanly with Vite.

## Install

```sh
npm i -D vitest @solidjs/testing-library @testing-library/jest-dom jsdom
```

`@solidjs/testing-library` is a thin wrapper around `@testing-library/dom` that knows how to mount Solid components and clean up after each test.

## `vite.config.ts` / `vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "jsdom",
    globals: true, // optional — exposes `expect`, `it`, `describe`
    setupFiles: ["./test-setup.ts"],
    deps: {
      optimizer: {
        web: { include: ["solid-js"] },
      },
    },
  },
  resolve: {
    conditions: ["development", "browser"],
  },
});
```

The `conditions: ["development", "browser"]` is important — it tells Vite to load Solid's browser-flavored bundles (with HMR/dev-mode niceties) rather than the SSR ones.

`vite-plugin-solid` may need the test option:

```ts
solid({ ssr: false });
```

if you hit "render is undefined" issues at test time.

## `test-setup.ts`

```ts
import "@testing-library/jest-dom/vitest";
```

This adds matchers like `.toBeInTheDocument()`.

## Rendering a component

```tsx
import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect } from "vitest";
import { Counter } from "./Counter";

describe("Counter", () => {
  it("increments on click", async () => {
    render(() => <Counter />);
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("0");
    fireEvent.click(button);
    expect(button).toHaveTextContent("1");
  });
});
```

`render` accepts a function (just like `solid-js/web`'s `render`). Returns a result with the same query helpers as `screen`, plus `container` and `unmount`.

`@solidjs/testing-library` automatically calls `cleanup()` between tests so DOM doesn't leak.

## Queries

| Query                                      | Use                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `getByRole(role)`                          | Preferred — accessibility-aligned.                                          |
| `getByLabelText(text)`                     | Form fields paired with `<label>`.                                          |
| `getByText(text)`                          | Visible text.                                                               |
| `getByTestId(id)`                          | Last resort for elements without semantic markup.                           |
| `queryBy*`                                 | Returns null if not found (use for "should not exist" assertions).          |
| `findBy*`                                  | Returns a promise; waits for the element to appear. Use for async/Suspense. |
| `getAllBy*` / `queryAllBy*` / `findAllBy*` | Multiple matches.                                                           |

Always prefer `getByRole`/`getByLabelText` over `getByTestId` — they nudge you toward accessible markup.

## Events

```tsx
import { fireEvent } from "@solidjs/testing-library";

fireEvent.click(button);
fireEvent.input(input, { target: { value: "hello" } });
fireEvent.submit(form);
fireEvent.keyDown(el, { key: "Enter" });
```

Or use `@testing-library/user-event` for higher-fidelity simulation:

```sh
npm i -D @testing-library/user-event
```

```ts
import userEvent from "@testing-library/user-event";

const user = userEvent.setup();
await user.click(button);
await user.type(input, "hello");
```

## Async / Suspense / resources

```tsx
it("loads user data", async () => {
  vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ name: "Ada" })));
  render(() => <UserCard id="1" />);
  expect(await screen.findByText("Ada")).toBeInTheDocument();
});
```

`findByText` waits up to a default timeout (1s). Pair with `vi.fn`/`vi.spyOn` to mock fetch.

For component trees with `<Suspense>` / `<ErrorBoundary>`, simply mount and use `findBy*` to wait for the resolved state.

## Testing reactive logic without mounting

For testing signals, memos, stores, custom hooks/factories — anything that doesn't render — use `createRoot`:

```ts
import { createRoot } from "solid-js";
import { makeCounter } from "./counter";
import { describe, it, expect } from "vitest";

describe("makeCounter", () => {
  it("increments", () => {
    createRoot((dispose) => {
      const counter = makeCounter(0);
      expect(counter.count()).toBe(0);
      counter.increment();
      expect(counter.count()).toBe(1);
      dispose();
    });
  });
});
```

Without `createRoot`, signals created at module top will warn about "computations created without a root". `createRoot(dispose => { ...; dispose() })` is the standard pattern.

## Testing routes

`@solidjs/router` ships `<MemoryRouter>` for in-memory navigation:

```tsx
import { MemoryRouter, Route } from "@solidjs/router";
import { render, screen } from "@solidjs/testing-library";

it("navigates to user page", () => {
  render(() => (
    <MemoryRouter url="/users/123">
      <Route path="/users/:id" component={User} />
    </MemoryRouter>
  ));
  expect(screen.getByText("User 123")).toBeInTheDocument();
});
```

For testing actions / queries, mock the underlying server function or fetch.

## Testing context

Wrap the component under test in the same Provider hierarchy as production:

```tsx
render(() => (
  <ThemeProvider>
    <Header />
  </ThemeProvider>
));
```

For tests of the consumer logic only (no UI), put `useContext` calls inside a `createRoot` after rendering a small Provider stub.

## Testing custom directives

Apply the directive to a real element via `render` and assert the resulting DOM/state:

```tsx
import "./directives"; // ensures use:autofocus is registered for tree-shaking

render(() => <input use:autofocus />);
expect(document.activeElement).toBe(screen.getByRole("textbox"));
```

## Common pitfalls

- **Forgot `vite-plugin-solid` in vitest config.** JSX won't compile; tests fail with parse errors.
- **Wrong `conditions`.** Without `["development", "browser"]`, you may import Solid's SSR build, which lacks `render`.
- **Render not called with a function.** `render(<Foo />, ...)` won't work; must be `render(() => <Foo />)`.
- **Testing reactive code without `createRoot`.** Effects don't run outside an owner; signals warn.
- **Mocking `solid-js`.** Don't — it's small and instances should be real.
- **Asserting before async work.** Use `findBy*` (returns a promise), not `getBy*`, for resource/Suspense outputs.
- **Stale DOM between tests.** `@solidjs/testing-library` auto-cleans, but if you render outside it (e.g. raw `solid-js/web` `render`), call `dispose()` manually.

## Examples

### Component with form

```tsx
import { render, screen, fireEvent } from "@solidjs/testing-library";

it("submits the form", async () => {
  const onSubmit = vi.fn();
  render(() => <ContactForm onSubmit={onSubmit} />);

  await fireEvent.input(screen.getByLabelText(/email/i), {
    target: { value: "ada@example.com" },
  });
  await fireEvent.click(screen.getByRole("button", { name: /send/i }));

  expect(onSubmit).toHaveBeenCalledWith({ email: "ada@example.com" });
});
```

### Async data

```tsx
it("renders user", async () => {
  global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: "Ada" })));
  render(() => <UserPage id="1" />);
  expect(await screen.findByText("Ada")).toBeInTheDocument();
});
```

### Custom hook

```ts
it("toggles", () => {
  createRoot((dispose) => {
    const t = useToggle(false);
    expect(t.on()).toBe(false);
    t.toggle();
    expect(t.on()).toBe(true);
    dispose();
  });
});
```

## Related

- `solid-mental-model` — components run once; understand owners.
- `solid-router` — `<MemoryRouter>` for tests.
- `solid-resources` — async patterns to mock and wait for.
- `solid-configuration` — vitest config alignment with vite-plugin-solid.
