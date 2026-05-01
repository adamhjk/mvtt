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

import { describe, it, expect } from "vitest";
import { matches, withVisibility, type Visibility, type Recipient } from "./visibility.js";
import { defineEvent, z } from "./index.js";

const Tick = defineEvent({
  name: "@test/visibility/Tick",
  schema: z.object({ n: z.number() }),
});

describe("visibility.matches", () => {
  const gm: Recipient = { userId: "u1", role: "gm" };
  const player: Recipient = { userId: "u2", role: "player" };

  it("undefined visibility means public — anyone passes", () => {
    expect(matches(undefined, gm)).toBe(true);
    expect(matches(undefined, player)).toBe(true);
    expect(matches(undefined, null)).toBe(true);
  });

  it("kind: everyone passes for any recipient (and even null)", () => {
    const v: Visibility = { kind: "everyone" };
    expect(matches(v, gm)).toBe(true);
    expect(matches(v, player)).toBe(true);
    expect(matches(v, null)).toBe(true);
  });

  it("kind: role passes only when the recipient's role matches", () => {
    const v: Visibility = { kind: "role", role: "gm" };
    expect(matches(v, gm)).toBe(true);
    expect(matches(v, player)).toBe(false);
  });

  it("kind: role denies a null recipient (no session = no permission)", () => {
    const v: Visibility = { kind: "role", role: "gm" };
    expect(matches(v, null)).toBe(false);
  });

  it("kind: users passes only for the listed userIds", () => {
    const v: Visibility = { kind: "users", userIds: ["u1", "u3"] };
    expect(matches(v, gm)).toBe(true); // u1 is in the list
    expect(matches(v, player)).toBe(false); // u2 isn't
    expect(matches(v, null)).toBe(false);
  });
});

describe("withVisibility", () => {
  it("attaches visibility without mutating the event factory's output", () => {
    const ev = Tick({ n: 1 });
    expect(ev.visibility).toBeUndefined();
    const restricted = withVisibility(ev, { kind: "role", role: "gm" });
    expect(restricted.visibility).toEqual({ kind: "role", role: "gm" });
    // The original is unchanged
    expect(ev.visibility).toBeUndefined();
    // type and payload preserved
    expect(restricted.type).toBe(ev.type);
    expect(restricted.payload).toEqual(ev.payload);
  });
});
