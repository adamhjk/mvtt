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

import {
  previewRollable,
  type CommandInstance,
  type EntityId,
} from "@vtt/substrate";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { kit } from "@vtt/characters/client";
import {
  CancelPendingRoll,
  CommitPendingRoll,
  ContributeToPendingRoll,
  PendingRoll,
  RemoveContribution,
  type Contribution,
} from "@vtt/characters/shared";
import { invokeRollable } from "@vtt/substrate";
import { canWrite, Permissions } from "@vtt/permissions/shared";
import { Active, Character, Team, isActive } from "@vtt/characters/shared";
import { createMemo, type Accessor } from "solid-js";
import {
  CharacterTraits,
  Conditions,
  Pools,
  RawAbilities,
  Skills,
  TbMonster,
  TownAbilities,
  TB_CHANNEL_NATURE_CONTRIB_KIND,
  TB_DISPOSITION_CONTRIB_KIND,
  TB_HEROIC_CONTRIB_KIND,
  TB_MODIFIER_CONTRIB_KIND,
  TB_OBSTACLE_CONTRIB_KIND,
  TB_PERSONA_SPEND_CONTRIB_KIND,
  TB_SYNERGY_CONTRIB_KIND,
  TB_VERSUS_CONTRIB_KIND,
  UseTraitOnRoll,
  channelNatureFromContributions,
  dispositionAddToFromContributions,
  dispositionFromContributions,
  dispositionMonsterPoolFromContributions,
  eligibleHelpFor,
  getSkill,
  helpProvidedBy,
  helpReplacesKey,
  heroicFromContributions,
  obstacleFromContributions,
  personaSpendTotalFromContributions,
  suggestedItemModifiersFor,
  suggestedQuickModifiersFor,
  synergyHelpersFromContributions,
  versusFromContributions,
  type DispoAddTo,
  type DispoMonsterPool,
  type HelperContext,
  type HelpOption,
  type TbRollKind,
  type TbRollModifier,
  type TbRollModifierApply,
  type TbRollModifierKind,
  type TbSuggestedQuickModifier,
  formatModifier,
} from "../../shared/index.js";

/**
 * Stable rolling counter for manual-modifier ids. The old contributor used
 * a module-level counter; we keep that behaviour so duplicate clicks on
 * the same quick button get distinct ids and stack as the rules expect.
 */
let modifierCounter = 0;
function freshModifierId(): string {
  modifierCounter += 1;
  return `manual:${modifierCounter}:${Date.now().toString(36)}`;
}

/**
 * Generate a fresh versus-test correlation key. Uses `crypto.randomUUID()`
 * when available; falls back to a coarse timestamp+random combo on older
 * runtimes (jsdom in some test environments). Prefixed `versus:` for
 * legibility in chat-row tooltips and event logs.
 */
