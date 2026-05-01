// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { createMemo, type Accessor } from "solid-js";
import { useClient, useQuery } from "@vtt/substrate/client";
import { Identity, Online } from "@vtt/identity/shared";

export interface MeInfo {
  readonly userId: string;
  readonly role: string;
  readonly clientId: string;
}

/**
 * "Who am I?" — resolves the current connection's userId/role/clientId
 * by matching `Online.clientId` against `client.clientId()`. Same shape
 * as the characters/scene helpers; copied to avoid cross-plugin
 * imports of internals.
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
    return { userId: id.userId, role: id.role, clientId: cid };
  });
}
