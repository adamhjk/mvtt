import { fileURLToPath } from "node:url";
import { dirname, extname, resolve, basename, sep } from "node:path";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { startServer } from "@vtt/substrate/server";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { comms } from "@vtt/comms";
import { resolution } from "@vtt/resolution";
import { scene } from "@vtt/scene";
import { createAuth } from "@vtt/auth/server";
import { parseAuthSession } from "@vtt/auth";
import { SqlitePersistence } from "@vtt/persistence-sqlite";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const dataDir = resolve(repoRoot, "data");
const dbPath = resolve(dataDir, "mvtt.db");
const secretPath = resolve(dataDir, "auth.secret");
const clientRoot = resolve(here, "../../client/dist");
const iconsRoot = resolve(repoRoot, "assets/icons/ffffff/transparent/1x1");
// Plugin-owned writable storage. Each plugin gets a subdirectory keyed
// by its qualified name (e.g. `data/plugin-data/@vtt/scene/...`).
// Mounted read-only at `/plugin-data/` and written-to via the
// `/api/plugin-data/...` POST handler below (GM-only, no traversal).
const pluginDataDir = resolve(dataDir, "plugin-data");
mkdirSync(pluginDataDir, { recursive: true });

const port = Number(process.env.PORT ?? 3001);
const baseURL = process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`;

mkdirSync(dataDir, { recursive: true });
const secret = process.env.BETTER_AUTH_SECRET ?? loadOrCreateSecret(secretPath);

const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const auth = createAuth({
  databasePath: dbPath,
  baseURL,
  secret,
  trustedOrigins,
});

await auth.migrate();

// Share the SQLite handle the auth package opened — one DB file per
// deployment, world_event/world_snapshot tables alongside the auth tables.
const persistence = new SqlitePersistence({ db: auth.db });
await persistence.migrate();

// One-shot scan of the icon directory at boot. The catalog is fixed at
// deploy time so there's no need to rescan; the picker fetches this
// manifest once per session and caches it client-side. Each entry's
// `slug` is `"<artist>/<name>"` (no extension) — the renderer maps that
// to `/icons/<slug>.svg` against the assetRoots mount below.
type IconEntry = { slug: string; artist: string; name: string };
const iconManifest: IconEntry[] = existsSync(iconsRoot)
  ? buildIconManifest(iconsRoot)
  : [];
const iconManifestBody = JSON.stringify({ icons: iconManifest });

// Image content types we let plugins upload. The substrate's static-file
// MIME map already serves these correctly; this allowlist is the upload
// gate (so a plugin can't write a `.html` or `.js` into the public mount
// and turn the asset folder into a script delivery vector).
const ALLOWED_PLUGIN_DATA_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
]);
// Cap upload size — generous enough for high-res maps, low enough to
// keep an accidental 4K video from filling the disk. Plugins that
// genuinely need bigger payloads should ship their own uploader.
const MAX_PLUGIN_DATA_BYTES = 25 * 1024 * 1024; // 25 MB

// Hand HTTP routes off to better-auth and a small probe endpoint, leaving
// everything else for the substrate (static client + WS upgrade).
const authHandler = toNodeHandler(auth.auth.handler);
const httpHandler = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
  const url = req.url ?? "/";
  if (url.startsWith("/api/auth/")) {
    await authHandler(req, res);
    return true;
  }
  if (url === "/api/has-gm") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ hasGameMaster: auth.hasGameMaster() }));
    return true;
  }
  if (url === "/api/icons/manifest") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "public, max-age=300");
    res.end(iconManifestBody);
    return true;
  }
  // Plugin-data write path: POST /api/plugin-data/<plugin>/<rest>.
  // The body is the raw file. On success we return the public URL where
  // the file is now readable (`/plugin-data/<plugin>/<rest>`). GM-only.
  // Path safety: the resolved absolute path must stay inside
  // pluginDataDir; the extension must be in the allowlist.
  if (url.startsWith("/api/plugin-data/") && req.method === "POST") {
    const rel = decodeURIComponent(url.slice("/api/plugin-data/".length).split("?")[0]!);
    return await handlePluginDataUpload(req, res, rel);
  }
  return false;
};

async function handlePluginDataUpload(
  req: IncomingMessage,
  res: ServerResponse,
  rel: string,
): Promise<boolean> {
  const send = (status: number, body: object) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
    return true;
  };
  // GM gate — uploads can replace what every player sees, so we restrict
  // to the most-trusted role. Future per-plugin permission policies are
  // out of scope.
  const session = parseAuthSession(
    await auth.resolveSession(fromNodeHeaders(req.headers)),
  );
  if (!session) return send(401, { error: "not authenticated" });
  if (session.role !== "gm") return send(403, { error: "GM only" });

  // Path safety. Reject empty, traversal, absolute, or
  // not-an-allowlisted-extension paths up front.
  if (!rel || rel.includes("..") || rel.startsWith("/")) {
    return send(400, { error: "invalid path" });
  }
  const ext = extname(rel).toLowerCase();
  if (!ALLOWED_PLUGIN_DATA_EXTS.has(ext)) {
    return send(400, { error: `extension ${ext || "(none)"} not allowed` });
  }
  const absolute = resolve(pluginDataDir, rel);
  if (absolute !== pluginDataDir && !absolute.startsWith(pluginDataDir + sep)) {
    return send(400, { error: "path escapes plugin-data root" });
  }

  // Read the body with a hard byte cap. If the client lies about
  // Content-Length and streams more, we abort.
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk);
    received += buf.length;
    if (received > MAX_PLUGIN_DATA_BYTES) {
      return send(413, { error: "payload too large" });
    }
    chunks.push(buf);
  }
  const body = Buffer.concat(chunks);

  // Replace any sibling file with the same base name but a different
  // extension. Keeps the on-disk story to one background-per-scene
  // even when the GM uploads PNG, then JPG, etc. The trait points at
  // the new path; the old file would otherwise linger forever.
  try {
    const dir = dirname(absolute);
    mkdirSync(dir, { recursive: true });
    const stem = basename(absolute, ext);
    for (const sibling of readdirSync(dir)) {
      if (sibling === basename(absolute)) continue;
      if (basename(sibling, extname(sibling)) === stem) {
        try {
          unlinkSync(resolve(dir, sibling));
        } catch {
          /* best-effort cleanup */
        }
      }
    }
    await writeFile(absolute, body);
  } catch (err) {
    return send(500, { error: `write failed: ${(err as Error).message}` });
  }

  // Cache-bust on overwrite by stamping the URL with the byte length —
  // crude but enough to make the browser re-fetch even when the path
  // didn't change (e.g. same name + ext, different bytes).
  const publicPath = `/plugin-data/${rel}?v=${received}`;
  return send(200, { path: publicPath, size: received });
}

// Dev convenience: when DEV_PROXY_URL is set (typical: http://localhost:5173),
// the substrate's port serves Vite's compiled output with HMR. That way both
// `:5173` and `:3001` give the same live experience and no one has to remember
// which port to load. Production deployments leave it unset and serve dist.
const devProxy = process.env.DEV_PROXY_URL;

const handle = await startServer({
  port,
  plugins: [shellWorkbench, identity, permissions, comms, resolution, scene],
  clientRoot: existsSync(clientRoot) ? clientRoot : undefined,
  httpHandler,
  authenticateUpgrade: async (req) => {
    const headers = fromNodeHeaders(req.headers);
    return await auth.resolveSession(headers);
  },
  // Tell the substrate how to derive a {userId, role} Recipient from our
  // opaque session — that's what the per-event visibility filter uses.
  extractRecipient: (session) => {
    const s = parseAuthSession(session);
    return s ? { userId: s.userId, role: s.role } : null;
  },
  persistence,
  devProxy,
  assetRoots: {
    ...(existsSync(iconsRoot) ? { "/icons/": iconsRoot } : {}),
    "/plugin-data/": pluginDataDir,
  },
});

const plugins = handle.registry.plugins.map((p) => `${p.name}@${p.version}`).join(", ");
console.log(`mvtt server listening on ${baseURL}`);
console.log(`plugins: ${plugins}`);
console.log(`auth db: ${dbPath}`);
console.log(`game master ${auth.hasGameMaster() ? "exists" : "not yet — first signup will become GM"}`);
if (devProxy) {
  console.log(`dev proxy: forwarding non-API HTTP and HMR to ${devProxy}`);
} else if (existsSync(clientRoot)) {
  console.log(`client served from ${clientRoot}`);
} else {
  console.log(`client bundle not built — run \`pnpm --filter @vtt/client build\` to enable serving at /`);
}
if (existsSync(iconsRoot)) {
  console.log(`icons: ${iconManifest.length} mounted at /icons/ (${iconsRoot})`);
} else {
  console.log(`icons: ${iconsRoot} not found — token picker will be empty`);
}

const shutdown = async () => {
  await handle.close();
  auth.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function buildIconManifest(root: string): IconEntry[] {
  const out: IconEntry[] = [];
  for (const artistEnt of readdirSync(root, { withFileTypes: true })) {
    if (!artistEnt.isDirectory()) continue;
    const artist = artistEnt.name;
    const dir = resolve(root, artist);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".svg")) continue;
      const name = basename(file, ".svg");
      out.push({ slug: `${artist}/${name}`, artist, name });
    }
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

function loadOrCreateSecret(path: string): string {
  if (existsSync(path)) {
    return readFileSync(path, "utf-8").trim();
  }
  const secret = randomBytes(32).toString("base64");
  writeFileSync(path, secret + "\n", { mode: 0o600 });
  console.log(`generated new auth secret at ${path}`);
  return secret;
}
