import { createAuthClient } from "better-auth/solid";
import { inferAdditionalFields } from "better-auth/client/plugins";

export interface MvttAuthClientOptions {
  /** Base URL of the auth server. Defaults to current origin. */
  baseURL?: string;
}

export function createMvttAuthClient(opts: MvttAuthClientOptions = {}) {
  return createAuthClient({
    baseURL: opts.baseURL,
    plugins: [
      inferAdditionalFields({
        user: {
          role: { type: "string", required: false, defaultValue: "player", input: false },
        },
      }),
    ],
  });
}

export type MvttAuthClient = ReturnType<typeof createMvttAuthClient>;
