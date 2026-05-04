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

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, cleanup, fireEvent } from "@solidjs/testing-library";
import {
  buildTestClient,
  mountWithClient,
} from "@vtt/substrate/client-testing";
import { type EntityId } from "@vtt/substrate";
import { ownedBy, Permissions } from "@vtt/permissions/shared";
import { Identity, Online } from "@vtt/identity/shared";
import { shellWorkbench } from "@vtt/shell-workbench";
import { notes } from "@vtt/notes";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { characters } from "@vtt/characters";
import { Character, CharacterToken } from "@vtt/characters/shared";
import { scene } from "./manifest.js";
import { Scene, LinkedCharacter, Position, TokenImage } from "./shared/traits.js";
import { CharactersOverlayTab } from "./client/CharactersOverlayTab.js";
import { PlaceCharacterToken } from "./shared/commands.js";

beforeEach(() => cleanup());

const TEST_CLIENT_ID = "test-client-1";

const ME_GM = {
  userId: "gm-1",
  email: "gm@test.dev",
  name: "GM",
  role: "gm" as const,
};

const ME_PLAYER = {
  userId: "player-1",
  email: "p@test.dev",
  name: "Player",
  role: "player" as const,
};

interface SeedOpts {
  session: typeof ME_GM | typeof ME_PLAYER;
  characters: Array<{ name: string; ownerUserId: string; imageUrl?: string | null }>;
  placedOnSceneCharacterIds?: string[];
}

/**
 * Build a test client preloaded with one Scene + the requested
 * Characters, plus an Online row that maps `useMe()` back to the
 * provided session. Returns the seeded scene id and an array of the
 * spawned character ids in the order requested.
 */
function harness(opts: SeedOpts) {
  let sceneId!: EntityId;
  const characterIds: EntityId[] = [];
  const h = buildTestClient({
    plugins: [shellWorkbench, notes, identity, permissions, characters, scene],
    session: opts.session,
    clientId: TEST_CLIENT_ID,
    setupWorld: ({ world }) => {
      sceneId = world.spawn([
        Scene({
          name: "Tomb",
          gridSize: 70,
          widthPx: 700,
          heightPx: 700,
          backgroundColor: "#1a1a1a",
          gridColor: "#2a2a2a",
          backgroundImage: null,
        }),
      ]);
      // Online entity for `useMe()` → role lookup. The IdentityFill /
      // CharactersOverlayTab share the substrate's me-resolution
      // pattern: match Online.clientId against client.clientId().
      world.spawn([
        Identity({
          userId: opts.session.userId,
          role: opts.session.role,
        }),
        Online({ clientId: TEST_CLIENT_ID, since: 0 }),
      ]);
      for (const c of opts.characters) {
        const id = world.spawn([
          Character({ name: c.name }),
          Permissions(ownedBy(c.ownerUserId)),
        ]);
        if (c.imageUrl !== undefined) {
          world.set(id, CharacterToken, { imageUrl: c.imageUrl });
        }
        characterIds.push(id);
      }
      // Pre-place a subset of characters so we can test the
      // place-once disabled state. The placement is shaped like the
      // CharacterTokenPlacementSystem's spawn — a token entity with
      // LinkedCharacter + Position(sceneId).
      for (const placedId of opts.placedOnSceneCharacterIds ?? []) {
        world.spawn([
          LinkedCharacter({ characterId: placedId as EntityId }),
          Position({
            sceneId,
            x: 0,
            y: 0,
            rotation: 0,
            movedAt: 0,
          }),
        ]);
      }
    },
  });
  return { ...h, sceneId, characterIds };
}

