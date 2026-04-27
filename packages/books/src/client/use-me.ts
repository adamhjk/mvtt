import { createMemo, type Accessor } from "solid-js";
import { useClient, useQuery } from "@vtt/substrate/client";
import { Identity, Online } from "@vtt/identity/shared";

export interface MeInfo {
  userId: string;
  role: string;
}

/**
 * "Who am I?" — same shape as scene's use-me. Resolves the current
 * connection's userId/role by matching `Online.clientId` against
 * `client.clientId()`. Used by every books view that needs role-based
 * gating (create form, remove button, config edits).
 */
export function useMe(): Accessor<MeInfo | null> {
  const client = useClient();
  const players = useQuery([Identity, Online]);
  return createMemo(() => {
    const list = players();
    const cid = client.clientId();
    if (!cid) return null;
    const found = list.find(
      (p) => (p.values.Online as { clientId: string }).clientId === cid,
    );
    if (!found) return null;
    const id = found.values.Identity as { userId: string; role: string };
    return { userId: id.userId, role: id.role };
  });
}
