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

import { render } from "solid-js/web";
import { createSignal, Show, onMount } from "solid-js";
import {
  startClient,
  ClientProvider,
  type PluginDef,
} from "@vtt/substrate/client";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { comms } from "@vtt/comms";
import { notes } from "@vtt/notes";
import { assets } from "@vtt/assets";
import { resolution } from "@vtt/resolution";
import { scene } from "@vtt/scene";
import { books } from "@vtt/books";
import { pdfBook } from "@vtt/pdf-book";
import { characters } from "@vtt/characters";
import { diceTray } from "@vtt/dice-tray";
import { systemSimple } from "@vtt/system-simple";
import { App } from "./App";
import { AuthGate } from "./AuthGate";
import { WorldGate } from "./WorldGate";
import { authClient } from "./auth-client";
import "./styles.css";

const wsProto = location.protocol === "https:" ? "wss" : "ws";

/**
 * Static catalog of every plugin compiled into this client bundle. The
 * actual set used per world is filtered against the world's resolved
 * `plugins` list (advertised by the server in `/api/worlds`) so the
 * client's Registry mirrors the server's per-world Registry. Without
 * that, the workbench chrome leaks UI from plugins the world doesn't
 * actually have, and dispatching against them produces "unknown
 * command" nacks.
 */
const ALL_PLUGINS: ReadonlyArray<PluginDef> = [
  shellWorkbench,
  identity,
  permissions,
  comms,
  notes,
  assets,
  resolution,
  scene,
  books,
  pdfBook,
  characters,
  diceTray,
  systemSimple,
];

function Root() {
  const [authed, setAuthed] = createSignal<boolean | null>(null);
  // Probing the session before mounting the client avoids a flash of the
  // app shell during a page reload.
  onMount(async () => {
    const res = await authClient.getSession();
    setAuthed(Boolean(res.data?.session));
  });

  const onAuthenticated = () => setAuthed(true);

  return (
    <Show
      when={authed() !== null}
      fallback={<div class="grid min-h-screen place-items-center text-fg-muted text-sm">loading…</div>}
    >
      <Show when={authed()} fallback={<AuthGate onAuthenticated={onAuthenticated} />}>
        <WorldGate>
          {(ctx) => {
            const world = ctx.worlds.find((w) => w.id === ctx.worldId);
            return (
              <Authenticated
                worldId={ctx.worldId}
                activePlugins={world?.plugins ?? []}
              />
            );
          }}
        </WorldGate>
      </Show>
    </Show>
  );
}

function Authenticated(props: {
  worldId: string;
  activePlugins: ReadonlyArray<string>;
}) {
  const wsURL = `${wsProto}://${location.host}/ws?worldId=${encodeURIComponent(props.worldId)}`;
  // Filter the static plugin catalog against the world's resolved
  // active set. Plugins compiled into the binary but not active for
  // this world stay loaded as JS modules — we just don't register them
  // with the world's client Registry, which is what the workbench
  // chrome and reactivity layer read from.
  const active = new Set(props.activePlugins);
  const plugins = ALL_PLUGINS.filter((p) => active.has(p.name));
  // Only spin up the WebSocket once we know we have a session AND a worldId.
  const client = startClient({
    url: wsURL,
    plugins,
  });
  return (
    <ClientProvider value={client}>
      <App />
    </ClientProvider>
  );
}

render(() => <Root />, document.getElementById("root")!);
