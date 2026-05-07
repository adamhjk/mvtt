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
import { useClient } from "@vtt/substrate/client";
import type { PageProviderContext } from "../shared/slots.js";
import { useMe } from "./use-me.js";

/**
 * Per-render Solid wrapper around `PageProviderContext`. Providers are
 * called every time the workbench renders a tab / picker / palette, so
 * they need a fresh context that's safe to capture and read inside a
 * Solid memo. We tracking-read the relevant signals (me, world via the
 * substrate's reactivity bridge) so calling `provider.list(ctx())` inside
 * a memo re-runs when either the user identity OR the world changes.
 */
export interface ProviderRunContext extends PageProviderContext {}

export function useProviderContext(): Accessor<ProviderRunContext> {
  const client = useClient();
  const me = useMe();
  return createMemo<ProviderRunContext>(() => {
    const m = me();
    return {
      world: client.world,
      registry: client.registry,
      userId: m?.userId ?? "",
      role: m?.role ?? "player",
    };
  });
}
