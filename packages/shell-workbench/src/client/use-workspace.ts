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

import { createMemo, type Accessor } from "solid-js";
import { useClient, useQuery } from "@vtt/substrate/client";
import { OwnedBy } from "@vtt/permissions/shared";
import { WorkspaceOwner, WorkspaceState } from "../shared/traits.js";
import type { z } from "zod";
import { useMe } from "./use-me.js";

export type WorkspaceStateValue = z.infer<typeof WorkspaceState.schema>;

export interface WorkspaceHandle {
  /** This user's WorkspaceOwner entity id, or null until bootstrap. */
  readonly ownerEntityId: Accessor<string | null>;
  /** The current workspace state, or null if the owner doesn't exist yet. */
  readonly state: Accessor<WorkspaceStateValue | null>;
  /** Convenience: is the user a GM? */
  readonly isGm: Accessor<boolean>;
}

/**
 * Resolve the current user's workspace state. Tracks every relevant signal
 * so views re-render when the bootstrap-on-join system spawns the owner
 * entity, when WorkspaceStateChanged events arrive, or when the user's
 * other tab dispatches a mutation.
 */
export function useWorkspace(): WorkspaceHandle {
  const me = useMe();
  const owners = useQuery([WorkspaceOwner, OwnedBy, WorkspaceState]);
  const found = createMemo(() => {
    const m = me();
    if (!m) return null;
    return (
      owners().find((row) => (row.values.OwnedBy as { userId: string }).userId === m.userId) ??
      null
    );
  });
  const ownerEntityId = createMemo(() => found()?.id ?? null);
  const state = createMemo(() =>
    (found()?.values.WorkspaceState as WorkspaceStateValue | undefined) ?? null,
  );
  const isGm = createMemo(() => me()?.role === "gm");
  return { ownerEntityId, state, isGm };
}
