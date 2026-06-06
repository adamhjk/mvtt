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

import {
  definePlugin,
  type EntityId,
} from "@vtt/substrate";
import {
  buildCharacterHarness,
  type CharacterHarness,
} from "@vtt/characters/testing";
import {
  CharacterSheetIdentitySlot,
  CharacterSheetVitalsSlot,
  CharacterSheetStatusSlot,
  CharacterSheetTabsSlot,
  CharacterSheetActionsSlot,
  PendingRoll,
} from "@vtt/characters/shared";
import { ChatTimelineContributorSlot } from "@vtt/comms/shared";
import { RollActionsSlot } from "@vtt/resolution/shared";
import { ItemDetailSectionsSlot } from "@vtt/items/shared";
import { PaletteCommandsSlot } from "@vtt/shell-workbench/shared";
import { LinkKindsSlot } from "@vtt/notes/shared";
import { BlockKindsSlot } from "@vtt/adventures/shared";
import { WorkbenchChatRailSurface } from "@vtt/shell-workbench/shared";
import { Formula, RollResult, RolledBy, RequestRoll } from "@vtt/resolution/shared";
import { systemTorchbearer } from "../../manifest.js";
import {
  Identity,
  RawAbilities,
  Skills,
  TownAbilities,
  CharacterTraits,
  Conditions,
  Pools,
} from "../../shared/index.js";
import { TbAtelierEditor } from "./TbAtelierEditor.jsx";

/**
 * Sidecar plugin that registers the slots TB fills against but which
 * aren't loaded by the character harness. Mirrors `sheet-shape.test.tsx`'s
 * `sheetSlotsTestInfra` — keeps card tests honest without dragging the
 * full shell into jsdom.
 */
const atelierTestInfra = definePlugin({
  name: "@vtt/atelier-test-infra",
  version: "0.0.0",
  slots: [
    CharacterSheetIdentitySlot,
    CharacterSheetVitalsSlot,
    CharacterSheetStatusSlot,
    CharacterSheetTabsSlot,
    CharacterSheetActionsSlot,
    ChatTimelineContributorSlot,
    RollActionsSlot,
    ItemDetailSectionsSlot,
    PaletteCommandsSlot,
    LinkKindsSlot,
    BlockKindsSlot,
  ],
  surfaces: [WorkbenchChatRailSurface],
  traits: [Formula, RollResult, RolledBy],
  commands: [RequestRoll],
});

export interface AtelierTestSetupArgs {
  readonly world: CharacterHarness["world"];
  readonly characterId: EntityId;
}

export interface AtelierTestArgs {
  /** Optional GM gate. Defaults to true so the commit button renders. */
  readonly asGm?: boolean;
  /**
   * Customize Bryn's loadout. Defaults set Will 4 / Health 5 / Nature 4
   * with a Theurge build — matching `sheet-shape.test.tsx:153`'s harness
   * so the migrated tests assert against the same baseline.
   */
  readonly setup?: (args: AtelierTestSetupArgs) => void;
  /** Skills the initiator carries (rating > 0). */
  readonly skills?: Record<string, number>;
  /** Personal traits the initiator carries (CharacterTraits.entries). */
  readonly traits?: Array<{
    name: string;
    level: number;
    beneficialUses?: number;
    description?: string;
  }>;
  /** Persona / fate pool overrides. */
  readonly pools?: { fate?: number; persona?: number };
  /** Active conditions on the initiator. */
  readonly conditions?: Array<"angry" | "afraid" | "hungry" | "exhausted" | "sick" | "injured">;
  /** The rollable name to open the pending roll against. */
  readonly rollableName: string;
  /** Per-call opts passed when the PendingRoll spawned. */
  readonly opts?: Record<string, unknown>;
}

const DEFAULT_ME_USER = "test-me";

export function buildAtelierHarness(args: AtelierTestArgs): {
  h: CharacterHarness;
  rollId: EntityId;
} {
  let rollId: EntityId = "" as EntityId;
  const h = buildCharacterHarness({
    plugins: [atelierTestInfra, systemTorchbearer],
    asGm: args.asGm ?? true,
    meUserId: DEFAULT_ME_USER,
    setupWorld: ({ world, characterId }) => {
      world.set(characterId, Identity, {
        name: "Bryn",
        stock: "Human",
        class: "Theurge",
        level: 3,
        age: 23,
        home: "Highvale",
        raiment: "Brown robe",
        parents: "Tanners of Highvale",
        mentor: "Old Hertha",
        friend: "Wren",
        enemy: "Brother Olin",
      });
      world.set(characterId, RawAbilities, {
        will: { rating: 4, advancement: { pass: 0, fail: 0 } },
        health: { rating: 5, advancement: { pass: 0, fail: 0 } },
        nature: {
          rating: 4,
          maximum: 4,
          advancement: { pass: 0, fail: 0 },
          descriptors: ["Boasting", "Demanding", "Running"],
        },
      });
      if (args.skills && Object.keys(args.skills).length > 0) {
        const entries: Record<string, {
          rating: number;
          advancement: { pass: number; fail: number };
          taxed: boolean;
          learningTests: number;
        }> = {};
        for (const [id, rating] of Object.entries(args.skills)) {
          entries[id] = {
            rating,
            advancement: { pass: 0, fail: 0 },
            taxed: false,
            learningTests: 0,
          };
        }
        world.set(characterId, Skills, { entries });
      }
      if (args.traits && args.traits.length > 0) {
        world.set(characterId, CharacterTraits, {
          entries: args.traits.map((t) => ({
            name: t.name,
            level: t.level,
            beneficialUses: t.beneficialUses ?? 0,
            usedAgainst: false,
            description: t.description ?? "",
          })),
        });
      }
      if (args.pools) {
        world.set(characterId, Pools, {
          fate: { current: args.pools.fate ?? 3, maximum: 3 },
          persona: { current: args.pools.persona ?? 3, maximum: 3 },
        });
      }
      if (args.conditions && args.conditions.length > 0) {
        const C: Record<string, boolean> = {
          angry: false,
          afraid: false,
          hungry: false,
          exhausted: false,
          sick: false,
          injured: false,
          fresh: false,
        };
        for (const c of args.conditions) C[c] = true;
        world.set(characterId, Conditions, C as never);
      }
      world.set(characterId, TownAbilities, {
        resources: { rating: 0, advancement: { pass: 0, fail: 0 }, taxed: false },
        circles: { rating: 0, advancement: { pass: 0, fail: 0 }, taxed: false },
      });
      args.setup?.({ world, characterId });
      rollId = world.allocateId();
      world.spawnAt(rollId, [
        PendingRoll({
          initiatorUserId: DEFAULT_ME_USER,
          initiatorCharacterId: characterId,
          rollableName: args.rollableName,
          opts: args.opts ?? {},
          contributions: [],
          openedAt: Date.now(),
        }),
      ]);
    },
  });
  return { h, rollId };
}

export function mountTbEditor(rollId: EntityId): unknown {
  return TbAtelierEditor.render({ rollId });
}
