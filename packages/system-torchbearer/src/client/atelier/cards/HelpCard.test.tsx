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
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import { mountWithClient } from "@vtt/substrate/client-testing";
import { type EntityId } from "@vtt/substrate";
import { Character } from "@vtt/characters/shared";
import { Permissions, everyone } from "@vtt/permissions/shared";
import {
  buildAtelierHarness,
  mountTbEditor,
} from "../test-helpers.jsx";
import {
  RawAbilities,
  Skills,
  SkillCheck,
  TB_MODIFIER_CONTRIB_KIND,
} from "../../../shared/index.js";

beforeEach(() => cleanup());

interface HelperSetup {
  skills: Record<string, number>;
  will?: number;
  health?: number;
  nature?: number;
}

function buildHelpHarness(helper: HelperSetup) {
  let helperId: EntityId = "" as EntityId;
  const { h, rollId } = buildAtelierHarness({
    rollableName: SkillCheck.name,
    opts: { skillId: "fighter" },
    // Bryn (the initiator) carries Fighter 4 so the help roll has a kind.
    skills: { fighter: 4 },
    setup: ({ world }) => {
      helperId = world.allocateId();
      world.spawnAt(helperId, [
        Character({ name: "Tarn" }),
        Permissions({ read: everyone(), write: everyone() }),
      ]);
      const entries: Record<string, {
        rating: number;
        advancement: { pass: number; fail: number };
        taxed: boolean;
        learningTests: number;
      }> = {};
      for (const [id, rating] of Object.entries(helper.skills)) {
        entries[id] = {
          rating,
          advancement: { pass: 0, fail: 0 },
          taxed: false,
          learningTests: 0,
        };
      }
      world.set(helperId, Skills, { entries });
      world.set(helperId, RawAbilities, {
        will: { rating: helper.will ?? 0, advancement: { pass: 0, fail: 0 } },
        health: { rating: helper.health ?? 0, advancement: { pass: 0, fail: 0 } },
        nature: {
          rating: helper.nature ?? 0,
          maximum: helper.nature ?? 0,
          advancement: { pass: 0, fail: 0 },
          descriptors: [],
        },
      });
    },
  });
  return { h, rollId, helperId };
}

describe("HelpCard — TB helper roster (DH p.37)", () => {
  it("renders the Help & companions header with the suggested-help citation for skill rolls", () => {
    const { h, rollId } = buildHelpHarness({ skills: { hunter: 3 } });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    const card = screen.getByTestId("atelier-help-card");
    // Fighter's printed Help: line is "Hunter" (DH p.249).
    expect(card.textContent).toContain("suggested:");
    expect(card.textContent).toContain("Hunter");
    expect(card.textContent).toContain("DH p.37");
  });

  it("a peer with the suggested help skill exposes a +1D help button that dispatches a tb-modifier", async () => {
    const { h, rollId, helperId } = buildHelpHarness({ skills: { hunter: 3 } });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    const row = screen.getByTestId(`atelier-help-row-${helperId}`);
    expect(row.textContent).toContain("Tarn");
    const btn = screen.getByTestId(`atelier-help-btn-${helperId}`);
    fireEvent.click(btn);
    await waitFor(() => {
      const c = h.dispatched.find(
        (d) => d.type === "@vtt/characters/ContributeToPendingRoll",
      ) as
        | {
            payload: {
              contribution: {
                kind: string;
                replaces?: string;
                payload: {
                  source: string;
                  kind: string;
                  value: number;
                  providedBy: string;
                  label: string;
                };
              };
            };
          }
        | undefined;
      expect(c).toBeDefined();
      expect(c!.payload.contribution.kind).toBe(TB_MODIFIER_CONTRIB_KIND);
      expect(c!.payload.contribution.replaces).toBe(`tb:help:${helperId}`);
      expect(c!.payload.contribution.payload.source).toBe("help");
      expect(c!.payload.contribution.payload.kind).toBe("dice");
      expect(c!.payload.contribution.payload.value).toBe(1);
      expect(c!.payload.contribution.payload.providedBy).toBe(
        `help:${helperId}:skill:hunter`,
      );
      expect(c!.payload.contribution.payload.label).toContain(
        "Tarn helps with Hunter 3",
      );
    });
  });

  it("a peer without an eligible skill still gets a 'per GM' button for negotiated help (DH p.37)", async () => {
    const { h, rollId, helperId } = buildHelpHarness({ skills: { cook: 4 } });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    // No automatic +1D help button — Cook isn't in Fighter's suggestedHelp.
    expect(screen.queryByTestId(`atelier-help-btn-${helperId}`)).toBeNull();
    const gmBtn = screen.getByTestId(`atelier-help-gm-btn-${helperId}`);
    fireEvent.click(gmBtn);
    await waitFor(() => {
      const c = h.dispatched.find(
        (d) => d.type === "@vtt/characters/ContributeToPendingRoll",
      ) as
        | {
            payload: {
              contribution: {
                payload: { providedBy: string; label: string; source: string };
              };
            };
          }
        | undefined;
      expect(c).toBeDefined();
      expect(c!.payload.contribution.payload.source).toBe("help");
      expect(c!.payload.contribution.payload.providedBy).toBe(
        `help:${helperId}:skill:cook`,
      );
      expect(c!.payload.contribution.payload.label).toContain("(per GM)");
    });
  });

  it("filters peers with no usable skill or ability rating (DH p.37 'Rating 0 Help')", () => {
    const { h, rollId, helperId } = buildHelpHarness({ skills: {} });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    expect(
      screen.queryByTestId(`atelier-help-row-${helperId}`),
    ).toBeNull();
    expect(screen.getByTestId("atelier-help-card").textContent).toContain(
      "none of your characters can help",
    );
  });
});