describe("CharactersOverlayTab", () => {
  it("lists every character in the world by name", () => {
    const h = harness({
      session: ME_GM,
      characters: [
        { name: "Tarn", ownerUserId: ME_PLAYER.userId },
        { name: "Brom", ownerUserId: ME_GM.userId },
      ],
    });
    mountWithClient(h, () =>
      CharactersOverlayTab.render({ sceneId: h.sceneId }) as never,
    );
    expect(screen.getByText("Tarn")).toBeInTheDocument();
    expect(screen.getByText("Brom")).toBeInTheDocument();
  });

  it("clicking a character dispatches PlaceCharacterToken with the right shape", () => {
    const h = harness({
      session: ME_GM,
      characters: [
        {
          name: "Tarn",
          ownerUserId: ME_PLAYER.userId,
          imageUrl: "/plugin-data/test-world/@vtt/characters/characters/x/token.png?v=1",
        },
      ],
    });
    mountWithClient(h, () =>
      CharactersOverlayTab.render({ sceneId: h.sceneId }) as never,
    );
    fireEvent.click(screen.getByRole("button", { name: /Tarn/i }));
    const dispatched = h.dispatched.filter(
      (c) => c.type === PlaceCharacterToken.name,
    );
    expect(dispatched).toHaveLength(1);
    const payload = dispatched[0]!.payload as {
      sceneId: string;
      characterId: string;
      label: string;
      imageUrl: string | null;
    };
    expect(payload.sceneId).toBe(h.sceneId);
    expect(payload.characterId).toBe(h.characterIds[0]);
    expect(payload.label).toBe("Tarn");
    expect(payload.imageUrl).toBe(
      "/plugin-data/test-world/@vtt/characters/characters/x/token.png?v=1",
    );
  });

  it("disables the button for an already-placed character (place-once UX)", () => {
    const h = harness({
      session: ME_GM,
      characters: [{ name: "Tarn", ownerUserId: ME_PLAYER.userId }],
      placedOnSceneCharacterIds: undefined, // populated below by id
    });
    // Place after we know the ids.
    h.world.spawn([
      LinkedCharacter({ characterId: h.characterIds[0]! }),
      Position({
        sceneId: h.sceneId,
        x: 0,
        y: 0,
        rotation: 0,
        movedAt: 0,
      }),
    ]);
    mountWithClient(h, () =>
      CharactersOverlayTab.render({ sceneId: h.sceneId }) as never,
    );
    const button = screen.getByRole("button", { name: /Tarn/i });
    expect(button).toBeDisabled();
    // Click is suppressed by the disabled attribute; no dispatch.
    fireEvent.click(button);
    const dispatched = h.dispatched.filter(
      (c) => c.type === PlaceCharacterToken.name,
    );
    expect(dispatched).toHaveLength(0);
  });

  it("disables placement for players who don't own the character", () => {
    const h = harness({
      session: ME_PLAYER,
      characters: [{ name: "OtherSomeone", ownerUserId: "other-player" }],
    });
    mountWithClient(h, () =>
      CharactersOverlayTab.render({ sceneId: h.sceneId }) as never,
    );
    const button = screen.getByRole("button", { name: /OtherSomeone/i });
    expect(button).toBeDisabled();
  });

  it("after the placement command completes, the button reflects the placed state", async () => {
    const h = harness({
      session: ME_GM,
      characters: [{ name: "Tarn", ownerUserId: ME_GM.userId }],
    });
    mountWithClient(h, () =>
      CharactersOverlayTab.render({ sceneId: h.sceneId }) as never,
    );
    const button = screen.getByRole("button", { name: /Tarn/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    // The harness pipes commands through a real CommandPipeline; the
    // resulting CharacterTokenPlaced event spawns the linked-token
    // entity, and the tab's reactive query re-renders the button as
    // disabled.
    await Promise.resolve();
    await Promise.resolve();
    const after = screen.getByRole("button", { name: /Tarn/i });
    expect(after).toBeDisabled();
    // And the world should now have a TokenImage-less linked token —
    // we passed null imageUrl in this test, so no TokenImage trait.
    const placed = h.world.query([LinkedCharacter, Position]);
    expect(placed).toHaveLength(1);
    expect(h.world.get(placed[0]!.id, [TokenImage])).toBeUndefined();
  });
});
