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
      userId: m?.userId ?? "",
      role: m?.role ?? "player",
    };
  });
}
