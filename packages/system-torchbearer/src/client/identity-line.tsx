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

import { qualifiedName } from "@vtt/substrate";
import type { CharacterSheetRegion } from "@vtt/characters/shared";
import { useTrait } from "@vtt/substrate/client";
import { createMemo, type JSX } from "solid-js";
import { Identity } from "../shared/index.js";

/**
 * Identity sub-line under the framework name+token portrait. Pure
 * display — Stock · Class · Lvl N. Editing happens on the Who You
 * Are tab where every field has its own labeled input.
 */
function IdentityLine(props: { characterId: string }): JSX.Element {
  const identity = useTrait(props.characterId, Identity);
  const summary = createMemo(() => {
    const v = identity();
    if (!v) return null;
    const stock = v.stock?.trim() ?? "";
    const klass = v.class?.trim() ?? "";
    const level = v.level ?? 1;
    const parts: string[] = [];
    if (stock) parts.push(stock);
    if (klass) parts.push(klass);
    parts.push(`Lvl ${level}`);
    return parts.join(" · ");
  });

  return (
    <div
      style={{
        "font-family": "var(--font-display)",
        "font-size": "0.95rem",
        color: "var(--color-fg-muted)",
      }}
    >
      {summary() ?? "—"}
    </div>
  );
}

export const TbIdentityFill: CharacterSheetRegion = {
  id: qualifiedName("@vtt/system-torchbearer/identity-line") as CharacterSheetRegion["id"],
  // Below the default name+token fill (priority 100) so the sub-line
  // sits underneath the name without elbowing it aside.
  priority: 50,
  render: ({ characterId }) => IdentityLine({ characterId }),
};
