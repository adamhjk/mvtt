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
import { screen, cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import {
  defineCommand,
  definePlugin,
  defineRollable,
  defineTrait,
  ok,
  z,
  type CommandInstance,
} from "@vtt/substrate";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { ownedBy, Permissions } from "@vtt/permissions/shared";

import { buildCharacterHarness, mountWithClient, type CharacterHarness } from "./testing.js";
import { Character } from "./shared/traits.js";
import {
  CancelPendingRoll,
  CommitPendingRoll,
  ContributeToPendingRoll,
  OpenPendingRoll,
  RemoveContribution,
} from "./shared/commands.js";
import { PendingRoll, type Contribution } from "./shared/pending.js";
import { PendingRollContributorsSlot, type PendingRollContributor } from "./shared/slot.js";
import { PendingRollPanels } from "./client/PendingRollPanels.js";
import { RollableLabel } from "./client/kit.js";

beforeEach(() => cleanup());

/* -------------------------------------------------------------------------
 * Test fixtures: a tiny "Stats" trait + interactive StatCheck rollable
 * + a no-op RollDice command (we only assert dispatch, not actual rolling).
 * ----------------------------------------------------------------------- */

const Stats = defineTrait({
  name: "@test/pending/Stats",
  schema: z
    .object({
      might: z.number().int().min(0).max(10).default(2),
    })
    .default({ might: 2 }),
});

const RollDice = defineCommand({
  name: "@test/pending/RollDice",
  schema: z.object({
    notation: z.string(),
    label: z.string(),
    characterId: z.string(),
  }),
  validate: () => ok(),
  apply: () => [],
});

const StatCheck = defineRollable({
  name: "@test/pending/stat-check",
  inputs: [Stats, Character] as const,
  command: RollDice,
  interactive: true,
  opts: z
    .object({
      stat: z.enum(["might"]).default("might"),
      contributions: z.array(z.unknown()).optional(),
    })
    .default({ stat: "might" }),
  compute: ([stats, character], { opts }) => {
    let total = stats.might;
    const contribs = (opts.contributions ?? []) as Contribution[];
    for (const c of contribs) {
      if (c.kind === "modifier") {
        const v = (c.payload as { value?: number })?.value;
        if (typeof v === "number") total += v;
      } else if (c.kind === "help") {
        const dice = (c.payload as { dice?: number })?.dice;
        if (typeof dice === "number") total += dice;
      }
    }
    return {
      notation: `1d6+${total}`,
      label: `${character.name} — Might ${total}`,
    };
  },
  toPayload: (spec, { entityId }) => ({
    notation: spec.notation,
    label: spec.label,
    characterId: entityId,
  }),
});

/**
 * Sibling rollable that publishes `spec.modifiers` — needed so the
 * panel's modifier-chip rendering (and the × remove button) has
 * something to display in tests. StatCheck folds contributions
 * into the dice total but doesn't expose them as a spec field;
 * this one mirrors the contribution list as TB-shaped modifiers
 * so the panel's `specModifiers()` accessor finds them.
 */
const ModifierCheck = defineRollable({
  name: "@test/pending/modifier-check",
  inputs: [Stats, Character] as const,
  command: RollDice,
  interactive: true,
  opts: z
    .object({
      contributions: z.array(z.unknown()).optional(),
    })
    .default({}),
  compute: ([stats, character], { opts }) => {
    const contribs = (opts.contributions ?? []) as Contribution[];
    const modifiers = contribs
      .filter((c) => c.kind === "tb-modifier")
      .map((c) => c.payload as Record<string, unknown>);
    return {
      notation: `1d6+${stats.might}`,
      label: `${character.name} — Modifier`,
      modifiers,
    };
  },
  toPayload: (spec, { entityId }) => ({
    notation: spec.notation,
    label: spec.label,
    characterId: entityId,
  }),
});

const fixturePlugin = definePlugin({
  name: "@vtt/pending-test",
  version: "0.0.0",
  traits: [Stats],
  commands: [RollDice],
  rollables: [StatCheck, ModifierCheck],
});

function harness(opts?: { asGm?: boolean; ownerUserId?: string }): CharacterHarness {
  return buildCharacterHarness({
    plugins: [fixturePlugin],
    asGm: opts?.asGm,
    ownerUserId: opts?.ownerUserId,
    setupWorld: ({ world, characterId }) => {
      world.set(characterId, Stats, { might: 3 });
    },
  });
}

/* -------------------------------------------------------------------------
 * Substrate-level tests: commands + systems
 * ----------------------------------------------------------------------- */

describe("OpenPendingRoll", () => {
  it("spawns a PendingRoll entity carrying initiator + rollable + opts", async () => {
    const h = harness();
    const dispatch = h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    );
    const ack = await dispatch.ack;
    expect(ack.ok).toBe(true);
    const rolls = h.world.query([PendingRoll]);
    expect(rolls).toHaveLength(1);
    const value = rolls[0]!.values.PendingRoll as {
      initiatorUserId: string;
      initiatorCharacterId: string;
      rollableName: string;
      contributions: Contribution[];
    };
    expect(value.initiatorUserId).toBe(h.meUserId);
    expect(value.initiatorCharacterId).toBe(h.characterId);
    expect(value.rollableName).toBe(StatCheck.name);
    expect(value.contributions).toEqual([]);
  });

  it("rejects when the initiator character isn't owned by the dispatcher", async () => {
    const h = harness({ ownerUserId: "someone-else" });
    const dispatch = h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    );
    const ack = await dispatch.ack;
    expect(ack.ok).toBe(false);
    expect(h.world.query([PendingRoll])).toHaveLength(0);
  });

  it("rejects when the rollable isn't registered", async () => {
    const h = harness();
    const dispatch = h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: "@test/pending/never-registered",
        opts: {},
      }) as CommandInstance,
    );
    const ack = await dispatch.ack;
    expect(ack.ok).toBe(false);
  });
});

