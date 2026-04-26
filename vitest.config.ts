import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  test: {
    include: ["packages/**/*.test.ts"],
    environment: "node",
    server: {
      deps: {
        external: ["ws"],
      },
    },
  },
  resolve: {
    conditions: ["node", "import"],
  },
});
