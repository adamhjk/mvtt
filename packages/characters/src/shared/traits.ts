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

import { defineTrait, EntityId, z } from "@vtt/substrate";

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
 * **Asset-first storage**: the canonical field is `assetId`, pointing
 * at an `Asset` entity in the world. New uploads go through
 * `POST /api/worlds/<wid>/assets/upload`, then `SetCharacterTokenImage`
 * records the returned assetId here.
 *
 * `imageUrl` is the legacy field — entities materialised before the
 * asset-first refactor carry a path like
 * `/plugin-data/<worldId>/@vtt/characters/characters/<characterId>/token.png?v=<bytes>`.
 * Readers prefer `assetId` and fall back to `imageUrl` when assetId is
 * null. Both fields are independently nullable so re-uploading a new
 * portrait clears imageUrl and writes assetId in the same set.
 *
 * Helper: use `resolveCharacterTokenUrl(token, worldId)` from
 * `@vtt/characters/shared` to centralise the precedence logic.
 */
export const CharacterToken = defineTrait({
  name: "@vtt/characters/CharacterToken",
  schema: z.object({
    /** Asset entity carrying the portrait bytes (canonical). */
    assetId: EntityId.nullable().default(null),
    /**
     * Legacy raw URL under `/plugin-data/<wid>/@vtt/characters/...`.
     * Pre-refactor entities carried this directly; new uploads leave
     * it null and write `assetId`. Kept for BC — readers fall back
     * here only when assetId is null.
     */
    imageUrl: z.string().nullable().default(null),
  }),
});

/**
 * Active flag — whether this character/NPC/monster is currently "in
 * play" and should appear in pickers (helper roster on a pending roll,
 * conflict-declare party/enemy chips, switch-team list, etc.).
 *
 * Catalogs and adventure imports materialise large sets of NPC and
 * monster entities up front so wiki-links / quantified spawns work
 * without per-encounter ceremony. Without filtering, every picker
 * shows the entire library and the fuzzy-lookups in particular lose
 * their usefulness. `Active` is the picker filter: pickers hide
 * inactive entries; library pages (Monsters, NPCs) keep showing
 * everything and surface a per-row toggle.
 *
 * Backwards compatibility: prod entities predating this trait don't
 * carry it. Readers must treat *missing* trait as `active: true` so
 * existing characters keep appearing in every picker. The
 * `isActive(world, id)` helper does this normalisation.
 */
export const Active = defineTrait({
  name: "@vtt/characters/Active",
  schema: z
    .object({
      active: z.boolean().default(true),
    })
    .default({ active: true }),
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
