import { render } from "solid-js/web";
import { createSignal, Show, onMount } from "solid-js";
import { startClient, ClientProvider } from "@vtt/substrate/client";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { comms } from "@vtt/comms";
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
        <WorldGate>{(ctx) => <Authenticated worldId={ctx.worldId} />}</WorldGate>
      </Show>
    </Show>
  );
}

function Authenticated(props: { worldId: string }) {
  const wsURL = `${wsProto}://${location.host}/ws?worldId=${encodeURIComponent(props.worldId)}`;
  // Only spin up the WebSocket once we know we have a session AND a worldId.
  const client = startClient({
    url: wsURL,
    plugins: [
      shellWorkbench,
      identity,
      permissions,
      comms,
      resolution,
      scene,
      books,
      pdfBook,
      characters,
      diceTray,
      systemSimple,
    ],
  });
  return (
    <ClientProvider value={client}>
      <App />
    </ClientProvider>
  );
}

render(() => <Root />, document.getElementById("root")!);
