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
  qualifiedName,
  type CommandInstance,
} from "@vtt/substrate";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { kit } from "@vtt/characters/client";
import {
  ContributeToPendingRoll,
  PendingRoll,
  type Contribution,
  type PendingRollContributor,
  type PendingRollContributorArgs,
} from "@vtt/characters/shared";
import { Character } from "@vtt/characters/shared";
import { canWrite, Permissions } from "@vtt/permissions/shared";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import {
  CharacterTraits,
  Conditions,
  Pools,
  RawAbilities,
  Skills,
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
  type HelperContext,
  type HelpOption,
  type TbRollKind,
  type TbRollModifier,
  type TbRollModifierApply,
  type TbRollModifierKind,
  type TbSuggestedQuickModifier,
  formatModifier,
} from "../shared/index.js";

/**
 * Pending-roll contributor for Torchbearer rolls.
 *
 * Renders inside the existing pending-roll panel (chat rail) for any
 * roll whose `rollableName` is under `@vtt/system-torchbearer/`. Lets
 * the player or GM stack TB-shaped modifiers onto the spec before
 * commit:
 *
 *   - ±1D / ±1s quick buttons (most common case at the table)
 *   - "Add a labelled modifier" with kind picker (D / s),
 *     value (signed integer), apply mode (always / on success /
 *     on fail), and a short label
 *
 * Each click emits a `Contribution` with `kind: "tb-modifier"` and a
 * payload that is exactly the `TbRollModifier` shape — the rollable's
 * compute fn picks them up via `modifiersFromContributions`.
 *
 * What's deliberately NOT in this contributor (yet):
 *
 *   - Wise / trait / fate / persona spend. These mutate the spending
 *     character's resources as a side effect; they need a dedicated
 *     command pair (Spend → Refund) so the panel can surface the
 *     cost. Stub-shape covered by the labelled-modifier UI here.
 *
 *   - Provider-driven mods (an enchanted item that says "+1D"). The
 *     `TbRollModifierProvidersSlot` (declared in this plugin) will
 *     enumerate registered providers when the panel opens, but no
 *     provider machinery exists yet.
 */

let modifierCounter = 0;
function freshModifierId(): string {
  modifierCounter += 1;
  return `manual:${modifierCounter}:${Date.now().toString(36)}`;
}

/**
 * Generate a fresh versus-test correlation key. Uses
 * `crypto.randomUUID()` when available; falls back to a coarse
 * timestamp+random combo on older runtimes (jsdom in some test
 * environments). Prefixed `versus:` for legibility in chat-row
 * tooltips and event logs.
 */
