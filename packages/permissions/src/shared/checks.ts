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

import { fail, matches, ok, type Result, type Visibility, type World } from "@vtt/substrate";
import { type Role, parseAuthSession } from "@vtt/auth";
import { Permissions } from "./traits.js";

/**
 * Compose with `validate` in commands:
 *
 *   validate: (ctx) => requireRole(ctx, "gm").ok ? ok() : fail("GM only")
 *
 * Returns Result so the caller can chain — keeps the validate body
 * readable when checks compose.
 */
export function requireRole(ctx: { session?: unknown }, role: Role): Result {
  const s = parseAuthSession(ctx.session);
  if (!s) return fail("not authenticated");
  if (s.role !== role) return fail(`requires role: ${role}`);
  return ok();
}

/**
 * Pass when the actor may write the entity:
 *   - GMs always pass (universal bypass — gm is the escape hatch).
 *   - Otherwise the actor's `{userId, role}` must match the entity's
 *     `Permissions.write` Visibility (everyone / role / users).
 *
 * Fails when no session, the entity has no `Permissions` trait (no
 * one owns it, only GMs may act), or none of the above match.
 *
 * This is the canonical write-gate for every plugin. `requireOwnerOrGm`
 * and `requireCharacterEditor` are gone — assignment IS write access
 * (a player listed in `Permissions.write.userIds` has full edit
 * rights), and ownership is just "I am in the users list."
 */
export function requireWrite(ctx: { session?: unknown; world: World }, entityId: string): Result {
  const s = parseAuthSession(ctx.session);
  if (!s) return fail("not authenticated");
  if (s.role === "gm") return ok();
  const got = ctx.world.get(entityId, [Permissions]) as
    | { Permissions: { read: Visibility; write: Visibility } }
    | undefined;
  if (!got) {
    return fail(`entity ${entityId} has no Permissions trait — GM only`);
  }
  if (matches(got.Permissions.write, { userId: s.userId, role: s.role })) {
    return ok();
  }
  return fail(`you don't have write access to ${entityId}`);
}

/**
 * Boolean form of the read check, for client-side UI predicates like
 * "is this row clickable?" Always returns true for GMs. Without a
 * `Permissions` trait the entity is treated as public (matches the
 * snapshot filter's default).
 *
 * Accepts the client's `{userId, role}` shape directly (typically the
 * value of `useMe()`), not a raw session — clients don't have the
 * opaque session object on hand.
 */
export function canRead(
  me: { userId: string; role: string } | null,
  permissions: { read: Visibility; write: Visibility } | undefined,
): boolean {
  if (!me) return false;
  if (me.role === "gm") return true;
  if (!permissions) return true;
  return matches(permissions.read, me);
}

/**
 * Boolean form of `requireWrite`, for client-side UI predicates like
 * "should this input be enabled?" GMs always return true. Accepts the
 * client's `{userId, role}` shape directly.
 */
export function canWrite(
  me: { userId: string; role: string } | null,
  permissions: { read: Visibility; write: Visibility } | undefined,
): boolean {
  if (!me) return false;
  if (me.role === "gm") return true;
  if (!permissions) return false;
  return matches(permissions.write, me);
}