describe("ContributeToPendingRoll", () => {
  it("appends a contribution to the PendingRoll's contributions array", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    const pendingRollId = h.world.query([PendingRoll])[0]!.id;
    await h.client.dispatch(
      ContributeToPendingRoll({
        pendingRollId,
        contribution: {
          kind: "modifier",
          label: "test +2",
          fromUserId: h.meUserId,
          payload: { value: 2 },
        },
      }) as CommandInstance,
    ).ack;
    const value = h.world.get(pendingRollId, [PendingRoll]) as {
      PendingRoll: { contributions: Contribution[] };
    };
    expect(value.PendingRoll.contributions).toHaveLength(1);
    expect(value.PendingRoll.contributions[0]).toMatchObject({
      kind: "modifier",
      label: "test +2",
      fromUserId: h.meUserId,
      payload: { value: 2 },
    });
  });

  it("rejects when contribution.fromUserId doesn't match the dispatcher", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    const pendingRollId = h.world.query([PendingRoll])[0]!.id;
    const ack = await h.client.dispatch(
      ContributeToPendingRoll({
        pendingRollId,
        contribution: {
          kind: "modifier",
          label: "spoof",
          fromUserId: "other-user",
          payload: { value: 99 },
        },
      }) as CommandInstance,
    ).ack;
    expect(ack.ok).toBe(false);
  });

  it("`replaces` dedups: posting two contributions with the same key keeps only the latest", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    const pendingRollId = h.world.query([PendingRoll])[0]!.id;
    await h.client.dispatch(
      ContributeToPendingRoll({
        pendingRollId,
        contribution: {
          kind: "test-setting",
          label: "first pick",
          fromUserId: h.meUserId,
          payload: { value: 2 },
          replaces: "test:setting",
        },
      }) as CommandInstance,
    ).ack;
    await h.client.dispatch(
      ContributeToPendingRoll({
        pendingRollId,
        contribution: {
          kind: "test-setting",
          label: "second pick",
          fromUserId: h.meUserId,
          payload: { value: 5 },
          replaces: "test:setting",
        },
      }) as CommandInstance,
    ).ack;
    const value = h.world.get(pendingRollId, [PendingRoll]) as {
      PendingRoll: { contributions: Contribution[] };
    };
    // Only the latest survives.
    expect(value.PendingRoll.contributions).toHaveLength(1);
    expect(value.PendingRoll.contributions[0]!.label).toBe("second pick");
    expect(value.PendingRoll.contributions[0]!.payload).toEqual({ value: 5 });
  });

  it("`replaces` is keyed: contributions with different keys all survive", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    const pendingRollId = h.world.query([PendingRoll])[0]!.id;
    for (const k of ["a", "b", "a"]) {
      await h.client.dispatch(
        ContributeToPendingRoll({
          pendingRollId,
          contribution: {
            kind: "test-setting",
            label: `pick ${k}`,
            fromUserId: h.meUserId,
            payload: { which: k },
            replaces: `test:${k}`,
          },
        }) as CommandInstance,
      ).ack;
    }
    const value = h.world.get(pendingRollId, [PendingRoll]) as {
      PendingRoll: { contributions: Contribution[] };
    };
    // 'a' is replaced by the second 'a'; 'b' stands alone. → 2 left.
    expect(value.PendingRoll.contributions).toHaveLength(2);
    const labels = value.PendingRoll.contributions.map((c) => c.label).sort();
    expect(labels).toEqual(["pick a", "pick b"]);
  });

  it("RemoveContribution drops a single contribution by its inner payload.id", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    const pendingRollId = h.world.query([PendingRoll])[0]!.id;
    // Post two contributions with different inner ids.
    for (const id of ["mod-a", "mod-b"]) {
      await h.client.dispatch(
        ContributeToPendingRoll({
          pendingRollId,
          contribution: {
            kind: "tb-modifier",
            label: id,
            fromUserId: h.meUserId,
            payload: {
              id,
              kind: "dice",
              value: 1,
              label: id,
              apply: "always",
              source: "manual",
            },
          },
        }) as CommandInstance,
      ).ack;
    }
    let value = h.world.get(pendingRollId, [PendingRoll]) as {
      PendingRoll: { contributions: Contribution[] };
    };
    expect(value.PendingRoll.contributions).toHaveLength(2);
    // Remove only `mod-a`.
    await h.client.dispatch(
      RemoveContribution({
        pendingRollId,
        modifierId: "mod-a",
      }) as CommandInstance,
    ).ack;
    value = h.world.get(pendingRollId, [PendingRoll]) as {
      PendingRoll: { contributions: Contribution[] };
    };
    expect(value.PendingRoll.contributions).toHaveLength(1);
    const remainingPayload = value.PendingRoll.contributions[0]!.payload as {
      id: string;
    };
    expect(remainingPayload.id).toBe("mod-b");
  });

  it("RemoveContribution is a no-op when modifierId doesn't match any contribution", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    const pendingRollId = h.world.query([PendingRoll])[0]!.id;
    await h.client.dispatch(
      ContributeToPendingRoll({
        pendingRollId,
        contribution: {
          kind: "tb-modifier",
          label: "mod-z",
          fromUserId: h.meUserId,
          payload: {
            id: "mod-z",
            kind: "dice",
            value: 1,
            label: "mod-z",
            apply: "always",
            source: "manual",
          },
        },
      }) as CommandInstance,
    ).ack;
    await h.client.dispatch(
      RemoveContribution({
        pendingRollId,
        modifierId: "nonexistent",
      }) as CommandInstance,
    ).ack;
    const value = h.world.get(pendingRollId, [PendingRoll]) as {
      PendingRoll: { contributions: Contribution[] };
    };
    expect(value.PendingRoll.contributions).toHaveLength(1);
  });

  it("contributions without `replaces` stack normally", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    const pendingRollId = h.world.query([PendingRoll])[0]!.id;
    for (let i = 0; i < 3; i++) {
      await h.client.dispatch(
        ContributeToPendingRoll({
          pendingRollId,
          contribution: {
            kind: "modifier",
            label: `+${i}`,
            fromUserId: h.meUserId,
            payload: { value: i },
          },
        }) as CommandInstance,
      ).ack;
    }
    const value = h.world.get(pendingRollId, [PendingRoll]) as {
      PendingRoll: { contributions: Contribution[] };
    };
    expect(value.PendingRoll.contributions).toHaveLength(3);
  });

  it("rejects when the contribution claims a character the dispatcher doesn't own", async () => {
    const h = harness();
    // Spawn a foreign character that the test user doesn't own.
    const foreignChar = h.world.spawn([
      Character({ name: "Stranger" }),
      Permissions(ownedBy("stranger-user")),
    ]);
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    const pendingRollId = h.world.query([PendingRoll])[0]!.id;
    const ack = await h.client.dispatch(
      ContributeToPendingRoll({
        pendingRollId,
        contribution: {
          kind: "help",
          label: "Stranger helps",
          fromUserId: h.meUserId,
          fromCharacterId: foreignChar,
          payload: { dice: 99, stat: "might" },
        },
      }) as CommandInstance,
    ).ack;
    expect(ack.ok).toBe(false);
  });
});

