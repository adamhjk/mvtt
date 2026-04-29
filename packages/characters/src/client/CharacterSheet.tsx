import { useTrait } from "@vtt/substrate/client";
import { Show, type JSX } from "solid-js";
import { Character } from "../shared/traits.js";
import { SheetShell } from "./SheetShell.js";

/**
 * Character sheet entry point. Resolves the character entity, then
 * mounts the responsive `<SheetShell>` which projects every game
 * system's contributions into the five named regions
 * (Identity / Vitals / Status / Tabs / Actions).
 *
 * The shell is rendered even with no game-system fills — players
 * still get the editable name + player-assignment via the default
 * Identity fill.
 */
export function CharacterSheet(props: { characterId: string }): JSX.Element {
  const character = useTrait(props.characterId, Character);
  return (
    <Show
      when={character()}
      fallback={
        <div class="flex h-full items-center justify-center text-xs text-fg-subtle">
          character not found
        </div>
      }
    >
      <SheetShell characterId={props.characterId} />
    </Show>
  );
}
