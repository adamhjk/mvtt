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
import { EditorState } from "@codemirror/state";
import { isInsideSetdesignFence } from "./client/CodeMirrorEditor.jsx";

function stateAt(body: string, caretChar: string = "|"): {
  state: EditorState;
  pos: number;
} {
  const pos = body.indexOf(caretChar);
  if (pos < 0) throw new Error("caret marker not found in test body");
  const doc = body.slice(0, pos) + body.slice(pos + caretChar.length);
  return { state: EditorState.create({ doc }), pos };
}

describe("isInsideSetdesignFence", () => {
  it("returns false in plain prose with no fence above", () => {
    const { state, pos } = stateAt("some prose\nmore prose|\n");
    expect(isInsideSetdesignFence(state, pos)).toBe(false);
  });

  it("returns true when cursor is on a content line inside a ```setdesign block", () => {
    const { state, pos } = stateAt(
      ["```setdesign", "**Door** -> locked|", "```"].join("\n"),
    );
    expect(isInsideSetdesignFence(state, pos)).toBe(true);
  });

  it("returns false when the closing fence has been crossed", () => {
    const { state, pos } = stateAt(
      [
        "```setdesign",
        "**Door** -> locked",
        "```",
        "after the block|",
      ].join("\n"),
    );
    expect(isInsideSetdesignFence(state, pos)).toBe(false);
  });

  it("returns false inside a different-language fence", () => {
    const { state, pos } = stateAt(
      ["```ts", "const x = 1|;", "```"].join("\n"),
    );
    expect(isInsideSetdesignFence(state, pos)).toBe(false);
  });

  it("returns false on the fence opener line itself", () => {
    const { state, pos } = stateAt(["```setdesign|", "x", "```"].join("\n"));
    expect(isInsideSetdesignFence(state, pos)).toBe(false);
  });

  it("matches setdesign with surrounding whitespace in the info string", () => {
    const { state, pos } = stateAt(
      ["```setdesign  ", "**Door**|", "```"].join("\n"),
    );
    expect(isInsideSetdesignFence(state, pos)).toBe(true);
  });

  it("handles multiple sequential blocks correctly", () => {
    const { state, pos } = stateAt(
      [
        "```setdesign",
        "first block",
        "```",
        "",
        "```ts",
        "code|",
        "```",
      ].join("\n"),
    );
    expect(isInsideSetdesignFence(state, pos)).toBe(false);
  });
});
