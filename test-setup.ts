// Adds jest-dom matchers (toBeInTheDocument, toHaveTextContent, etc.) for
// kit/component integration tests. Loaded by every test, but only the
// jsdom-env tests actually use the matchers.
import "@testing-library/jest-dom/vitest";

/**
 * jsdom's fetch implementation throws `ERR_INVALID_URL` on relative
 * paths because the document's base URL is `about:blank`. Component
 * tests don't usually care about API roundtrips — they're testing
 * click→dispatch flows — so install a permissive shim that:
 *
 *   - returns sensible-shaped 200s for the few endpoints view code
 *     unconditionally calls on mount (memberships, worlds, etc.) so
 *     `createResource` doesn't throw on a real 404
 *   - returns 404 for everything else
 *
 * Tests that DO want to assert specific responses can override
 * `globalThis.fetch` with `vi.spyOn` inside the test itself.
 */
declare const window: unknown;
if (typeof window !== "undefined") {
  // jsdom doesn't ship ResizeObserver. The workbench's Pane uses one
  // to track the tab strip's width for overflow partitioning. Stub it
  // so component mounts don't crash; tests can override the .observe
  // callback via vi.spyOn if they want to drive specific widths.
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver =
      ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  // jsdom doesn't implement scrollIntoView. The SheetShell's sticky
  // tab bar (kit.Tabs `select`) calls it after a tab switch so the new
  // tab is read from the top instead of mid-scroll. In real browsers
  // it's a function; in jsdom we just need a no-op so the click
  // handler doesn't throw. Tests that want to assert it was called can
  // still vi.spyOn / replace it on a specific element.
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = function (): void {};
  }
  globalThis.fetch = async (
    input: RequestInfo | URL,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();

    // /api/worlds/:id/memberships → empty owner + members
    if (/\/api\/worlds\/[^/]+\/memberships$/.test(url)) {
      return new Response(
        JSON.stringify({
          owner: { userId: "test-me", name: "Me", email: "me@test.dev" },
          members: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // /api/worlds → empty list
    if (url.endsWith("/api/worlds")) {
      return new Response(JSON.stringify({ worlds: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // /api/game-systems → empty list
    if (url.endsWith("/api/game-systems")) {
      return new Response(JSON.stringify({ gameSystems: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // Anything else: stub 404 instead of throwing.
    return new Response("not found", { status: 404 });
  };
}
