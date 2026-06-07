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
import {
  buildAtelierHarness,
  mountTbEditor,
} from "./test-helpers.jsx";
import {
  TB_DISPOSITION_CONTRIB_KIND,
  TB_VERSUS_CONTRIB_KIND,
  WillCheck,
} from "../../shared/index.js";

beforeEach(() => cleanup());

interface DispatchedContribution {
  type: string;
  payload: {
    pendingRollId: string;
    contribution: {
      kind: string;
      payload: Record<string, unknown>;
      replaces?: string;
    };
  };
}

describe("TopStrip — headline + mode switch", () => {
  it("renders the three-segment mode switch with `independent` active by default", () => {
    const { h, rollId } = buildAtelierHarness({ rollableName: WillCheck.name });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    expect(screen.getByTestId("atelier-mode-switch")).toBeInTheDocument();
    expect(screen.getByTestId("atelier-mode-independent")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("atelier-mode-versus")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("atelier-mode-disposition")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("clicking `disposition` dispatches a tb-disposition contribution and switches the variant", async () => {
    const { h, rollId } = buildAtelierHarness({ rollableName: WillCheck.name });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    fireEvent.click(screen.getByTestId("atelier-mode-disposition"));
    await waitFor(() => {
      const c = (h.dispatched as DispatchedContribution[]).find(
        (d) =>
          d.type === "@vtt/characters/ContributeToPendingRoll" &&
          d.payload.contribution.kind === TB_DISPOSITION_CONTRIB_KIND,
      );
      expect(c).toBeDefined();
      expect(c!.payload.contribution.payload.enabled).toBe(true);
      expect(c!.payload.contribution.replaces).toBe("tb:disposition");
    });
    await waitFor(() => {
      expect(screen.getByTestId("atelier-editor")).toHaveAttribute(
        "data-mode",
        "disposition",
      );
    });
  });

  it("clicking `versus` parks a fresh versus id and shows the versus variant", async () => {
    const { h, rollId } = buildAtelierHarness({ rollableName: WillCheck.name });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    fireEvent.click(screen.getByTestId("atelier-mode-versus"));
    await waitFor(() => {
      const c = (h.dispatched as DispatchedContribution[]).find(
        (d) =>
          d.type === "@vtt/characters/ContributeToPendingRoll" &&
          d.payload.contribution.kind === TB_VERSUS_CONTRIB_KIND,
      );
      expect(c).toBeDefined();
      expect(c!.payload.contribution.payload.versusTestId).toMatch(/^versus:/);
      expect(c!.payload.contribution.replaces).toBe("tb:versus");
    });
    await waitFor(() => {
      expect(screen.getByTestId("atelier-editor")).toHaveAttribute(
        "data-mode",
        "versus",
      );
    });
    // No other open roll exists, so the opponent card shows its empty state.
    expect(
      screen.getByTestId("atelier-opponent-card").textContent,
    ).toContain("no other open rolls");
  });

  it("switching from disposition back to `independent` clears the disposition flag", async () => {
    const { h, rollId } = buildAtelierHarness({ rollableName: WillCheck.name });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    fireEvent.click(screen.getByTestId("atelier-mode-disposition"));
    await waitFor(() => {
      expect(screen.getByTestId("atelier-editor")).toHaveAttribute(
        "data-mode",
        "disposition",
      );
    });
    fireEvent.click(screen.getByTestId("atelier-mode-independent"));
    await waitFor(() => {
      const offs = (h.dispatched as DispatchedContribution[]).filter(
        (d) =>
          d.type === "@vtt/characters/ContributeToPendingRoll" &&
          d.payload.contribution.kind === TB_DISPOSITION_CONTRIB_KIND &&
          d.payload.contribution.payload.enabled === false,
      );
      expect(offs.length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(screen.getByTestId("atelier-editor")).toHaveAttribute(
        "data-mode",
        "independent",
      );
    });
  });

  it("renders the initiator name + source label in the headline", () => {
    const { h, rollId } = buildAtelierHarness({ rollableName: WillCheck.name });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    const strip = screen.getByTestId("atelier-top-strip");
    // The character harness's default Character.name is "Tarn" — the
    // editor's headline reads that, not the TB-specific Identity.name.
    expect(strip.textContent).toContain("Tarn");
    expect(strip.textContent).toContain("Will");
  });
});

describe("TbAtelierEditor — slot prefix gate", () => {
  it("only attaches to TB rollables (rollablePrefix matches the namespace)", async () => {
    const { TbAtelierEditor } = await import("./TbAtelierEditor.jsx");
    expect(TbAtelierEditor.rollablePrefix).toBe("@vtt/system-torchbearer/");
  });
});
