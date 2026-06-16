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
import { formatLink, parseInner, parseLinks } from "./shared/wiki-link.js";

describe("parseInner", () => {
  it("default kind for unprefixed body", () => {
    expect(parseInner("Goblin Cave")).toEqual({
      kind: "note",
      body: "Goblin Cave",
      anchor: null,
      alias: null,
    });
  });

  it("explicit kind:body", () => {
    expect(parseInner("character:Krell")).toEqual({
      kind: "character",
      body: "Krell",
      anchor: null,
      alias: null,
    });
  });

  it("ignores unknown kind: when knownKinds is provided", () => {
    expect(parseInner("foo:bar", { knownKinds: new Set(["note", "character"]) })).toEqual({
      kind: "note",
      body: "foo:bar",
      anchor: null,
      alias: null,
    });
  });

  it("accepts known kind: when knownKinds is provided", () => {
    expect(
      parseInner("character:Krell", {
        knownKinds: new Set(["note", "character"]),
      }),
    ).toEqual({
      kind: "character",
      body: "Krell",
      anchor: null,
      alias: null,
    });
  });

  it("sigil prefix routes to registered kind", () => {
    expect(parseInner("@Krell", { sigils: { "@": "character" } })).toEqual({
      kind: "character",
      body: "Krell",
      anchor: null,
      alias: null,
    });
  });

  it("sigil takes precedence over kind: when both could match", () => {
    expect(parseInner("@character:foo", { sigils: { "@": "character" } })).toEqual({
      kind: "character",
      body: "character:foo",
      anchor: null,
      alias: null,
    });
  });

  it("anchor", () => {
    expect(parseInner("Goblin Cave#Tactics")).toEqual({
      kind: "note",
      body: "Goblin Cave",
      anchor: "Tactics",
      alias: null,
    });
  });

  it("alias only", () => {
    expect(parseInner("Goblin Cave|the cave")).toEqual({
      kind: "note",
      body: "Goblin Cave",
      anchor: null,
      alias: "the cave",
    });
  });

  it("anchor + alias", () => {
    expect(parseInner("note:e42#hd:abc|Tactics")).toEqual({
      kind: "note",
      body: "e42",
      anchor: "hd:abc",
      alias: "Tactics",
    });
  });

  it("trims whitespace inside brackets", () => {
    expect(parseInner("  Goblin Cave  ")).toEqual({
      kind: "note",
      body: "Goblin Cave",
      anchor: null,
      alias: null,
    });
  });

  it("rejects empty body", () => {
    expect(parseInner("")).toBeNull();
    expect(parseInner("   ")).toBeNull();
    expect(parseInner("character:")).toBeNull();
  });

  it("rejects empty body after a registered sigil", () => {
    expect(parseInner("@", { sigils: { "@": "character" } })).toBeNull();
  });

  it("treats unregistered single-char prefix as literal body", () => {
    // "@" by itself with no registered sigil is just a one-char title.
    expect(parseInner("@")).toEqual({
      kind: "note",
      body: "@",
      anchor: null,
      alias: null,
    });
  });

  it("rejects empty anchor or alias", () => {
    expect(parseInner("Goblin Cave#")).toBeNull();
    expect(parseInner("Goblin Cave|")).toBeNull();
  });

  it("custom default kind", () => {
    expect(parseInner("foo", { defaultKind: "character" })).toEqual({
      kind: "character",
      body: "foo",
      anchor: null,
      alias: null,
    });
  });
});

describe("parseLinks", () => {
  it("finds every link in source order with ranges", () => {
    const text = "See [[Goblin Cave]] and [[character:Krell|the chief]] for context.";
    const links = parseLinks(text);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({
      kind: "note",
      body: "Goblin Cave",
      embed: false,
    });
    expect(links[1]).toMatchObject({
      kind: "character",
      body: "Krell",
      alias: "the chief",
      embed: false,
    });
    expect(text.slice(...links[0]!.range)).toBe("[[Goblin Cave]]");
    expect(text.slice(...links[1]!.range)).toBe("[[character:Krell|the chief]]");
  });

  it("recognises embed prefix `!`", () => {
    const text = "Map: ![[asset:e7]]";
    const links = parseLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0]!.embed).toBe(true);
    expect(links[0]!.kind).toBe("asset");
    expect(links[0]!.body).toBe("e7");
    expect(links[0]!.range[0]).toBe(text.indexOf("!"));
  });

  it("ignores [[…]] inside fenced code blocks", () => {
    const text = "before\n```\n[[Goblin Cave]]\n```\nafter [[Real Link]]";
    const links = parseLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0]!.body).toBe("Real Link");
  });

  it("preserves [[…]] inside ```setdesign fences so backlinks see them", () => {
    const text = "intro\n```setdesign\n**Innkeeper** [[character:Marta]] -> 5sp/night\n```\n";
    const links = parseLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0]!.kind).toBe("character");
    expect(links[0]!.body).toBe("Marta");
  });

  it("ignores [[…]] inside inline backtick spans", () => {
    const text = "Use `[[Goblin Cave]]` syntax to link to [[Real Link]].";
    const links = parseLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0]!.body).toBe("Real Link");
  });

  it("doesn't split on a single `]` inside body", () => {
    const text = "Look at [[Some [bracket] thing]]";
    const links = parseLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0]!.body).toBe("Some [bracket] thing");
  });

  it("returns empty for text without links", () => {
    expect(parseLinks("Just plain prose with [single] brackets.")).toEqual([]);
  });

  it("handles two links touching", () => {
    const text = "[[a]][[b]]";
    const links = parseLinks(text);
    expect(links.map((l) => l.body)).toEqual(["a", "b"]);
  });

  it("empty inner is a no-op (no parse, no throw)", () => {
    expect(parseLinks("[[]]")).toEqual([]);
    expect(parseLinks("[[ ]]")).toEqual([]);
  });
});

describe("formatLink", () => {
  it("emits canonical normalised form", () => {
    expect(formatLink({ kind: "note", body: "e42", alias: "Goblin Cave" })).toBe(
      "[[note:e42|Goblin Cave]]",
    );
  });

  it("includes anchor when present", () => {
    expect(
      formatLink({
        kind: "note",
        body: "e42",
        anchor: "hd:abc",
        alias: "Tactics",
      }),
    ).toBe("[[note:e42#hd:abc|Tactics]]");
  });

  it("emits embed prefix when embed: true", () => {
    expect(formatLink({ kind: "asset", body: "e7", embed: true })).toBe("![[asset:e7]]");
  });

  it("round-trips with parseLinks", () => {
    const original = formatLink({
      kind: "character",
      body: "e10",
      alias: "Krell",
    });
    const parsed = parseLinks(original);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      kind: "character",
      body: "e10",
      alias: "Krell",
      embed: false,
    });
  });
});
