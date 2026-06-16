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
import { describe, expect, it, beforeEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { mountWithClient } from "@vtt/substrate/client-testing";
import type { EntityId } from "@vtt/substrate";
import { Character, PendingRoll } from "@vtt/characters/shared";
import { Formula, RolledBy, RollResult } from "@vtt/resolution/shared";
import { buildAtelierHarness, mountTbEditor } from "../test-helpers.jsx";
import {
  TB_DISPOSITION_CONTRIB_KIND,
  TB_ROLL_META_SYSTEM,
  TB_VERSUS_CONTRIB_KIND,
  WillCheck,
  type TbRollSpec,
} from "../../../shared/index.js";

beforeEach(() => cleanup());

interface DispatchedContribution {
  type: string;
  payload: {
    pendingRollId: string;
    contribution: {
      kind: string;
      payload: { versusTestId?: string | null };
      replaces?: string;
    };
  };
}

/**
 * Harness with a second open TB pending roll (initiated by a second
 * character, "Grim") so the opponent card has a pair candidate.
 */
function buildTwoRollHarness(): {
  h: ReturnType<typeof buildAtelierHarness>["h"];
  rollId: EntityId;
  otherRollId: EntityId;
} {
  let otherRollId: EntityId = "" as EntityId;
  const { h, rollId } = buildAtelierHarness({
    rollableName: WillCheck.name,
    setup: ({ world }) => {
      const otherCharId = world.allocateId();
      world.spawnAt(otherCharId, [Character({ name: "Grim" })]);
      otherRollId = world.allocateId();
      world.spawnAt(otherRollId, [
        PendingRoll({
          initiatorUserId: "other-user",
          initiatorCharacterId: otherCharId,
          rollableName: WillCheck.name,
          opts: {},
          contributions: [],
          openedAt: Date.now(),
        }),
      ]);
    },
  });
  return { h, rollId, otherRollId };
}

function versusDispatches(h: { dispatched: unknown[] }): DispatchedContribution[] {
  return (h.dispatched as DispatchedContribution[]).filter(
    (d) =>
      d.type === "@vtt/characters/ContributeToPendingRoll" &&
      d.payload.contribution.kind === TB_VERSUS_CONTRIB_KIND,
  );
}

describe("OpponentCard — pair-with flow in the roll screen", () => {
  it("selecting versus lists the other open TB roll as a pair candidate", async () => {
    const { h, rollId, otherRollId } = buildTwoRollHarness();
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    fireEvent.click(screen.getByTestId("atelier-mode-versus"));
    await waitFor(() => {
      const card = screen.getByTestId("atelier-opponent-card");
      expect(card.textContent).toContain("Grim");
      expect(screen.getByTestId(`atelier-opponent-pair-${otherRollId}`)).toBeInTheDocument();
    });
    // Versus selected but nobody paired yet — no unpair affordance.
    expect(screen.queryByTestId("atelier-opponent-unpair")).not.toBeInTheDocument();
  });

  it("clicking pair dispatches matching tb-versus contributions to both rolls", async () => {
    const { h, rollId, otherRollId } = buildTwoRollHarness();
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    fireEvent.click(screen.getByTestId("atelier-mode-versus"));
    await waitFor(() => screen.getByTestId(`atelier-opponent-pair-${otherRollId}`));
    fireEvent.click(screen.getByTestId(`atelier-opponent-pair-${otherRollId}`));
    await waitFor(() => {
      // The two most recent versus dispatches carry the pairing: one to
      // each roll, sharing a single fresh versus id.
      const vs = versusDispatches(h);
      const last2 = vs.slice(-2);
      expect(last2).toHaveLength(2);
      const ids = last2.map((d) => d.payload.contribution.payload.versusTestId);
      expect(ids[0]).toMatch(/^versus:/);
      expect(ids[0]).toBe(ids[1]);
      const targets = last2.map((d) => d.payload.pendingRollId).sort();
      expect(targets).toEqual([rollId, otherRollId].sort());
    });
    // The card flips to the partner summary once the pairing lands:
    // who you're paired with + what they're testing — never their pool.
    await waitFor(() => {
      const partner = screen.getByTestId("atelier-opponent-partner");
      expect(partner.textContent).toContain("Grim");
      expect(screen.getByTestId("atelier-opponent-source").textContent).toMatch(/^testing /);
    });
    expect(screen.queryByTestId("atelier-opponent-pool")).not.toBeInTheDocument();
  });

  it("unpair clears the pairing on BOTH rolls", async () => {
    const { h, rollId, otherRollId } = buildTwoRollHarness();
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    fireEvent.click(screen.getByTestId("atelier-mode-versus"));
    await waitFor(() => screen.getByTestId(`atelier-opponent-pair-${otherRollId}`));
    fireEvent.click(screen.getByTestId(`atelier-opponent-pair-${otherRollId}`));
    // Wait for the partner summary — proof the pairing landed on the peer,
    // not just that an unpaired versus id exists on our roll.
    await waitFor(() => screen.getByTestId("atelier-opponent-partner"));
    fireEvent.click(screen.getByTestId("atelier-opponent-unpair"));
    await waitFor(() => {
      const clears = versusDispatches(h).filter(
        (d) => d.payload.contribution.payload.versusTestId === null,
      );
      const targets = clears.map((d) => d.payload.pendingRollId).sort();
      expect(targets).toEqual([rollId, otherRollId].sort());
    });
  });

  it("keeps the pairing visible after the opponent commits first", async () => {
    const VERSUS_ID = "versus:already-rolled";
    const rolledSpec: TbRollSpec = {
      kind: "skill",
      source: "Fighter",
      sourceId: "fighter",
      baseDice: 4,
      pool: 4,
      bonusSuccesses: 0,
      heroic: false,
      successTarget: 4,
      baseObstacle: null,
      obstacle: null,
      modifiers: [],
      caption: "Grim — Fighter (versus)",
      versusTestId: VERSUS_ID,
    };
    const { h, rollId } = buildAtelierHarness({
      rollableName: WillCheck.name,
      // Our roll already carries the pairing key (opts fallback).
      opts: { versusTestId: VERSUS_ID },
      setup: ({ world }) => {
        // The opponent's side has already been rolled: no PendingRoll,
        // just the spawned Roll entity carrying the same versusTestId.
        const rolledId = world.allocateId();
        world.spawnAt(rolledId, [
          Formula({
            notation: "4d6>=4",
            reason: "Grim — Fighter",
            meta: { system: TB_ROLL_META_SYSTEM, spec: rolledSpec },
          }),
          RollResult({ total: 2, output: "x", rolledAt: 50, dice: [] }),
          RolledBy({ userId: "other-user", displayName: "Grim" }),
        ]);
      },
    });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    await waitFor(() => {
      const committed = screen.getByTestId("atelier-opponent-committed");
      expect(committed.textContent).toContain("Grim");
      expect(committed.textContent).toContain("waiting on you");
    });
    // Still in versus mode, and NOT offering a re-pair that would orphan
    // the committed half.
    expect(screen.getByTestId("atelier-editor")).toHaveAttribute("data-mode", "versus");
    expect(screen.queryByText(/pair with:/)).not.toBeInTheDocument();
  });

  it("switching a paired roll to disposition unpairs both rolls first", async () => {
    const { h, rollId, otherRollId } = buildTwoRollHarness();
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    fireEvent.click(screen.getByTestId("atelier-mode-versus"));
    await waitFor(() => screen.getByTestId(`atelier-opponent-pair-${otherRollId}`));
    fireEvent.click(screen.getByTestId(`atelier-opponent-pair-${otherRollId}`));
    await waitFor(() => screen.getByTestId("atelier-opponent-partner"));
    fireEvent.click(screen.getByTestId("atelier-mode-disposition"));
    await waitFor(() => {
      const clears = versusDispatches(h).filter(
        (d) => d.payload.contribution.payload.versusTestId === null,
      );
      const targets = clears.map((d) => d.payload.pendingRollId).sort();
      expect(targets).toEqual([rollId, otherRollId].sort());
      const dispo = (h.dispatched as DispatchedContribution[]).find(
        (d) =>
          d.type === "@vtt/characters/ContributeToPendingRoll" &&
          d.payload.contribution.kind === TB_DISPOSITION_CONTRIB_KIND,
      );
      expect(dispo).toBeDefined();
    });
    await waitFor(() => {
      expect(screen.getByTestId("atelier-editor")).toHaveAttribute("data-mode", "disposition");
    });
  });
});
