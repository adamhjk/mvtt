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

import { createResource, createSignal, Show, Match, Switch } from "solid-js";
import { authClient } from "./auth-client";

type Mode = "signin" | "signup";

async function fetchHasGameMaster(): Promise<boolean> {
  const res = await fetch("/api/has-gm");
  if (!res.ok) return true;
  const json = (await res.json()) as { hasGameMaster: boolean };
  return json.hasGameMaster;
}

export function AuthGate(props: { onAuthenticated: () => void }) {
  const [hasGM, { refetch: refetchHasGM }] = createResource(fetchHasGameMaster);
  const [mode, setMode] = createSignal<Mode>("signin");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  // Effective mode: when no GM exists, we always force the GM-bootstrap form
  // (which is structurally a sign-up, but with framing copy that says "create
  // the Game Master account"). Otherwise honour the user's selection.
  const effective = (): "bootstrap" | Mode => (!hasGM() ? "bootstrap" : mode());

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const m = effective();
      if (m === "bootstrap" || m === "signup") {
        const res = await authClient.signUp.email({
          email: email(),
          password: password(),
          name: name(),
        });
        if (res.error) throw new Error(res.error.message ?? "sign up failed");
      } else {
        const res = await authClient.signIn.email({
          email: email(),
          password: password(),
        });
        if (res.error) throw new Error(res.error.message ?? "sign in failed");
      }
      // After GM bootstrap, has-gm flips; after every other signup/signin, just proceed.
      await refetchHasGM();
      props.onAuthenticated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="grid min-h-screen place-items-center bg-surface px-4">
      <div class="w-full max-w-sm rounded-(--radius-card) border border-border bg-surface-elevated p-6 shadow-sm">
        <Show when={hasGM.state === "ready"} fallback={<p class="text-sm text-fg-muted">loading…</p>}>
          <Switch>
            <Match when={effective() === "bootstrap"}>
              <header class="mb-4">
                <h1 class="text-lg font-semibold tracking-tight text-fg">Create the Game Master</h1>
                <p class="mt-1 text-xs text-fg-muted">
                  No account exists yet on this server. The first account you create becomes the
                  Game Master. Subsequent signups will be Players.
                </p>
              </header>
            </Match>
            <Match when={effective() === "signin"}>
              <header class="mb-4">
                <h1 class="text-lg font-semibold tracking-tight text-fg">Sign in</h1>
                <p class="mt-1 text-xs text-fg-muted">Welcome back.</p>
              </header>
            </Match>
            <Match when={effective() === "signup"}>
              <header class="mb-4">
                <h1 class="text-lg font-semibold tracking-tight text-fg">Create a Player account</h1>
                <p class="mt-1 text-xs text-fg-muted">Join an existing session as a player.</p>
              </header>
            </Match>
          </Switch>

          <form onSubmit={submit} class="flex flex-col gap-3">
            <Show when={effective() !== "signin"}>
              <Field
                label="Display name"
                value={name()}
                onInput={setName}
                placeholder="Hero"
                required
                autocomplete="name"
              />
            </Show>
            <Field
              label="Email"
              type="email"
              value={email()}
              onInput={setEmail}
              placeholder="you@example.com"
              required
              autocomplete="email"
            />
            <Field
              label="Password"
              type="password"
              value={password()}
              onInput={setPassword}
              placeholder="at least 8 characters"
              required
              autocomplete={effective() === "signin" ? "current-password" : "new-password"}
            />
            <Show when={error()}>
              <p class="rounded-(--radius-control) border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">
                {error()}
              </p>
            </Show>
            <button
              type="submit"
              disabled={busy()}
              class="rounded-(--radius-control) bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover transition disabled:opacity-50"
            >
              <Switch>
                <Match when={effective() === "bootstrap"}>
                  {busy() ? "Creating GM…" : "Create Game Master"}
                </Match>
                <Match when={effective() === "signin"}>
                  {busy() ? "Signing in…" : "Sign in"}
                </Match>
                <Match when={effective() === "signup"}>
                  {busy() ? "Creating account…" : "Create account"}
                </Match>
              </Switch>
            </button>
          </form>

          <Show when={effective() !== "bootstrap"}>
            <p class="mt-4 border-t border-border-muted pt-3 text-center text-xs text-fg-muted">
              <Show
                when={mode() === "signin"}
                fallback={
                  <>
                    Already registered?{" "}
                    <button
                      type="button"
                      class="text-accent hover:underline"
                      onClick={() => setMode("signin")}
                    >
                      Sign in
                    </button>
                  </>
                }
              >
                New here?{" "}
                <button
                  type="button"
                  class="text-accent hover:underline"
                  onClick={() => setMode("signup")}
                >
                  Create a Player account
                </button>
              </Show>
            </p>
          </Show>
        </Show>
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  autocomplete?: string;
}) {
  return (
    <label class="flex flex-col gap-1 text-xs text-fg-muted">
      <span>{props.label}</span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        placeholder={props.placeholder}
        required={props.required}
        autocomplete={props.autocomplete}
        class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
      />
    </label>
  );
}
