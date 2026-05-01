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
import { describe, it, expect, beforeEach } from "vitest";
import { screen, cleanup, fireEvent } from "@solidjs/testing-library";
import {
  defineCommand,
  definePlugin,
  defineRollable,
  defineTrait,
  ok,
  z,
  type CommandInstance,
} from "@vtt/substrate";

import {
  buildCharacterHarness,
  mountWithClient,
  type CharacterHarness,
} from "./testing.js";
import { SetField } from "./shared/commands.js";
import {
  CheckField,
  DotsField,
  NumberField,
  Rollable,
  RollableLabel,
  RollButton,
  TrackField,
  ValueField,
  type FieldBinding,
} from "./client/kit.js";

/* -------------------------------------------------------------------------
 * Per-test traits + commands the kit binds against
 * ----------------------------------------------------------------------- */

const Stats = defineTrait({
  name: "@test/kit/Stats",
  schema: z
    .object({
      might: z.number().int().min(0).max(5).default(2),
      quickness: z.number().int().min(0).max(5).default(2),
    })
    .default({ might: 2, quickness: 2 }),
});

const Vitals = defineTrait({
  name: "@test/kit/Vitals",
  schema: z
    .object({
      hp: z.number().int().min(0).default(6),
      proficient: z.boolean().default(false),
    })
    .default({ hp: 6, proficient: false }),
});

const RollDice = defineCommand({
  name: "@test/kit/RollDice",
  schema: z.object({
    notation: z.string(),
    label: z.string(),
    characterId: z.string(),
  }),
  validate: () => ok(),
  apply: () => [],
});

const StatCheck = defineRollable({
  name: "@test/kit/stat-check",
  inputs: [Stats] as const,
  command: RollDice,
  opts: z.object({ stat: z.enum(["might", "quickness"]) }).default({ stat: "might" }),
  compute: ([stats], { opts }) => ({
    notation: `1d6+${stats[opts.stat]}`,
    label: `${capitalize(opts.stat)} check`,
  }),
  toPayload: (spec, { entityId }) => ({
    notation: spec.notation,
    label: spec.label,
    characterId: entityId,
  }),
});

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const kitTestPlugin = definePlugin({
  name: "@vtt/kit-test",
  version: "0.0.0",
  traits: [Stats, Vitals],
  commands: [RollDice],
  rollables: [StatCheck],
});

function harness(opts?: {
  asGm?: boolean;
  ownerUserId?: string;
  playerUserId?: string;
}): CharacterHarness {
  return buildCharacterHarness({
    plugins: [kitTestPlugin],
    asGm: opts?.asGm,
    ownerUserId: opts?.ownerUserId,
    playerUserId: opts?.playerUserId,
    setupWorld: ({ world, characterId }) => {
      world.set(characterId, Stats, { might: 3, quickness: 2 });
      world.set(characterId, Vitals, { hp: 4, proficient: false });
    },
  });
}

beforeEach(() => {
  cleanup();
});

/* -------------------------------------------------------------------------
 * ValueField
 * ----------------------------------------------------------------------- */

