import { createMemo, type Accessor } from "solid-js";
import { useClient, useQuery } from "@vtt/substrate/client";
import { Identity, Online } from "@vtt/identity/shared";

export interface MeInfo {
  userId: string;
  role: string;
  name: string;
}

/**
 * "Who am I?" — resolves the current connection's userId/role/name by
 * matching `Online.clientId` against `client.clientId()`. Reads both
 * signals up front so the memo tracks them.
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
    const nm = (found.values as { Name?: { value: string } }).Name;
    return { userId: id.userId, role: id.role, name: nm?.value ?? "" };
  });
}
