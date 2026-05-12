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
import * as YAML from "js-yaml";
import { prepareYaml, restoreWikiLinks } from "./shared/yaml-wikilinks.js";

function roundTrip(body: string): unknown {
  const { body: safe, table } = prepareYaml(body);
  const parsed = YAML.load(safe);
  return restoreWikiLinks(parsed, table);
}

describe("prepareYaml / restoreWikiLinks", () => {
  it("lets bare [[item:x]] in a list parse as a string", () => {
    const body = "carries:\n  - [[item:hammer]]\n  - [[item:chain shirt]]";
    expect(roundTrip(body)).toEqual({
      carries: ["[[item:hammer]]", "[[item:chain shirt]]"],
    });
  });

  it("preserves the alias form [[item:e485|Mace]]", () => {
    const body = "carries:\n  - [[item:e485|Mace]]";
    expect(roundTrip(body)).toEqual({ carries: ["[[item:e485|Mace]]"] });
  });

  it("handles wiki-links as mapping values", () => {
    const body = "carries:\n  - item: [[item:hammer]]\n    slot: handR";
    expect(roundTrip(body)).toEqual({
      carries: [{ item: "[[item:hammer]]", slot: "handR" }],
    });
  });

  it("preserves the embed marker on ![[asset:…]]", () => {
    const body = "portrait: ![[asset:abc123]]";
    expect(roundTrip(body)).toEqual({ portrait: "![[asset:abc123]]" });
  });

  it("supports the quantifier prefix `2× [[item:x]]`", () => {
    const body = "carries:\n  - 2× [[item:ration]]";
    expect(roundTrip(body)).toEqual({ carries: ["2× [[item:ration]]"] });
  });

  it("does not touch values without a wiki-link", () => {
    const body = "name: Skarra\nlevel: 4";
    expect(roundTrip(body)).toEqual({ name: "Skarra", level: 4 });
  });

  it("handles a previously-quoted wiki-link (backwards-compat)", () => {
    const body = 'carries:\n  - "[[item:hammer]]"';
    expect(roundTrip(body)).toEqual({ carries: ["[[item:hammer]]"] });
  });

  it("preserves multiple links in document order", () => {
    const body =
      "carries:\n  - [[item:a]]\n  - [[item:b]]\n  - [[item:c]]";
    expect(roundTrip(body)).toEqual({
      carries: ["[[item:a]]", "[[item:b]]", "[[item:c]]"],
    });
  });
});
