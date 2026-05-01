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

import { type CommandInstance } from "@vtt/substrate";
import { useClient, useQuery } from "@vtt/substrate/client";
import { OwnedBy } from "@vtt/permissions/shared";
import {
  definePageProvider,
  RetargetTab,
} from "@vtt/shell-workbench/shared";
import { createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js";
import { Character } from "../shared/traits.js";
import {
  CreateCharacter,
  RemoveCharacter,
} from "../shared/commands.js";
import { CharacterCreated } from "../shared/events.js";
import { CharacterSheet } from "./CharacterSheet.js";
import { useMe } from "./use-me.js";

const CHARACTERS_KIND = "@vtt/characters/characters";

/**
 * The Characters PageProvider. Each Character entity becomes one
 * selectable Page; render mounts the sheet inside the workbench's
 * pane. Empty branch (`entityId === null`): show the management hub
 * — list every character with Open/Remove and an inline create form.
 */
export const CharactersPageProvider = definePageProvider({
  kind: CHARACTERS_KIND,
  icon: "user",
  label: "Characters",
  reads: [Character],
  list: ({ world }) => {
    return world.query([Character]).map((row) => {
      const c = row.values.Character as { name: string };
      return { id: row.id, label: c.name };
    });
  },
  defaultEntity: ({ world }) => {
    const first = world.query([Character])[0];
    return first?.id ?? null;
  },
  render: ({ tabId, entityId }) => {
    return <CharactersPage tabId={tabId} entityId={entityId} />;
  },
});

function CharactersPage(props: {
  tabId: string;
  entityId: string | null;
}): JSX.Element {
  return (
    <Show
      when={props.entityId}
      fallback={
        <section class="flex h-full flex-col gap-3">
          <CharactersHub tabId={props.tabId} />
        </section>
      }
    >
      {(idAcc) => <CharacterSheet characterId={idAcc()} />}
    </Show>
  );
}

/**
 * Management hub shown when the tab has no entityId. Lists every
 * character, lets the viewer Open one, and (subject to ownership or
 * GM role) Remove. The create form below spawns a new character and
 * retargets this tab onto it.
 *
 * Anyone authenticated can create their own character. Removing is
 * gated to owner-or-GM by the RenameCharacter / RemoveCharacter
 * validators server-side; we mirror that gate in the UI so the button
 * doesn't appear for users who can't act on it.
 */
function CharactersHub(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const characterRows = useQuery([Character, OwnedBy]);

  const characters = createMemo(() =>
    characterRows()
      .map((row) => ({
        id: row.id,
        name: (row.values.Character as { name: string }).name,
        ownerUserId: (row.values.OwnedBy as { userId: string }).userId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  const canRemove = (ownerUserId: string) => {
    const m = me();
    if (!m) return false;
    return m.role === "gm" || m.userId === ownerUserId;
  };

  const open = (characterId: string) => {
    client.dispatch(
      RetargetTab({
        tabId: props.tabId,
        pageKind: CHARACTERS_KIND,
        entityId: characterId,
      }) as CommandInstance,
    );
  };

  const remove = (characterId: string, name: string) => {
    if (!window.confirm(`Remove "${name}"?`)) return;
    client.dispatch(RemoveCharacter({ characterId }) as CommandInstance);
  };

  return (
    <div class="flex h-full items-start justify-center overflow-y-auto py-10">
      <div class="flex w-full max-w-lg flex-col gap-6 px-5">
        <Show
          when={characters().length > 0}
          fallback={
            <div class="flex flex-col items-center gap-5 text-center">
              <p
                class="font-display text-2xl tracking-tight text-fg-muted"
                style={{ "font-family": "var(--font-display)" }}
              >
                No characters yet — create one below.
              </p>
              <Show
                when={me()}
                fallback={
                  <p class="text-xs text-fg-subtle">
                    sign in to create a character…
                  </p>
                }
              >
                <CreateCharacterForm tabId={props.tabId} />
              </Show>
            </div>
          }
        >
          <header class="flex items-baseline justify-between">
            <h2
              class="font-display text-xl tracking-tight text-fg"
              style={{ "font-family": "var(--font-display)" }}
            >
              Characters
            </h2>
            <span class="font-display text-[0.62rem] uppercase tracking-[0.16em] text-fg-subtle">
              {characters().length} total
            </span>
          </header>
          <ul class="flex flex-col gap-1">
            <For each={characters()}>
              {(c) => (
                <li class="group flex items-center gap-3 rounded-(--radius-control) border border-border-muted bg-surface-elevated px-3 py-2">
                  <button
                    type="button"
                    onClick={() => open(c.id)}
                    class="flex-1 truncate text-left text-sm text-fg hover:text-accent transition"
                    title="Open this character"
                  >
                    {c.name}
                  </button>
                  <span class="font-mono text-[0.6rem] text-fg-subtle">
                    {c.id}
                  </span>
                  <button
                    type="button"
                    onClick={() => open(c.id)}
                    class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition"
                  >
                    Open
                  </button>
                  <Show when={canRemove(c.ownerUserId)}>
                    <button
                      type="button"
                      onClick={() => remove(c.id, c.name)}
                      class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-[0.65rem] text-fg-subtle hover:border-danger hover:text-danger transition"
                      title={`Remove "${c.name}"`}
                    >
                      Remove
                    </button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <Show when={me()}>
            <div class="mt-2 flex flex-col gap-3 border-t border-border-muted pt-5">
              <h3 class="font-display text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle">
                Create new character
              </h3>
              <CreateCharacterForm tabId={props.tabId} />
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

/**
 * Inline create form. Subscribes to CharacterCreated once before
 * dispatch, captures the existing Character-entity ids, and on the
 * first matching event diffs the world's Character query to identify
 * the freshly-spawned entity so this tab can retarget onto it.
 */
function CreateCharacterForm(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let inputEl: HTMLInputElement | undefined;

  onMount(() => {
    inputEl?.focus();
  });

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (busy()) return;
    const trimmed = name().trim();
    if (trimmed.length === 0) return;
    setBusy(true);

    const beforeIds = new Set(
      client.world.query([Character]).map((r) => r.id),
    );

    const off = client.bus.on(CharacterCreated.name, () => {
      off();
      const fresh = client.world
        .query([Character])
        .find((r) => !beforeIds.has(r.id));
      if (fresh) {
        client.dispatch(
          RetargetTab({
            tabId: props.tabId,
            pageKind: CHARACTERS_KIND,
            entityId: fresh.id,
          }) as CommandInstance,
        );
      }
      setName("");
      setBusy(false);
    });

    client.dispatch(CreateCharacter({ name: trimmed }) as CommandInstance);
  };

  return (
    <form
      onSubmit={submit}
      class="flex w-full flex-col gap-3"
      autocomplete="off"
      data-form-type="other"
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
    >
      <label class="flex flex-col gap-1 text-left">
        <span class="font-display text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle">
          Name
        </span>
        <input
          ref={inputEl}
          type="text"
          name="character-name"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          placeholder="e.g. Tarn the Bold"
          maxLength={120}
          autocomplete="off"
          spellcheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 font-display text-base text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
      </label>
      <button
        type="submit"
        disabled={busy() || name().trim().length === 0}
        class="rounded-(--radius-control) bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover transition disabled:opacity-50"
      >
        {busy() ? "Creating…" : "Create character"}
      </button>
    </form>
  );
}
