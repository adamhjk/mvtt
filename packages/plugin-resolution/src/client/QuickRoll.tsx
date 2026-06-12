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

import { qualifiedName, type CommandInstance } from "@vtt/substrate";
import { useClient, useQuery } from "@vtt/substrate/client";
import { Identity, Name, Online } from "@vtt/identity/shared";
import {
  activeSpeakerId,
  setActiveSpeakerId,
  useEffectiveSpeakerId,
  useSpeakAsOptions,
} from "@vtt/characters/client";
import {
  type QuickRollComposer,
  type QuickRollComposerArgs,
} from "@vtt/characters/shared";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { RequestRoll } from "../shared/commands.js";

/**
 * Freeform "roll arbitrary dice" composer for the Roll Atelier's right
 * pane. Same input path as the chat `/r` slash handler — dispatches
 * `RequestRoll` — but as a first-class surface inside the Atelier so
 * arbitrary dice and structured rollables share one home. The resolved
 * roll then appears in the Atelier's Recent feed like any other.
 *
 * Resolution owns `RequestRoll`, so the composer lives here and fills
 * the characters-owned `QuickRollComposerSlot`. `onClose` returns the
 * pane to its normal pending/resolved view (and clears selection so the
 * just-rolled result lands in view once it arrives).
 */
function QuickRollComposerBody(props: QuickRollComposerArgs): JSX.Element {
  const client = useClient();
  const [text, setText] = createSignal("");
  const [gmOnly, setGmOnly] = createSignal(false);

  const players = useQuery([Identity, Name, Online]);
  const me = createMemo(() => {
    const cid = client.clientId();
    if (!cid) return null;
    const found = players().find(
      (p) => (p.values.Online as { clientId: string }).clientId === cid,
    );
    if (!found) return null;
    const id = found.values.Identity as { userId: string; role: string };
    return { userId: id.userId, role: id.role };
  });
  const isGm = createMemo(() => me()?.role === "gm");

  const speakAsOptions = useSpeakAsOptions();
  const speakerId = useEffectiveSpeakerId();

  const roll = () => {
    const notation = text().trim();
    if (notation.length === 0) return;
    const sid = speakerId();
    const gm = isGm() && gmOnly();
    client.dispatch(
      RequestRoll({
        notation,
        visibility: gm ? "gm-only" : "public",
        ...(sid ? { speakingAsCharacterId: sid } : {}),
      }) as CommandInstance,
    );
    setText("");
    props.onClose();
  };

  return (
    <article
      class="flex flex-col gap-3"
      data-testid="atelier-quick-roll-composer"
    >
      <header class="flex items-baseline justify-between gap-2 border-b border-border-muted pb-2">
        <h3 class="font-display text-sm tracking-tight text-fg">Quick roll</h3>
        <button
          type="button"
          onClick={() => props.onClose()}
          class="rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 text-[0.7rem] text-fg-subtle hover:border-danger hover:text-danger transition"
          data-testid="atelier-quick-roll-cancel"
        >
          cancel
        </button>
      </header>

      <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.65rem] text-fg-subtle">
        <Show when={speakAsOptions().length > 1}>
          <label class="flex items-center gap-1.5">
            <span class="font-display uppercase tracking-[0.16em]">
              speak as
            </span>
            <select
              value={activeSpeakerId() ?? ""}
              onChange={(e) =>
                setActiveSpeakerId(
                  e.currentTarget.value === "" ? null : e.currentTarget.value,
                )
              }
              class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            >
              <For each={speakAsOptions()}>
                {(o) => <option value={o.characterId ?? ""}>{o.label}</option>}
              </For>
            </select>
          </label>
        </Show>
        <Show when={isGm()}>
          <label class="flex cursor-pointer items-center gap-1.5 select-none">
            <input
              type="checkbox"
              checked={gmOnly()}
              onChange={(e) => setGmOnly(e.currentTarget.checked)}
              class="h-3.5 w-3.5 cursor-pointer rounded-(--radius-control) border-border accent-accent"
            />
            <span class="font-display uppercase tracking-[0.16em]">gm only</span>
          </label>
        </Show>
      </div>

      <form
        class="flex gap-2"
        autocomplete="off"
        data-form-type="other"
        data-1p-ignore="true"
        data-lpignore="true"
        data-bwignore="true"
        onSubmit={(e) => {
          e.preventDefault();
          roll();
        }}
      >
        <input
          type="text"
          name="quick-roll-notation"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          placeholder="dice notation… (e.g. 2d6+1, 4d6kh3)"
          autocomplete="off"
          spellcheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-testid="atelier-quick-roll-input"
          class="flex-1 rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
        <button
          type="submit"
          class="rounded-(--radius-control) bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover transition"
          data-testid="atelier-quick-roll-submit"
        >
          Roll
        </button>
      </form>
    </article>
  );
}

export const QuickRollComposerFill: QuickRollComposer = {
  id: qualifiedName("@vtt/resolution/quick-roll") as QuickRollComposer["id"],
  priority: 0,
  render: (args) => QuickRollComposerBody(args) as JSX.Element,
};
