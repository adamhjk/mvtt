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
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import {
  AdvancementTrack,
  computeAdvancement,
  EntryListField,
  EntryRowsField,
  LabeledLadder,
  Tabs,
} from "./client/kit.js";
import {
  buildCharacterHarness,
  mountWithClient,
  type CharacterHarness,
} from "./testing.js";
import { defineTrait, definePlugin, z } from "@vtt/substrate";
import { SetField } from "./shared/commands.js";

beforeEach(() => {
  cleanup();
});

/* -------------------------------------------------------------------------
 * Tabs primitive — the keyed-Show fix
 * ----------------------------------------------------------------------- */

describe("kit/Tabs", () => {
  it("renders the first tab's body by default", () => {
    render(() => (
      <Tabs
        tabs={[
          { id: "a", label: "Alpha", render: () => <p>alpha-body</p> },
          { id: "b", label: "Beta", render: () => <p>beta-body</p> },
        ]}
      />
    ));
    expect(screen.getByText("alpha-body")).toBeInTheDocument();
    expect(screen.queryByText("beta-body")).toBeNull();
  });

  it("clicking a different tab swaps the body", () => {
    // Regression: previously the body used `<Show when={X}>` without
    // `keyed`, so the inner render fn ran once at first-truthy and the
    // body never updated when activeId changed between truthy values.
    render(() => (
      <Tabs
        tabs={[
          { id: "a", label: "Alpha", render: () => <p>alpha-body</p> },
          { id: "b", label: "Beta", render: () => <p>beta-body</p> },
          { id: "c", label: "Gamma", render: () => <p>gamma-body</p> },
        ]}
      />
    ));

    fireEvent.click(screen.getByRole("tab", { name: "Beta" }));
    expect(screen.queryByText("alpha-body")).toBeNull();
    expect(screen.getByText("beta-body")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Gamma" }));
    expect(screen.queryByText("beta-body")).toBeNull();
    expect(screen.getByText("gamma-body")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Alpha" }));
    expect(screen.queryByText("gamma-body")).toBeNull();
    expect(screen.getByText("alpha-body")).toBeInTheDocument();
  });

  it("aria-selected reflects the active tab", () => {
    render(() => (
      <Tabs
        tabs={[
          { id: "a", label: "Alpha", render: () => <p>a</p> },
          { id: "b", label: "Beta", render: () => <p>b</p> },
        ]}
      />
    ));
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(screen.getByRole("tab", { name: "Beta" }));
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "true");
  });

  it("sorts tabs by descending priority (ties by label)", () => {
    render(() => (
      <Tabs
        tabs={[
          { id: "low", label: "Low", priority: 10, render: () => <p>l</p> },
          { id: "z", label: "Zed", priority: 50, render: () => <p>z</p> },
          { id: "a", label: "Alpha", priority: 50, render: () => <p>a</p> },
          { id: "high", label: "High", priority: 100, render: () => <p>h</p> },
        ]}
      />
    ));
    const order = screen.getAllByRole("tab").map((b) => b.textContent);
    expect(order).toEqual(["High", "Alpha", "Zed", "Low"]);
  });

  it("renders the empty-state when given no tabs", () => {
    render(() => (
      <Tabs
        tabs={[]}
        emptyState={<p data-testid="empty">no tabs yet</p>}
      />
    ));
    expect(screen.getByTestId("empty")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("scrolls the bar into view on switch when bar is sticky", () => {
    // Inside SheetShell the tab bar is `position: sticky` pinned under
    // the identity header. When the user is scrolled deep into the
    // previous tab and picks a new one, we want the new tab read from
    // its top — not from wherever the prior scroll happened to be.
    // Tabs detects the sticky bar at click time and calls
    // scrollIntoView({block:'start'}); SheetShell's scroll-margin-top
    // accounts for the identity bar's height.
    render(() => (
      <Tabs
        tabs={[
          { id: "a", label: "A", render: () => <p>a</p> },
          { id: "b", label: "B", render: () => <p>b</p> },
        ]}
      />
    ));
    const bar = document.querySelector(".vk-tabs__bar") as HTMLElement;
    bar.style.position = "sticky";
    const spy = vi.fn();
    bar.scrollIntoView = spy;
    fireEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ block: "start" });
  });

  it("does NOT scroll on switch when bar is static (non-shell consumers)", () => {
    // Outside SheetShell (or inside it on desktop where the @container
    // override resets position to static), the bar isn't sticky and the
    // tab body has its own overflow:auto — switching mounts a fresh
    // body at scrollTop:0, no scroll-back needed. Calling
    // scrollIntoView there would yank the page unexpectedly.
    render(() => (
      <Tabs
        tabs={[
          { id: "a", label: "A", render: () => <p>a</p> },
          { id: "b", label: "B", render: () => <p>b</p> },
        ]}
      />
    ));
    const bar = document.querySelector(".vk-tabs__bar") as HTMLElement;
    // Default: position is "static" (kit's default rule sets nothing,
    // and jsdom returns "static" via the initial value).
    const spy = vi.fn();
    bar.scrollIntoView = spy;
    fireEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("re-mounts the body on each switch (not just toggling visibility)", () => {
    // `keyed` semantics: clicking the same tab again is a no-op, but
    // clicking a different tab mounts fresh JSX. Verify by checking
    // each tab's body has unique content, only one node at a time.
    render(() => (
      <Tabs
        tabs={[
          { id: "a", label: "A", render: () => <span data-testid="body">A-content</span> },
          { id: "b", label: "B", render: () => <span data-testid="body">B-content</span> },
        ]}
      />
    ));
    expect(screen.getAllByTestId("body")).toHaveLength(1);
    expect(screen.getByTestId("body")).toHaveTextContent("A-content");
    fireEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(screen.getAllByTestId("body")).toHaveLength(1);
    expect(screen.getByTestId("body")).toHaveTextContent("B-content");
  });
});

/* -------------------------------------------------------------------------
 * LabeledLadder — bound to a record-shaped trait
 * ----------------------------------------------------------------------- */

const Conditions = defineTrait({
  name: "@test/kit/LadderConditions",
  schema: z
    .object({
      a: z.boolean().default(false),
      b: z.boolean().default(false),
      c: z.boolean().default(false),
    })
    .default({ a: false, b: false, c: false }),
});

const ladderTestPlugin = definePlugin({
  name: "@vtt/kit-ladder-test",
  version: "0.0.0",
  traits: [Conditions],
});

function ladderHarness(opts?: { asGm?: boolean }): CharacterHarness {
  return buildCharacterHarness({
    plugins: [ladderTestPlugin],
    asGm: opts?.asGm,
    setupWorld: ({ world, characterId }) => {
      world.set(characterId, Conditions, { a: false, b: true, c: false });
    },
  });
}

describe("kit/LabeledLadder", () => {
  it("renders a labeled chip per item, with a tooltip when provided", () => {
    const h = ladderHarness({ asGm: true });
    mountWithClient(h, () => (
      <LabeledLadder
        characterId={h.characterId}
        trait={Conditions}
        items={[
          { id: "a", label: "Alpha", hint: "first item" },
          { id: "b", label: "Beta" },
          { id: "c", label: "Gamma", tone: "danger" },
        ]}
        ariaLabel="Test ladder"
      />
    ));
    const root = screen.getByRole("group", { name: "Test ladder" });
    expect(root).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
    const alphaLabel = screen.getByText("Alpha").closest("label")!;
    expect(alphaLabel).toHaveAttribute("title", "first item");
    const gammaLabel = screen.getByText("Gamma").closest("label")!;
    expect(gammaLabel).toHaveAttribute("data-tone", "danger");
  });

  it("reflects the trait's current state on each checkbox", () => {
    const h = ladderHarness({ asGm: true });
    mountWithClient(h, () => (
      <LabeledLadder
        characterId={h.characterId}
        trait={Conditions}
        items={[
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
        ]}
      />
    ));
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[0]!.checked).toBe(false);
    expect(checkboxes[1]!.checked).toBe(true); // b was true in setup
    expect(checkboxes[2]!.checked).toBe(false);
  });

  it("clicking an unchecked item dispatches SetField with path=[item.id], value=true", () => {
    const h = ladderHarness({ asGm: true });
    mountWithClient(h, () => (
      <LabeledLadder
        characterId={h.characterId}
        trait={Conditions}
        items={[
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ]}
      />
    ));
    const aCheckbox = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    fireEvent.click(aCheckbox);

    const dispatched = h.dispatched as Array<{ type: string; payload: unknown }>;
    const sets = dispatched.filter((d) => d.type === SetField.name);
    expect(sets.length).toBeGreaterThanOrEqual(1);
    const last = sets[sets.length - 1]!.payload as {
      trait: string;
      path: Array<string>;
      value: unknown;
    };
    expect(last.trait).toBe(Conditions.name);
    expect(last.path).toEqual(["a"]);
    expect(last.value).toBe(true);
  });

  it("respects a custom pathFor mapper", () => {
    const h = ladderHarness({ asGm: true });
    mountWithClient(h, () => (
      <LabeledLadder
        characterId={h.characterId}
        trait={Conditions}
        items={[
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ]}
        pathFor={(item) => ["nested", item.id]}
      />
    ));
    const aCheckbox = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    fireEvent.click(aCheckbox);
    const dispatched = h.dispatched as Array<{ type: string; payload: unknown }>;
    const last = dispatched.filter((d) => d.type === SetField.name).slice(-1)[0]!
      .payload as { path: Array<string> };
    expect(last.path).toEqual(["nested", "a"]);
  });

  it("disables checkboxes when requires='gm' and the user is a player", () => {
    const h = ladderHarness({ asGm: false });
    mountWithClient(h, () => (
      <LabeledLadder
        characterId={h.characterId}
        trait={Conditions}
        items={[{ id: "a", label: "A" }]}
        requires="gm"
      />
    ));
    const cb = screen.getByRole("checkbox") as HTMLInputElement;
    expect(cb.disabled).toBe(true);
  });
});

/* -------------------------------------------------------------------------
 * computeAdvancement formula (DH p.108)
 * ----------------------------------------------------------------------- */

describe("kit/computeAdvancement", () => {
  it("rating ≤ 1 needs 1 P, 0 F (Resources/Circles 0→1, Rating 1 special case)", () => {
    expect(computeAdvancement(0)).toEqual({ passNeeded: 1, failNeeded: 0 });
    expect(computeAdvancement(1)).toEqual({ passNeeded: 1, failNeeded: 0 });
  });

  it("rating ≥ 2 needs P=rating, F=rating-1", () => {
    expect(computeAdvancement(2)).toEqual({ passNeeded: 2, failNeeded: 1 });
    expect(computeAdvancement(3)).toEqual({ passNeeded: 3, failNeeded: 2 });
    expect(computeAdvancement(4)).toEqual({ passNeeded: 4, failNeeded: 3 });
    expect(computeAdvancement(5)).toEqual({ passNeeded: 5, failNeeded: 4 });
    expect(computeAdvancement(6)).toEqual({ passNeeded: 6, failNeeded: 5 });
  });

  it("works at the upper bounds (Resources/Circles cap of 10)", () => {
    expect(computeAdvancement(9)).toEqual({ passNeeded: 9, failNeeded: 8 });
    expect(computeAdvancement(10)).toEqual({ passNeeded: 10, failNeeded: 9 });
  });
});

/* -------------------------------------------------------------------------
 * AdvancementTrack — bound to a trait, derives bubble counts
 * ----------------------------------------------------------------------- */

const RatedSkill = defineTrait({
  name: "@test/kit/RatedSkill",
  schema: z
    .object({
      rating: z.number().int().min(0).default(0),
      advancement: z
        .object({
          pass: z.number().int().min(0).default(0),
          fail: z.number().int().min(0).default(0),
        })
        .default({ pass: 0, fail: 0 }),
    })
    .default({ rating: 0, advancement: { pass: 0, fail: 0 } }),
});

const advanceTestPlugin = definePlugin({
  name: "@vtt/kit-advance-test",
  version: "0.0.0",
  traits: [RatedSkill],
});

function advanceHarness(
  setup: { rating: number; pass?: number; fail?: number },
  asGm = true,
): CharacterHarness {
  return buildCharacterHarness({
    plugins: [advanceTestPlugin],
    asGm,
    setupWorld: ({ world, characterId }) => {
      world.set(characterId, RatedSkill, {
        rating: setup.rating,
        advancement: { pass: setup.pass ?? 0, fail: setup.fail ?? 0 },
      });
    },
  });
}

describe("kit/AdvancementTrack", () => {
  it("rating 1: shows 1 P bubble and an em-dash for the F row", () => {
    const h = advanceHarness({ rating: 1 });
    mountWithClient(h, () => (
      <AdvancementTrack
        characterId={h.characterId}
        trait={RatedSkill}
        passPath={["advancement", "pass"]}
        failPath={["advancement", "fail"]}
        rating={1}
      />
    ));
    // P track: exactly 1 dot.
    const dotGroups = screen.getAllByRole("group");
    // First group is the P row's DotsField (DotsField uses role=group).
    // The F row renders an em-dash placeholder, not a DotsField.
    const dots = dotGroups[0]!.querySelectorAll(".vk-dot");
    expect(dots).toHaveLength(1);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("rating 3: shows 3 P bubbles and 2 F bubbles", () => {
    const h = advanceHarness({ rating: 3, pass: 2, fail: 1 });
    mountWithClient(h, () => (
      <AdvancementTrack
        characterId={h.characterId}
        trait={RatedSkill}
        passPath={["advancement", "pass"]}
        failPath={["advancement", "fail"]}
        rating={3}
      />
    ));
    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(2);
    expect(groups[0]!.querySelectorAll(".vk-dot")).toHaveLength(3);
    expect(groups[1]!.querySelectorAll(".vk-dot")).toHaveLength(2);
    // 2 of 3 P dots filled; 1 of 2 F dots filled.
    expect(groups[0]!.querySelectorAll(".vk-dot--filled")).toHaveLength(2);
    expect(groups[1]!.querySelectorAll(".vk-dot--filled")).toHaveLength(1);
  });

  it("clicking a P bubble dispatches SetField with the pass path", () => {
    const h = advanceHarness({ rating: 4 });
    mountWithClient(h, () => (
      <AdvancementTrack
        characterId={h.characterId}
        trait={RatedSkill}
        passPath={["advancement", "pass"]}
        failPath={["advancement", "fail"]}
        rating={4}
      />
    ));
    const groups = screen.getAllByRole("group");
    const passDots = Array.from(groups[0]!.querySelectorAll(".vk-dot"));
    expect(passDots).toHaveLength(4);
    // Click the 3rd dot — DotsField sets the value to that level.
    fireEvent.click(passDots[2]!);

    const dispatched = h.dispatched as Array<{ type: string; payload: unknown }>;
    const last = dispatched.filter((d) => d.type === SetField.name).slice(-1)[0]!
      .payload as { trait: string; path: Array<string>; value: unknown };
    expect(last.path).toEqual(["advancement", "pass"]);
    expect(last.value).toBe(3);
  });

  it("clicking an F bubble dispatches SetField with the fail path", () => {
    const h = advanceHarness({ rating: 3 });
    mountWithClient(h, () => (
      <AdvancementTrack
        characterId={h.characterId}
        trait={RatedSkill}
        passPath={["advancement", "pass"]}
        failPath={["advancement", "fail"]}
        rating={3}
      />
    ));
    const groups = screen.getAllByRole("group");
    const failDots = Array.from(groups[1]!.querySelectorAll(".vk-dot"));
    fireEvent.click(failDots[1]!);
    const dispatched = h.dispatched as Array<{ type: string; payload: unknown }>;
    const last = dispatched.filter((d) => d.type === SetField.name).slice(-1)[0]!
      .payload as { path: Array<string>; value: unknown };
    expect(last.path).toEqual(["advancement", "fail"]);
    expect(last.value).toBe(2);
  });

  it("track length tracks the rating prop reactively", () => {
    // Bumping the rating prop changes how many bubbles each row shows
    // — the kit derives `passNeeded` / `failNeeded` from the live
    // rating, not a frozen snapshot.
    const h = advanceHarness({ rating: 2 });
    const [rating, setRating] = createSignal(2);
    mountWithClient(h, () => (
      <AdvancementTrack
        characterId={h.characterId}
        trait={RatedSkill}
        passPath={["advancement", "pass"]}
        failPath={["advancement", "fail"]}
        rating={rating()}
      />
    ));
    let groups = screen.getAllByRole("group");
    expect(groups[0]!.querySelectorAll(".vk-dot")).toHaveLength(2);
    expect(groups[1]!.querySelectorAll(".vk-dot")).toHaveLength(1);

    setRating(5);
    groups = screen.getAllByRole("group");
    expect(groups[0]!.querySelectorAll(".vk-dot")).toHaveLength(5);
    expect(groups[1]!.querySelectorAll(".vk-dot")).toHaveLength(4);
  });
});

/* -------------------------------------------------------------------------
 * EntryListField — pill / tag editor bound to a string[] trait path
 * ----------------------------------------------------------------------- */

const TagsTrait = defineTrait({
  name: "@test/kit/Tags",
  schema: z
    .object({
      values: z.array(z.string().min(1).max(40)).default([]),
    })
    .default({ values: [] }),
});

const tagsTestPlugin = definePlugin({
  name: "@vtt/kit-tags-test",
  version: "0.0.0",
  traits: [TagsTrait],
});

function tagsHarness(initial: string[], asGm = true): CharacterHarness {
  return buildCharacterHarness({
    plugins: [tagsTestPlugin],
    asGm,
    setupWorld: ({ world, characterId }) => {
      world.set(characterId, TagsTrait, { values: initial });
    },
  });
}

function tagsRoot(): HTMLElement {
  const region = document.querySelector(".vk-tags") as HTMLElement | null;
  if (!region) throw new Error("expected .vk-tags region");
  return region;
}

function tagsInput(): HTMLInputElement {
  const input = tagsRoot().querySelector(
    "input.vk-tags__input",
  ) as HTMLInputElement | null;
  if (!input) throw new Error("expected .vk-tags__input");
  return input;
}

describe("kit/EntryListField", () => {
  it("renders each entry as a pill in order", () => {
    const h = tagsHarness(["alpha", "beta", "gamma"]);
    mountWithClient(h, () => (
      <EntryListField
        characterId={h.characterId}
        trait={TagsTrait}
        path={["values"]}
      />
    ));
    const texts = Array.from(tagsRoot().querySelectorAll(".vk-tag__text"))
      .map((n) => n.textContent);
    expect(texts).toEqual(["alpha", "beta", "gamma"]);
  });

  it("Enter commits the input and dispatches SetField with the new array", () => {
    const h = tagsHarness(["alpha"]);
    mountWithClient(h, () => (
      <EntryListField
        characterId={h.characterId}
        trait={TagsTrait}
        path={["values"]}
      />
    ));
    const input = tagsInput();
    fireEvent.input(input, { target: { value: "beta" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect(cmd).toBeDefined();
    expect((cmd!.payload as { value: string[] }).value).toEqual(["alpha", "beta"]);
  });

  it("comma key also commits the entry", () => {
    const h = tagsHarness([]);
    mountWithClient(h, () => (
      <EntryListField
        characterId={h.characterId}
        trait={TagsTrait}
        path={["values"]}
      />
    ));
    const input = tagsInput();
    fireEvent.input(input, { target: { value: "first" } });
    fireEvent.keyDown(input, { key: "," });
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect(cmd).toBeDefined();
    expect((cmd!.payload as { value: string[] }).value).toEqual(["first"]);
  });

  it("trims whitespace before committing", () => {
    const h = tagsHarness([]);
    mountWithClient(h, () => (
      <EntryListField
        characterId={h.characterId}
        trait={TagsTrait}
        path={["values"]}
      />
    ));
    const input = tagsInput();
    fireEvent.input(input, { target: { value: "  spaced  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect((cmd!.payload as { value: string[] }).value).toEqual(["spaced"]);
  });

  it("ignores blank / whitespace-only commits", () => {
    const h = tagsHarness(["alpha"]);
    mountWithClient(h, () => (
      <EntryListField
        characterId={h.characterId}
        trait={TagsTrait}
        path={["values"]}
      />
    ));
    const input = tagsInput();
    fireEvent.input(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(h.dispatched.find((c) => c.type === SetField.name)).toBeUndefined();
  });

  it("rejects duplicates by default", () => {
    const h = tagsHarness(["alpha"]);
    mountWithClient(h, () => (
      <EntryListField
        characterId={h.characterId}
        trait={TagsTrait}
        path={["values"]}
      />
    ));
    const input = tagsInput();
    fireEvent.input(input, { target: { value: "alpha" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(h.dispatched.find((c) => c.type === SetField.name)).toBeUndefined();
  });

  it("allowDuplicates=true permits identical entries", () => {
    const h = tagsHarness(["alpha"]);
    mountWithClient(h, () => (
      <EntryListField
        characterId={h.characterId}
        trait={TagsTrait}
        path={["values"]}
        allowDuplicates
      />
    ));
    const input = tagsInput();
    fireEvent.input(input, { target: { value: "alpha" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect(cmd).toBeDefined();
    expect((cmd!.payload as { value: string[] }).value).toEqual(["alpha", "alpha"]);
  });

  it("clicking × on a pill removes that entry", () => {
    const h = tagsHarness(["alpha", "beta", "gamma"]);
    mountWithClient(h, () => (
      <EntryListField
        characterId={h.characterId}
        trait={TagsTrait}
        path={["values"]}
      />
    ));
    fireEvent.click(screen.getByLabelText("remove beta"));
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect((cmd!.payload as { value: string[] }).value).toEqual(["alpha", "gamma"]);
  });

  it("backspace on empty input removes the trailing entry", () => {
    const h = tagsHarness(["alpha", "beta"]);
    mountWithClient(h, () => (
      <EntryListField
        characterId={h.characterId}
        trait={TagsTrait}
        path={["values"]}
      />
    ));
    const input = tagsInput();
    expect(input.value).toBe("");
    fireEvent.keyDown(input, { key: "Backspace" });
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect((cmd!.payload as { value: string[] }).value).toEqual(["alpha"]);
  });

  it("blur with non-empty input commits", () => {
    const h = tagsHarness([]);
    mountWithClient(h, () => (
      <EntryListField
        characterId={h.characterId}
        trait={TagsTrait}
        path={["values"]}
      />
    ));
    const input = tagsInput();
    fireEvent.input(input, { target: { value: "drift" } });
    fireEvent.blur(input);
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect((cmd!.payload as { value: string[] }).value).toEqual(["drift"]);
  });

  it("rejects entries longer than maxEntryLength", () => {
    const h = tagsHarness([]);
    mountWithClient(h, () => (
      <EntryListField
        characterId={h.characterId}
        trait={TagsTrait}
        path={["values"]}
        maxEntryLength={5}
      />
    ));
    const input = tagsInput();
    expect(input.maxLength).toBe(5);
    // The input also enforces maxLength via the DOM, but our trim
    // path also bails defensively. Force a long value via a direct
    // assignment + keyDown:
    fireEvent.input(input, { target: { value: "longer-than-five" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(h.dispatched.find((c) => c.type === SetField.name)).toBeUndefined();
  });

  it("non-editor: hides input + remove buttons, shows '—' when empty", () => {
    const h = tagsHarness([], false);
    mountWithClient(h, () => (
      <EntryListField
        characterId={h.characterId}
        trait={TagsTrait}
        path={["values"]}
        requires="gm"
      />
    ));
    expect(tagsRoot().querySelector("input")).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("non-editor with entries: pills render without × buttons", () => {
    const h = tagsHarness(["alpha", "beta"], false);
    mountWithClient(h, () => (
      <EntryListField
        characterId={h.characterId}
        trait={TagsTrait}
        path={["values"]}
        requires="gm"
      />
    ));
    expect(tagsRoot().querySelector(".vk-tag__remove")).toBeNull();
    expect(tagsRoot().querySelector("input")).toBeNull();
    const texts = Array.from(tagsRoot().querySelectorAll(".vk-tag__text"))
      .map((n) => n.textContent);
    expect(texts).toEqual(["alpha", "beta"]);
  });
});

/* -------------------------------------------------------------------------
 * EntryRowsField — structured-row editor bound to an array-of-objects
 * ----------------------------------------------------------------------- */

interface RelationshipEntry extends Record<string, unknown> {
  name: string;
  location: string;
  level: number;
  active: boolean;
}

const RelationshipsTrait = defineTrait({
  name: "@test/kit/Relationships",
  schema: z
    .object({
      entries: z
        .array(
          z.object({
            name: z.string().min(1).max(80),
            location: z.string().max(80).default(""),
            level: z.number().int().min(0).max(10).default(0),
            active: z.boolean().default(false),
          }),
        )
        .default([]),
    })
    .default({ entries: [] }),
});

const rowsTestPlugin = definePlugin({
  name: "@vtt/kit-rows-test",
  version: "0.0.0",
  traits: [RelationshipsTrait],
});

function rowsHarness(initial: RelationshipEntry[], asGm = true): CharacterHarness {
  return buildCharacterHarness({
    plugins: [rowsTestPlugin],
    asGm,
    setupWorld: ({ world, characterId }) => {
      world.set(characterId, RelationshipsTrait, { entries: initial });
    },
  });
}

const RELATIONSHIP_COLUMNS = [
  { key: "name", type: "text", label: "Name", placeholder: "who" },
  { key: "location", type: "text", label: "Location", placeholder: "where" },
  { key: "level", type: "number", label: "Lv", min: 0, max: 10, width: "4rem" },
  { key: "active", type: "check", label: "✓", width: "3rem", align: "center" },
] as const;

function rowsRoot(): HTMLElement {
  const r = document.querySelector(".vk-rows") as HTMLElement | null;
  if (!r) throw new Error("expected .vk-rows region");
  return r;
}

function addInput(): HTMLInputElement {
  const i = rowsRoot().querySelector(".vk-rows__add-input") as HTMLInputElement | null;
  if (!i) throw new Error("expected .vk-rows__add-input");
  return i;
}

describe("kit/EntryRowsField", () => {
  it("renders header with each column label", () => {
    const h = rowsHarness([]);
    mountWithClient(h, () => (
      <EntryRowsField<RelationshipEntry>
        characterId={h.characterId}
        trait={RelationshipsTrait}
        path={["entries"]}
        columns={RELATIONSHIP_COLUMNS}
        seedEntry={(name) => ({ name, location: "", level: 0, active: false })}
      />
    ));
    const heads = Array.from(rowsRoot().querySelectorAll(".vk-rows__head"))
      .map((n) => n.textContent?.trim() ?? "")
      .filter((t) => t.length > 0);
    expect(heads).toEqual(["Name", "Location", "Lv", "✓"]);
  });

  it("empty state shows the configured emptyHint", () => {
    const h = rowsHarness([]);
    mountWithClient(h, () => (
      <EntryRowsField<RelationshipEntry>
        characterId={h.characterId}
        trait={RelationshipsTrait}
        path={["entries"]}
        columns={RELATIONSHIP_COLUMNS}
        seedEntry={(name) => ({ name, location: "", level: 0, active: false })}
        emptyHint="no relationships yet"
      />
    ));
    expect(screen.getByText("no relationships yet")).toBeInTheDocument();
  });

  it("renders each existing entry as a row with all configured cells", () => {
    const h = rowsHarness([
      { name: "Wren", location: "Highvale", level: 2, active: true },
      { name: "Olin", location: "Cathedral", level: 1, active: false },
    ]);
    mountWithClient(h, () => (
      <EntryRowsField<RelationshipEntry>
        characterId={h.characterId}
        trait={RelationshipsTrait}
        path={["entries"]}
        columns={RELATIONSHIP_COLUMNS}
        seedEntry={(name) => ({ name, location: "", level: 0, active: false })}
      />
    ));
    const rows = rowsRoot().querySelectorAll(".vk-rows__row");
    expect(rows).toHaveLength(2);
    expect((rows[0]!.querySelectorAll("input")[0] as HTMLInputElement).value).toBe("Wren");
    expect((rows[0]!.querySelectorAll("input")[1] as HTMLInputElement).value).toBe(
      "Highvale",
    );
    expect((rows[0]!.querySelectorAll("input")[2] as HTMLInputElement).value).toBe("2");
    expect((rows[0]!.querySelectorAll("input")[3] as HTMLInputElement).checked).toBe(true);
  });

  it("typing in the add input + Enter dispatches SetField with seeded entry", () => {
    const h = rowsHarness([]);
    mountWithClient(h, () => (
      <EntryRowsField<RelationshipEntry>
        characterId={h.characterId}
        trait={RelationshipsTrait}
        path={["entries"]}
        columns={RELATIONSHIP_COLUMNS}
        seedEntry={(name) => ({ name, location: "", level: 0, active: false })}
        addPlaceholder="add relationship…"
      />
    ));
    const input = addInput();
    fireEvent.input(input, { target: { value: "Bryn" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect(cmd).toBeDefined();
    expect((cmd!.payload as { value: RelationshipEntry[] }).value).toEqual([
      { name: "Bryn", location: "", level: 0, active: false },
    ]);
  });

  it("blank add-row input does not dispatch on Enter", () => {
    const h = rowsHarness([]);
    mountWithClient(h, () => (
      <EntryRowsField<RelationshipEntry>
        characterId={h.characterId}
        trait={RelationshipsTrait}
        path={["entries"]}
        columns={RELATIONSHIP_COLUMNS}
        seedEntry={(name) => ({ name, location: "", level: 0, active: false })}
      />
    ));
    const input = addInput();
    fireEvent.input(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(h.dispatched.find((c) => c.type === SetField.name)).toBeUndefined();
  });

  it("editing a text cell + Enter dispatches SetField with the updated entry", () => {
    const h = rowsHarness([
      { name: "Wren", location: "Highvale", level: 1, active: false },
    ]);
    mountWithClient(h, () => (
      <EntryRowsField<RelationshipEntry>
        characterId={h.characterId}
        trait={RelationshipsTrait}
        path={["entries"]}
        columns={RELATIONSHIP_COLUMNS}
        seedEntry={(name) => ({ name, location: "", level: 0, active: false })}
      />
    ));
    const locationInput = rowsRoot().querySelectorAll(".vk-rows__row input")[1] as HTMLInputElement;
    fireEvent.focus(locationInput);
    fireEvent.input(locationInput, { target: { value: "Tannery" } });
    fireEvent.keyDown(locationInput, { key: "Enter" });
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect((cmd!.payload as { value: RelationshipEntry[] }).value).toEqual([
      { name: "Wren", location: "Tannery", level: 1, active: false },
    ]);
  });

  it("editing a number cell clamps to min/max", () => {
    const h = rowsHarness([
      { name: "Wren", location: "", level: 5, active: false },
    ]);
    mountWithClient(h, () => (
      <EntryRowsField<RelationshipEntry>
        characterId={h.characterId}
        trait={RelationshipsTrait}
        path={["entries"]}
        columns={RELATIONSHIP_COLUMNS}
        seedEntry={(name) => ({ name, location: "", level: 0, active: false })}
      />
    ));
    const lvInput = rowsRoot().querySelectorAll(".vk-rows__row input")[2] as HTMLInputElement;
    fireEvent.focus(lvInput);
    fireEvent.input(lvInput, { target: { value: "999" } });
    fireEvent.blur(lvInput);
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect((cmd!.payload as { value: RelationshipEntry[] }).value).toEqual([
      { name: "Wren", location: "", level: 10, active: false },
    ]);
  });

  it("toggling a check cell dispatches SetField with the boolean flipped", () => {
    const h = rowsHarness([
      { name: "Wren", location: "", level: 1, active: false },
    ]);
    mountWithClient(h, () => (
      <EntryRowsField<RelationshipEntry>
        characterId={h.characterId}
        trait={RelationshipsTrait}
        path={["entries"]}
        columns={RELATIONSHIP_COLUMNS}
        seedEntry={(name) => ({ name, location: "", level: 0, active: false })}
      />
    ));
    const checkInput = rowsRoot().querySelectorAll(".vk-rows__row input")[3] as HTMLInputElement;
    fireEvent.click(checkInput);
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect((cmd!.payload as { value: RelationshipEntry[] }).value).toEqual([
      { name: "Wren", location: "", level: 1, active: true },
    ]);
  });

  it("clicking a row's × dispatches SetField with that row removed", () => {
    const h = rowsHarness([
      { name: "Wren", location: "", level: 0, active: false },
      { name: "Olin", location: "", level: 0, active: false },
      { name: "Brynn", location: "", level: 0, active: false },
    ]);
    mountWithClient(h, () => (
      <EntryRowsField<RelationshipEntry>
        characterId={h.characterId}
        trait={RelationshipsTrait}
        path={["entries"]}
        columns={RELATIONSHIP_COLUMNS}
        seedEntry={(name) => ({ name, location: "", level: 0, active: false })}
      />
    ));
    fireEvent.click(screen.getByLabelText("remove row 2"));
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect((cmd!.payload as { value: RelationshipEntry[] }).value.map((e) => e.name)).toEqual(
      ["Wren", "Brynn"],
    );
  });

  it("non-editor: hides × buttons, hides add row, disables inputs", () => {
    const h = rowsHarness(
      [{ name: "Wren", location: "Highvale", level: 1, active: false }],
      false,
    );
    mountWithClient(h, () => (
      <EntryRowsField<RelationshipEntry>
        characterId={h.characterId}
        trait={RelationshipsTrait}
        path={["entries"]}
        columns={RELATIONSHIP_COLUMNS}
        seedEntry={(name) => ({ name, location: "", level: 0, active: false })}
        requires="gm"
      />
    ));
    expect(rowsRoot().querySelector(".vk-rows__remove")).toBeNull();
    expect(rowsRoot().querySelector(".vk-rows__addrow")).toBeNull();
    const inputs = Array.from(rowsRoot().querySelectorAll(".vk-rows__row input"));
    for (const i of inputs) expect((i as HTMLInputElement).disabled).toBe(true);
  });
});

