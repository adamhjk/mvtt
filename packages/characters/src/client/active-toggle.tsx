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

import type { CommandInstance } from "@vtt/substrate";
import { useClient, useTrait } from "@vtt/substrate/client";
import { createMemo, type JSX } from "solid-js";
import { Active } from "../shared/traits.js";
import { SetField } from "../shared/commands.js";

/**
 * A compact two-state pill the GM clicks to flip a character/NPC/
 * monster between Active (in play, visible in pickers) and Inactive
 * (library, hidden from pickers). Renders the same width in both
 * states so it doesn't reflow the surrounding row.
 *
 * The current value is read live from the `Active` trait. A missing
 * trait counts as `active: true` — the BC default for prod entities
 * that predate the flag. Clicking writes a `SetField` so the trait is
 * materialised and the pickers re-derive.
 *
 * Editor-gated by `Permissions` upstream: parents should only render
 * this for users who have write access to the entity. The component
 * itself doesn't gate (so it works the same in tests where the harness
 * is a GM).
 */
export function ActiveToggle(props: {
  characterId: string;
  /** Override the `data-testid` (defaults to `active-toggle-<id>`). */
  testId?: string;
  /** Optional size — `"sm"` is the list-row default, `"md"` for sheets. */
  size?: "sm" | "md";
}): JSX.Element {
  const client = useClient();
  const trait = useTrait(props.characterId, Active);
  const isActive = createMemo(() => trait()?.active !== false);
  const flip = (): void => {
    client.dispatch(
      SetField({
        characterId: props.characterId,
        trait: Active.name,
        path: ["active"],
        value: !isActive(),
      }) as CommandInstance,
    );
  };
  const padding = (): string => (props.size === "md" ? "0.3rem 0.7rem" : "0.15rem 0.5rem");
  const fontSize = (): string => (props.size === "md" ? "0.72rem" : "0.6rem");
  return (
    <button
      type="button"
      onClick={flip}
      data-testid={props.testId ?? `active-toggle-${props.characterId}`}
      aria-pressed={isActive()}
      title={
        isActive()
          ? "Active — visible in pickers. Click to hide."
          : "Inactive — hidden from pickers. Click to bring into play."
      }
      class="rounded-(--radius-control) border tabular-nums uppercase tracking-wider transition-colors"
      style={{
        padding: padding(),
        "font-family": "var(--font-display)",
        "font-size": fontSize(),
        "letter-spacing": "0.1em",
        "border-color": isActive() ? "var(--color-accent)" : "var(--color-border-muted)",
        "background-color": isActive() ? "var(--color-accent)" : "var(--color-surface-elevated)",
        color: isActive() ? "var(--color-accent-fg)" : "var(--color-fg-muted)",
      }}
    >
      {isActive() ? "Active" : "Inactive"}
    </button>
  );
}
