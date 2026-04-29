import {
  createResource,
  createSignal,
  Match,
  Show,
  Switch,
  type JSX,
} from "solid-js";
import { authClient } from "./auth-client";

interface WorldSummary {
  id: string;
  name: string;
  gameSystemPlugin: string;
  ownerUserId: string;
  createdAt: number;
  isOwner: boolean;
}

interface GameSystemSummary {
  name: string;
  version: string;
}

interface SessionInfo {
  userId: string;
  isGlobalGm: boolean;
}

const lastWorldKey = (userId: string) => `mvtt:lastWorldId:${userId}`;

async function fetchWorlds(): Promise<WorldSummary[]> {
  const res = await fetch("/api/worlds", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`/api/worlds → ${res.status}`);
  const body = (await res.json()) as { worlds: WorldSummary[] };
  return body.worlds;
}

async function fetchGameSystems(): Promise<GameSystemSummary[]> {
  const res = await fetch("/api/game-systems", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`/api/game-systems → ${res.status}`);
  const body = (await res.json()) as { gameSystems: GameSystemSummary[] };
  return body.gameSystems;
}

async function fetchSession(): Promise<SessionInfo | null> {
  const res = await authClient.getSession();
  const session = res.data?.session;
  const user = res.data?.user as { id?: string; role?: string } | undefined;
  if (!session || !user?.id) return null;
  return {
    userId: user.id,
    isGlobalGm: user.role === "gm",
  };
}

/**
 * After auth succeeds, resolve which worldId the connection should
 * target before the WS client is mounted. The decision tree:
 *
 *   - URL has `?worldId=<x>` AND the user can access x → use x.
 *   - URL has nothing AND user has worlds → redirect to last-used (or
 *     first), full reload.
 *   - User has no worlds AND is the global GM → forced create modal.
 *   - User has no worlds AND is a player → empty state ("ask your GM
 *     to invite you"), nothing else to do.
 *
 * The redirect is a full reload by design — switching worlds today is
 * a reconnect, so this same path is what the world picker dropdown will
 * use later. Keeping reconnect simple beats a mid-session swap that
 * tears down and rebuilds the client on the same page.
 */
export function WorldGate(props: {
  children: (ctx: {
    worldId: string;
    session: SessionInfo;
    worlds: WorldSummary[];
  }) => JSX.Element;
}): JSX.Element {
  const [data] = createResource(async () => {
    const [worlds, systems, session] = await Promise.all([
      fetchWorlds(),
      fetchGameSystems(),
      fetchSession(),
    ]);
    return { worlds, systems, session };
  });

  const decision = () => {
    const d = data();
    if (!d || !d.session) return { kind: "loading" as const };
    const session = d.session;
    const url = new URL(window.location.href);
    const requested = url.searchParams.get("worldId");

    if (requested && d.worlds.some((w) => w.id === requested)) {
      try {
        localStorage.setItem(lastWorldKey(session.userId), requested);
      } catch {
        /* private mode / quota — proceed without persistence */
      }
      return { kind: "ready" as const, worldId: requested, session, worlds: d.worlds };
    }

    if (d.worlds.length > 0) {
      let target = d.worlds[0]!.id;
      try {
        const last = localStorage.getItem(lastWorldKey(session.userId));
        if (last && d.worlds.some((w) => w.id === last)) target = last;
      } catch {
        /* ignore */
      }
      url.searchParams.set("worldId", target);
      // `replace` so we don't push the worldId-less URL onto history.
      window.location.replace(url.toString());
      return { kind: "loading" as const };
    }

    return {
      kind: "empty" as const,
      session,
      systems: d.systems,
    };
  };

  return (
    <Switch>
      <Match when={decision().kind === "loading"}>
        <div class="grid min-h-screen place-items-center text-fg-muted text-sm">
          loading worlds…
        </div>
      </Match>
      <Match when={decision().kind === "empty"}>
        {(() => {
          const d = decision() as Extract<ReturnType<typeof decision>, { kind: "empty" }>;
          return d.session.isGlobalGm ? (
            <CreateFirstWorld systems={d.systems} userId={d.session.userId} />
          ) : (
            <NoWorldsYet />
          );
        })()}
      </Match>
      <Match when={decision().kind === "ready"}>
        {(() => {
          const d = decision() as Extract<ReturnType<typeof decision>, { kind: "ready" }>;
          return props.children({
            worldId: d.worldId,
            session: d.session,
            worlds: d.worlds,
          });
        })()}
      </Match>
    </Switch>
  );
}