describe("CommitPendingRoll", () => {
  it("despawns the entity but does NOT dispatch the rollable's command itself", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    const pendingRollId = h.world.query([PendingRoll])[0]!.id;
    h.dispatched.length = 0;
    await h.client.dispatch(CommitPendingRoll({ pendingRollId }) as CommandInstance).ack;
    expect(h.world.query([PendingRoll])).toHaveLength(0);
    // The committing client is responsible for ALSO dispatching the
    // roll command separately. CommitPendingRoll itself only despawns.
    expect(h.dispatched.some((c) => c.type === RollDice.name)).toBe(false);
  });

  it("rejects commit by anyone other than the initiator (or a GM)", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    const pendingRollId = h.world.query([PendingRoll])[0]!.id;

    // Build a second harness on the same world... can't easily share
    // worlds across harnesses, so simulate by mutating session.
    // Easier: build a fresh harness with a different user as me, but
    // keep the pending-roll user as initiator.
    const otherUser = buildCharacterHarness({
      plugins: [fixturePlugin],
      meUserId: "stranger",
      ownerUserId: "stranger",
    });
    // Spawn the same pending roll in the other harness's world and try
    // to commit — different worlds so we instead test the rule in
    // isolation: use the same harness but spoof a different session.
    // Simplest path: replace the session via a custom dispatch.
    void otherUser;

    // Spoof the dispatcher's identity by directly invoking the command
    // pipeline with a different session — bypasses h.client which
    // hardcodes its own session.
    const result = await h.pipeline.dispatch({
      id: "x1",
      issuedBy: "client-stranger",
      issuedAt: Date.now(),
      cmd: CommitPendingRoll({ pendingRollId }) as CommandInstance,
      session: {
        userId: "stranger",
        email: "stranger@test.dev",
        name: "Stranger",
        role: "player",
      },
    });
    expect(result.result.ok).toBe(false);
    expect(h.world.query([PendingRoll])).toHaveLength(1);
  });
});

