import { type CommandInstance } from "@vtt/substrate";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { OwnedBy } from "@vtt/permissions/shared";
import { Identity, Online } from "@vtt/identity/shared";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
} from "solid-js";
import { Character } from "../shared/traits.js";
import { AssignCharacter, RenameCharacter } from "../shared/commands.js";
import { useMe } from "./use-me.js";
import { useWorldMembers, type WorldMember } from "./world-members.js";

/**
 * Default fill for `CharacterSheetIdentitySlot`. Renders the editable
 * name and the player-assignment dropdown that used to be at the top
 * of the legacy CharacterSheet. Game-system plugins fill the same slot
 * to add a sub-line ("Lvl 4 Ranger · Neutral Good") below.
 *
 * Owner-or-GM gating mirrors the server-side validators on
 * RenameCharacter / AssignCharacter — players who don't own this
 * character see read-only fields.
 */
export function IdentityFill(props: { characterId: string }): JSX.Element {
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

  const rename = (next: string) => {
    client.dispatch(
      RenameCharacter({
        characterId: props.characterId,
        name: next,
      }) as CommandInstance,
    );
  };

  const assign = (playerUserId: string) => {
    client.dispatch(
      AssignCharacter({
        characterId: props.characterId,
        playerUserId,
      }) as CommandInstance,
    );
  };

  return (
    <div class="flex flex-col gap-2">
      <div class="flex flex-col gap-1">
        <span class="font-display text-[0.6rem] uppercase tracking-[0.2em] text-fg-subtle">
          Name
        </span>
        <NameField
          value={character()?.name ?? ""}
          disabled={!canEdit() || !character()}
          onCommit={rename}
        />
      </div>
      <div class="flex flex-col gap-1">
        <span class="font-display text-[0.6rem] uppercase tracking-[0.2em] text-fg-subtle">
          Player
        </span>
        <PlayerField
          value={character()?.playerUserId ?? ""}
          disabled={!canEdit() || !character()}
          onCommit={assign}
        />
      </div>
    </div>
  );
}

function PlayerField(props: {
  value: string;
  disabled: boolean;
  onCommit: (next: string) => void;
}): JSX.Element {
  const [members] = useWorldMembers();
  const onlineRows = useQuery([Identity, Online]);
  const onlineUserIds = createMemo(() => {
    const set = new Set<string>();
    for (const row of onlineRows()) {
      set.add((row.values.Identity as { userId: string }).userId);
    }
    return set;
  });

  const options = createMemo<WorldMember[]>(() => {
    const m = members();
    if (!m) return [];
    const all = [m.owner, ...m.members];
    const seen = new Set<string>();
    const deduped = all.filter((x) => {
      if (seen.has(x.userId)) return false;
      seen.add(x.userId);
      return true;
    });
    deduped.sort((a, b) => a.name.localeCompare(b.name));
    if (props.value.length > 0 && !seen.has(props.value)) {
      deduped.push({
        userId: props.value,
        name: `${props.value} (no longer a member)`,
        email: "",
        role: "player",
      });
    }
    return deduped;
  });

  let selectEl!: HTMLSelectElement;

  // Membership list arrives via a separate async HTTP fetch, so on a
  // hard refresh the snapshot's `playerUserId` lands before the matching
  // <option>. Setting <select value> at that moment falls through to the
  // first option and Solid won't re-sync when the option later renders.
  // createEffect runs post-mount (so the ref is bound) and re-runs
  // whenever options() or props.value changes — re-syncing the property
  // every time the membership list arrives or the assignment moves.
  createEffect(() => {
    options();
    const want = props.value;
    if (selectEl.value !== want) selectEl.value = want;
  });

  return (
    <select
      ref={selectEl}
      disabled={props.disabled || members.loading}
      onChange={(e) => props.onCommit(e.currentTarget.value)}
      class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
    >
      <option value="">Unassigned</option>
      <For each={options()}>
        {(o) => (
          <option value={o.userId}>
            {onlineUserIds().has(o.userId) ? "• " : ""}
            {o.name}
          </option>
        )}
      </For>
    </select>
  );
}

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