describe("kit/ValueField", () => {
  it("renders the trait value at the given path", () => {
    const h = harness();
    mountWithClient(h, () => (
      <ValueField characterId={h.characterId} trait={Stats} path={["might"]} />
    ));
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows the placeholder when the trait is absent", () => {
    const h = harness();
    mountWithClient(h, () => (
      <ValueField characterId={h.characterId} trait={Stats} path={["does-not-exist"]} />
    ));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("formats numbers as signed when format=\"signed\"", () => {
    const h = harness();
    mountWithClient(h, () => (
      <ValueField
        characterId={h.characterId}
        trait={Stats}
        path={["might"]}
        format="signed"
      />
    ));
    expect(screen.getByText("+3")).toBeInTheDocument();
  });

  it("re-renders when the underlying trait changes", async () => {
    const h = harness();
    mountWithClient(h, () => (
      <ValueField characterId={h.characterId} trait={Stats} path={["might"]} />
    ));
    expect(screen.getByText("3")).toBeInTheDocument();
    h.client.dispatch(
      SetField({
        characterId: h.characterId,
        trait: Stats.name as unknown as string,
        path: ["might"],
        value: 5,
      }) as CommandInstance,
    );
    expect(await screen.findByText("5")).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------
 * NumberField
 * ----------------------------------------------------------------------- */

describe("kit/NumberField", () => {
  function bindMight(h: CharacterHarness): FieldBinding {
    return {
      characterId: h.characterId,
      trait: Stats,
      path: ["might"],
    };
  }

  it("seeds from the current trait value", () => {
    const h = harness();
    mountWithClient(h, () => <NumberField {...bindMight(h)} min={0} max={5} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("3");
  });

  it("dispatches SetField with the new value on blur", async () => {
    const h = harness();
    mountWithClient(h, () => <NumberField {...bindMight(h)} min={0} max={5} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "4" } });
    fireEvent.blur(input);
    expect(h.dispatched).toHaveLength(1);
    const cmd = h.dispatched[0]!;
    expect(cmd.type).toBe(SetField.name);
    expect(cmd.payload).toMatchObject({
      characterId: h.characterId,
      trait: Stats.name,
      path: ["might"],
      value: 4,
    });
  });

  it("clamps to min/max before dispatching", () => {
    const h = harness();
    mountWithClient(h, () => <NumberField {...bindMight(h)} min={0} max={5} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "100" } });
    fireEvent.blur(input);
    expect(h.dispatched).toHaveLength(1);
    expect((h.dispatched[0]!.payload as { value: number }).value).toBe(5);
  });

  it("does not dispatch when the value is unchanged", () => {
    const h = harness();
    mountWithClient(h, () => <NumberField {...bindMight(h)} min={0} max={5} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "3" } });
    fireEvent.blur(input);
    expect(h.dispatched).toHaveLength(0);
  });

  it("is disabled when the user is not the owner and not a GM", () => {
    const h = harness({ ownerUserId: "someone-else" });
    mountWithClient(h, () => <NumberField {...bindMight(h)} min={0} max={5} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("is enabled for a GM even when not the owner", () => {
    const h = harness({ ownerUserId: "someone-else", asGm: true });
    mountWithClient(h, () => <NumberField {...bindMight(h)} min={0} max={5} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.disabled).toBe(false);
  });

  it("is enabled for a player assigned to a character the GM still owns", () => {
    // GM owns the character but assigned it to me. Editor rights flow
    // through Character.playerUserId, so the bound input must enable.
    const h = harness({
      ownerUserId: "gm-1",
      playerUserId: "test-me",
    });
    mountWithClient(h, () => <NumberField {...bindMight(h)} min={0} max={5} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.disabled).toBe(false);
  });

  it("is disabled when assigned to a different player", () => {
    const h = harness({
      ownerUserId: "gm-1",
      playerUserId: "someone-else",
    });
    mountWithClient(h, () => <NumberField {...bindMight(h)} min={0} max={5} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});

/* -------------------------------------------------------------------------
 * CheckField
 * ----------------------------------------------------------------------- */

describe("kit/CheckField", () => {
  it("reflects the current trait value", () => {
    const h = harness();
    mountWithClient(h, () => (
      <CheckField
        characterId={h.characterId}
        trait={Vitals}
        path={["proficient"]}
      />
    ));
    const cb = screen.getByRole("checkbox") as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it("dispatches SetField on toggle", () => {
    const h = harness();
    mountWithClient(h, () => (
      <CheckField
        characterId={h.characterId}
        trait={Vitals}
        path={["proficient"]}
      />
    ));
    const cb = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(cb);
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]!.payload).toMatchObject({
      trait: Vitals.name,
      path: ["proficient"],
      value: true,
    });
  });
});

/* -------------------------------------------------------------------------
 * DotsField
 * ----------------------------------------------------------------------- */

describe("kit/DotsField", () => {
  it("renders max dots and fills up to the current value", () => {
    const h = harness();
    const { container } = mountWithClient(h, () => (
      <DotsField
        characterId={h.characterId}
        trait={Stats}
        path={["might"]}
        max={5}
      />
    ));
    const dots = container.querySelectorAll(".vk-dot");
    expect(dots).toHaveLength(5);
    const filled = container.querySelectorAll(".vk-dot--filled");
    expect(filled).toHaveLength(3);
  });

  it("clicking a dot dispatches SetField with that level", () => {
    const h = harness();
    const { container } = mountWithClient(h, () => (
      <DotsField
        characterId={h.characterId}
        trait={Stats}
        path={["might"]}
        max={5}
      />
    ));
    const dots = container.querySelectorAll(".vk-dot");
    fireEvent.click(dots[4]!);
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]!.payload).toMatchObject({
      trait: Stats.name,
      path: ["might"],
      value: 5,
    });
  });

  it("clicking the currently-filled top dot decrements by one", () => {
    const h = harness();
    const { container } = mountWithClient(h, () => (
      <DotsField
        characterId={h.characterId}
        trait={Stats}
        path={["might"]}
        max={5}
      />
    ));
    const dots = container.querySelectorAll(".vk-dot");
    fireEvent.click(dots[2]!);
    expect(h.dispatched).toHaveLength(1);
    expect((h.dispatched[0]!.payload as { value: number }).value).toBe(2);
  });
});

/* -------------------------------------------------------------------------
 * TrackField
 * ----------------------------------------------------------------------- */

describe("kit/TrackField", () => {
  it("renders max boxes and fills up to current value", () => {
    const h = harness();
    const { container } = mountWithClient(h, () => (
      <TrackField
        characterId={h.characterId}
        trait={Vitals}
        path={["hp"]}
        max={6}
      />
    ));
    const boxes = container.querySelectorAll(".vk-trackbox");
    expect(boxes).toHaveLength(6);
    expect(container.querySelectorAll(".vk-trackbox--filled")).toHaveLength(4);
  });

  it("clicking a box sets HP to that level", () => {
    const h = harness();
    const { container } = mountWithClient(h, () => (
      <TrackField
        characterId={h.characterId}
        trait={Vitals}
        path={["hp"]}
        max={6}
      />
    ));
    const boxes = container.querySelectorAll(".vk-trackbox");
    fireEvent.click(boxes[5]!);
    expect(h.dispatched).toHaveLength(1);
    expect((h.dispatched[0]!.payload as { value: number }).value).toBe(6);
  });
});

/* -------------------------------------------------------------------------
 * RollableLabel + Rollable + RollButton
 * ----------------------------------------------------------------------- */

describe("kit/RollableLabel", () => {
  it("dispatches the rollable's command on click", () => {
    const h = harness();
    mountWithClient(h, () => (
      <RollableLabel
        characterId={h.characterId}
        rollable={StatCheck}
        opts={{ stat: "might" }}
      >
        Might
      </RollableLabel>
    ));
    const label = screen.getByRole("button", { name: /might/i });
    fireEvent.click(label);
    expect(h.dispatched).toHaveLength(1);
    const cmd = h.dispatched[0]!;
    expect(cmd.type).toBe(RollDice.name);
    expect(cmd.payload).toMatchObject({
      notation: "1d6+3",
      characterId: h.characterId,
    });
  });

  it("resolves a rollable referenced by name string", () => {
    const h = harness();
    mountWithClient(h, () => (
      <RollableLabel
        characterId={h.characterId}
        rollable={StatCheck.name}
        opts={{ stat: "quickness" }}
      >
        Quickness
      </RollableLabel>
    ));
    fireEvent.click(screen.getByRole("button", { name: /quickness/i }));
    expect(h.dispatched).toHaveLength(1);
    expect((h.dispatched[0]!.payload as { notation: string }).notation).toBe(
      "1d6+2",
    );
  });

  it("Enter / Space activate the trigger", () => {
    const h = harness();
    mountWithClient(h, () => (
      <Rollable
        characterId={h.characterId}
        rollable={StatCheck}
        opts={{ stat: "might" }}
      >
        Might
      </Rollable>
    ));
    const el = screen.getByRole("button", { name: /might/i });
    fireEvent.keyDown(el, { key: "Enter" });
    fireEvent.keyDown(el, { key: " " });
    expect(h.dispatched).toHaveLength(2);
  });
});

describe("kit/RollButton", () => {
  it("renders a button with the label and dispatches on click", () => {
    const h = harness();
    mountWithClient(h, () => (
      <RollButton
        characterId={h.characterId}
        rollable={StatCheck}
        opts={{ stat: "might" }}
        label="Roll Might"
      />
    ));
    const btn = screen.getByRole("button", { name: "Roll Might" });
    fireEvent.click(btn);
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]!.type).toBe(RollDice.name);
  });
});

/* -------------------------------------------------------------------------
 * End-to-end loop
 * ----------------------------------------------------------------------- */

describe("kit end-to-end", () => {
  it("editing via NumberField updates a sibling ValueField", async () => {
    const h = harness();
    mountWithClient(h, () => (
      <div>
        <NumberField
          characterId={h.characterId}
          trait={Stats}
          path={["might"]}
          min={0}
          max={5}
        />
        <ValueField
          characterId={h.characterId}
          trait={Stats}
          path={["might"]}
          format="signed"
        />
      </div>
    ));
    expect(screen.getByText("+3")).toBeInTheDocument();
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "5" } });
    fireEvent.blur(input);
    expect(await screen.findByText("+5")).toBeInTheDocument();
  });

  it("clicking a stat-name RollableLabel rolls 1d6+stat for that label", () => {
    const h = harness();
    mountWithClient(h, () => (
      <div>
        <RollableLabel
          characterId={h.characterId}
          rollable={StatCheck}
          opts={{ stat: "might" }}
        >
          Might
        </RollableLabel>
        <RollableLabel
          characterId={h.characterId}
          rollable={StatCheck}
          opts={{ stat: "quickness" }}
        >
          Quickness
        </RollableLabel>
      </div>
    ));
    fireEvent.click(screen.getByRole("button", { name: "Might" }));
    fireEvent.click(screen.getByRole("button", { name: "Quickness" }));
    expect(h.dispatched).toHaveLength(2);
    expect((h.dispatched[0]!.payload as { notation: string }).notation).toBe("1d6+3");
    expect((h.dispatched[1]!.payload as { notation: string }).notation).toBe("1d6+2");
  });
});
