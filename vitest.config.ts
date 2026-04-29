import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

/**
 * Two projects so unit/smoke tests get the node-flavored module
 * resolution (so `ws` resolves to its real WebSocketServer instead of
 * the browser stub) while component tests get the browser/development
 * conditions Solid needs to load `render` from its DOM bundle.
 *
 *   node:      *.test.ts       node env       node, import conditions
 *   jsdom:     *.test.tsx      jsdom env      browser, development conditions
 *
 * Smoke files use the `*.smoke.test.ts` naming so they're picked up by
 * the node project alongside the substrate unit tests — same vitest
 * pass, parallel scheduling, no separate `pnpm smoke`.
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [solid({ ssr: true })],
        test: {
          name: "node",
          include: ["packages/**/*.test.ts"],
          environment: "node",
          setupFiles: ["./test-setup.ts"],
          server: {
            deps: {
              external: ["ws"],
            },
          },
        },
        resolve: {
          conditions: ["node", "import"],
        },
      },
      {
        plugins: [solid({ ssr: false })],
        test: {
          name: "jsdom",
          include: ["packages/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./test-setup.ts"],
        },
        resolve: {
          conditions: ["development", "browser"],
        },
      },
    ],
  },
});
