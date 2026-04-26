import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AuthSession, Role } from "./shared.js";

export interface AuthOptions {
  /** Absolute path to the SQLite file. Parent directory will be created if missing. */
  databasePath: string;
  /** Base URL used for cookie scoping and CORS, e.g. "http://localhost:3001". */
  baseURL: string;
  /** 32+ char secret for signing/encrypting cookies. */
  secret: string;
  /** Whether new accounts should require email verification. Default: false (scaffold). */
  requireEmailVerification?: boolean;
  /** Trusted origins for CORS (e.g. the Vite dev server). */
  trustedOrigins?: string[];
}

export interface MvttAuth {
  readonly auth: ReturnType<typeof buildBetterAuth>;
  readonly db: Database.Database;
  /** Returns true iff at least one user with role=gm already exists. */
  hasGameMaster(): boolean;
  /** Validate cookies → AuthSession. Returns null when there is no session. */
  resolveSession(headers: Headers): Promise<AuthSession | null>;
  /** Run schema migrations against the SQLite file. Idempotent. */
  migrate(): Promise<void>;
  close(): void;
}

function buildBetterAuth(opts: {
  db: Database.Database;
  baseURL: string;
  secret: string;
  requireEmailVerification: boolean;
  trustedOrigins: string[];
  hasGameMaster: () => boolean;
}) {
  return betterAuth({
    database: opts.db,
    baseURL: opts.baseURL,
    basePath: "/api/auth",
    secret: opts.secret,
    trustedOrigins: opts.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: opts.requireEmailVerification,
      autoSignIn: true,
      minPasswordLength: 8,
    },
    user: {
      additionalFields: {
        role: {
          // First account on a fresh server becomes the GM, every subsequent
          // signup is a player. Inputs are blocked so a malicious client can
          // never claim role=gm during signup.
          type: "string" as const,
          required: false,
          defaultValue: "player",
          input: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const role: Role = opts.hasGameMaster() ? "player" : "gm";
            return { data: { ...user, role } };
          },
        },
      },
    },
  });
}

export function createAuth(opts: AuthOptions): MvttAuth {
  mkdirSync(dirname(opts.databasePath), { recursive: true });
  const db = new Database(opts.databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const hasGameMaster = (): boolean => {
    try {
      const row = db
        .prepare(`SELECT COUNT(*) AS c FROM "user" WHERE role = ?`)
        .get("gm") as { c: number } | undefined;
      return (row?.c ?? 0) > 0;
    } catch {
      // Table may not exist yet (migration hasn't run); treat as no GM.
      return false;
    }
  };

  const auth = buildBetterAuth({
    db,
    baseURL: opts.baseURL,
    secret: opts.secret,
    requireEmailVerification: opts.requireEmailVerification ?? false,
    trustedOrigins: opts.trustedOrigins ?? [],
    hasGameMaster,
  });

  const resolveSession = async (headers: Headers): Promise<AuthSession | null> => {
    const session = await auth.api.getSession({ headers });
    if (!session) return null;
    return {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: ((session.user as { role?: Role }).role ?? "player") as Role,
    };
  };

  const migrate = async (): Promise<void> => {
    const { runMigrations } = await getMigrations(auth.options);
    await runMigrations();
  };

  return {
    auth,
    db,
    hasGameMaster,
    resolveSession,
    migrate,
    close: () => db.close(),
  };
}