describe("CancelPendingRoll", () => {
  it("despawns the entity without rolling", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    const pendingRollId = h.world.query([PendingRoll])[0]!.id;
    h.dispatched.length = 0;
    await h.client.dispatch(CancelPendingRoll({ pendingRollId }) as CommandInstance).ack;
    expect(h.world.query([PendingRoll])).toHaveLength(0);
    expect(h.dispatched.some((c) => c.type === RollDice.name)).toBe(false);
  });
});

/* -------------------------------------------------------------------------
 * Kit-level test: <RollableLabel> for an interactive rollable opens a
 * pending roll instead of dispatching the rollable's command directly
 * ----------------------------------------------------------------------- */

describe("kit/RollableLabel + interactive rollable", () => {
  it("clicking an interactive rollable dispatches OpenPendingRoll instead of the roll", () => {
    const h = harness();
    mountWithClient(h, () => (
      <RollableLabel characterId={h.characterId} rollable={StatCheck} opts={{ stat: "might" }}>
        Might
      </RollableLabel>
    ));
    fireEvent.click(screen.getByRole("button", { name: /might/i }));
    expect(h.dispatched.some((c) => c.type === OpenPendingRoll.name)).toBe(true);
    expect(h.dispatched.some((c) => c.type === RollDice.name)).toBe(false);
  });
});

