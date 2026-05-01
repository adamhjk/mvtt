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

import {
  buildTestClient,
  mountWithClient,
  type BuildTestClientOptions,
  type TestClientHarness,
} from "@vtt/substrate/client-testing";
import {
  definePlugin,
  type EntityId,
  type PluginDef,
} from "@vtt/substrate";
import { Identity, Online } from "@vtt/identity/shared";
import { OwnedBy } from "@vtt/permissions/shared";
import { Character } from "./shared/index.js";
import { PendingRoll } from "./shared/pending.js";
import {
  AssignCharacter,
  CancelPendingRoll,
  CommitPendingRoll,
  ContributeToPendingRoll,
  CreateCharacter,
  OpenPendingRoll,
  RemoveCharacter,
  RenameCharacter,
  SetField,
} from "./shared/commands.js";
import {
  CharacterAssigned,
  CharacterCreated,
  CharacterFieldSet,
  CharacterRemoved,
  CharacterRenamed,
  PendingRollCancelled,
  PendingRollCommitted,
  PendingRollContributed,
  PendingRollOpened,
} from "./shared/events.js";
import {
  CharacterAssignmentSystem,
  CharacterFieldSetSystem,
  CharacterRemovalSystem,
  CharacterRenameSystem,
  CharacterSpawningSystem,
  PendingRollCancelSystem,
  PendingRollCommitSystem,
  PendingRollContributionSystem,
  PendingRollSpawnSystem,
} from "./server/systems.js";
import { PendingRollContributorsSlot } from "./shared/slot.js";

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

export interface BuildCharacterHarnessOptions
  extends Omit<BuildTestClientOptions, "plugins" | "session" | "setupWorld"> {
  /**
   * Game-system / extra plugins under test, beyond the always-on
   * characters + identity + permissions infrastructure.
   */
  readonly plugins?: ReadonlyArray<PluginDef>;
  /** Owner userId of the test character. Defaults to `meUserId`. */
  readonly ownerUserId?: string;
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
  traits: [Character, OwnedBy, Identity, Online, PendingRoll],
  events: [
    CharacterCreated,
    CharacterRenamed,
    CharacterRemoved,
    CharacterAssigned,
    CharacterFieldSet,
    PendingRollOpened,
    PendingRollContributed,
    PendingRollCommitted,
    PendingRollCancelled,
  ],
  commands: [
    CreateCharacter,
    RemoveCharacter,
    RenameCharacter,
    AssignCharacter,
    SetField,
    OpenPendingRoll,
    ContributeToPendingRoll,
    CommitPendingRoll,
    CancelPendingRoll,
  ],
  systems: [
    CharacterSpawningSystem,
    CharacterRenameSystem,
    CharacterRemovalSystem,
    CharacterAssignmentSystem,
    CharacterFieldSetSystem,
    PendingRollSpawnSystem,
    PendingRollContributionSystem,
    PendingRollCommitSystem,
    PendingRollCancelSystem,
  ],
  slots: [PendingRollContributorsSlot],
});

export function buildCharacterHarness(
  opts: BuildCharacterHarnessOptions = {},
): CharacterHarness {
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
      characterId = world.spawn([
        Character({ name: opts.characterName ?? "Tarn" }),
        OwnedBy({ userId: ownerUserId }),
      ]);
      world.spawn([
        Identity({ userId: meUserId, role }),
        Online({ clientId, since: Date.now() }),
      ]);
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
