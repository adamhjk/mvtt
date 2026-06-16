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
  buildTestClient,
  type BuildTestClientOptions,
  type TestClientHarness,
} from "@vtt/substrate/client-testing";
import { definePlugin, type EntityId, type PluginDef } from "@vtt/substrate";
import { Identity, Online } from "@vtt/identity/shared";
import { ownedBy, Permissions } from "@vtt/permissions/shared";
import { Character, Team } from "./shared/index.js";
import { PendingRoll } from "./shared/pending.js";
import {
  CancelPendingRoll,
  CommitPendingRoll,
  ContributeToPendingRoll,
  CreateCharacter,
  OpenPendingRoll,
  RemoveCharacter,
  RemoveContribution,
  RenameCharacter,
  SetField,
} from "./shared/commands.js";
import {
  CharacterCreated,
  CharacterFieldSet,
  CharacterRemoved,
  CharacterRenamed,
  PendingRollCancelled,
  PendingRollCommitted,
  PendingRollContributed,
  PendingRollContributionRemoved,
  PendingRollOpened,
} from "./shared/events.js";
import {
  CharacterFieldSetSystem,
  CharacterRemovalSystem,
  CharacterRenameSystem,
  CharacterSpawningSystem,
  PendingRollCancelSystem,
  PendingRollCommitSystem,
  PendingRollContributionRemoveSystem,
  PendingRollContributionSystem,
  PendingRollSpawnSystem,
} from "./server/systems.js";
import { CharacterListExclusionSlot, PendingRollContributorsSlot } from "./shared/slot.js";
import {
  PendingRollEditorsSlot,
  QuickRollComposerSlot,
  ResolvedRollFeedSlot,
  RollAtelierRailSlot,
  RollAtelierUiState,
  RollAtelierUiStateChanged,
  RollAtelierUiStateMirror,
  SetRollAtelierUiState,
} from "./shared/atelier.js";
import { GenericPendingRollEditor } from "./client/GenericRollEditor.js";

/**
 * Test harness for plugin views and kit components that bind to a
 * character. Wraps `buildTestClient` from `@vtt/substrate/client-testing`
 * with a synthetic Character + Identity + Online presence so kit hooks
 * like `useMe()` and the SetField permission gates work out of the box.
 *
 * Each plugin under test contributes itself as one entry in `plugins`;
 * the character infrastructure is added automatically. Use
 * `setupWorld` to spawn the test character's plugin-specific traits
 * (`Stats`, `Vitals`, etc.) before the test mounts the component.
 *
 * Returns the same shape `buildTestClient` returns plus `characterId`
 * and `meUserId` for convenience.
 */
export interface CharacterHarness extends TestClientHarness {
  readonly characterId: EntityId;
  readonly meUserId: string;
}

export interface BuildCharacterHarnessOptions extends Omit<
  BuildTestClientOptions,
  "plugins" | "session" | "setupWorld"
> {
  /**
   * Game-system / extra plugins under test, beyond the always-on
   * characters + identity + permissions infrastructure.
   */
  readonly plugins?: ReadonlyArray<PluginDef>;
  /** Owner userId of the test character. Defaults to `meUserId`. */
  readonly ownerUserId?: string;
  /**
   * Assigned player on the test character. Distinct from `ownerUserId`
   * so tests can exercise the GM-owns-but-player-plays case (the
   * editor-rights path that comes from `Character.playerUserId`).
   * Empty string spawns an unassigned character; omit to leave
   * `playerUserId` undefined.
   */
  readonly playerUserId?: string;
  /** Make the synthetic user a GM. Defaults to `false` (player). */
  readonly asGm?: boolean;
  /** Override the synthetic user's userId. Defaults to `"test-me"`. */
  readonly meUserId?: string;
  /** The character's display name. Defaults to `"Tarn"`. */
  readonly characterName?: string;
  /**
   * Spawn additional plugin-specific traits on the character entity
   * (e.g., `Stats({...}), Vitals({...})`). Receives the resolved
   * characterId so callers can also spawn related entities.
   */
  readonly setupWorld?: (args: {
    world: TestClientHarness["world"];
    registry: TestClientHarness["registry"];
    characterId: EntityId;
  }) => void;
}