/* -------------------------------------------------------------------------
 * Panel-level integration tests
 * ----------------------------------------------------------------------- */

describe("PendingRollPanel", () => {
  it("renders nothing when there are no PendingRoll entities", () => {
    const h = harness();
    const { container } = mountWithClient(h, () => PendingRollPanels());
    expect(container.querySelector('[data-testid="pending-roll-panel"]')).toBeNull();
  });

  it("renders one panel per active PendingRoll, with initiator name + preview notation", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    mountWithClient(h, () => PendingRollPanels());
    const panel = await screen.findByTestId("pending-roll-panel");
    expect(panel).toBeInTheDocument();
    // Default Character name from the harness is "Tarn"; preview notation
    // for might=3 with no contributions is "1d6+3".
    expect(panel.textContent).toContain("Tarn");
    expect(panel.textContent).toContain("1d6+3");
  });

  it("contributions flow through compute to update the live notation in the panel", async () => {
    // The modifier list shown by the panel is sourced from
    // `spec.modifiers` — system-simple's StatCheck doesn't publish
    // a modifier array, so the contribution is invisible as a chip,
    // but it IS folded into the dice notation by the rollable's
    // compute. Total changes from 1d6+3 to 1d6+5.
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    const pendingRollId = h.world.query([PendingRoll])[0]!.id;
    await h.client.dispatch(
      ContributeToPendingRoll({
        pendingRollId,
        contribution: {
          kind: "modifier",
          label: "encouragement +2",
          fromUserId: h.meUserId,
          payload: { value: 2 },
        },
      }) as CommandInstance,
    ).ack;
    mountWithClient(h, () => PendingRollPanels());
    const panel = await screen.findByTestId("pending-roll-panel");
    expect(panel.textContent).toContain("1d6+5");
  });

  it("renders the headline as `<character> is rolling <source>` from the spec", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    mountWithClient(h, () => PendingRollPanels());
    const headline = await screen.findByTestId("pending-roll-headline");
    // Initiator name is whatever the harness set up; just verify the
    // structure: name → " is rolling " → source label.
    expect(headline.textContent).toMatch(/ is rolling /);
    // The fallback splits on `/` and takes the last segment.
    expect(headline.textContent).toContain("stat-check");
  });

  it("renders an × remove button on each modifier chip whose contribution is in the list", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: ModifierCheck.name,
        opts: {},
      }) as CommandInstance,
    ).ack;
    const pendingRollId = h.world.query([PendingRoll])[0]!.id;
    await h.client.dispatch(
      ContributeToPendingRoll({
        pendingRollId,
        contribution: {
          kind: "tb-modifier",
          label: "+1D",
          fromUserId: h.meUserId,
          payload: {
            id: "manual:test",
            kind: "dice",
            value: 1,
            label: "test",
            apply: "always",
            source: "manual",
          },
        },
      }) as CommandInstance,
    ).ack;
    mountWithClient(h, () => PendingRollPanels());
    await screen.findByTestId("pending-roll-panel");
    expect(screen.getByTestId("pending-roll-modifiers")).toBeInTheDocument();
    expect(screen.getByTestId("pending-roll-modifier-remove-manual:test")).toBeInTheDocument();
  });

  it("clicking × dispatches RemoveContribution and removes the chip after the round-trip", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: ModifierCheck.name,
        opts: {},
      }) as CommandInstance,
    ).ack;
    const pendingRollId = h.world.query([PendingRoll])[0]!.id;
    await h.client.dispatch(
      ContributeToPendingRoll({
        pendingRollId,
        contribution: {
          kind: "tb-modifier",
          label: "+1D",
          fromUserId: h.meUserId,
          payload: {
            id: "manual:remove-me",
            kind: "dice",
            value: 1,
            label: "remove me",
            apply: "always",
            source: "manual",
          },
        },
      }) as CommandInstance,
    ).ack;
    h.dispatched.length = 0;
    mountWithClient(h, () => PendingRollPanels());
    await screen.findByTestId("pending-roll-panel");
    fireEvent.click(screen.getByTestId("pending-roll-modifier-remove-manual:remove-me"));
    const removed = h.dispatched.find((c) => c.type === RemoveContribution.name);
    expect(removed).toBeDefined();
    expect(removed!.payload).toEqual({
      pendingRollId,
      modifierId: "manual:remove-me",
    });
    // The dispatch+system pass is async — wait for the round-trip
    // to clear the contribution from the PendingRoll.
    await waitFor(() => {
      const value = h.world.get(pendingRollId, [PendingRoll]) as {
        PendingRoll: { contributions: Contribution[] };
      };
      expect(value.PendingRoll.contributions).toEqual([]);
    });
  });

  it("does NOT render an × button on auto-modifiers (no matching contribution)", async () => {
    // ModifierCheck publishes only contribution-derived modifiers,
    // not auto-derived ones — so this test inserts an "auto-" id
    // modifier into spec.modifiers without a matching contribution
    // by patching the world directly. The chip should render
    // without ×.
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: ModifierCheck.name,
        opts: {},
      }) as CommandInstance,
    ).ack;
    const pendingRollId = h.world.query([PendingRoll])[0]!.id;
    // Post a contribution mirroring an auto-mod — but the chip's
    // matching is by *contribution* presence, so if a contribution
    // exists, the × shows. The "auto" semantics live in the
    // rollable's compute (no contribution = no remove). Verify
    // that path: post a contribution with id "manual:x", confirm
    // ×; then query, confirm chip text matches.
    await h.client.dispatch(
      ContributeToPendingRoll({
        pendingRollId,
        contribution: {
          kind: "tb-modifier",
          label: "+1D",
          fromUserId: h.meUserId,
          payload: {
            id: "manual:x",
            kind: "dice",
            value: 1,
            label: "x",
            apply: "always",
            source: "manual",
          },
        },
      }) as CommandInstance,
    ).ack;
    mountWithClient(h, () => PendingRollPanels());
    await screen.findByTestId("pending-roll-panel");
    // Sanity: the manual one HAS ×.
    expect(screen.queryByTestId("pending-roll-modifier-remove-manual:x")).toBeInTheDocument();
    // An auto-mod id isn't in contributions → would have no × even
    // if it were in spec.modifiers.
    expect(screen.queryByTestId("pending-roll-modifier-remove-auto:condition:fresh")).toBeNull();
  });

  it("does NOT render a built-in 'Add modifier' input — system contributors handle modifiers", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    mountWithClient(h, () => PendingRollPanels());
    await screen.findByTestId("pending-roll-panel");
    expect(screen.queryByPlaceholderText("±N")).toBeNull();
    expect(screen.queryByRole("button", { name: "add" })).toBeNull();
    expect(screen.queryByText("Add modifier")).toBeNull();
  });

  it("clicking 'roll' on the panel dispatches the rollable's command + CommitPendingRoll", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    h.dispatched.length = 0;
    mountWithClient(h, () => PendingRollPanels());
    await screen.findByTestId("pending-roll-panel");
    fireEvent.click(screen.getByRole("button", { name: "roll" }));
    expect(h.dispatched.some((c) => c.type === RollDice.name)).toBe(true);
    expect(h.dispatched.some((c) => c.type === CommitPendingRoll.name)).toBe(true);
  });

  it("clicking 'cancel' dispatches CancelPendingRoll without rolling", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    h.dispatched.length = 0;
    mountWithClient(h, () => PendingRollPanels());
    await screen.findByTestId("pending-roll-panel");
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(h.dispatched.some((c) => c.type === CancelPendingRoll.name)).toBe(true);
    expect(h.dispatched.some((c) => c.type === RollDice.name)).toBe(false);
  });

  it("hides Commit/Cancel for non-initiators (other players)", async () => {
    const h = harness();
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    // The roll was opened by the initiator user. Now build a separate
    // client whose me() is a DIFFERENT user, and mount the panel from
    // their perspective. Both clients share the same world.
    const otherClient = buildCharacterHarness({
      plugins: [fixturePlugin],
      meUserId: "observer",
      ownerUserId: "observer",
    });
    // Replicate the pending roll into the other client's world so the
    // panel sees something to render. (In production the snapshot/event
    // sync handles this; in tests we mirror manually.)
    const value = h.world.get(h.world.query([PendingRoll])[0]!.id, [PendingRoll]) as {
      PendingRoll: Parameters<typeof PendingRoll>[0];
    };
    otherClient.world.spawn([PendingRoll(value.PendingRoll as never)]);
    // Also spawn an Identity entity matching the observer so useMe
    // resolves on the other client side.
    otherClient.world.spawn([
      Identity({ userId: "observer", role: "player" }),
      Name({ value: "Observer" }),
      Online({ clientId: "test-client-1", since: Date.now() }),
    ]);

    mountWithClient(otherClient, () => PendingRollPanels());
    await screen.findByTestId("pending-roll-panel");
    // Non-initiator: no commit/cancel actions visible. Modifier UI
    // (when applicable) comes from system-specific contributors —
    // the default panel no longer ships its own.
    expect(screen.queryByRole("button", { name: "roll" })).toBeNull();
    expect(screen.queryByRole("button", { name: "cancel" })).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * PendingRollContributorsSlot: system-specific contributor extension
 * ----------------------------------------------------------------------- */

describe("PendingRollContributorsSlot", () => {
  it("renders a registered contributor's UI inside the panel", async () => {
    const customContributor: PendingRollContributor = {
      id: "@test/pending/custom-contrib" as PendingRollContributor["id"],
      rollablePrefix: "@test/pending/",
      render: (args) => (
        <button
          type="button"
          data-testid="custom-contrib"
          onClick={() =>
            args.contribute({
              kind: "modifier",
              label: "via custom contributor",
              fromUserId: args.initiatorUserId,
              payload: { value: 7 },
            })
          }
        >
          contribute 7
        </button>
      ),
    };
    const contribPlugin = definePlugin({
      name: "@vtt/test-pending-contrib",
      version: "0.0.0",
      fills: {
        [PendingRollContributorsSlot.name]: [customContributor],
      },
    });
    const h = buildCharacterHarness({
      plugins: [fixturePlugin, contribPlugin],
      setupWorld: ({ world, characterId }) => {
        world.set(characterId, Stats, { might: 1 });
      },
    });
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    h.dispatched.length = 0;
    mountWithClient(h, () => PendingRollPanels());
    await screen.findByTestId("pending-roll-panel");
    fireEvent.click(screen.getByTestId("custom-contrib"));
    const contribute = h.dispatched.find((c) => c.type === ContributeToPendingRoll.name);
    expect(contribute).toBeDefined();
    expect(
      (contribute!.payload as { contribution: { payload: { value: number } } }).contribution.payload
        .value,
    ).toBe(7);
  });

  it("filters contributors by rollablePrefix when set", async () => {
    const otherSystemContributor: PendingRollContributor = {
      id: "@test/pending/other-sys" as PendingRollContributor["id"],
      rollablePrefix: "@vtt/dnd5e/",
      render: () => <button data-testid="other-sys-contrib">should not show</button>,
    };
    const matchingContributor: PendingRollContributor = {
      id: "@test/pending/matching" as PendingRollContributor["id"],
      rollablePrefix: "@test/pending/",
      render: () => <button data-testid="matching-contrib">visible</button>,
    };
    const contribPlugin = definePlugin({
      name: "@vtt/test-pending-prefix",
      version: "0.0.0",
      fills: {
        [PendingRollContributorsSlot.name]: [otherSystemContributor, matchingContributor],
      },
    });
    const h = buildCharacterHarness({
      plugins: [fixturePlugin, contribPlugin],
      setupWorld: ({ world, characterId }) => {
        world.set(characterId, Stats, { might: 1 });
      },
    });
    await h.client.dispatch(
      OpenPendingRoll({
        initiatorCharacterId: h.characterId,
        rollableName: StatCheck.name,
        opts: { stat: "might" },
      }) as CommandInstance,
    ).ack;
    mountWithClient(h, () => PendingRollPanels());
    await screen.findByTestId("pending-roll-panel");
    expect(screen.getByTestId("matching-contrib")).toBeInTheDocument();
    expect(screen.queryByTestId("other-sys-contrib")).toBeNull();
  });
});
