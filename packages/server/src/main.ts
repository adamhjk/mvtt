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
import { rename } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { startServer } from "@vtt/substrate/server";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { comms } from "@vtt/comms";
import { resolution } from "@vtt/resolution";
import { scene } from "@vtt/scene";
import { books } from "@vtt/books";
import { pdfBook } from "@vtt/pdf-book";
import { pdfBookAssetRoots } from "@vtt/pdf-book/server";
import { characters } from "@vtt/characters";
import { diceTray } from "@vtt/dice-tray";
import { diceTrayAssetRoots } from "@vtt/dice-tray/server";
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
  ".pdf",
]);
// Cap upload size — books (PDFs) are routinely 100+ MB so 25 MB
// would have rejected most rulebooks; 250 MB covers a typical
// hardcover scan with headroom for high-res maps too. Plugins that
// genuinely need bigger payloads should ship their own uploader.
const MAX_PLUGIN_DATA_BYTES = 250 * 1024 * 1024; // 250 MB

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
  // Drain-and-reject helper: when the validator rejects before we've
  // read the body, the upstream proxy (Vite in dev) can still be
  // pumping bytes. Closing the response immediately makes those
  // writes hit a closed socket — `EPIPE` on the proxy side. Consume
  // and discard the rest of `req` first, then send. The drain is
  // bounded by MAX_PLUGIN_DATA_BYTES so a misbehaving client can't
  // make us read forever.
  const sendAfterDrain = async (status: number, body: object) => {
    if (req.readable) {
      let drained = 0;
      try {
        for await (const chunk of req) {
          drained += (chunk as Buffer).length;
          if (drained > MAX_PLUGIN_DATA_BYTES) {
            req.destroy();
            break;
          }
        }
      } catch {
        /* socket already broken — fine, we're rejecting anyway */
      }
    }
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
    return true;
  };

  // GM gate — uploads can replace what every player sees, so we
  // restrict to the most-trusted role. Future per-plugin permission
  // policies are out of scope.
  const session = parseAuthSession(
    await auth.resolveSession(fromNodeHeaders(req.headers)),
  );
  if (!session) return sendAfterDrain(401, { error: "not authenticated" });
  if (session.role !== "gm") return sendAfterDrain(403, { error: "GM only" });

  // Path safety. Reject empty, traversal, absolute, or
  // not-an-allowlisted-extension paths up front.
  if (!rel || rel.includes("..") || rel.startsWith("/")) {
    return sendAfterDrain(400, { error: "invalid path" });
  }
  const ext = extname(rel).toLowerCase();
  if (!ALLOWED_PLUGIN_DATA_EXTS.has(ext)) {
    return sendAfterDrain(400, {
      error: `extension ${ext || "(none)"} not allowed`,
    });
  }
  const absolute = resolve(pluginDataDir, rel);
  if (absolute !== pluginDataDir && !absolute.startsWith(pluginDataDir + sep)) {
    return sendAfterDrain(400, { error: "path escapes plugin-data root" });
  }

  // Cheap upfront reject when the client volunteered a Content-Length
  // header that already exceeds the cap — saves a multi-hundred-MB
  // write+drain when we're going to reject anyway.
  const declaredLen = Number(req.headers["content-length"] ?? "");
  if (Number.isFinite(declaredLen) && declaredLen > MAX_PLUGIN_DATA_BYTES) {
    return sendAfterDrain(413, { error: "payload too large" });
  }

  // Stream the body to a sibling temp file, then atomic-rename into
  // place on success. v0 buffered everything in RAM (twice — chunks
  // + concat); a 250 MB upload was 500 MB resident before write,
  // which made the dev server stall and eventually killed the
  // proxied request mid-flight. Streaming keeps memory bounded and
  // also cleans up the partial file on size-cap or write errors.
  const dir = dirname(absolute);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    return sendAfterDrain(500, {
      error: `mkdir failed: ${(err as Error).message}`,
    });
  }
  const tmpPath = resolve(
    dir,
    `.${basename(absolute)}.${randomBytes(6).toString("hex")}.partial`,
  );

  let received = 0;
  let oversized = false;
  // Tap each chunk to enforce the byte cap before it lands on disk —
  // a `Transform` would also work but a passthrough counter on the
  // request is enough.
  req.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > MAX_PLUGIN_DATA_BYTES) {
      oversized = true;
      req.destroy();
    }
  });

  const writeStream = createWriteStream(tmpPath);
  try {
    await pipeline(req, writeStream);
  } catch (err) {
    // Best-effort cleanup — rename never happened, so the .partial
    // file is the only artefact.
    try {
      unlinkSync(tmpPath);
    } catch {
      /* already gone */
    }
    if (oversized) {
      return sendAfterDrain(413, { error: "payload too large" });
    }
    return sendAfterDrain(500, {
      error: `write failed: ${(err as Error).message}`,
    });
  }

  // Replace any sibling file with the same base name but a different
  // extension. Keeps the on-disk story to one file-per-slot even when
  // the GM uploads PNG, then JPG, etc. The trait points at the new
  // path; the old file would otherwise linger forever.
  try {
    const stem = basename(absolute, ext);
    for (const sibling of readdirSync(dir)) {
      if (sibling === basename(absolute)) continue;
      // Skip our own .partial files and any other plugin's siblings.
      if (sibling.startsWith(".")) continue;
      if (basename(sibling, extname(sibling)) === stem) {
        try {
          unlinkSync(resolve(dir, sibling));
        } catch {
          /* best-effort cleanup */
        }
      }
    }
    await rename(tmpPath, absolute);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* already gone */
    }
    return sendAfterDrain(500, {
      error: `rename failed: ${(err as Error).message}`,
    });
  }

  // Cache-bust on overwrite by stamping the URL with the byte length —
  // crude but enough to make the browser re-fetch even when the path
  // didn't change (e.g. same name + ext, different bytes).
  const publicPath = `/plugin-data/${rel}?v=${received}`;
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ path: publicPath, size: received }));
  return true;
}

// Dev convenience: when DEV_PROXY_URL is set (typical: http://localhost:5173),
// the substrate's port serves Vite's compiled output with HMR. That way both
// `:5173` and `:3001` give the same live experience and no one has to remember
// which port to load. Production deployments leave it unset and serve dist.
const devProxy = process.env.DEV_PROXY_URL;

const handle = await startServer({
  port,
  plugins: [shellWorkbench, identity, permissions, comms, resolution, scene, books, pdfBook, characters, diceTray],
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
    // Static support files pdfjs-dist needs for accurate rendering
    // (CMaps, standard fonts, WASM image decoders, ICC profiles).
    // See @vtt/pdf-book/server/asset-roots.ts for the rationale.
    ...pdfBookAssetRoots(),
    // dice-box mesh/texture assets vendored under @vtt/dice-tray;
    // the client's Babylon SceneLoader fetches default.json from
    // /dice-tray-assets/ at scene startup.
    ...diceTrayAssetRoots(),
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
