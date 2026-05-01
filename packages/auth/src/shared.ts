// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { z } from "zod";

/**
 * Two roles in this scaffold: the Game Master runs the session, players join
 * it. The first account ever created on a given server becomes the GM —
 * subsequent signups are players. There can be exactly one GM until we add
 * an admin UI to change that.
 */
export const RoleSchema = z.enum(["gm", "player"]);
export type Role = z.infer<typeof RoleSchema>;

export const ROLES: Readonly<Role[]> = ["gm", "player"];

/**
 * The shape the substrate threads through to commands as `ctx.session`.
 * Auth-aware plugins narrow the opaque `unknown` with this schema before use.
 */
export const AuthSessionSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  role: RoleSchema,
});

export type AuthSession = z.infer<typeof AuthSessionSchema>;

/**
 * Narrow an opaque `unknown` to an AuthSession. Returns null if the value
 * isn't a valid session — callers decide whether that's a hard fail or a
 * soft "skip" depending on the call site (validate vs. system run).
 */
export function parseAuthSession(value: unknown): AuthSession | null {
  const parsed = AuthSessionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
