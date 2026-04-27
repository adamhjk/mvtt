import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwind from "@tailwindcss/vite";

const SERVER_PORT = process.env.SERVER_PORT ?? "3001";

export default defineConfig({
  plugins: [tailwind(), solid()],
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: `ws://localhost:${SERVER_PORT}`,
        ws: true,
        changeOrigin: true,
      },
      "/api": {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
      },
      "/icons": {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
      },
      // Plugin-owned uploaded assets (e.g. scene background images
      // written via /api/plugin-data/...). The substrate mounts these
      // at /plugin-data/ on its own port; the dev proxy makes the same
      // path resolvable when the client is loaded via Vite at 5173.
      "/plugin-data": {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
