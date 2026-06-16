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

import { describe, expect, it } from "vitest";
import type { CommandInstance, CommandName, EntityId } from "@vtt/substrate";
import {
  ROLL_ATELIER_KIND,
  RollAtelierUiState,
  RollAtelierUiStateChanged,
  RollAtelierUiStateMirror,
  SetRollAtelierUiState,
  tagRollWithOrigin,
} from "./atelier.js";

describe("@vtt/characters atelier shared surface", () => {
  it("page kind constant is the plugin-namespaced id", () => {
    expect(ROLL_ATELIER_KIND).toBe("@vtt/characters/roll-atelier");
  });

  it("RollAtelierUiState accepts defaults", () => {
    const parsed = RollAtelierUiState.schema.parse(undefined);
    expect(parsed.selectedRollId).toBeNull();
    expect(parsed.railCollapsed).toBe(false);
  });

  it("RollAtelierUiState accepts a partial — required selectedRollId may be null", () => {
    const parsed = RollAtelierUiState.schema.parse({
      selectedRollId: null,
      railCollapsed: true,
    });
    expect(parsed.selectedRollId).toBeNull();
    expect(parsed.railCollapsed).toBe(true);
  });

  it("RollAtelierUiState rejects non-null non-string selection", () => {
    expect(() =>
      RollAtelierUiState.schema.parse({
        selectedRollId: 42,
        railCollapsed: false,
      }),
    ).toThrow();
  });

  it("SetRollAtelierUiState validate is a pass-through ok()", () => {
    const cmd = SetRollAtelierUiState({
      entityId: "tab-sentinel:tab-1" as never,
      value: { selectedRollId: null, railCollapsed: false },
    });
    expect(cmd.type).toBe("@vtt/characters/SetRollAtelierUiState");
  });

  it("RollAtelierUiStateChanged is transient + broadcast", () => {
    expect(RollAtelierUiStateChanged.transient).toBe(true);
    expect(RollAtelierUiStateChanged.broadcast).toBe(true);
  });

  it("Mirror system writes the trait on event", () => {
    expect(RollAtelierUiStateMirror.name).toBe("RollAtelierUiStateMirror");
    expect(RollAtelierUiStateMirror.writes).toContain(RollAtelierUiState);
  });

  it("RollAtelierUiState defaults quickRollOpen for pre-existing sentinels", () => {
    const parsed = RollAtelierUiState.schema.parse({
      selectedRollId: null,
      railCollapsed: false,
    });
    expect(parsed.quickRollOpen).toBe(false);
  });
});

describe("tagRollWithOrigin", () => {
  const PENDING = "pending-1" as EntityId;
  const cmd = (payload: unknown): CommandInstance => ({
    type: "@x/Roll" as CommandName,
    payload,
  });

  it("stamps originPendingRollId into meta when the command has none", () => {
    const out = tagRollWithOrigin(cmd({ notation: "1d20" }), PENDING);
    expect(out.type).toBe("@x/Roll");
    expect(out.payload).toEqual({
      notation: "1d20",
      meta: { originPendingRollId: PENDING },
    });
  });

  it("preserves existing meta siblings (e.g. a TB spec)", () => {
    const out = tagRollWithOrigin(
      cmd({ notation: "3d6", meta: { system: "tb", spec: { kind: "skill" } } }),
      PENDING,
    );
    const meta = (out.payload as { meta: Record<string, unknown> }).meta;
    expect(meta).toEqual({
      system: "tb",
      spec: { kind: "skill" },
      originPendingRollId: PENDING,
    });
  });

  it("does not mutate the input command", () => {
    const input = cmd({ notation: "1d20", meta: { system: "tb" } });
    tagRollWithOrigin(input, PENDING);
    expect(input.payload).toEqual({ notation: "1d20", meta: { system: "tb" } });
  });

  it("ignores a non-object meta rather than spreading it", () => {
    const out = tagRollWithOrigin(cmd({ notation: "1d20", meta: "weird" }), PENDING);
    expect((out.payload as { meta: unknown }).meta).toEqual({
      originPendingRollId: PENDING,
    });
  });
});