const DEFAULT_ME_USER = "test-me";
const DEFAULT_CLIENT_ID = "test-client-1";

/**
 * Synthetic infrastructure plugin that bundles the characters package's
 * traits/events/commands/systems alongside Identity, Online, and
 * OwnedBy. Built once and reused across calls — the registry validates
 * by reference so the same plugin can be loaded by every harness.
 */
const charactersTestInfra = definePlugin({
  name: "@vtt/characters-testing",
  version: "0.0.0",
  traits: [Character, Permissions, Identity, Online, PendingRoll, Team, RollAtelierUiState],
  events: [
    CharacterCreated,
    CharacterRenamed,
    CharacterRemoved,
    CharacterFieldSet,
    PendingRollOpened,
    PendingRollContributed,
    PendingRollContributionRemoved,
    PendingRollCommitted,
    PendingRollCancelled,
    RollAtelierUiStateChanged,
  ],
  commands: [
    CreateCharacter,
    RemoveCharacter,
    RenameCharacter,
    SetField,
    OpenPendingRoll,
    ContributeToPendingRoll,
    RemoveContribution,
    CommitPendingRoll,
    CancelPendingRoll,
    SetRollAtelierUiState,
  ],
  systems: [
    CharacterSpawningSystem,
    CharacterRenameSystem,
    CharacterRemovalSystem,
    CharacterFieldSetSystem,
    PendingRollSpawnSystem,
    PendingRollContributionSystem,
    PendingRollContributionRemoveSystem,
    PendingRollCommitSystem,
    PendingRollCancelSystem,
    RollAtelierUiStateMirror,
  ],
  slots: [
    CharacterListExclusionSlot,
    PendingRollContributorsSlot,
    PendingRollEditorsSlot,
    RollAtelierRailSlot,
    ResolvedRollFeedSlot,
    QuickRollComposerSlot,
  ],
  fills: {
    [PendingRollEditorsSlot.name]: [GenericPendingRollEditor],
  },
});

export function buildCharacterHarness(opts: BuildCharacterHarnessOptions = {}): CharacterHarness {
  const meUserId = opts.meUserId ?? DEFAULT_ME_USER;
  const ownerUserId = opts.ownerUserId ?? meUserId;
  const clientId = opts.clientId ?? DEFAULT_CLIENT_ID;
  const role = opts.asGm ? "gm" : "player";

  let characterId!: EntityId;

  const harness = buildTestClient({
    plugins: [charactersTestInfra, ...(opts.plugins ?? [])],
    clientId,
    worldId: opts.worldId,
    session: {
      userId: meUserId,
      email: `${meUserId}@test.dev`,
      name: meUserId,
      role,
    },
    setupWorld: ({ world, registry }) => {
      // The harness models the new permission semantic: an "assigned"
      // player is just a userId in `Permissions.write.userIds`. If
      // `playerUserId` is supplied, we add it to the write list (in
      // addition to the owner); otherwise the owner is the sole writer.
      const writers = [ownerUserId];
      if (
        opts.playerUserId !== undefined &&
        opts.playerUserId.length > 0 &&
        !writers.includes(opts.playerUserId)
      ) {
        writers.push(opts.playerUserId);
      }
      characterId = world.spawn([
        Character({ name: opts.characterName ?? "Tarn" }),
        Permissions({
          read: { kind: "everyone" },
          write: { kind: "users", userIds: writers },
        }),
        Team({ kind: "party" }),
      ]);
      // Owner-not-also-writer reverts to default ownedBy(). The
      // explicit-writers branch above keeps single-owner harnesses
      // exactly equivalent to `ownedBy(ownerUserId)`.
      void ownedBy;
      world.spawn([Identity({ userId: meUserId, role }), Online({ clientId, since: Date.now() })]);
      if (opts.setupWorld) opts.setupWorld({ world, registry, characterId });
    },
  });

  return {
    ...harness,
    characterId,
    meUserId,
  };
}

export { mountWithClient } from "@vtt/substrate/client-testing";
export type { TestClientHarness } from "@vtt/substrate/client-testing";
