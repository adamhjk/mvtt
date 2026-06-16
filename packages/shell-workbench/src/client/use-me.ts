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
    const found = list.find((p) => (p.values.Online as { clientId: string }).clientId === cid);
    if (!found) return null;
    const id = found.values.Identity as { userId: string; role: string };
    const nm = (found.values as { Name?: { value: string } }).Name;
    return { userId: id.userId, role: id.role, name: nm?.value ?? "" };
  });
}
