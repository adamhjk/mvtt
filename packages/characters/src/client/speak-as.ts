import { createMemo, createSignal, type Accessor } from "solid-js";
import { useQuery } from "@vtt/substrate/client";
import { OwnedBy } from "@vtt/permissions/shared";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { Character } from "../shared/traits.js";
import { useMe } from "./use-me.js";

/**
 * One option in the chat composer / dice roller "speak as" dropdown.
 * `characterId === null` is the "speak as the player" sentinel — every
 * authenticated user always has this option.
 */
export interface SpeakAsOption {
  readonly characterId: string | null;
  readonly label: string;
}

/**
 * Module-level store for the user's currently-selected speak-as
 * identity (an EntityId, or `null` for "speak as the player"). Shared
 * across views so picking a character in the chat composer also
 * changes which identity the dice roller attributes rolls to.
 *
 * Lives in `@vtt/characters/client` rather than `@vtt/comms` because
 * comms and resolution both depend on characters, and characters owns
 * the underlying `Character` trait — keeping the shared state here
 * avoids a cycle.
 */
const [activeSpeakerId, setActiveSpeakerId] = createSignal<string | null>(
  null,
);

export { activeSpeakerId, setActiveSpeakerId };

/**
 * Resolve the speak-as options visible to the current user: the
 * always-present "self" entry plus every Character whose
 * `playerUserId` matches the current user. Owners (often a GM running
 * NPCs) also see characters they own even if they're not the
 * assigned player. Sorted alphabetically with "self" pinned first.
 */
export function useSpeakAsOptions(): Accessor<SpeakAsOption[]> {
  const me = useMe();
  const rows = useQuery([Character, OwnedBy]);
  const presence = useQuery([Identity, Name, Online]);

  return createMemo<SpeakAsOption[]>(() => {
    const m = me();
    if (!m) return [];

    const selfLabel =
      presence()
        .map((r) => ({
          userId: (r.values.Identity as { userId: string }).userId,
          name: (r.values.Name as { value: string }).value,
        }))
        .find((p) => p.userId === m.userId)?.name ?? "myself";

    const mine: SpeakAsOption[] = [];
    for (const row of rows()) {
      const c = row.values.Character as {
        name: string;
        playerUserId?: string;
      };
      const owner = row.values.OwnedBy as { userId: string };
      const isPlayer = c.playerUserId === m.userId;
      const isOwner = owner.userId === m.userId;
      if (!isPlayer && !isOwner) continue;
      mine.push({ characterId: row.id, label: c.name });
    }
    mine.sort((a, b) => a.label.localeCompare(b.label));
    return [{ characterId: null, label: selfLabel }, ...mine];
  });
}

/**
 * Returns the EntityId currently selected, but only if it still
 * appears among the user's options — if the assigned character is
 * removed or reassigned, this falls back to `null` so the dispatched
 * command never references a stale id.
 */
export function useEffectiveSpeakerId(): Accessor<string | null> {
  const options = useSpeakAsOptions();
  return createMemo<string | null>(() => {
    const sel = activeSpeakerId();
    if (sel === null) return null;
    const found = options().find((o) => o.characterId === sel);
    return found ? sel : null;
  });
}
