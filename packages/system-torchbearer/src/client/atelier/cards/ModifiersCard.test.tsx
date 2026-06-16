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
import { buildAtelierHarness, mountTbEditor } from "../test-helpers.jsx";
import { TB_MODIFIER_CONTRIB_KIND, WillCheck } from "../../../shared/index.js";

beforeEach(() => cleanup());

describe("ModifiersCard — TB pre-roll quick mods & labelled subform", () => {
  it("renders the static quick-mod buttons (+1D, -1D, +1s, -1s)", () => {
    const { h, rollId } = buildAtelierHarness({ rollableName: WillCheck.name });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    expect(screen.getByTestId("atelier-quick-+1D")).toBeInTheDocument();
    expect(screen.getByTestId("atelier-quick-−1D")).toBeInTheDocument();
    expect(screen.getByTestId("atelier-quick-+1s")).toBeInTheDocument();
    expect(screen.getByTestId("atelier-quick-−1s")).toBeInTheDocument();
  });

  it("renders the conditional +1s on success / on fail siblings", () => {
    const { h, rollId } = buildAtelierHarness({ rollableName: WillCheck.name });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    expect(screen.getByTestId("atelier-quick-+1s on succ.")).toBeInTheDocument();
    expect(screen.getByTestId("atelier-quick-+1s on fail")).toBeInTheDocument();
  });

  it("clicking +1D dispatches ContributeToPendingRoll with a dice modifier", async () => {
    const { h, rollId } = buildAtelierHarness({ rollableName: WillCheck.name });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    fireEvent.click(screen.getByTestId("atelier-quick-+1D"));
    await waitFor(() => {
      const c = h.dispatched.find((d) => d.type === "@vtt/characters/ContributeToPendingRoll") as
        | { payload: { contribution: { payload: { kind: string; value: number; apply: string } } } }
        | undefined;
      expect(c).toBeDefined();
      expect(c!.payload.contribution.payload.kind).toBe("dice");
      expect(c!.payload.contribution.payload.value).toBe(1);
      expect(c!.payload.contribution.payload.apply).toBe("always");
    });
  });

  it("clicking +1s on success dispatches an on-success success modifier", async () => {
    const { h, rollId } = buildAtelierHarness({ rollableName: WillCheck.name });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    fireEvent.click(screen.getByTestId("atelier-quick-+1s on succ."));
    await waitFor(() => {
      const c = h.dispatched.find((d) => d.type === "@vtt/characters/ContributeToPendingRoll") as
        | { payload: { contribution: { kind: string; payload: { apply: string; kind: string } } } }
        | undefined;
      expect(c).toBeDefined();
      expect(c!.payload.contribution.kind).toBe(TB_MODIFIER_CONTRIB_KIND);
      expect(c!.payload.contribution.payload.apply).toBe("on-success");
      expect(c!.payload.contribution.payload.kind).toBe("success");
    });
  });

  it("the labelled-modifier subform submits with the typed label + value", async () => {
    const { h, rollId } = buildAtelierHarness({ rollableName: WillCheck.name });
    mountWithClient(h, () => mountTbEditor(rollId) as never);

    // Reveal the form.
    fireEvent.click(screen.getByTestId("atelier-modifier-add-toggle"));

    const valueInput = screen.getByTestId("atelier-labelled-value") as HTMLInputElement;
    const labelInput = screen.getByTestId("atelier-labelled-label") as HTMLInputElement;
    fireEvent.input(valueInput, { target: { value: "2" } });
    fireEvent.input(labelInput, { target: { value: "wise: tunnel" } });
    fireEvent.click(screen.getByTestId("atelier-labelled-submit"));

    await waitFor(() => {
      const c = h.dispatched.find((d) => d.type === "@vtt/characters/ContributeToPendingRoll") as
        | { payload: { contribution: { payload: { value: number; label: string; kind: string } } } }
        | undefined;
      expect(c).toBeDefined();
      expect(c!.payload.contribution.payload.value).toBe(2);
      expect(c!.payload.contribution.payload.label).toBe("wise: tunnel");
      expect(c!.payload.contribution.payload.kind).toBe("dice");
    });
  });

  it("rejects the labelled-modifier submission when label is empty (button disabled)", () => {
    const { h, rollId } = buildAtelierHarness({ rollableName: WillCheck.name });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    fireEvent.click(screen.getByTestId("atelier-modifier-add-toggle"));
    const submit = screen.getByTestId("atelier-labelled-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const before = h.dispatched.filter(
      (d) => d.type === "@vtt/characters/ContributeToPendingRoll",
    ).length;
    fireEvent.click(submit);
    const after = h.dispatched.filter(
      (d) => d.type === "@vtt/characters/ContributeToPendingRoll",
    ).length;
    expect(after).toBe(before);
  });

  it("hides the ±Ob quick buttons in versus mode but keeps ±D / ±s", () => {
    const { h, rollId } = buildAtelierHarness({
      rollableName: WillCheck.name,
      opts: { versusTestId: "versus:test-1" },
    });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    expect(screen.getByTestId("atelier-quick-+1D")).toBeInTheDocument();
    expect(screen.queryByTestId("atelier-quick-+1 Ob")).toBeNull();
    expect(screen.queryByTestId("atelier-quick-−1 Ob")).toBeNull();
  });
});
