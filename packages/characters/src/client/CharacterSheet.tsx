import { type CommandInstance } from "@vtt/substrate";
import { useClient, useTrait } from "@vtt/substrate/client";
import { OwnedBy } from "@vtt/permissions/shared";
import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { Character } from "../shared/traits.js";
import { RenameCharacter } from "../shared/commands.js";
import {
  CharacterSheetSectionsSlot,
  type CharacterSheetSection,
} from "../shared/slot.js";
import { useMe } from "./use-me.js";

/**
 * Character sheet body. Renders the editable name at the top, then
 * stacks every section registered in `CharacterSheetSectionsSlot`
 * below it (game-system projections). With no fills, the sheet is
 * just the name.
 *
 * Rename is gated to owner-or-GM. Players who don't own this character
 * see a read-only name.
 */
export function CharacterSheet(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const character = useTrait(props.characterId, Character);
  const ownership = useTrait(props.characterId, OwnedBy);

  const canEdit = createMemo(() => {
    const m = me();
    if (!m) return false;
    if (m.role === "gm") return true;
    const o = ownership();
    return !!o && o.userId === m.userId;
  });

  const sections = createMemo<CharacterSheetSection[]>(() => {
    const fills = client.registry.fillsForSlot(
      CharacterSheetSectionsSlot,
    ) as CharacterSheetSection[];
    return [...fills].sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa;
      return a.label.localeCompare(b.label);
    });
  });

  const rename = (next: string) => {
    client.dispatch(
      RenameCharacter({
        characterId: props.characterId,
        name: next,
      }) as CommandInstance,
    );
  };

  return (
    <Show
      when={character()}
      fallback={
        <div class="flex h-full items-center justify-center text-xs text-fg-subtle">
          character not found
        </div>
      }
    >
      {(c) => (
        <div class="flex h-full flex-col gap-6 overflow-y-auto px-6 py-5">
          <header class="flex flex-col gap-2">
            <span class="font-display text-[0.6rem] uppercase tracking-[0.2em] text-fg-subtle">
              Name
            </span>
            <NameField
              value={c().name}
              disabled={!canEdit()}
              onCommit={rename}
            />
          </header>

          <Show
            when={sections().length > 0}
            fallback={
              <p class="rounded-(--radius-control) border border-dashed border-border-muted bg-surface-elevated px-4 py-6 text-center text-xs text-fg-subtle">
                no game system projected onto this character yet
              </p>
            }
          >
            <div class="flex flex-col gap-5">
              <For each={sections()}>
                {(section) => (
                  <section class="flex flex-col gap-2">
                    <h3 class="font-display text-[0.6rem] uppercase tracking-[0.2em] text-fg-subtle">
                      {section.label}
                    </h3>
                    <div>
                      {section.render({ characterId: props.characterId }) as JSX.Element}
                    </div>
                  </section>
                )}
              </For>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

/**
 * Two-way bound text field, auto-commit on blur or Enter. Same pattern
 * the scene Config tab uses: local signal for what's typed, prop-sync
 * effect that re-seeds when the trait changes from elsewhere (other
 * device, GM rename), `lastDispatched` to avoid the commit-time flash
 * during the server round-trip.
 */
function NameField(props: {
  value: string;
  disabled: boolean;
  onCommit: (next: string) => void;
}): JSX.Element {
  const [local, setLocal] = createSignal(props.value);
  const [editing, setEditing] = createSignal(false);
  let lastDispatched: string | null = null;

  createEffect(() => {
    const next = props.value;
    if (editing()) return;
    if (lastDispatched !== null) {
      if (next === lastDispatched) lastDispatched = null;
      return;
    }
    setLocal(next);
  });

  const commit = () => {
    const trimmed = local().trim();
    if (trimmed.length === 0) {
      setLocal(props.value);
      setEditing(false);
      return;
    }
    if (trimmed === props.value) {
      setEditing(false);
      return;
    }
    lastDispatched = trimmed;
    props.onCommit(trimmed);
    setEditing(false);
  };

  return (
    <input
      type="text"
      value={local()}
      maxLength={120}
      disabled={props.disabled}
      autocomplete="off"
      spellcheck={false}
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      onFocus={() => setEditing(true)}
      onInput={(e) => setLocal(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.currentTarget as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setLocal(props.value);
          setEditing(false);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 font-display text-base text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}