/**
 * First-run UX for the global GM: no worlds exist yet, force a
 * create-world dialog. Cannot be dismissed; the GM must create at
 * least one world to use the app. Submitting redirects to the new
 * world via `?worldId=`.
 */
function CreateFirstWorld(props: {
  systems: GameSystemSummary[];
  userId: string;
}): JSX.Element {
  const [name, setName] = createSignal("My Table");
  const [gameSystem, setGameSystem] = createSignal(
    props.systems[0]?.name ?? "",
  );
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError(null);
    if (!name().trim()) {
      setError("name is required");
      return;
    }
    if (!gameSystem()) {
      setError("pick a game system");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/worlds", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name().trim(), gameSystem: gameSystem() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `create failed (${res.status})`);
      }
      const body = (await res.json()) as { world: { id: string } };
      try {
        localStorage.setItem(lastWorldKey(props.userId), body.world.id);
      } catch {
        /* ignore */
      }
      const url = new URL(window.location.href);
      url.searchParams.set("worldId", body.world.id);
      window.location.replace(url.toString());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="grid min-h-screen place-items-center bg-surface px-4">
      <div class="w-full max-w-md rounded-(--radius-card) border border-border bg-surface-elevated p-6 shadow-sm">
        <header class="mb-4">
          <h1 class="text-lg font-semibold tracking-tight text-fg">
            Create your first world
          </h1>
          <p class="mt-1 text-xs text-fg-muted">
            A world is one campaign or table. The game system you pick
            decides which mechanics are available — it can't be changed
            later.
          </p>
        </header>
        <form onSubmit={submit} class="flex flex-col gap-3">
          <label class="flex flex-col gap-1 text-xs text-fg-muted">
            <span>Name</span>
            <input
              type="text"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              required
              maxlength={120}
              class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </label>
          <label class="flex flex-col gap-1 text-xs text-fg-muted">
            <span>Game system</span>
            <select
              value={gameSystem()}
              onChange={(e) => setGameSystem(e.currentTarget.value)}
              class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            >
              <Show
                when={props.systems.length > 0}
                fallback={<option value="">(no game systems available)</option>}
              >
                {props.systems.map((s) => (
                  <option value={s.name}>{s.name}</option>
                ))}
              </Show>
            </select>
          </label>
          <Show when={error()}>
            <p class="rounded-(--radius-control) border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">
              {error()}
            </p>
          </Show>
          <button
            type="submit"
            disabled={busy() || props.systems.length === 0}
            class="rounded-(--radius-control) bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover transition disabled:opacity-50"
          >
            {busy() ? "Creating…" : "Create world"}
          </button>
        </form>
      </div>
    </div>
  );
}

function NoWorldsYet(): JSX.Element {
  return (
    <div class="grid min-h-screen place-items-center bg-surface px-4">
      <div class="w-full max-w-md rounded-(--radius-card) border border-border bg-surface-elevated p-6 text-center shadow-sm">
        <h1 class="text-lg font-semibold tracking-tight text-fg">
          You haven't been invited to any worlds yet
        </h1>
        <p class="mt-2 text-xs text-fg-muted">
          Ask your Game Master to add you to a world. Once they do,
          refresh this page.
        </p>
      </div>
    </div>
  );
}
