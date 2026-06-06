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
  WillCheck,
} from "../../shared/index.js";

beforeEach(() => cleanup());

describe("TopStrip — headline, mode badge, disposition toggle", () => {
  it("renders a disposition toggle button", () => {
    const { h, rollId } = buildAtelierHarness({ rollableName: WillCheck.name });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    expect(screen.getByTestId("atelier-disposition-toggle")).toBeInTheDocument();
  });

  it("clicking the disposition toggle dispatches a tb-disposition contribution with replaces=tb:disposition", async () => {
    const { h, rollId } = buildAtelierHarness({ rollableName: WillCheck.name });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    fireEvent.click(screen.getByTestId("atelier-disposition-toggle"));
    await waitFor(() => {
      const c = h.dispatched.find(
        (d) => d.type === "@vtt/characters/ContributeToPendingRoll",
      ) as { payload: { contribution: { kind: string; payload: { enabled: boolean }; replaces?: string } } } | undefined;
      expect(c).toBeDefined();
      expect(c!.payload.contribution.kind).toBe(TB_DISPOSITION_CONTRIB_KIND);
      expect(c!.payload.contribution.payload.enabled).toBe(true);
      expect(c!.payload.contribution.replaces).toBe("tb:disposition");
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

  it("renders an `independent` mode badge by default", () => {
    const { h, rollId } = buildAtelierHarness({ rollableName: WillCheck.name });
    mountWithClient(h, () => mountTbEditor(rollId) as never);
    expect(screen.getByTestId("atelier-mode-badge").textContent).toMatch(
      /independent/i,
    );
  });
});

describe("TbAtelierEditor — slot prefix gate", () => {
  it("only attaches to TB rollables (rollablePrefix matches the namespace)", async () => {
    const { TbAtelierEditor } = await import("./TbAtelierEditor.jsx");
    expect(TbAtelierEditor.rollablePrefix).toBe("@vtt/system-torchbearer/");
  });
});
