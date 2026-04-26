import { fail, ok, type Result, type World } from "@vtt/substrate";
import { type Role, parseAuthSession } from "@vtt/auth";
import { OwnedBy } from "./traits.js";

/**
 * Compose with `validate` in commands:
 *
 *   validate: (ctx) => requireRole(ctx, "gm").ok ? ok() : fail("GM only")
 *
 * Returns Result so the caller can chain — keeps the validate body
 * readable when checks compose.
 */
export function requireRole(
  ctx: { session?: unknown },
  role: Role,
): Result {
  const s = parseAuthSession(ctx.session);
  if (!s) return fail("not authenticated");
  if (s.role !== role) return fail(`requires role: ${role}`);
  return ok();
}

/**
 * Pass when the actor is the entity's owner OR a GM. The "or GM" branch
 * is the universal escape hatch — Game Masters can manipulate anything
 * regardless of OwnedBy. Returns fail when there's no session, the entity
 * doesn't exist, the entity has no `OwnedBy` trait (no one owns it; only
 * GMs can act on it), or the actor is neither owner nor GM.
 */
export function requireOwnerOrGm(
  ctx: { session?: unknown; world: World },
  entityId: string,
): Result {
  const s = parseAuthSession(ctx.session);
  if (!s) return fail("not authenticated");
  if (s.role === "gm") return ok();
  const got = ctx.world.get(entityId, [OwnedBy]) as
    | { OwnedBy: { userId: string } }
    | undefined;
  if (!got) return fail(`entity ${entityId} has no OwnedBy trait — GM only`);
  if (got.OwnedBy.userId !== s.userId) {
    return fail(`entity ${entityId} is owned by another user`);
  }
  return ok();
}
