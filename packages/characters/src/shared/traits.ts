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

import { defineTrait, z } from "@vtt/substrate";

/**
 * A player- or GM-managed character. The display name is the only
 * field the substrate cares about; game-system plugins (D&D 5e, PbtA,
 * FATE, etc.) project additional state onto a character by registering
 * their own traits and filling the `CharacterSheetSectionsSlot`. With
 * nothing projected, the sheet is just an editable name.
 *
 * Editing rights (rename / remove / set fields / roll) flow through
 * the standard `Permissions` trait: anyone listed in
 * `Permissions.write` (plus GMs by universal bypass) is the editor.
 * "Assigning a character to a player" is just adding their userId to
 * the write list — no separate `playerUserId` field. The chat
 * composer's "speak as" dropdown lists every character the user can
 * write to.
 */
export const Character = defineTrait({
  name: "@vtt/characters/Character",
  schema: z.object({
    name: z.string().min(1).max(120),
  }),
});

/**
 * Per-character uploaded token portrait. Lazily attached: the trait
 * only exists once the character has been given a token image; absent
 * means "no image yet" (the scene's character placement falls back to
 * the default creature icon).
 *
 * `imageUrl` must be a path under
 * `/plugin-data/<worldId>/@vtt/characters/characters/<characterId>/`
 * — same shape as scene backgrounds and pdf-book documents. The upload
 * endpoint stamps a `?v=<bytes>` cache-bust suffix so the browser
 * re-fetches when the GM replaces the file. Server-side validation in
 * SetCharacterTokenImage enforces the prefix to keep the trait
 * pointing at this plugin's own storage.
 *
 * `null` is allowed so a previously-set image can be cleared without
 * needing a separate "remove trait" API in the substrate.
 */
export const CharacterToken = defineTrait({
  name: "@vtt/characters/CharacterToken",
  schema: z.object({
    imageUrl: z.string().nullable(),
  }),
});

/**
 * Team affiliation — `"party"` for player-side characters,
 * `"enemy"` for NPCs / antagonists / GM-controlled entities. Used by
 * mechanics that need to query "who else is on my team" — most
 * directly, TB's disposition rolls, where per-team conditions like
 * Hungry & Thirsty / Exhausted apply once if any team member has
 * the condition (SG p.47 — "this penalty counts once, no matter
 * how many in a group are hungry and thirsty").
 *
 * Defaults to `"party"`. NPCs / monsters get switched to `"enemy"`
 * via SetField (or future creation-flow tooling). Conflicts use
 * this to partition combatants into the party / enemy sides.
 */
export const Team = defineTrait({
  name: "@vtt/characters/Team",
  schema: z
    .object({
      kind: z.enum(["party", "enemy"]).default("party"),
    })
    .default({ kind: "party" }),
});