function freshVersusTestId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const uuid = g.crypto?.randomUUID?.();
  if (uuid) return `versus:${uuid}`;
  return `versus:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function TbContributorPanel(props: PendingRollContributorArgs): JSX.Element {
  const me = kit.useMe();
  const client = useClient();
  const pr = useTrait(props.pendingRollId, PendingRoll);
  // All other open pending rolls — for the versus picker. Reactive
  // on the world so pairings light up the moment a peer opens
  // their own pending roll.
  const otherPendingRolls = useQuery([PendingRoll]);

  // Latest panel-toggled heroic state, derived from the pending roll's
  // chronological contribution list. `undefined` means "no toggle yet,
  // defer to the underlying spec / opts" — the button shows a generic
  // "make heroic" affordance rather than locking to on/off.
  const panelHeroic = createMemo<boolean | undefined>(() => {
    const value = pr();
    if (!value) return undefined;
    return heroicFromContributions(value.contributions as Contribution[]);
  });

  // Latest panel-set obstacle. `undefined` means "no panel pick yet —
  // show whatever the pending roll's `opts.obstacle` was set to (or
  // null)". `null` means "panel cleared the obstacle". A number means
  // "panel set Ob N" (1-10). Used to highlight the active obstacle
  // button so re-clicking the same value clears it.
  const panelObstacle = createMemo<number | null | undefined>(() => {
    const value = pr();
    if (!value) return undefined;
    return obstacleFromContributions(value.contributions as Contribution[]);
  });

  // Effective obstacle for highlighting purposes — what the row
  // shows as "currently selected". If the panel has posted, that
  // wins; otherwise fall back to opts.obstacle from when the roll
  // opened. Display-only; the rollable's compute resolves the same
  // priority on commit.
  const activeObstacle = createMemo<number | null>(() => {
    const fromPanel = panelObstacle();
    if (fromPanel !== undefined) return fromPanel;
    const value = pr();
    if (!value) return null;
    const o = (value.opts as { obstacle?: unknown } | undefined)?.obstacle;
    return typeof o === "number" ? o : null;
  });

  // Active disposition flag — panel contribution wins over
  // opts.dispositionMode; default off.
  const activeDisposition = createMemo<boolean>(() => {
    const fromPanel = dispositionFromContributions(
      (pr()?.contributions ?? []) as Contribution[],
    );
    if (typeof fromPanel === "boolean") return fromPanel;
    const fromOpts = (pr()?.opts as { dispositionMode?: unknown } | undefined)
      ?.dispositionMode;
    return typeof fromOpts === "boolean" ? fromOpts : false;
  });

  // Active disposition addTo — which ability ("will"/"health") is the
  // additive base for the dispo total. Panel contribution > opts; null
  // when explicitly cleared, undefined when never set.
  const activeDispositionAddTo = createMemo<"will" | "health" | null>(() => {
    const fromPanel = dispositionAddToFromContributions(
      (pr()?.contributions ?? []) as Contribution[],
    );
    if (fromPanel !== undefined) return fromPanel;
    const fromOpts = (
      pr()?.opts as { dispositionAddTo?: "will" | "health" | null } | undefined
    )?.dispositionAddTo;
    return fromOpts ?? null;
  });

  // Currently-paired versusTestId (panel contribution wins; opts.versusTestId
  // is the fallback). `null` means explicitly cleared; `undefined`
  // / "" means no pairing.
  const activeVersusId = createMemo<string | null>(() => {
    const fromPanel = versusFromContributions(
      (pr()?.contributions ?? []) as Contribution[],
    );
    if (fromPanel !== undefined) return fromPanel;
    const o = (pr()?.opts as { versusTestId?: unknown } | undefined)
      ?.versusTestId;
    return typeof o === "string" ? o : null;
  });

  // Live Conditions trait of the initiator — used to derive
  // contextual quick-mod buttons (e.g. Angry's GM-option +1 Ob).
  const initiatorConditions = useTrait(
    props.initiatorCharacterId,
    Conditions,
  );

  /**
   * Live preview of the TbRollSpec that *would* land on the wire if the
   * roll were committed right now. Several panel sections key their
   * eligibility off this — the help picker needs the roll's kind +
   * sourceId, the Angry quick button needs versusTestId, etc.
   */
  interface Probe {
    sourceId?: unknown;
    kind?: unknown;
    versusTestId?: unknown;
  }
  const previewedSpec = createMemo<Probe | null>(() => {
    const value = pr();
    if (!value) return null;
    const rollable = client.registry.rollables.get(value.rollableName);
    if (!rollable) return null;
    try {
      const raw = previewRollable(
        rollable,
        client.world,
        value.initiatorCharacterId,
        {
          ...(value.opts as Record<string, unknown>),
          contributions: value.contributions,
        },
      );
      return raw && typeof raw === "object" ? (raw as Probe) : null;
    } catch {
      return null;
    }
  });

  /**
   * Contextual quick-modifier buttons — surfaced only when the
   * character's state + the rollable's source make a particular
   * GM-option / discretionary modifier relevant. Today this lights
   * up Angry's +1 Ob for non-versus precision/social rolls; the
   * pattern extends to anything else `suggestedQuickModifiersFor`
   * decides to publish (level benefits, gear effects, etc.).
   */
  const suggestedQuickButtons = createMemo<TbSuggestedQuickModifier[]>(() => {
    const c = initiatorConditions();
    const spec = previewedSpec();
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
      characterId: props.initiatorCharacterId,
      kind,
      sourceId,
    });
    return [...condition, ...items];
  });

  /**
   * Click handler for a suggested quick button. Posts a regular
   * `tb-modifier` contribution carrying the suggestion's modifier
   * payload — same flow as the static quick buttons. Stackable
   * (no `replaces` key) so a player can apply twice if the GM rules
   * the penalty doubles, though that's rare.
   */
  const applySuggested = (sq: TbSuggestedQuickModifier) => {
    const m = me();
    if (!m) return;
    const full: TbRollModifier = {
      id: freshModifierId(),
      source: sq.modifier.source ?? "condition",
      kind: sq.modifier.kind,
      value: sq.modifier.value,
      label: sq.modifier.label,
      apply: sq.modifier.apply,
      providedBy: sq.modifier.providedBy,
    };
    props.contribute({
      kind: TB_MODIFIER_CONTRIB_KIND,
      label: formatModifier(full),
      fromUserId: m.userId,
      fromCharacterId: props.initiatorCharacterId,
      payload: full,
    });
  };

  // Other pending rolls eligible for pairing — every active TB
  // pending roll except this one. Each row carries the opponent's
  // initiator-character name and their currently-active versus id
  // (so we can highlight when this panel and that one already share
  // a pairing key).
  interface VersusCandidate {
    pendingRollId: string;
    characterId: string;
    characterName: string;
    versusId: string | null;
  }
  const versusCandidates = createMemo<VersusCandidate[]>(() => {
    const out: VersusCandidate[] = [];
    for (const row of otherPendingRolls()) {
      if (row.id === props.pendingRollId) continue;
      const v = row.values.PendingRoll as {
        rollableName: string;
        initiatorCharacterId: string;
        contributions: Contribution[];
        opts: unknown;
      };
      // Only TB rollables. Other systems' pending rolls aren't
      // candidates for a TB versus test.
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

  // Quick-mod buttons: dispatch immediately on click.
  const offer = (mod: Omit<TbRollModifier, "id" | "source">) => {
    const m = me();
    if (!m) return;
    const full: TbRollModifier = {
      id: freshModifierId(),
      source: "manual",
      ...mod,
    };
    const contribution: Contribution = {
      kind: TB_MODIFIER_CONTRIB_KIND,
      label: formatModifier(full),
      fromUserId: m.userId,
      fromCharacterId: props.initiatorCharacterId,
      payload: full,
    };
    props.contribute(contribution);
  };

  // Heroic toggle: a single contribution that flips the success target
  // for the duration of this pending roll. Posting again with the
  // opposite value undoes it (last-wins resolution in
  // `heroicFromContributions`).
  const toggleHeroic = (next: boolean) => {
    const m = me();
    if (!m) return;
    props.contribute({
      kind: TB_HEROIC_CONTRIB_KIND,
      label: next ? "Heroic on (3+ counts)" : "Heroic off (4+ counts)",
      fromUserId: m.userId,
      fromCharacterId: props.initiatorCharacterId,
      payload: { enabled: next },
      // Heroic is a single-value setting; the contribution-recording
      // system replaces any prior tb:heroic in the contributions list
      // so the panel's history shows just the live state.
      replaces: "tb:heroic",
    });
  };

  /* -------- Pre-roll persona / channel-nature / synergy spends -------- */

  // Initiator's pools / abilities for gating the buttons.
  const initiatorPools = useTrait(props.initiatorCharacterId, Pools);
  const initiatorAbilities = useTrait(props.initiatorCharacterId, RawAbilities);

  /** Cumulative persona declared on this pending roll (cap 3 per RAW). */
  const personaSpendDeclared = createMemo<number>(() => {
    const value = pr();
    if (!value) return 0;
    return personaSpendTotalFromContributions(
      value.contributions as Contribution[],
    );
  });

  /** Latest channel-nature scope on the pending roll (or null). */
  const channelDeclared = createMemo<"within" | "outside" | null>(() => {
    const value = pr();
    if (!value) return null;
    const decl = channelNatureFromContributions(
      value.contributions as Contribution[],
    );
    return decl?.scope ?? null;
  });

  /** Helpers who've declared synergy on this pending roll. */
  const synergyDeclared = createMemo<string[]>(() => {
    const value = pr();
    if (!value) return [];
    return synergyHelpersFromContributions(
      value.contributions as Contribution[],
    );
  });

  const fateAvail = createMemo<number>(
    () => initiatorPools()?.fate.current ?? 0,
  );
  const personaAvail = createMemo<number>(
    () => initiatorPools()?.persona.current ?? 0,
  );
  const natureRating = createMemo<number>(
    () => initiatorAbilities()?.nature.rating ?? 0,
  );

  /**
   * Stamp one persona-dice declaration. Each click adds an independent
   * `tb-persona-spend` contribution; the rollable's compute sums them
   * (capped at 3). Each contribution carries a unique `id`, and the
   * rollable mints its synthesized `+ND Persona` modifier with the
   * same id — so the standard PendingRollPanel chip × can clear a
   * single mistaken click. The fate / persona pool isn't decremented
   * until commit — see `TbCommitSpendsSystem`.
   */
  const declarePersonaDice = (count: 1) => {
    const m = me();
    if (!m) return;
    props.contribute({
      kind: TB_PERSONA_SPEND_CONTRIB_KIND,
      label: `Spend ${count} persona (+${count}D)`,
      fromUserId: m.userId,
      fromCharacterId: props.initiatorCharacterId,
      payload: { id: freshModifierId(), count },
    });
  };

  /**
   * Toggle channel-nature. Posts `tb-channel-nature` with `scope`;
   * posting again with the same scope or a different one supersedes
   * the previous via `replaces: "tb:channel-nature"`. The contribution
   * carries a fresh `id` so the synthesized modifier chip's × can
   * clear the channel entirely.
   */
  const toggleChannelNature = (scope: "within" | "outside") => {
    const m = me();
    if (!m) return;
    props.contribute({
      kind: TB_CHANNEL_NATURE_CONTRIB_KIND,
      label: `Channel Nature (${scope})`,
      fromUserId: m.userId,
      fromCharacterId: props.initiatorCharacterId,
      payload: { id: freshModifierId(), scope },
      replaces: "tb:channel-nature",
    });
  };

  // Obstacle toggle: clicking a button sets that obstacle; clicking
  // the active obstacle again clears it. Posts `tb-obstacle` with
  // either the numeric pick or `null`. last-wins resolution lets a
  // GM correct a player's pick by clicking a different value.
  /**
   * Toggle disposition mode. Posts a tb-disposition contribution
   * with `replaces: "tb:disposition"` so subsequent toggles
   * supersede the previous setting cleanly. When toggling off, also
   * clears the addTo selection.
   */
  const toggleDisposition = (next: boolean) => {
    const m = me();
    if (!m) return;
    props.contribute({
      kind: TB_DISPOSITION_CONTRIB_KIND,
      label: next
        ? "Disposition roll (SG p.63)"
        : "Disposition off",
      fromUserId: m.userId,
      fromCharacterId: props.initiatorCharacterId,
      payload: { enabled: next, addTo: next ? activeDispositionAddTo() : null },
      replaces: "tb:disposition",
    });
  };

  /**
   * Pick the Will or Health additive base for the disposition roll.
   * Per SG p.63-64 / LM p.106 the conflict type pins which ability is
   * added: Kill / Drive Off / Flee / Pursue → Health; Convince /
   * Capture / Trick → Will. The pending-roll panel needs an explicit
   * pick so skill rolls (where the dice pool ≠ the additive base)
   * compute correctly.
   */
  const pickDispositionAddTo = (next: "will" | "health") => {
    const m = me();
    if (!m) return;
    props.contribute({
      kind: TB_DISPOSITION_CONTRIB_KIND,
      label: `Disposition: + ${next === "will" ? "Will" : "Health"}`,
      fromUserId: m.userId,
      fromCharacterId: props.initiatorCharacterId,
      payload: { enabled: true, addTo: next },
      replaces: "tb:disposition",
    });
  };

  const pickObstacle = (n: number) => {
    const m = me();
    if (!m) return;
    const next = activeObstacle() === n ? null : n;
    props.contribute({
      kind: TB_OBSTACLE_CONTRIB_KIND,
      label: next === null ? "Obstacle cleared" : `Ob ${next}`,
      fromUserId: m.userId,
      fromCharacterId: props.initiatorCharacterId,
      payload: { value: next },
      // Base obstacle is single-value; replace any prior pick so the
      // panel shows just the live setting. Quick-button +1Ob / -1Ob
      // modifiers stack normally as `tb-modifier` contributions.
      replaces: "tb:base-obstacle",
    });
  };

  /**
   * Toggle a versus pairing with another pending roll. Posts the
   * tb-versus contribution to BOTH sides so each panel shows the
   * link without the opponent doing anything. If we're already
   * paired with the candidate, the click clears both sides.
   *
   * Re-uses the candidate's existing versusTestId when present (so
   * a third party joining an established pairing inherits the same
   * key). Otherwise mints a fresh `versus:<uuid>` and applies it.
   */
  const togglePairWith = (cand: VersusCandidate) => {
    const m = me();
    if (!m) return;
    const myActive = activeVersusId();
    const alreadyPaired =
      myActive !== null && cand.versusId !== null && myActive === cand.versusId;
    const next = alreadyPaired ? null : cand.versusId ?? freshVersusTestId();
    const payload = { versusTestId: next };
    // Look up my character's display name for the peer-side label
    // — we want "vs Bryn" on the opponent's panel, not "vs <userId>"
    // (the userId is opaque to other players and looks like garbage).
    const myChar = client.world.get(props.initiatorCharacterId, [Character]) as
      | { Character: { name: string } }
      | undefined;
    const myCharacterName = myChar?.Character.name ?? "your roll";
    const myLabel =
      next === null ? "Versus cleared" : `vs ${cand.characterName}`;
    // Post to my side via the standard contribute callback.
    props.contribute({
      kind: TB_VERSUS_CONTRIB_KIND,
      label: myLabel,
      fromUserId: m.userId,
      fromCharacterId: props.initiatorCharacterId,
      payload,
      replaces: "tb:versus",
    });
    // Post to the opponent's side directly — same key, mirrored
    // label. The contribute callback prop only writes to *this*
    // pending roll, so we go through the command pipeline to
    // address the opponent's pendingRollId. Server-side dedup
    // (`replaces: "tb:versus"`) makes this idempotent.
    const peerLabel =
      next === null ? "Versus cleared" : `vs ${myCharacterName}`;
    client.dispatch(
      ContributeToPendingRoll({
        pendingRollId: cand.pendingRollId as Parameters<
          typeof ContributeToPendingRoll
        >[0]["pendingRollId"],
        contribution: {
          kind: TB_VERSUS_CONTRIB_KIND,
          label: peerLabel,
          fromUserId: m.userId,
          // Don't claim the opponent's character — we're posting on
          // behalf of *us*, not their character.
          payload,
          replaces: "tb:versus",
        },
      }) as CommandInstance,
    );
  };

  // Labelled-modifier form state.
  const [kind, setKind] = createSignal<TbRollModifierKind>("dice");
  const [value, setValue] = createSignal<string>("1");
  const [apply, setApply] = createSignal<TbRollModifierApply>("always");
  const [label, setLabel] = createSignal<string>("");

  const submitLabelled = () => {
    const v = Number(value());
    if (!Number.isFinite(v) || !Number.isInteger(v) || v === 0) return;
    const lbl = label().trim();
    if (lbl.length === 0) return;
    offer({
      kind: kind(),
      value: v,
      apply: apply(),
      label: lbl,
    });
    setValue("1");
    setLabel("");
  };

  /* -------- Help (DH p.37) -------- */
  // Every Character entity in the world (with Permissions) — used to
  // enumerate the helper roster. Reactive so a GM dropping a new NPC
  // shows up live.
  const allCharacters = useQuery([Character, Permissions]);

  // Roll's headline kind/sourceId — what the helper is helping with.
  // Read off the previewed spec so it tracks as panel toggles
  // (heroic, disposition, versus pick) shift the kind.
  const helpRoll = createMemo<{ kind: TbRollKind; sourceId: string } | null>(() => {
    const spec = previewedSpec();
    if (!spec) return null;
    const sid = typeof spec.sourceId === "string" ? spec.sourceId : "";
    const kind = (typeof spec.kind === "string" ? spec.kind : "") as TbRollKind;
    if (!kind || !sid) return null;
    if (kind === "versus") return null; // versus pairs aren't directly helped
    return { kind, sourceId: sid };
  });

  /**
   * The skill's printed suggested-help skill names — for the small-font
   * citation row underneath the "Helping" header. Empty for ability
   * rolls (which have no list — same-ability help is the only path).
   */
  const suggestedHelpNames = createMemo<string[]>(() => {
    const r = helpRoll();
    if (!r) return [];
    if (r.kind !== "skill" && r.kind !== "skill-bl") return [];
    const skill = getSkill(r.sourceId);
    if (!skill) return [];
    return skill.suggestedHelp.map((id) => getSkill(id)?.name ?? id);
  });

  /**
   * Build a HelperContext snapshot for a given character. Reads Skills,
   * RawAbilities, TownAbilities defensively — any of these traits may
   * not have been materialised yet on a freshly-spawned character.
   */
  const helperContextOf = (charId: string): HelperContext => {
    const skillsTrait = client.world.get(charId as Parameters<typeof client.world.get>[0], [Skills]) as
      | { Skills: { entries: Record<string, { rating: number }> } }
      | undefined;
    const abilitiesTrait = client.world.get(charId as Parameters<typeof client.world.get>[0], [RawAbilities]) as
      | {
          RawAbilities: {
            will: { rating: number };
            health: { rating: number };
            nature: { rating: number; descriptors: string[] };
          };
        }
      | undefined;
    const townTrait = client.world.get(charId as Parameters<typeof client.world.get>[0], [TownAbilities]) as
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

  /**
   * Build the "per GM" option list — every skill the helper has at
   * rating > 0 that is NOT already an automatic option, plus same-rated
   * abilities the rules don't auto-allow. The GM-discretion slot per
   * DH p.37 is "one additional skill the GM rules appropriate" — we
   * surface every candidate and let the table negotiate which one.
   */
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
      // The roller's own skill is the "same-skill" automatic — already
      // handled. Skip to avoid duplicate.
      if (id === rollSourceId && rollKind !== "ability" && rollKind !== "town-ability") continue;
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

  interface HelperRow {
    characterId: string;
    name: string;
    automatic: HelpOption[];
    gm: HelpOption[];
    activeOptionId: string | null;
  }

  /**
   * The full helper roster — every Character the current user can
   * write to, except the initiator. Each row carries its automatic
   * (rules-permitted) options plus its GM-discretion options. We
   * include rows with no automatic options so the user can still
   * propose GM-allowed help; rows with neither automatic nor GM
   * options (everything at rating 0) are filtered out.
   */
  const helpers = createMemo<HelperRow[]>(() => {
    const m = me();
    if (!m) return [];
    const r = helpRoll();
    if (!r) return [];
    const rows: HelperRow[] = [];
    const live = pr();
    const contributions = (live?.contributions ?? []) as Contribution[];
    for (const row of allCharacters()) {
      if (row.id === props.initiatorCharacterId) continue;
      const perm = row.values.Permissions as
        | Parameters<typeof canWrite>[1]
        | undefined;
      if (!canWrite(m, perm)) continue;
      const ctx = helperContextOf(row.id);
      const automatic = eligibleHelpFor(r, ctx);
      const gm = gmOptionsFor(r.kind, r.sourceId, ctx, automatic);
      if (automatic.length === 0 && gm.length === 0) continue;
      // Active help posted for this helper, if any. Reads the latest
      // tb-modifier contribution whose providedBy is `help:<charId>:…`.
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

  // Per-row pickers: which option the helper has currently selected
  // to offer (defaults to the first automatic option, falling back to
  // the first GM option).
  const [helperPicks, setHelperPicks] = createSignal<
    Record<string, string>
  >({});
  const helperPick = (h: HelperRow): string => {
    const fromState = helperPicks()[h.characterId];
    if (fromState) return fromState;
    if (h.automatic.length > 0) return h.automatic[0]!.id;
    return h.gm[0]?.id ?? "";
  };
  const setHelperPick = (charId: string, optionId: string): void => {
    setHelperPicks({ ...helperPicks(), [charId]: optionId });
  };

  /**
   * Post a +1D help contribution for `helper` using the chosen option.
   * `viaGm` flips the label so the chat row shows that the help is a
   * GM-discretion entry (not an automatic rules-permitted one).
   */
  const offerHelp = (h: HelperRow, optionId: string, viaGm: boolean): void => {
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
    props.contribute({
      kind: TB_MODIFIER_CONTRIB_KIND,
      label: formatModifier(modifier),
      fromUserId: m.userId,
      fromCharacterId: h.characterId,
      payload: modifier,
      replaces: helpReplacesKey(h.characterId),
    });
  };

  /**
   * Toggle synergy on a helper row (DH p.87): the helper spends 1 fate
   * "before the dice are cast" so they learn from the test on a pass.
   * Posting again with `replaces: "tb:synergy:<charId>"` supersedes the
   * previous toggle for that helper. The fate debit lands at commit
   * via `TbCommitSpendsSystem`.
   */
  const toggleSynergy = (h: HelperRow): void => {
    const m = me();
    if (!m) return;
    props.contribute({
      kind: TB_SYNERGY_CONTRIB_KIND,
      label: `${h.name} synergy (1 fate, DH p.87)`,
      fromUserId: m.userId,
      fromCharacterId: h.characterId,
      payload: { id: freshModifierId(), helperCharacterId: h.characterId },
      replaces: `tb:synergy:${h.characterId}`,
    });
  };

  /**
   * Helper's fate-pool snapshot — used to gate the synergy toggle.
   * Reactively re-reads when the helper character's pool changes.
   */
  const helperFateAvail = (helperCharacterId: string): number => {
    const got = client.world.get(
      helperCharacterId as Parameters<typeof client.world.get>[0],
      [Pools],
    ) as { Pools: { fate: { current: number } } } | undefined;
    return got?.Pools.fate.current ?? 0;
  };

  /* -------- Trait usage (DH p.79–80) -------- */
  // Initiator's character traits, reactive — so dot counts and the
  // "1 trait per test" guard update live.
  const initiatorTraits = useTrait(props.initiatorCharacterId, CharacterTraits);
  // True once any trait modifier is on the pending roll — DH p.81
  // "one trait per test, for or against".
  const traitAlreadyUsed = createMemo<boolean>(() => {
    const value = pr();
    if (!value) return false;
    for (const c of value.contributions as Contribution[]) {
      if (c.kind !== TB_MODIFIER_CONTRIB_KIND) continue;
      const mod = c.payload as { source?: string } | undefined;
      if (mod?.source === "trait") return true;
    }
    return false;
  });
  const useTraitFor = (traitIndex: number): void => {
    client.dispatch(
      UseTraitOnRoll({
        pendingRollId: props.pendingRollId as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: props.initiatorCharacterId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex,
        direction: "for",
      }) as CommandInstance,
    );
  };
  const useTraitAgainst = (
    traitIndex: number,
    severity: "minus-1d" | "plus-2d-opp",
  ): void => {
    client.dispatch(
      UseTraitOnRoll({
        pendingRollId: props.pendingRollId as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: props.initiatorCharacterId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex,
        direction: "against",
        severity,
      }) as CommandInstance,
    );
  };

  return (
    <div class="flex flex-col gap-2" data-testid="tb-pending-roll-contributor">
      <div
        class="flex flex-col gap-1"
        data-testid="tb-pending-roll-obstacle"
        classList={{ hidden: activeDisposition() }}
      >
        <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
          Obstacle
        </span>
        <div class="flex flex-wrap gap-1" role="radiogroup" aria-label="Obstacle">
          <For each={OBSTACLE_VALUES}>
            {(n) => (
              <button
                type="button"
                role="radio"
                aria-checked={activeObstacle() === n}
                class="inline-flex h-6 w-6 items-center justify-center rounded-(--radius-control) border font-mono text-[0.7rem] transition"
                classList={{
                  "border-accent bg-accent text-accent-fg": activeObstacle() === n,
                  "border-border bg-surface-elevated text-fg-muted hover:border-accent hover:text-fg":
                    activeObstacle() !== n,
                }}
                onClick={() => pickObstacle(n)}
                title={
                  activeObstacle() === n
                    ? `Click to clear Ob ${n}`
                    : `Set Ob ${n} — needs ${n} successes to pass`
                }
              >
                {n}
              </button>
            )}
          </For>
        </div>
        <Show when={activeObstacle() === null}>
          <span class="text-[0.65rem] text-fg-subtle">
            no obstacle — any success counts
          </span>
        </Show>
      </div>

      <div
        class="flex flex-col gap-1"
        data-testid="tb-pending-roll-disposition"
      >
        <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
          Disposition
        </span>
        <button
          type="button"
          class="rounded-(--radius-control) border px-2 py-0.5 text-[0.7rem] transition"
          classList={{
            "border-accent bg-accent text-accent-fg": activeDisposition(),
            "border-border bg-surface-elevated text-fg-muted hover:border-accent hover:text-fg":
              !activeDisposition(),
          }}
          onClick={() => toggleDisposition(!activeDisposition())}
          title={
            activeDisposition()
              ? "Clear disposition mode — back to a normal test."
              : "Switch to a disposition roll (DH p.254). No obstacle, no pass/fail; result = base + successes - team penalties."
          }
          data-testid="tb-pending-roll-disposition-toggle"
        >
          {activeDisposition() ? "disposition (on)" : "switch to disposition"}
        </button>
        <Show when={activeDisposition()}>
          <div
            class="flex items-center gap-1 mt-0.5"
            data-testid="tb-pending-roll-disposition-addto"
          >
            <span class="text-[0.6rem] text-fg-subtle uppercase tracking-[0.14em]">
              add to
            </span>
            <button
              type="button"
              class="rounded-(--radius-control) border px-1.5 py-0.5 text-[0.65rem] transition"
              classList={{
                "border-accent bg-accent text-accent-fg":
                  activeDispositionAddTo() === "will",
                "border-border bg-surface text-fg-muted hover:border-accent":
                  activeDispositionAddTo() !== "will",
              }}
              onClick={() => pickDispositionAddTo("will")}
              data-testid="tb-pending-roll-disposition-addto-will"
              title="Add Will rating to successes (Convince / Capture / Trick conflicts)"
            >
              Will
            </button>
            <button
              type="button"
              class="rounded-(--radius-control) border px-1.5 py-0.5 text-[0.65rem] transition"
              classList={{
                "border-accent bg-accent text-accent-fg":
                  activeDispositionAddTo() === "health",
                "border-border bg-surface text-fg-muted hover:border-accent":
                  activeDispositionAddTo() !== "health",
              }}
              onClick={() => pickDispositionAddTo("health")}
              data-testid="tb-pending-roll-disposition-addto-health"
              title="Add Health rating to successes (Kill / Drive Off / Flee / Pursue conflicts)"
            >
              Health
            </button>
          </div>
          <span class="text-[0.65rem] text-fg-subtle">
            disposition = (Will or Health) + successes − team penalties
          </span>
          <Show when={activeDispositionAddTo() === null}>
            <span
              class="text-[0.65rem] italic"
              style={{ color: "var(--color-warning, #C9A227)" }}
              data-testid="tb-pending-roll-disposition-addto-warning"
            >
              pick Will or Health — required for the dispo math
            </span>
          </Show>
        </Show>
      </div>

      <Show when={versusCandidates().length > 0 && !activeDisposition()}>
        <div class="flex flex-col gap-1" data-testid="tb-pending-roll-versus">
          <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
            Versus
          </span>
          <ul class="flex flex-col gap-1">
            <For each={versusCandidates()}>
              {(c) => {
                const isPaired = () =>
                  activeVersusId() !== null &&
                  c.versusId !== null &&
                  activeVersusId() === c.versusId;
                return (
                  <li class="flex items-center gap-1 rounded-(--radius-control) bg-surface px-2 py-1">
                    <span class="flex-1 truncate text-[0.7rem] text-fg-muted">
                      vs <span class="text-fg">{c.characterName}</span>
                    </span>
                    <button
                      type="button"
                      class="rounded-(--radius-control) border px-2 py-0.5 text-[0.65rem] transition"
                      classList={{
                        "border-accent bg-accent text-accent-fg": isPaired(),
                        "border-border bg-surface-elevated text-fg-muted hover:border-accent hover:text-fg":
                          !isPaired(),
                      }}
                      onClick={() => togglePairWith(c)}
                      title={
                        isPaired()
                          ? "Click to clear this versus pairing"
                          : `Pair this roll with ${c.characterName}'s pending roll for a versus test`
                      }
                    >
                      {isPaired() ? "paired" : "pair"}
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </div>
      </Show>

      <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
        Quick modifiers
      </span>

      <div class="flex flex-wrap gap-1">
        <For each={QUICK_BUTTONS}>
          {(b) => (
            <button
              type="button"
              class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.7rem] text-fg-muted hover:border-accent hover:text-fg transition"
              onClick={() => offer(b.mod)}
              title={b.title}
            >
              {b.shortLabel}
            </button>
          )}
        </For>
        {/* Contextual GM-option / state-dependent buttons — visually
            distinguished by a dashed border so the player sees they
            come from a rule the system noticed (Angry, etc.) rather
            than the always-available stack. */}
        <For each={suggestedQuickButtons()}>
          {(sq) => (
            <button
              type="button"
              class="rounded-(--radius-control) border border-dashed border-accent/60 bg-surface-elevated px-2 py-0.5 text-[0.7rem] text-fg-muted hover:border-accent hover:text-fg transition"
              onClick={() => applySuggested(sq)}
              title={sq.note}
              data-testid={`tb-pending-roll-suggested-${sq.id}`}
            >
              {sq.buttonLabel}
            </button>
          )}
        </For>
      </div>

      <div class="flex flex-wrap items-center gap-1 border-t border-border-muted pt-2">
        <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
          Heroic
        </span>
        <button
          type="button"
          class="rounded-(--radius-control) border px-2 py-0.5 text-[0.7rem] transition"
          classList={{
            "border-accent bg-accent text-accent-fg": panelHeroic() === true,
            "border-border bg-surface-elevated text-fg-muted hover:border-accent hover:text-fg":
              panelHeroic() !== true,
          }}
          onClick={() => toggleHeroic(true)}
          title="Force heroic mode on — every die showing 3+ counts as a success"
          data-testid="tb-pending-roll-heroic-on"
        >
          on (3+)
        </button>
        <button
          type="button"
          class="rounded-(--radius-control) border px-2 py-0.5 text-[0.7rem] transition"
          classList={{
            "border-accent bg-accent text-accent-fg": panelHeroic() === false,
            "border-border bg-surface-elevated text-fg-muted hover:border-accent hover:text-fg":
              panelHeroic() !== false,
          }}
          onClick={() => toggleHeroic(false)}
          title="Force heroic mode off — every die showing 4+ counts as a success"
          data-testid="tb-pending-roll-heroic-off"
        >
          off (4+)
        </button>
        <Show when={panelHeroic() === undefined}>
          <span class="text-[0.65rem] text-fg-subtle">
            using spec default
          </span>
        </Show>
      </div>

      {/* Persona advantage + Channel Nature — pre-roll declarations
          per DH p.250 ("tally advantages before the test"). The fate /
          persona pool isn't decremented until commit. */}
      <div
        class="flex flex-col gap-1 border-t border-border-muted pt-2"
        data-testid="tb-pending-roll-persona"
      >
        <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
          Persona spends
        </span>
        <div class="flex flex-wrap items-center gap-1">
          {/* Persona advantage — one click = one persona = +1D, capped at 3. */}
          <button
            type="button"
            class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.7rem] text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={
              personaAvail() < 1 || personaSpendDeclared() >= 3
            }
            onClick={() => declarePersonaDice(1)}
            title={
              personaAvail() < 1
                ? "no persona to spend"
                : personaSpendDeclared() >= 3
                  ? "persona-dice cap reached (3 max — DH p.8)"
                  : `Spend 1 persona for +1D (cumulative: ${personaSpendDeclared()}/3)`
            }
            data-testid="tb-pending-roll-persona-dice"
          >
            +1D persona ({personaSpendDeclared()}/3)
          </button>

          {/* Channel Nature — within / outside picker (DH p.67). */}
          <Show when={natureRating() > 0}>
            <span
              class="inline-flex items-center gap-1 rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.65rem] text-fg-muted"
              data-testid="tb-pending-roll-channel-group"
            >
              <button
                type="button"
                class="rounded-(--radius-control) border px-1.5 py-0.5 transition"
                classList={{
                  "border-accent bg-accent text-accent-fg":
                    channelDeclared() === "within",
                  "border-border hover:border-accent hover:text-fg":
                    channelDeclared() !== "within",
                }}
                disabled={
                  personaAvail() < 1 && channelDeclared() !== "within"
                }
                onClick={() => toggleChannelNature("within")}
                title="Channel Nature within your descriptors — no tax (DH p.67). 1 persona, +Nature D."
                data-testid="tb-pending-roll-channel-within"
              >
                within
              </button>
              <button
                type="button"
                class="rounded-(--radius-control) border px-1.5 py-0.5 transition"
                classList={{
                  "border-accent bg-accent text-accent-fg":
                    channelDeclared() === "outside",
                  "border-border hover:border-accent hover:text-fg":
                    channelDeclared() !== "outside",
                }}
                disabled={
                  personaAvail() < 1 && channelDeclared() !== "outside"
                }
                onClick={() => toggleChannelNature("outside")}
                title="Channel Nature outside your descriptors — taxes Nature post-resolution (DH p.67-68: -1 on pass, -margin on fail)."
                data-testid="tb-pending-roll-channel-outside"
              >
                outside
              </button>
              <span class="text-fg-subtle">
                channel +{natureRating()}D
              </span>
            </span>
          </Show>
        </div>
        <Show
          when={
            personaSpendDeclared() === 0 && channelDeclared() === null
          }
        >
          <span class="text-[0.65rem] text-fg-subtle">
            no persona declared (DH p.250 — tally advantages before the test)
          </span>
        </Show>
      </div>

      <Show when={(initiatorTraits()?.entries.length ?? 0) > 0}>
        <div
          class="flex flex-col gap-1 border-t border-border-muted pt-2"
          data-testid="tb-pending-roll-traits"
        >
          <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
            Traits
          </span>
          <Show when={traitAlreadyUsed()}>
            <span class="text-[0.65rem] text-fg-subtle italic">
              one trait per test (DH p.81) — already used
            </span>
          </Show>
          <ul class="flex flex-col gap-1">
            <For each={initiatorTraits()?.entries ?? []}>
              {(t, i) => {
                const usesLeft = (): number =>
                  t.level >= 3 ? Infinity : Math.max(0, t.level - (t.beneficialUses ?? 0));
                const usedAgainstThisSession = (): boolean =>
                  t.usedAgainst === true;
                const forDisabled = (): boolean =>
                  traitAlreadyUsed() || (t.level < 3 && usesLeft() <= 0);
                const againstDisabled = (): boolean =>
                  traitAlreadyUsed() || usedAgainstThisSession();
                return (
                  <li class="flex items-center gap-1 rounded-(--radius-control) bg-surface px-2 py-1">
                    <span class="flex-1 truncate text-[0.7rem] text-fg">
                      {t.name}
                      <span class="ml-1 text-fg-subtle">
                        Lv {t.level}
                        {t.level < 3
                          ? ` · ${usesLeft()}/${t.level}`
                          : " · all tests"}
                        <Show when={usedAgainstThisSession()}>
                          <span
                            class="ml-1"
                            title="Already used against yourself this session — clear the 'vs Self' checkbox in the traits table to reset"
                          >
                            · vs self ✓
                          </span>
                        </Show>
                      </span>
                    </span>
                    <button
                      type="button"
                      class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-40 disabled:cursor-not-allowed"
                      disabled={forDisabled()}
                      onClick={() => useTraitFor(i())}
                      title={
                        t.level >= 3
                          ? `+1s on a passed/tied roll (Lv 3 — DH p.79)`
                          : forDisabled()
                            ? "no beneficial uses left this session"
                            : `Spend a beneficial use for +1D on this roll (DH p.79)`
                      }
                    >
                      for self
                    </button>
                    <button
                      type="button"
                      class="rounded-(--radius-control) border border-dashed border-border bg-surface-elevated px-2 py-0.5 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-40 disabled:cursor-not-allowed"
                      disabled={againstDisabled()}
                      onClick={() => useTraitAgainst(i(), "minus-1d")}
                      title={
                        usedAgainstThisSession()
                          ? "already used against yourself this session (DH p.80)"
                          : "Take −1D on this roll, earn 1 check (DH p.80)"
                      }
                    >
                      −1D / +1 ✓
                    </button>
                    <Show when={activeVersusId() !== null}>
                      <button
                        type="button"
                        class="rounded-(--radius-control) border border-dashed border-border bg-surface-elevated px-2 py-0.5 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-40 disabled:cursor-not-allowed"
                        disabled={againstDisabled()}
                        onClick={() => useTraitAgainst(i(), "plus-2d-opp")}
                        title={
                          usedAgainstThisSession()
                            ? "already used against yourself this session (DH p.80)"
                            : "Add +2D to your opponent's versus roll, earn 2 checks (DH p.80)"
                        }
                      >
                        +2D opp / +2 ✓
                      </button>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </div>
      </Show>

      <Show when={helpRoll() !== null}>
        <div
          class="flex flex-col gap-1 border-t border-border-muted pt-2"
          data-testid="tb-pending-roll-help"
        >
          <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
            Helping
          </span>
          <Show when={suggestedHelpNames().length > 0}>
            <span class="text-[0.65rem] text-fg-subtle">
              suggested help: {suggestedHelpNames().join(", ")} (DH p.37)
            </span>
          </Show>
          <Show
            when={helpers().length > 0}
            fallback={
              <span class="text-[0.65rem] text-fg-subtle italic">
                none of your characters can help on this roll
              </span>
            }
          >
            <ul class="flex flex-col gap-1">
              <For each={helpers()}>
                {(h) => {
                  const pick = (): string => helperPick(h);
                  const isHelping = (): boolean => h.activeOptionId !== null;
                  const activeViaGm = (): boolean => {
                    if (!h.activeOptionId) return false;
                    return !h.automatic.some(
                      (o) => o.id === h.activeOptionId,
                    );
                  };
                  return (
                    <li
                      class="flex flex-wrap items-center gap-1 rounded-(--radius-control) bg-surface px-2 py-1"
                      data-testid={`tb-pending-roll-help-row-${h.characterId}`}
                    >
                      <span class="flex-1 truncate text-[0.7rem] text-fg">
                        {h.name}
                        <Show when={isHelping()}>
                          <span class="ml-1 text-fg-subtle">
                            · helping{activeViaGm() ? " (per GM)" : ""}
                          </span>
                        </Show>
                      </span>
                      <Show when={h.automatic.length + h.gm.length > 1}>
                        <select
                          value={pick()}
                          onChange={(e) =>
                            setHelperPick(h.characterId, e.currentTarget.value)
                          }
                          class="rounded-(--radius-control) border border-border bg-surface-elevated px-1 py-0.5 text-[0.65rem] text-fg outline-none focus:border-accent"
                          aria-label={`${h.name} help skill`}
                        >
                          <Show when={h.automatic.length > 0}>
                            <optgroup label="eligible">
                              <For each={h.automatic}>
                                {(o) => <option value={o.id}>{o.label}</option>}
                              </For>
                            </optgroup>
                          </Show>
                          <Show when={h.gm.length > 0}>
                            <optgroup label="per GM">
                              <For each={h.gm}>
                                {(o) => <option value={o.id}>{o.label}</option>}
                              </For>
                            </optgroup>
                          </Show>
                        </select>
                      </Show>
                      <Show when={h.automatic.length > 0}>
                        <button
                          type="button"
                          class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-50"
                          disabled={
                            !h.automatic.some((o) => o.id === pick())
                          }
                          onClick={() => offerHelp(h, pick(), false)}
                          title={`Add ${h.name}'s +1D help (DH p.37)`}
                          data-testid={`tb-pending-roll-help-btn-${h.characterId}`}
                        >
                          +1D help
                        </button>
                      </Show>
                      <Show when={h.gm.length > 0}>
                        <button
                          type="button"
                          class="rounded-(--radius-control) border border-dashed border-border bg-surface-elevated px-2 py-0.5 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-50"
                          disabled={!h.gm.some((o) => o.id === pick())}
                          onClick={() => offerHelp(h, pick(), true)}
                          title="Per GM (DH p.37): one additional skill the game master rules appropriate to the situation"
                          data-testid={`tb-pending-roll-help-gm-btn-${h.characterId}`}
                        >
                          per GM
                        </button>
                      </Show>
                      {/* Synergy toggle (DH p.87) — only when this
                          helper has actually offered help and has fate. */}
                      <Show when={h.activeOptionId !== null}>
                        {(_) => {
                          const isSynergy = (): boolean =>
                            synergyDeclared().includes(h.characterId);
                          return (
                            <button
                              type="button"
                              class="rounded-(--radius-control) border px-2 py-0.5 text-[0.65rem] transition disabled:opacity-50"
                              classList={{
                                "border-accent bg-accent text-accent-fg":
                                  isSynergy(),
                                "border-border bg-surface-elevated text-fg-muted hover:border-accent hover:text-fg":
                                  !isSynergy(),
                              }}
                              disabled={
                                !isSynergy() &&
                                helperFateAvail(h.characterId) < 1
                              }
                              onClick={() => toggleSynergy(h)}
                              title={
                                isSynergy()
                                  ? `Synergy active — ${h.name} learns from a passed test (DH p.87). Click to clear.`
                                  : helperFateAvail(h.characterId) < 1
                                    ? `${h.name} has 0 fate — can't synergize`
                                    : `Spend 1 of ${h.name}'s fate to learn from a passed test (DH p.87)`
                              }
                              data-testid={`tb-pending-roll-synergy-btn-${h.characterId}`}
                            >
                              {isSynergy() ? "synergy ✓" : "synergy"}
                            </button>
                          );
                        }}
                      </Show>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        </div>
      </Show>

      <div class="border-t border-border-muted pt-2">
        <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
          Labelled modifier
        </span>
        <div class="mt-1 flex flex-wrap items-center gap-1">
          <select
            value={kind()}
            onChange={(e) => setKind(e.currentTarget.value as TbRollModifierKind)}
            class="rounded-(--radius-control) border border-border bg-surface-elevated px-1 py-0.5 text-[0.65rem] text-fg outline-none focus:border-accent"
            aria-label="modifier kind"
          >
            <option value="dice">±D</option>
            <option value="success">±s</option>
            <option value="obstacle">±Ob</option>
          </select>
          <input
            type="number"
            value={value()}
            onInput={(e) => setValue(e.currentTarget.value)}
            class="w-16 rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 text-[0.7rem] text-fg outline-none focus:border-accent text-center"
            aria-label="modifier value"
          />
          <select
            value={apply()}
            onChange={(e) =>
              setApply(e.currentTarget.value as TbRollModifierApply)
            }
            class="rounded-(--radius-control) border border-border bg-surface-elevated px-1 py-0.5 text-[0.65rem] text-fg outline-none focus:border-accent"
            aria-label="apply mode"
          >
            <option value="always">always</option>
            <option value="on-success">on success</option>
            <option value="on-fail">on fail</option>
          </select>
          <input
            type="text"
            value={label()}
            onInput={(e) => setLabel(e.currentTarget.value)}
            placeholder="reason"
            class="flex-1 min-w-[6rem] rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 text-[0.7rem] text-fg outline-none focus:border-accent"
            aria-label="modifier label"
          />
          <button
            type="button"
            onClick={submitLabelled}
            disabled={label().trim().length === 0}
            class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.7rem] text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-50"
          >
            add
          </button>
        </div>
      </div>

      <Show when={!me()}>
        <span class="text-[0.65rem] text-fg-subtle">
          sign in to add modifiers
        </span>
      </Show>
    </div>
  );
}

interface QuickButton {
  shortLabel: string;
  title: string;
  mod: Omit<TbRollModifier, "id" | "source">;
}

/**
 * Canonical TB obstacle range (DH p.20 — Ob is set 1 to 10 in
 * normal play, with higher values reserved for legendary feats).
 * Renders as a row of toggleable buttons; click the active one to
 * clear, click another to switch.
 */
const OBSTACLE_VALUES: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Most-common-at-the-table quick buttons. Order is deliberate:
 * positive dice, negative dice, positive successes, negative
 * successes, then the conditional siblings.
 */
const QUICK_BUTTONS: ReadonlyArray<QuickButton> = [
  { shortLabel: "+1D",  title: "Add 1 die",                              mod: { kind: "dice",     value: 1,  label: "+1D",              apply: "always" } },
  { shortLabel: "-1D",  title: "Subtract 1 die",                         mod: { kind: "dice",     value: -1, label: "-1D",              apply: "always" } },
  { shortLabel: "+1s",  title: "Add 1 success",                          mod: { kind: "success",  value: 1,  label: "+1s",              apply: "always" } },
  { shortLabel: "-1s",  title: "Subtract 1 success",                     mod: { kind: "success",  value: -1, label: "-1s",              apply: "always" } },
  { shortLabel: "+1 Ob", title: "Raise the obstacle by 1",               mod: { kind: "obstacle", value: 1,  label: "+1 Ob",            apply: "always" } },
  { shortLabel: "-1 Ob", title: "Lower the obstacle by 1",               mod: { kind: "obstacle", value: -1, label: "-1 Ob",            apply: "always" } },
  { shortLabel: "+1s on succ.", title: "+1s applied only on success",    mod: { kind: "success",  value: 1,  label: "bonus on success", apply: "on-success" } },
  { shortLabel: "+1s on fail",  title: "+1s applied only on failure",    mod: { kind: "success",  value: 1,  label: "bonus on fail",    apply: "on-fail"    } },
];

export const TbPendingRollContributor: PendingRollContributor = {
  id: qualifiedName("@vtt/system-torchbearer/pending-roll-contributor") as PendingRollContributor["id"],
  priority: 100,
  rollablePrefix: "@vtt/system-torchbearer/",
  render: (args) => TbContributorPanel(args),
};