function freshVersusTestId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const uuid = g.crypto?.randomUUID?.();
  if (uuid) return `versus:${uuid}`;
  return `versus:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The three editor variants. Mode is *derived* from the mechanics state
 * (a live versus pairing → versus; the disposition flag → disposition;
 * otherwise independent) — there is no separate stored mode field that
 * could drift from the contributions. `setMode` keeps the mechanics
 * exclusive: entering a mode clears the other modes' contributions on
 * this roll (and, for versus, on the paired peer too).
 */
export type AtelierMode = "independent" | "versus" | "disposition";

/**
 * The full reactive bundle every card in the Atelier reads off the
 * selected PendingRoll. Lifted out of the per-card JSX so each card stays
 * thin and the dispatch wiring lives in one place — easier to test, easier
 * to keep in sync with the contribution shapes.
 */
export interface AtelierState {
  /** The pending roll's entity id (stable for the editor's lifetime). */
  readonly rollId: EntityId;
  /** The PendingRoll trait value (live; null until it lands). */
  readonly pr: ReturnType<typeof useTrait<typeof PendingRoll>>;
  /** Spec preview after folding in the live contribution list. */
  readonly previewedSpec: Accessor<Record<string, unknown> | null>;

  /* identity-style derivations */
  readonly initiatorCharacterId: EntityId;
  readonly initiatorUserId: Accessor<string | null>;
  readonly initiatorName: Accessor<string | null>;
  readonly initiatorIsMonster: Accessor<boolean>;
  readonly rollableName: Accessor<string | null>;

  /* canonical "what's currently set" accessors — mirror the old contributor's memos */
  readonly panelHeroic: Accessor<boolean | undefined>;
  readonly activeObstacle: Accessor<number | null>;
  readonly activeDisposition: Accessor<boolean>;
  readonly activeDispositionAddTo: Accessor<DispoAddTo | null>;
  readonly activeMonsterPool: Accessor<DispoMonsterPool>;
  readonly activeVersusId: Accessor<string | null>;
  readonly activeMode: Accessor<AtelierMode>;
  readonly personaSpendDeclared: Accessor<number>;
  readonly channelDeclared: Accessor<"within" | "outside" | null>;
  readonly synergyDeclared: Accessor<string[]>;
  readonly personaAvail: Accessor<number>;
  readonly natureRating: Accessor<number>;
  readonly suggestedQuickButtons: Accessor<TbSuggestedQuickModifier[]>;
  readonly traitAlreadyUsed: Accessor<boolean>;
  readonly versusCandidates: Accessor<VersusCandidate[]>;
  readonly helpers: Accessor<HelperRow[]>;
  readonly suggestedHelpNames: Accessor<string[]>;
  readonly initiatorTraits: ReturnType<typeof useTrait<typeof CharacterTraits>>;

  /* helper-row fate read */
  readonly helperFateAvail: (charId: string) => number;

  /* permissioning */
  readonly canCommit: Accessor<boolean>;
  readonly canContribute: Accessor<boolean>;

  /* actions — dispatch-shaped */
  readonly offerQuickMod: (mod: Omit<TbRollModifier, "id" | "source">) => void;
  readonly applySuggested: (sq: TbSuggestedQuickModifier) => void;
  readonly offerLabelledMod: (m: {
    kind: TbRollModifierKind;
    value: number;
    apply: TbRollModifierApply;
    label: string;
  }) => void;
  readonly removeContribution: (modifierId: string) => void;
  readonly pickObstacle: (n: number) => void;
  readonly toggleHeroic: (next: boolean) => void;
  readonly toggleDisposition: (next: boolean) => void;
  readonly setMode: (next: AtelierMode) => void;
  readonly pickDispositionAddTo: (next: DispoAddTo) => void;
  readonly pickMonsterPool: (next: DispoMonsterPool) => void;
  readonly togglePairWith: (cand: VersusCandidate) => void;
  readonly unpair: () => void;
  readonly declarePersonaDice: (count: 1) => void;
  readonly toggleChannelNature: (scope: "within" | "outside") => void;
  readonly useTraitFor: (traitIndex: number) => void;
  readonly useTraitAgainst: (
    traitIndex: number,
    severity: "minus-1d" | "plus-2d-opp",
  ) => void;
  readonly offerHelp: (h: HelperRow, optionId: string, viaGm: boolean) => void;
  readonly toggleSynergy: (h: HelperRow) => void;

  /* commit / cancel */
  readonly commit: () => void;
  readonly cancel: () => void;
}

export interface VersusCandidate {
  pendingRollId: string;
  characterId: string;
  characterName: string;
  versusId: string | null;
}

export interface HelperRow {
  characterId: string;
  name: string;
  automatic: HelpOption[];
  gm: HelpOption[];
  activeOptionId: string | null;
}

/**
 * Hook everything off the rollId + initiatorCharacterId. The editor pane
 * mounts inside `<Show when={pr()}>` so by the time this hook runs, both
 * ids are stable for the lifetime of the editor mount — `useTrait` reads
 * with a known-good id, no chicken-and-egg over null initiators.
 */
export function useAtelier(
  rollId: EntityId,
  initiatorCharacterId: EntityId,
): AtelierState {
  const client = useClient();
  const me = kit.useMe();
  const pr = useTrait(rollId, PendingRoll);

  const rollableName = createMemo<string | null>(() => pr()?.rollableName ?? null);
  const initiatorUserId = createMemo<string | null>(
    () => pr()?.initiatorUserId ?? null,
  );
  const initiatorCharacter = useTrait(initiatorCharacterId, Character);
  const initiatorName = createMemo<string | null>(
    () => initiatorCharacter()?.name ?? null,
  );

  const initiatorMonster = useTrait(initiatorCharacterId, TbMonster);
  const initiatorIsMonster = createMemo<boolean>(
    () => initiatorMonster() !== undefined,
  );

  const panelHeroic = createMemo<boolean | undefined>(() => {
    const v = pr();
    if (!v) return undefined;
    return heroicFromContributions(v.contributions as Contribution[]);
  });

  const panelObstacle = createMemo<number | null | undefined>(() => {
    const v = pr();
    if (!v) return undefined;
    return obstacleFromContributions(v.contributions as Contribution[]);
  });
  const activeObstacle = createMemo<number | null>(() => {
    const fromPanel = panelObstacle();
    if (fromPanel !== undefined) return fromPanel;
    const v = pr();
    if (!v) return null;
    const o = (v.opts as { obstacle?: unknown } | undefined)?.obstacle;
    return typeof o === "number" ? o : null;
  });

  const activeDisposition = createMemo<boolean>(() => {
    const fromPanel = dispositionFromContributions(
      (pr()?.contributions ?? []) as Contribution[],
    );
    if (typeof fromPanel === "boolean") return fromPanel;
    const fromOpts = (pr()?.opts as { dispositionMode?: unknown } | undefined)
      ?.dispositionMode;
    return typeof fromOpts === "boolean" ? fromOpts : false;
  });

  const activeDispositionAddTo = createMemo<DispoAddTo | null>(() => {
    const fromPanel = dispositionAddToFromContributions(
      (pr()?.contributions ?? []) as Contribution[],
    );
    if (fromPanel !== undefined) return fromPanel;
    const fromOpts = (
      pr()?.opts as { dispositionAddTo?: DispoAddTo | null } | undefined
    )?.dispositionAddTo;
    return fromOpts ?? null;
  });

  const activeMonsterPool = createMemo<DispoMonsterPool>(() => {
    const fromPanel = dispositionMonsterPoolFromContributions(
      (pr()?.contributions ?? []) as Contribution[],
    );
    return fromPanel ?? "within";
  });

  const activeVersusId = createMemo<string | null>(() => {
    const fromPanel = versusFromContributions(
      (pr()?.contributions ?? []) as Contribution[],
    );
    if (fromPanel !== undefined) return fromPanel;
    const o = (pr()?.opts as { versusTestId?: unknown } | undefined)
      ?.versusTestId;
    return typeof o === "string" ? o : null;
  });

  const initiatorConditions = useTrait(initiatorCharacterId, Conditions);

  interface Probe {
    sourceId?: unknown;
    kind?: unknown;
    versusTestId?: unknown;
  }
  const previewedSpec = createMemo<Record<string, unknown> | null>(() => {
    const v = pr();
    if (!v) return null;
    const rollable = client.registry.rollables.get(v.rollableName);
    if (!rollable) return null;
    try {
      const raw = previewRollable(
        rollable,
        client.world,
        v.initiatorCharacterId,
        {
          ...(v.opts as Record<string, unknown>),
          contributions: v.contributions,
        },
      );
      return raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  });

  /**
   * Derived mode, versus-first: a live versus id (even one still waiting
   * on an opponent) shows the versus variant so the pairing is never
   * invisible; the disposition flag comes second; the spec's own kind is
   * a last-resort fallback. `setMode` keeps the underlying contributions
   * mutually exclusive, so the precedence only matters for legacy rolls
   * written before mode selection was unified.
   */
  const activeMode = createMemo<AtelierMode>(() => {
    if (activeVersusId() !== null) return "versus";
    if (activeDisposition()) return "disposition";
    const kind = previewedSpec()?.["kind"];
    return kind === "versus" ? "versus" : "independent";
  });

  const suggestedQuickButtons = createMemo<TbSuggestedQuickModifier[]>(() => {
    const c = initiatorConditions();
    const spec = previewedSpec() as Probe | null;
    if (!c || !spec) return [];
    const sourceId = typeof spec.sourceId === "string" ? spec.sourceId : "";
    const kind = (
      typeof spec.kind === "string" ? spec.kind : ""
    ) as TbRollKind;
    const versusTestId =
      typeof spec.versusTestId === "string" ? spec.versusTestId : null;
    const condition = suggestedQuickModifiersFor({
      conditions: c,
      kind,
      sourceId,
      versusTestId,
    });
    const items = suggestedItemModifiersFor({
      world: client.world,
      characterId: initiatorCharacterId,
      kind,
      sourceId,
    });
    return [...condition, ...items];
  });

  const otherPendingRolls = useQuery([PendingRoll]);
  const versusCandidates = createMemo<VersusCandidate[]>(() => {
    const out: VersusCandidate[] = [];
    for (const row of otherPendingRolls()) {
      if (row.id === rollId) continue;
      const v = row.values.PendingRoll as {
        rollableName: string;
        initiatorCharacterId: string;
        contributions: Contribution[];
        opts: unknown;
      };
      if (!v.rollableName.startsWith("@vtt/system-torchbearer/")) continue;
      const opp = client.world.get(v.initiatorCharacterId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      const charName = opp?.Character.name ?? "(unknown)";
      const peerVersus = versusFromContributions(v.contributions);
      const optsVersus = (v.opts as { versusTestId?: unknown })?.versusTestId;
      const peerActive =
        peerVersus !== undefined
          ? peerVersus
          : typeof optsVersus === "string"
            ? optsVersus
            : null;
      out.push({
        pendingRollId: row.id,
        characterId: v.initiatorCharacterId,
        characterName: charName,
        versusId: peerActive,
      });
    }
    return out;
  });

  /* Persona / Nature / synergy — mirror old hook */
  const initiatorPools = useTrait(initiatorCharacterId, Pools);
  const initiatorAbilities = useTrait(initiatorCharacterId, RawAbilities);
  const personaSpendDeclared = createMemo<number>(() => {
    const v = pr();
    if (!v) return 0;
    return personaSpendTotalFromContributions(v.contributions as Contribution[]);
  });
  const channelDeclared = createMemo<"within" | "outside" | null>(() => {
    const v = pr();
    if (!v) return null;
    const decl = channelNatureFromContributions(
      v.contributions as Contribution[],
    );
    return decl?.scope ?? null;
  });
  const synergyDeclared = createMemo<string[]>(() => {
    const v = pr();
    if (!v) return [];
    return synergyHelpersFromContributions(v.contributions as Contribution[]);
  });
  const personaAvail = createMemo<number>(
    () => initiatorPools()?.persona.current ?? 0,
  );
  const natureRating = createMemo<number>(
    () => initiatorAbilities()?.nature.rating ?? 0,
  );

  /* Helpers + traits */
  const initiatorTraits = useTrait(initiatorCharacterId, CharacterTraits);
  const traitAlreadyUsed = createMemo<boolean>(() => {
    const v = pr();
    if (!v) return false;
    for (const c of v.contributions as Contribution[]) {
      if (c.kind !== TB_MODIFIER_CONTRIB_KIND) continue;
      const mod = c.payload as { source?: string } | undefined;
      if (mod?.source === "trait") return true;
    }
    return false;
  });

  const allCharacters = useQuery([Character, Permissions]);
  const activeRows = useQuery([Active]);
  const initiatorTeam = useTrait(initiatorCharacterId, Team);

  const helpRoll = createMemo<{ kind: TbRollKind; sourceId: string } | null>(
    () => {
      const spec = previewedSpec() as Probe | null;
      if (!spec) return null;
      const sid = typeof spec.sourceId === "string" ? spec.sourceId : "";
      const kind = (
        typeof spec.kind === "string" ? spec.kind : ""
      ) as TbRollKind;
      if (!kind || !sid) return null;
      if (kind === "versus") return null;
      return { kind, sourceId: sid };
    },
  );

  const suggestedHelpNames = createMemo<string[]>(() => {
    const r = helpRoll();
    if (!r) return [];
    if (r.kind !== "skill" && r.kind !== "skill-bl") return [];
    const skill = getSkill(r.sourceId);
    if (!skill) return [];
    return skill.suggestedHelp.map((id) => getSkill(id)?.name ?? id);
  });

  const helperContextOf = (charId: string): HelperContext => {
    const skillsTrait = client.world.get(charId as EntityId, [Skills]) as
      | { Skills: { entries: Record<string, { rating: number }> } }
      | undefined;
    const abilitiesTrait = client.world.get(charId as EntityId, [
      RawAbilities,
    ]) as
      | {
          RawAbilities: {
            will: { rating: number };
            health: { rating: number };
            nature: { rating: number; descriptors: string[] };
          };
        }
      | undefined;
    const townTrait = client.world.get(charId as EntityId, [TownAbilities]) as
      | {
          TownAbilities: {
            resources: { rating: number };
            circles: { rating: number };
          };
        }
      | undefined;
    const skills = new Map<string, number>();
    const entries = skillsTrait?.Skills.entries ?? {};
    for (const [id, e] of Object.entries(entries)) {
      if (e?.rating > 0) skills.set(id, e.rating);
    }
    return {
      skills,
      will: abilitiesTrait?.RawAbilities.will.rating ?? 0,
      health: abilitiesTrait?.RawAbilities.health.rating ?? 0,
      nature: abilitiesTrait?.RawAbilities.nature.rating ?? 0,
      natureDescriptors: abilitiesTrait?.RawAbilities.nature.descriptors ?? [],
      resources: townTrait?.TownAbilities.resources.rating ?? 0,
      circles: townTrait?.TownAbilities.circles.rating ?? 0,
    };
  };

  const gmOptionsFor = (
    rollKind: TbRollKind,
    rollSourceId: string,
    helper: HelperContext,
    automatic: ReadonlyArray<HelpOption>,
  ): HelpOption[] => {
    const taken = new Set(automatic.map((o) => o.id));
    const out: HelpOption[] = [];
    for (const [id, rating] of helper.skills) {
      const optionId = `skill:${id}`;
      if (taken.has(optionId)) continue;
      if (
        id === rollSourceId &&
        rollKind !== "ability" &&
        rollKind !== "town-ability"
      ) {
        continue;
      }
      const skill = getSkill(id);
      out.push({
        id: optionId,
        label: `${skill?.name ?? id} ${rating}`,
        rating,
        via: "suggested-skill",
      });
    }
    return out;
  };

  const helpers = createMemo<HelperRow[]>(() => {
    const m = me();
    if (!m) return [];
    const r = helpRoll();
    if (!r) return [];
    const rows: HelperRow[] = [];
    const live = pr();
    const contributions = (live?.contributions ?? []) as Contribution[];
    const myTeam = initiatorTeam()?.kind ?? "party";
    activeRows();
    for (const row of allCharacters()) {
      if (row.id === initiatorCharacterId) continue;
      const perm = row.values.Permissions as
        | Parameters<typeof canWrite>[1]
        | undefined;
      if (!canWrite(m, perm)) continue;
      if (!isActive(client.world, row.id)) continue;
      const helperTeam = client.world.get(row.id as EntityId, [Team]) as
        | { Team: { kind: "party" | "enemy" } }
        | undefined;
      const helperTeamKind = helperTeam?.Team.kind ?? "party";
      if (helperTeamKind !== myTeam) continue;
      const ctx = helperContextOf(row.id);
      const automatic = eligibleHelpFor(r, ctx);
      const gm = gmOptionsFor(r.kind, r.sourceId, ctx, automatic);
      if (automatic.length === 0 && gm.length === 0) continue;
      let activeOptionId: string | null = null;
      for (const c of contributions) {
        if (c.kind !== TB_MODIFIER_CONTRIB_KIND) continue;
        const mod = c.payload as { providedBy?: unknown } | undefined;
        const pb = typeof mod?.providedBy === "string" ? mod.providedBy : "";
        if (!pb.startsWith(`help:${row.id}:`)) continue;
        activeOptionId = pb.slice(`help:${row.id}:`.length);
      }
      rows.push({
        characterId: row.id,
        name: (row.values.Character as { name: string }).name,
        automatic,
        gm,
        activeOptionId,
      });
    }
    return rows;
  });

  const helperFateAvail = (helperCharacterId: string): number => {
    const got = client.world.get(helperCharacterId as EntityId, [Pools]) as
      | { Pools: { fate: { current: number } } }
      | undefined;
    return got?.Pools.fate.current ?? 0;
  };

  /* permissioning */
  const canCommit = createMemo<boolean>(() => {
    const m = me();
    if (!m) return false;
    return m.userId === initiatorUserId() || m.role === "gm";
  });
  // Anyone signed in can offer a contribution; permissions checks happen
  // server-side. Cards just need a "do we have a user?" gate to disable
  // dispatch attempts that would no-op.
  const canContribute = createMemo<boolean>(() => !!me());

  /* -------- contribution dispatchers (one per kind) -------- */
  const contributeRaw = (contribution: Omit<Contribution, "fromUserId"> & {
    fromUserId?: string;
  }) => {
    const m = me();
    if (!m) return;
    const full: Contribution = {
      ...contribution,
      fromUserId: contribution.fromUserId ?? m.userId,
    } as Contribution;
    const handle = client.dispatch(
      ContributeToPendingRoll({
        pendingRollId: rollId,
        contribution: full,
      }) as CommandInstance,
    );
    void handle.ack.then((ack) => {
      if (!ack.ok) {
        // eslint-disable-next-line no-console
        console.error("ContributeToPendingRoll rejected:", ack.reason, {
          contribution: full,
        });
      }
    });
  };

  const offerQuickMod = (mod: Omit<TbRollModifier, "id" | "source">) => {
    const m = me();
    if (!m) return;
    const full: TbRollModifier = {
      id: freshModifierId(),
      source: "manual",
      ...mod,
    };
    contributeRaw({
      kind: TB_MODIFIER_CONTRIB_KIND,
      label: formatModifier(full),
      fromCharacterId: initiatorCharacterId,
      payload: full,
    });
  };

  const applySuggested = (sq: TbSuggestedQuickModifier) => {
    const full: TbRollModifier = {
      id: freshModifierId(),
      source: sq.modifier.source ?? "condition",
      kind: sq.modifier.kind,
      value: sq.modifier.value,
      label: sq.modifier.label,
      apply: sq.modifier.apply,
      providedBy: sq.modifier.providedBy,
    };
    contributeRaw({
      kind: TB_MODIFIER_CONTRIB_KIND,
      label: formatModifier(full),
      fromCharacterId: initiatorCharacterId,
      payload: full,
    });
  };

  const offerLabelledMod = (m: {
    kind: TbRollModifierKind;
    value: number;
    apply: TbRollModifierApply;
    label: string;
  }) => {
    offerQuickMod({
      kind: m.kind,
      value: m.value,
      label: m.label,
      apply: m.apply,
    });
  };

  const removeContribution = (modifierId: string) => {
    client.dispatch(
      RemoveContribution({
        pendingRollId: rollId,
        modifierId,
      }) as CommandInstance,
    );
  };

  const toggleHeroic = (next: boolean) => {
    contributeRaw({
      kind: TB_HEROIC_CONTRIB_KIND,
      label: next ? "Heroic on (3+ counts)" : "Heroic off (4+ counts)",
      fromCharacterId: initiatorCharacterId,
      payload: { enabled: next },
      replaces: "tb:heroic",
    });
  };

  const pickObstacle = (n: number) => {
    const next = activeObstacle() === n ? null : n;
    contributeRaw({
      kind: TB_OBSTACLE_CONTRIB_KIND,
      label: next === null ? "Obstacle cleared" : `Ob ${next}`,
      fromCharacterId: initiatorCharacterId,
      payload: { value: next },
      replaces: "tb:base-obstacle",
    });
  };

  const toggleDisposition = (next: boolean) => {
    const seededAddTo: DispoAddTo | null = next
      ? initiatorIsMonster()
        ? "nature"
        : activeDispositionAddTo()
      : null;
    contributeRaw({
      kind: TB_DISPOSITION_CONTRIB_KIND,
      label: next ? "Disposition roll (SG p.63)" : "Disposition off",
      fromCharacterId: initiatorCharacterId,
      payload: {
        enabled: next,
        addTo: seededAddTo,
        pool:
          next && seededAddTo === "nature" ? activeMonsterPool() : undefined,
      },
      replaces: "tb:disposition",
    });
  };

  const pickDispositionAddTo = (next: DispoAddTo) => {
    const label =
      next === "will"
        ? "Disposition: + Will"
        : next === "health"
          ? "Disposition: + Health"
          : "Disposition: + Nature";
    contributeRaw({
      kind: TB_DISPOSITION_CONTRIB_KIND,
      label,
      fromCharacterId: initiatorCharacterId,
      payload: {
        enabled: true,
        addTo: next,
        pool: next === "nature" ? activeMonsterPool() : undefined,
      },
      replaces: "tb:disposition",
    });
  };

  const pickMonsterPool = (next: DispoMonsterPool) => {
    contributeRaw({
      kind: TB_DISPOSITION_CONTRIB_KIND,
      label:
        next === "within"
          ? "Disposition: within Nature (full)"
          : "Disposition: outside Nature (half)",
      fromCharacterId: initiatorCharacterId,
      payload: { enabled: true, addTo: "nature", pool: next },
      replaces: "tb:disposition",
    });
  };

  const togglePairWith = (cand: VersusCandidate) => {
    const m = me();
    if (!m) return;
    const myActive = activeVersusId();
    const alreadyPaired =
      myActive !== null && cand.versusId !== null && myActive === cand.versusId;
    const next = alreadyPaired ? null : cand.versusId ?? freshVersusTestId();
    const payload = { versusTestId: next };
    const myChar = client.world.get(
      initiatorCharacterId,
      [Character],
    ) as { Character: { name: string } } | undefined;
    const myName = myChar?.Character.name ?? "your roll";
    const myLabel =
      next === null ? "Versus cleared" : `vs ${cand.characterName}`;
    contributeRaw({
      kind: TB_VERSUS_CONTRIB_KIND,
      label: myLabel,
      fromCharacterId: initiatorCharacterId,
      payload,
      replaces: "tb:versus",
    });
    const peerLabel = next === null ? "Versus cleared" : `vs ${myName}`;
    client.dispatch(
      ContributeToPendingRoll({
        pendingRollId: cand.pendingRollId as Parameters<
          typeof ContributeToPendingRoll
        >[0]["pendingRollId"],
        contribution: {
          kind: TB_VERSUS_CONTRIB_KIND,
          label: peerLabel,
          fromUserId: m.userId,
          payload,
          replaces: "tb:versus",
        },
      }) as CommandInstance,
    );
  };

  const unpair = () => {
    // Clear the pairing on BOTH rolls. A one-sided clear would leave the
    // peer pointing at a versus id nobody else carries — stuck in versus
    // mode with a "?" opponent.
    const myActive = activeVersusId();
    if (myActive !== null) {
      const peer = versusCandidates().find((c) => c.versusId === myActive);
      if (peer) {
        // togglePairWith on an already-paired candidate clears both sides.
        togglePairWith(peer);
        return;
      }
    }
    contributeRaw({
      kind: TB_VERSUS_CONTRIB_KIND,
      label: "Versus cleared",
      fromCharacterId: initiatorCharacterId,
      payload: { versusTestId: null },
      replaces: "tb:versus",
    });
  };

  /**
   * Switch the editor variant. Mode is derived from the mechanics
   * contributions, so "setting" a mode means making those contributions
   * exclusive: leaving versus unpairs (both sides), leaving disposition
   * clears the disposition flag, and entering versus before an opponent
   * is picked parks a fresh versus id on this roll so every viewer sees
   * the versus variant with its pair-with list.
   */
  const setMode = (next: AtelierMode) => {
    if (next === activeMode()) return;
    if (next !== "versus" && activeVersusId() !== null) unpair();
    if (next === "disposition") {
      toggleDisposition(true);
    } else if (activeDisposition()) {
      toggleDisposition(false);
    }
    if (next === "versus" && activeVersusId() === null) {
      contributeRaw({
        kind: TB_VERSUS_CONTRIB_KIND,
        label: "Versus test — pick an opponent",
        fromCharacterId: initiatorCharacterId,
        payload: { versusTestId: freshVersusTestId() },
        replaces: "tb:versus",
      });
    }
  };

  const declarePersonaDice = (count: 1) => {
    contributeRaw({
      kind: TB_PERSONA_SPEND_CONTRIB_KIND,
      label: `Spend ${count} persona (+${count}D)`,
      fromCharacterId: initiatorCharacterId,
      payload: { id: freshModifierId(), count },
    });
  };

  const toggleChannelNature = (scope: "within" | "outside") => {
    contributeRaw({
      kind: TB_CHANNEL_NATURE_CONTRIB_KIND,
      label: `Channel Nature (${scope})`,
      fromCharacterId: initiatorCharacterId,
      payload: { id: freshModifierId(), scope },
      replaces: "tb:channel-nature",
    });
  };

  const useTraitFor = (traitIndex: number) => {
    client.dispatch(
      UseTraitOnRoll({
        pendingRollId: rollId,
        characterId: initiatorCharacterId,
        traitIndex,
        direction: "for",
      }) as CommandInstance,
    );
  };

  const useTraitAgainst = (
    traitIndex: number,
    severity: "minus-1d" | "plus-2d-opp",
  ) => {
    client.dispatch(
      UseTraitOnRoll({
        pendingRollId: rollId,
        characterId: initiatorCharacterId,
        traitIndex,
        direction: "against",
        severity,
      }) as CommandInstance,
    );
  };

  const offerHelp = (h: HelperRow, optionId: string, viaGm: boolean) => {
    const m = me();
    if (!m) return;
    const opt =
      h.automatic.find((o) => o.id === optionId) ??
      h.gm.find((o) => o.id === optionId);
    if (!opt) return;
    const tag = viaGm ? " (per GM)" : "";
    const modifier: TbRollModifier = {
      id: freshModifierId(),
      kind: "dice",
      value: 1,
      label: `${h.name} helps with ${opt.label}${tag}`,
      apply: "always",
      source: "help",
      providedBy: helpProvidedBy(h.characterId, opt.id),
    };
    contributeRaw({
      kind: TB_MODIFIER_CONTRIB_KIND,
      label: formatModifier(modifier),
      fromCharacterId: h.characterId as EntityId,
      payload: modifier,
      replaces: helpReplacesKey(h.characterId),
    });
  };

  const toggleSynergy = (h: HelperRow) => {
    contributeRaw({
      kind: TB_SYNERGY_CONTRIB_KIND,
      label: `${h.name} synergy (1 fate, DH p.87)`,
      fromCharacterId: h.characterId as EntityId,
      payload: { id: freshModifierId(), helperCharacterId: h.characterId },
      replaces: `tb:synergy:${h.characterId}`,
    });
  };

  const commit = () => {
    const v = pr();
    if (!v) return;
    const rollable = client.registry.rollables.get(v.rollableName);
    if (!rollable) return;
    const result = invokeRollable(
      rollable,
      client.world,
      v.initiatorCharacterId,
      {
        ...(v.opts as Record<string, unknown>),
        contributions: v.contributions,
      },
    );
    if (result) client.dispatch(result.command);
    client.dispatch(
      CommitPendingRoll({ pendingRollId: rollId }) as CommandInstance,
    );
  };

  const cancel = () => {
    client.dispatch(
      CancelPendingRoll({ pendingRollId: rollId }) as CommandInstance,
    );
  };

  return {
    rollId,
    pr,
    previewedSpec,
    initiatorCharacterId,
    initiatorUserId,
    initiatorName,
    initiatorIsMonster,
    rollableName,
    panelHeroic,
    activeObstacle,
    activeDisposition,
    activeDispositionAddTo,
    activeMonsterPool,
    activeVersusId,
    activeMode,
    personaSpendDeclared,
    channelDeclared,
    synergyDeclared,
    personaAvail,
    natureRating,
    suggestedQuickButtons,
    traitAlreadyUsed,
    versusCandidates,
    helpers,
    suggestedHelpNames,
    initiatorTraits,
    helperFateAvail,
    canCommit,
    canContribute,
    offerQuickMod,
    applySuggested,
    offerLabelledMod,
    removeContribution,
    pickObstacle,
    toggleHeroic,
    toggleDisposition,
    setMode,
    pickDispositionAddTo,
    pickMonsterPool,
    togglePairWith,
    unpair,
    declarePersonaDice,
    toggleChannelNature,
    useTraitFor,
    useTraitAgainst,
    offerHelp,
    toggleSynergy,
    commit,
    cancel,
  };
}
