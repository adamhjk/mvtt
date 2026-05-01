// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { definePlugin } from "@vtt/substrate";
import {
  CharacterSheetActionsSlot,
  CharacterSheetIdentitySlot,
  CharacterSheetStatusSlot,
  CharacterSheetTabsSlot,
  CharacterSheetVitalsSlot,
  PendingRollContributorsSlot,
} from "@vtt/characters/shared";
import { TokenUnderlaysSlot } from "@vtt/scene/shared";
import {
  Concept,
  MaxHp,
  MaxHpChanged,
  MaxHpDerivation,
  Notes,
  StatCheck,
  Stats,
  Vitals,
} from "./shared/index.js";
import {
  ActionsFill,
  ConceptIdentityFill,
  HelpWithCharacterContributor,
  HpBarUnderlay,
  NotesTabFill,
  StatsTabFill,
  StatusFill,
  VitalsFill,
} from "./client/index.js";

/**
 * The "Simple" game system: a minimal but useful baseline. Pulls in
 * the dice tray, characters, scenes, and books — and now contributes
 * an actual character sheet projection so a world running this system
 * has a usable sheet out of the box.
 *
 * Sheet contents (all five regions filled):
 *   Identity — Concept sub-line below the framework name+player.
 *   Vitals   — current/max HP via TrackField + summary stat.
 *   Status   — condition chips list.
 *   Tabs     — "Stats" (4 dot-rated stats, each label rolls 1d6+stat)
 *              and "Notes" (free-text).
 *   Actions  — quick roll buttons for each stat.
 *
 * Demonstrates the full new substrate pipeline end-to-end:
 *   defineDerivation (MaxHp from Stats),
 *   defineRollable (StatCheck → RequestRoll),
 *   SetField + useTraitPath (every kit input writes/reads via the
 *   universal pathway),
 *   the five sheet slots collapsing responsively in SheetShell.
 */
export const systemSimple = definePlugin({
  name: "@vtt/system-simple",
  version: "0.3.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/characters@^0",
    "@vtt/dice-tray@^0",
    "@vtt/scene@^0",
    "@vtt/books@^0",
    "@vtt/pdf-book@^0",
    "@vtt/resolution@^0",
  ],
  gameSystem: true,
  traits: [Stats, Vitals, MaxHp, Notes, Concept],
  events: [MaxHpChanged],
  derivations: [MaxHpDerivation],
  rollables: [StatCheck],
  fills: {
    [CharacterSheetIdentitySlot.name]: [ConceptIdentityFill],
    [CharacterSheetVitalsSlot.name]: [VitalsFill],
    [CharacterSheetStatusSlot.name]: [StatusFill],
    [CharacterSheetTabsSlot.name]: [StatsTabFill, NotesTabFill],
    [CharacterSheetActionsSlot.name]: [ActionsFill],
    [PendingRollContributorsSlot.name]: [HelpWithCharacterContributor],
    [TokenUnderlaysSlot.name]: [HpBarUnderlay],
  },
});

export default systemSimple;
