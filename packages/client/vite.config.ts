// mvtt, an RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of mvtt.
//
// mvtt is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// mvtt is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with mvtt.  If not, see <https://www.gnu.org/licenses/>.

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
      // pdfjs-dist support files (CMaps, standard fonts, WASM, ICC).
      // Mounted by the server via @vtt/pdf-book/server's
      // pdfBookAssetRoots(); proxied here so the same URLs resolve in
      // dev mode at 5173.
      "/pdfjs": {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
      },
      // dice-box mesh + texture assets vendored under @vtt/dice-tray
      // and mounted by the server via diceTrayAssetRoots(). Without
      // this proxy entry Vite's SPA fallback returns index.html for
      // /dice-tray-assets/default.json and Babylon's loader fails
      // with "importMesh has failed JSON parse".
      "/dice-tray-assets": {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
