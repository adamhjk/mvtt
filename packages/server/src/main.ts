import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { startServer } from "@vtt/substrate/server";
import { shellDefault } from "@vtt/shell-default";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { comms } from "@vtt/comms";
import { ping } from "@vtt/ping";
import { resolution } from "@vtt/resolution";
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
  return false;
};

// Dev convenience: when DEV_PROXY_URL is set (typical: http://localhost:5173),
// the substrate's port serves Vite's compiled output with HMR. That way both
// `:5173` and `:3001` give the same live experience and no one has to remember
// which port to load. Production deployments leave it unset and serve dist.
const devProxy = process.env.DEV_PROXY_URL;

const handle = await startServer({
  port,
  plugins: [shellDefault, identity, permissions, comms, ping, resolution],
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

const shutdown = async () => {
  await handle.close();
  auth.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function loadOrCreateSecret(path: string): string {
  if (existsSync(path)) {
    return readFileSync(path, "utf-8").trim();
  }
  const secret = randomBytes(32).toString("base64");
  writeFileSync(path, secret + "\n", { mode: 0o600 });
  console.log(`generated new auth secret at ${path}`);
  return secret;
}
