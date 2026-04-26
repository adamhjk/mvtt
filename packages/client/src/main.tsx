import { render } from "solid-js/web";
import { createSignal, Show, onMount } from "solid-js";
import { startClient, ClientProvider } from "@vtt/substrate/client";
import { shellDefault } from "@vtt/shell-default";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { comms } from "@vtt/comms";
import { ping } from "@vtt/ping";
import { resolution } from "@vtt/resolution";
import { App } from "./App";
import { AuthGate } from "./AuthGate";
import { authClient } from "./auth-client";
import "./styles.css";

const wsProto = location.protocol === "https:" ? "wss" : "ws";
const wsURL = `${wsProto}://${location.host}/ws`;

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
        <Authenticated />
      </Show>
    </Show>
  );
}

function Authenticated() {
  // Only spin up the WebSocket once we know we have a session — the substrate
  // rejects the upgrade otherwise and we'd loop on reconnects.
  const client = startClient({ url: wsURL, plugins: [shellDefault, identity, permissions, comms, ping, resolution] });
  return (
    <ClientProvider value={client}>
      <App />
    </ClientProvider>
  );
}

render(() => <Root />, document.getElementById("root")!);
