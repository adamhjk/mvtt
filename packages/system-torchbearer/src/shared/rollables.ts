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

import { defineRollable, z } from "@vtt/substrate";
import { Character } from "@vtt/characters/shared";
import { ContributionSchema } from "@vtt/characters/shared";
import { RequestRoll } from "@vtt/resolution/shared";
import { getSkill, type BeginnersLuck } from "./skills.js";
import {
  Conditions,
  Heroic,
  Identity,
  RawAbilities,
  Skills,
  TownAbilities,
} from "./traits.js";
import { Team } from "@vtt/characters/shared";
import {
  autoModifiersFromConditions,
  channelNatureFromContributions,
  dispositionAddToFromContributions,
  dispositionFromContributions,
  heroicFromContributions,
  modifiersFromContributions,
  obstacleFromContributions,
  personaSpendsFromContributions,
  personaSpendTotalFromContributions,
  synergyDeclsFromContributions,
  teamPenaltiesForDisposition,
  versusFromContributions,
} from "./roll-modifiers.js";
import type { EntityId, World } from "@vtt/substrate";
import {
  buildTbNotation,
  foldBlModifiers,
  foldModifiers,
  TB_ROLL_META_SYSTEM,
  TbRollSpecSchema,
  type TbRollKind,
  type TbRollModifier,
  type TbRollSpec,
} from "./roll-spec.js";

/**
 * Defensive read of the rolling character's current Nature rating.
 * `buildSpec` uses this to size the Channel Nature dice add — even
 * for rollables (Resources/Circles) that don't otherwise read
 * `RawAbilities`. Returns 0 when the trait isn't present (the
 * channel-nature panel section already gates on rating > 0, but
 * we re-check here so a malformed contribution can't synthesise
 * dice the character doesn't actually have).
 */
function readNatureRating(world: World, entityId: EntityId): number {
  const got = world.get(entityId, [RawAbilities]) as
    | { RawAbilities: { nature: { rating: number } } }
    | undefined;
  return got?.RawAbilities.nature.rating ?? 0;
}

/**
 * Torchbearer rolling subsystem (DH p.20-24, p.250-251).
 *
 * Every TB rollable produces a `TbRollSpec`: the structured roll
 * description the panel and the chat row consume. The dice notation
 * is a plain `Nd6`; the spec carries pool composition, every applied
 * modifier, conditional success bonuses, and an optional obstacle.
 *
 * The flow:
 *
 *   1. The rollable's compute reads base rating + Conditions trait
 *      (auto modifiers from Fresh / Injured / Sick).
 *
 *   2. `opts.contributions` from the PendingRoll panel — TB-shaped
 *      modifiers (`kind: "tb-modifier"`) and free-form labelled
 *      bonuses — are folded in.
 *
 *   3. `foldModifiers` collapses every always-applied modifier into
 *      a final `pool` and `bonusSuccesses`. Conditional modifiers
 *      (`apply: "on-success" | "on-fail"`) are recorded in the spec
 *      but not rolled into the notation.
 *
 *   4. `toPayload` emits `RequestRoll{ notation, reason, meta }`
 *      where `meta = { system: "@vtt/system-torchbearer", spec }` so
 *      the chat row can reconstruct the TB-aware result.
 *
 * Future expansion (rerolls from Faith / wise / fate, persona
 * spending, advantage from flanking, beginner's-luck "tax untaxed
 * Nature" branch) becomes additional modifier kinds and conditional
 * apply rules — no signature changes here.
 */

interface TbRollableArgs {
  /**
   * The rolling character's entity id. Threaded through so `buildSpec`
   * can read traits beyond the rollable's declared inputs (e.g.
   * `RawAbilities.nature.rating` for Channel Nature, even on rollables
   * like Resources/Circles that don't otherwise look at Nature).
   */
  entityId: import("@vtt/substrate").EntityId;
  baseDice: number;
  source: string;
  sourceId: string;
  kind: TbRollKind;
  /**
   * Headline for the chat-row tagline — typically the source plus
   * skill/ability label ("Will", "Fighter", "Will (Bryn)"). The
   * caption is composed inside `buildSpec` from `characterName` +
   * `headline` + the resolved obstacle so it reflects modifiers.
   */
  headline: string;
  /**
   * Character display name (from the Character trait). Prefixed onto
   * the caption when set; falls through cleanly when empty.
   */
  characterName: string;
  /** Auto-modifiers from rollable-specific traits (skills' `taxed` flag etc). */
  extraAuto?: ReadonlyArray<TbRollModifier>;
  /**
   * Whether this roll is heroic. Resolution priority (highest wins):
   *   1. `opts.heroic === true | false` — explicit per-roll override.
   *   2. The latest `tb-heroic` panel contribution (if any).
   *   3. The character's `Heroic` trait listing this roll's
   *      `sourceId` under the relevant kind.
   *   4. Fallback: not heroic.
   * Resolved by the rollable before calling `buildSpec`.
   */
  heroic: boolean;
  /**
   * Optional versus-test pairing key. Set when the roll is part of
   * a paired versus comparison (DH p.21); the chat row uses it to
   * discover the opponent's Roll entity. `null` for plain rolls.
   */
  versusTestId: string | null;
  /**
   * `true` when this roll generates conflict disposition (DH
   * p.254). When set, buildSpec adds per-team disposition penalties,
   * clears obstacle/versus (neither applies), and flips
   * `spec.dispositionMode`.
   */
  dispositionMode: boolean;
  /**
   * In `dispositionMode`, which ability is added to successes for the
   * dispo total — the panel's `addTo` selection. The compute path
   * looks up `RawAbilities.{will|health}.rating` and supplies the
   * matching `dispoBase`. `null`/undefined means the panel hasn't
   * selected one; buildSpec leaves `spec.dispoBase` absent and the
   * chat row falls back to `baseDice` (correct only for Will/Health
   * rollables).
   */
  dispoAddTo?: "will" | "health" | null;
  /**
   * In `dispositionMode`, the resolved additive-base value (the
   * captain's Will or Health rating). Stamped onto the spec as
   * `spec.dispoBase` when present.
   */
  dispoBase?: number;
  /**
   * Live World handle — needed to query party-tagged characters
   * for disposition team penalties. Threaded through from the
   * rollable's compute via `ctx.world`.
   */
  world: World;
}

/**
 * Resolve the heroic flag for a roll given the trait-driven baseline,
 * the panel toggle (if any), and an explicit per-roll override.
 * Encoded as a separate function so each rollable's compute reduces
 * to "read traits → resolve heroic → buildSpec" without inline
 * priority logic.
 */
function resolveHeroic(args: {
  /** Per-roll override (`opts.heroic`). `undefined` means "no override". */
  optsHeroic: boolean | undefined;
  /** Latest panel toggle (`tb-heroic` contribution). `undefined` means "no toggle". */
  panelHeroic: boolean | undefined;
  /** Trait-driven baseline (read from the character's `Heroic` trait). */
  traitHeroic: boolean;
}): boolean {
  if (args.optsHeroic !== undefined) return args.optsHeroic;
  if (args.panelHeroic !== undefined) return args.panelHeroic;
  return args.traitHeroic;
}

/**
 * Walk a `Heroic` trait and decide whether this roll's source is
 * marked heroic. The catalog is partitioned across the trait's
 * three lists; the `kind` selects which list to consult.
 *
 * Skill BL rolls use the same `skills` list as full skill rolls —
 * if a character has elevated their Fighter to heroic, BL Fighter
 * tests inherit the heroic target. (Whether *that* matches RAW is
 * a campaign-level call; we expose the data, the GM picks the
 * policy.)
 */
function traitHeroicFor(
  heroic: { abilities: string[]; townAbilities: string[]; skills: string[] },
  kind: TbRollKind,
  sourceId: string,
): boolean {
  if (kind === "ability") return heroic.abilities.includes(sourceId);
  if (kind === "town-ability") return heroic.townAbilities.includes(sourceId);
  if (kind === "skill" || kind === "skill-bl") return heroic.skills.includes(sourceId);
  return false; // versus / future kinds — opt in explicitly via opts/panel
}

/**
 * The shared compute body. Each rollable's `compute` reduces to:
 * read inputs → call this → return spec. Centralising here means
 * every TB rollable applies modifiers in the same order with the
 * same priority (auto first, manual second), which is what makes
 * downstream automation predictable.
 */
function buildSpec(
  args: TbRollableArgs,
  conditions: {
    fresh: boolean;
    hungryThirsty: boolean;
    angry: boolean;
    afraid: boolean;
    exhausted: boolean;
    injured: boolean;
    sick: boolean;
    dead: boolean;
  },
  contributionsRaw: unknown,
  baseObstacle: number | null,
): TbRollSpec {
  const auto = autoModifiersFromConditions(
    conditions,
    args.kind,
    args.sourceId,
    args.versusTestId,
  );
  const contribsTyped: ReadonlyArray<z.infer<typeof ContributionSchema>> =
    Array.isArray(contributionsRaw)
      ? (contributionsRaw as ReadonlyArray<z.infer<typeof ContributionSchema>>)
      : [];
  const fromContrib = modifiersFromContributions(contribsTyped);
  // Pre-roll persona / channel-nature / synergy declarations from the
  // panel (DH p.250 "tally advantages before the test"). The dice they
  // add fold into the pool here; the fate / persona pool debits and
  // ledger entries land at commit time via TbCommitSpendsSystem.
  //
  // Each declaration synthesizes a `TbRollModifier` whose `id` matches
  // the contribution's `payload.id` — so the standard PendingRollPanel
  // chip × affordance can dispatch `RemoveContribution` and clear the
  // pending state, exactly like a manual `tb-modifier`.
  const personaDecls = personaSpendsFromContributions(contribsTyped);
  const personaSpend = personaSpendTotalFromContributions(contribsTyped);
  const channelDecl = channelNatureFromContributions(contribsTyped);
  const synergyDecls = synergyDeclsFromContributions(contribsTyped);
  const synergyHelpers = synergyDecls.map((d) => d.helperCharacterId);
  const natureRating = readNatureRating(args.world, args.entityId);
  const channelDice =
    channelDecl !== null && natureRating > 0 ? natureRating : 0;
  const preRollSpendMods: TbRollModifier[] = [];
  for (const d of personaDecls) {
    preRollSpendMods.push({
      id: d.id,
      kind: "dice",
      value: d.count,
      label: `Persona +${d.count}D`,
      apply: "always",
      source: "persona",
      providedBy: "persona:advantage",
    });
  }
  if (channelDice > 0 && channelDecl !== null) {
    preRollSpendMods.push({
      id: channelDecl.id,
      kind: "dice",
      value: channelDice,
      label: `Channel Nature +${channelDice}D (${channelDecl.scope})`,
      apply: "always",
      source: "persona",
      providedBy: `persona:channel-nature:${channelDecl.scope}`,
    });
  }
  // Synergy declarations don't add dice (DH p.87 — fate spent for the
  // helper to learn from a passed test). Synthesize a zero-value
  // dice modifier per helper so the standard chip × can clear it,
  // and the chip is visible alongside other declarations. The chat
  // row's modifier rendering filters zero-value entries out, so this
  // doesn't pollute the post-roll display.
  for (const d of synergyDecls) {
    preRollSpendMods.push({
      id: d.id,
      kind: "dice",
      value: 0,
      label: `Synergy: ${d.helperCharacterId} (1 fate post-pass)`,
      apply: "always",
      source: "persona",
      providedBy: `synergy:${d.helperCharacterId}`,
    });
  }
  // Disposition mode adds team-aggregate penalties (Hungry & Thirsty,
  // Exhausted) computed across every party-tagged character. The
  // versus / obstacle resolution short-circuits to "no obstacle"
  // since disposition rolls don't pass/fail.
  const dispositionPenalties = args.dispositionMode
    ? teamPenaltiesForDisposition(args.world)
    : [];
  const modifiers: TbRollModifier[] = [
    ...auto,
    ...(args.extraAuto ?? []),
    ...preRollSpendMods,
    ...dispositionPenalties,
    ...fromContrib,
  ];
  // BL rolls follow DH p.59 "Beginners Roll Half": the ability + the
  // pre-half modifier group (wises, help, supplies, gear, plus
  // Injured/Sick that reduce the ability) is halved and rounded up,
  // and only then are post-half mods (traits, persona, channeled
  // Nature, Fresh, special/magic bonuses) added. `foldBlModifiers`
  // implements that partition; non-BL rolls keep the simple fold.
  const fold =
    args.kind === "skill-bl" ? foldBlModifiers : foldModifiers;
  const { pool, bonusSuccesses, obstacleAdjust } = fold(
    args.baseDice,
    modifiers,
  );
  // Resolved obstacle: base + always-applied obstacle modifiers,
  // clamped at 0. With no declared base, modifiers don't synthesise
  // an obstacle out of thin air — they're recorded in `modifiers`
  // for transparency but the spec stays "no obstacle". Disposition
  // mode forces obstacle to null regardless (no pass/fail).
  const resolvedObstacle = args.dispositionMode
    ? null
    : baseObstacle === null
      ? null
      : Math.max(0, baseObstacle + obstacleAdjust);
  // Disposition rolls never pair as versus tests; clear it so the
  // chat row's versus block doesn't fire.
  const effectiveVersusId = args.dispositionMode ? null : args.versusTestId;
  const captionBody = args.dispositionMode
    ? `${args.headline} (disposition)`
    : withObstacle(args.headline, resolvedObstacle);
  const captionWithVersus = effectiveVersusId
    ? `${captionBody} (versus)`
    : captionBody;
  const caption = withCharacter(args.characterName, captionWithVersus);
  const spec: TbRollSpec = {
    kind: args.kind,
    source: args.source,
    sourceId: args.sourceId,
    baseDice: args.baseDice,
    pool,
    bonusSuccesses,
    heroic: args.heroic,
    successTarget: args.heroic ? 3 : 4,
    baseObstacle: args.dispositionMode ? null : baseObstacle,
    obstacle: resolvedObstacle,
    modifiers,
    versusTestId: effectiveVersusId,
    dispositionMode: args.dispositionMode ? true : undefined,
    dispoBase:
      args.dispositionMode && args.dispoBase !== undefined
        ? args.dispoBase
        : undefined,
    dispoAddTo:
      args.dispositionMode && args.dispoAddTo !== undefined
        ? args.dispoAddTo
        : undefined,
    personaDiceSpent: personaSpend,
    channelNature:
      channelDice > 0 && channelDecl !== null
        ? {
            scope: channelDecl.scope,
            dice: channelDice as 1 | 2 | 3 | 4 | 5 | 6 | 7,
          }
        : null,
    synergyHelpers,
    caption,
  };
  // Round-trip through the schema so `apply`/`source` defaults are
  // populated and downstream consumers always see the canonical
  // shape — `parse` here is also our test that the spec is wire-safe.
  return TbRollSpecSchema.parse(spec);
}

const RollOptsBase = {
  /**
   * PendingRoll contributions captured in the panel before commit.
   * The kit pipes these through `opts` automatically; click-the-
   * label-and-roll callers can omit it.
   */
  contributions: z.array(ContributionSchema).optional(),
  /**
   * Optional obstacle the GM has declared for this test. When set,
   * the chat row shows "vs Ob N" and uses it to gate on-success/on-fail
   * conditional modifiers.
   */
  obstacle: z.number().int().min(0).max(20).optional(),
  /**
   * Per-roll heroic override.
   *   - `true` forces heroic on (success target = 3+).
   *   - `false` forces heroic off (success target = 4+) — useful
   *     for "this one test reverts to standard despite the trait".
   *   - `undefined` (omitted) defers to the panel toggle and then
   *     to the character's `Heroic` trait.
   * The chat row's heroic indicator reflects the resolved value, not
   * the override per se.
   */
  heroic: z.boolean().optional(),

  /**
   * Per-roll versus pairing override. `string` forces this roll into
   * a versus test with the given key (typically `versus:<uuid>`);
   * `null` forces no pairing; `undefined` defers to the panel
   * contribution and then to "not a versus test". The panel posts
   * the same key on both sides of a pairing so they discover each
   * other through the chat-timeline query.
   */
  versusTestId: z.string().min(1).max(80).nullable().optional(),

  /**
   * Per-roll disposition-mode override. `true` forces this roll
   * to generate disposition (DH p.254); `false` forces a normal
   * test even if the panel toggle is on; `undefined` defers to the
   * `tb-disposition` panel contribution and then to "normal test".
   */
  dispositionMode: z.boolean().optional(),
} as const;

/**
 * Read the latest `tb-heroic` toggle off a contributions list (typed
 * loose because rollable opts come in as Zod-parsed plain objects).
 */
function panelHeroicFromOpts(contributionsRaw: unknown): boolean | undefined {
  if (!Array.isArray(contributionsRaw)) return undefined;
  return heroicFromContributions(
    contributionsRaw as ReadonlyArray<z.infer<typeof ContributionSchema>>,
  );
}

/**
 * Read the latest `tb-obstacle` pick off a contributions list.
 * Returns `undefined` to mean "no panel pick", `null` to mean
 * "panel cleared the obstacle", or a positive integer.
 */
function panelObstacleFromOpts(
  contributionsRaw: unknown,
): number | null | undefined {
  if (!Array.isArray(contributionsRaw)) return undefined;
  return obstacleFromContributions(
    contributionsRaw as ReadonlyArray<z.infer<typeof ContributionSchema>>,
  );
}

/**
 * Read the latest `tb-versus` pairing off a contributions list.
 * Returns `undefined` for "no panel pairing", `null` for "panel
 * cleared the pairing", or the versusTestId string.
 */
function panelVersusFromOpts(
  contributionsRaw: unknown,
): string | null | undefined {
  if (!Array.isArray(contributionsRaw)) return undefined;
  return versusFromContributions(
    contributionsRaw as ReadonlyArray<z.infer<typeof ContributionSchema>>,
  );
}

/**
 * Resolve the versus pairing for a roll. Same priority shape as
 * obstacle/heroic: explicit opts wins; panel contribution next;
 * default is no pairing.
 */
function resolveVersus(args: {
  optsVersus: string | null | undefined;
  panelVersus: string | null | undefined;
}): string | null {
  if (args.optsVersus !== undefined) return args.optsVersus;
  if (args.panelVersus !== undefined) return args.panelVersus;
  return null;
}

/**
 * One-shot helper combining the panel-contribution decode and the
 * priority resolver. Each rollable's compute calls this with its
 * `opts` so the buildSpec call site stays a single line.
 */
function resolveVersusForOpts(opts: unknown): string | null {
  const o = opts as
    | { versusTestId?: string | null; contributions?: unknown }
    | undefined;
  return resolveVersus({
    optsVersus: o?.versusTestId,
    panelVersus: panelVersusFromOpts(o?.contributions),
  });
}

/**
 * Resolve the disposition-mode flag for a roll. Same priority style
 * as the other settings: explicit opts > panel contribution >
 * default off.
 */
function resolveDispositionForOpts(opts: unknown): boolean {
  const o = opts as
    | { dispositionMode?: boolean; contributions?: unknown }
    | undefined;
  if (typeof o?.dispositionMode === "boolean") return o.dispositionMode;
  if (Array.isArray(o?.contributions)) {
    const fromPanel = dispositionFromContributions(
      o.contributions as ReadonlyArray<z.infer<typeof ContributionSchema>>,
    );
    if (typeof fromPanel === "boolean") return fromPanel;
  }
  return false;
}

/**
 * Resolve the dispo `addTo` selection from opts / panel contributions.
 * Returns `null` when explicitly cleared, `undefined` when never set.
 */
function resolveDispositionAddToForOpts(
  opts: unknown,
): "will" | "health" | null | undefined {
  const o = opts as
    | {
        dispositionAddTo?: "will" | "health" | null;
        contributions?: unknown;
      }
    | undefined;
  if (o?.dispositionAddTo !== undefined) return o.dispositionAddTo;
  if (Array.isArray(o?.contributions)) {
    return dispositionAddToFromContributions(
      o.contributions as ReadonlyArray<z.infer<typeof ContributionSchema>>,
    );
  }
  return undefined;
}

/**
 * Look up the `addTo` ability rating off `RawAbilities`. Returns
 * `undefined` if the panel hasn't picked yet — caller may fall back to
 * `baseDice` for ability rollables (where they coincide) or leave the
 * spec without `dispoBase` so the chat row warns.
 */
function dispoBaseFromAbilities(
  abilities: { will: { rating: number }; health: { rating: number } },
  addTo: "will" | "health" | null | undefined,
): number | undefined {
  if (addTo === "will") return abilities.will.rating;
  if (addTo === "health") return abilities.health.rating;
  return undefined;
}

/**
 * Resolve the obstacle for a roll. Priority (highest wins):
 *   1. `opts.obstacle` — caller-side override (rare; e.g. a system
 *      mechanic forcing a specific Ob).
 *   2. `tb-obstacle` panel contribution — the player/GM's pick in
 *      the pending-roll panel. May be `null` (panel cleared it).
 *   3. Default `null` (no obstacle declared — pass on any success).
 *
 * `null` from any source means "no obstacle"; the resolution layer
 * treats that as "any total > 0 passes" so chat-bound rolls without
 * a pre-declared Ob still resolve.
 */
function resolveObstacle(args: {
  optsObstacle: number | undefined;
  panelObstacle: number | null | undefined;
}): number | null {
  if (args.optsObstacle !== undefined) return args.optsObstacle;
  if (args.panelObstacle !== undefined) return args.panelObstacle;
  return null;
}

function makePayload(spec: TbRollSpec, speakingAsCharacterId: string) {
  const notation = buildTbNotation(spec.pool, spec.bonusSuccesses, spec.heroic);
  return {
    notation,
    reason: spec.caption,
    visibility: "public" as const,
    speakingAsCharacterId,
    meta: { system: TB_ROLL_META_SYSTEM, spec },
  };
}

function withObstacle(headline: string, obstacle: number | null): string {
  return obstacle === null ? headline : `${headline} vs Ob ${obstacle}`;
}

function withCharacter(characterName: string, body: string): string {
  return characterName ? `${characterName} — ${body}` : body;
}

/* -------------------------------------------------------------------------
 * Ability rollables — Will, Health, Nature
 * ----------------------------------------------------------------------- */

export const WillCheck = defineRollable({
  name: "@vtt/system-torchbearer/will-check",
  inputs: [RawAbilities, Identity, Character, Conditions, Heroic] as const,
  // Disposition mode reads every party-tagged character's
  // Conditions; declare those as ambient inputs so the panel
  // re-previews when a teammate's H&T / Exhausted flips.
  ambientInputs: [Team, Conditions],
  command: RequestRoll,
  interactive: true,
  opts: z.object(RollOptsBase),
  compute: (
    [abilities, identity, character, conditions, heroic],
    { opts, world, entityId },
  ): TbRollSpec => {
    const obstacle = resolveObstacle({
      optsObstacle: opts?.obstacle,
      panelObstacle: panelObstacleFromOpts(opts?.contributions),
    });
    const headline = identity.name ? `Will (${identity.name})` : "Will";
    const isHeroic = resolveHeroic({
      optsHeroic: opts?.heroic,
      panelHeroic: panelHeroicFromOpts(opts?.contributions),
      traitHeroic: traitHeroicFor(heroic, "ability", "will"),
    });
    const willDispoMode = resolveDispositionForOpts(opts);
    const willAddTo = resolveDispositionAddToForOpts(opts);
    // Will-check in dispo mode: even if the panel didn't explicitly
    // pick "will" via the addTo selector, the ability rating IS the
    // additive base. Default the addTo + dispoBase from this rollable's
    // own ability.
    const willResolvedAddTo = willAddTo ?? "will";
    const willDispoBase = willDispoMode
      ? dispoBaseFromAbilities(abilities, willResolvedAddTo)
      : undefined;
    return buildSpec(
      {
        baseDice: abilities.will.rating,
        source: "Will",
        sourceId: "will",
        kind: "ability",
        heroic: isHeroic,
        versusTestId: resolveVersusForOpts(opts),
        dispositionMode: willDispoMode,
        dispoAddTo: willDispoMode ? willResolvedAddTo : undefined,
        dispoBase: willDispoBase,
        world,
        entityId,
        headline,
        characterName: character.name,
      },
      conditions,
      opts?.contributions,
      obstacle,
    );
  },
  toPayload: (spec, { entityId }) => makePayload(spec, entityId),
});

export const HealthCheck = defineRollable({
  name: "@vtt/system-torchbearer/health-check",
  inputs: [RawAbilities, Character, Conditions, Heroic] as const,
  ambientInputs: [Team, Conditions],
  command: RequestRoll,
  interactive: true,
  opts: z.object(RollOptsBase),
  compute: (
    [abilities, character, conditions, heroic],
    { opts, world, entityId },
  ): TbRollSpec => {
    const obstacle = resolveObstacle({
      optsObstacle: opts?.obstacle,
      panelObstacle: panelObstacleFromOpts(opts?.contributions),
    });
    const isHeroic = resolveHeroic({
      optsHeroic: opts?.heroic,
      panelHeroic: panelHeroicFromOpts(opts?.contributions),
      traitHeroic: traitHeroicFor(heroic, "ability", "health"),
    });
    const healthDispoMode = resolveDispositionForOpts(opts);
    const healthAddTo = resolveDispositionAddToForOpts(opts);
    const healthResolvedAddTo = healthAddTo ?? "health";
    const healthDispoBase = healthDispoMode
      ? dispoBaseFromAbilities(abilities, healthResolvedAddTo)
      : undefined;
    return buildSpec(
      {
        baseDice: abilities.health.rating,
        source: "Health",
        sourceId: "health",
        kind: "ability",
        heroic: isHeroic,
        versusTestId: resolveVersusForOpts(opts),
        dispositionMode: healthDispoMode,
        dispoAddTo: healthDispoMode ? healthResolvedAddTo : undefined,
        dispoBase: healthDispoBase,
        world,
        entityId,
        headline: "Health",
        characterName: character.name,
      },
      conditions,
      opts?.contributions,
      obstacle,
    );
  },
  toPayload: (spec, { entityId }) => makePayload(spec, entityId),
});

export const NatureCheck = defineRollable({
  name: "@vtt/system-torchbearer/nature-check",
  inputs: [RawAbilities, Character, Conditions, Heroic] as const,
  ambientInputs: [Team, Conditions],
  command: RequestRoll,
  interactive: true,
  opts: z.object({
    ...RollOptsBase,
    /**
     * `tap` rolls maximum Nature instead of the current (possibly
     * taxed) Nature rating, then taxes Nature down on a fail
     * (DH p.49). For shape-only the option is surfaced but the
     * taxing side-effect lives in the future system.
     */
    tap: z.boolean().optional(),
  }),
  compute: (
    [abilities, character, conditions, heroic],
    { opts, world, entityId },
  ): TbRollSpec => {
    const tap = opts?.tap === true;
    const baseDice = tap ? abilities.nature.maximum : abilities.nature.rating;
    const obstacle = resolveObstacle({
      optsObstacle: opts?.obstacle,
      panelObstacle: panelObstacleFromOpts(opts?.contributions),
    });
    const headline = tap ? "Nature (tap)" : "Nature";
    const source = tap ? "Nature (tap)" : "Nature";
    const isHeroic = resolveHeroic({
      optsHeroic: opts?.heroic,
      panelHeroic: panelHeroicFromOpts(opts?.contributions),
      traitHeroic: traitHeroicFor(heroic, "ability", "nature"),
    });
    const natureDispoMode = resolveDispositionForOpts(opts);
    const natureAddTo = resolveDispositionAddToForOpts(opts);
    const natureDispoBase = natureDispoMode
      ? dispoBaseFromAbilities(abilities, natureAddTo)
      : undefined;
    return buildSpec(
      {
        baseDice,
        source,
        sourceId: "nature",
        kind: "ability",
        heroic: isHeroic,
        versusTestId: resolveVersusForOpts(opts),
        dispositionMode: natureDispoMode,
        dispoAddTo: natureAddTo,
        dispoBase: natureDispoBase,
        world,
        entityId,
        headline,
        characterName: character.name,
      },
      conditions,
      opts?.contributions,
      obstacle,
    );
  },
  toPayload: (spec, { entityId }) => makePayload(spec, entityId),
});

/* -------------------------------------------------------------------------
 * Town ability rollables — Resources, Circles
 *
 * Town tests are NOT adventure tests, so condition modifiers don't
 * apply (DH p.250 — Adventure Phase Procedures lists condition
 * penalties; town has its own procedures). The compute fn still
 * reads Conditions for symmetry with sheet-bound rollable shape but
 * passes `kind: "town-ability"` so `autoModifiersFromConditions`
 * returns empty.
 * ----------------------------------------------------------------------- */

export const ResourcesCheck = defineRollable({
  name: "@vtt/system-torchbearer/resources-check",
  inputs: [TownAbilities, Character, Conditions, Heroic] as const,
  ambientInputs: [Team, Conditions],
  command: RequestRoll,
  interactive: true,
  opts: z.object(RollOptsBase),
  compute: (
    [town, character, conditions, heroic],
    { opts, world, entityId },
  ): TbRollSpec => {
    const obstacle = resolveObstacle({
      optsObstacle: opts?.obstacle,
      panelObstacle: panelObstacleFromOpts(opts?.contributions),
    });
    const isHeroic = resolveHeroic({
      optsHeroic: opts?.heroic,
      panelHeroic: panelHeroicFromOpts(opts?.contributions),
      traitHeroic: traitHeroicFor(heroic, "town-ability", "resources"),
    });
    return buildSpec(
      {
        baseDice: town.resources.rating,
        source: "Resources",
        sourceId: "resources",
        kind: "town-ability",
        heroic: isHeroic,
        versusTestId: resolveVersusForOpts(opts),
        dispositionMode: resolveDispositionForOpts(opts),
        world,
        entityId,
        headline: "Resources",
        characterName: character.name,
      },
      conditions,
      opts?.contributions,
      obstacle,
    );
  },
  toPayload: (spec, { entityId }) => makePayload(spec, entityId),
});

export const CirclesCheck = defineRollable({
  name: "@vtt/system-torchbearer/circles-check",
  inputs: [TownAbilities, Character, Conditions, Heroic] as const,
  ambientInputs: [Team, Conditions],
  command: RequestRoll,
  interactive: true,
  opts: z.object(RollOptsBase),
  compute: (
    [town, character, conditions, heroic],
    { opts, world, entityId },
  ): TbRollSpec => {
    const obstacle = resolveObstacle({
      optsObstacle: opts?.obstacle,
      panelObstacle: panelObstacleFromOpts(opts?.contributions),
    });
    const isHeroic = resolveHeroic({
      optsHeroic: opts?.heroic,
      panelHeroic: panelHeroicFromOpts(opts?.contributions),
      traitHeroic: traitHeroicFor(heroic, "town-ability", "circles"),
    });
    return buildSpec(
      {
        baseDice: town.circles.rating,
        source: "Circles",
        sourceId: "circles",
        kind: "town-ability",
        heroic: isHeroic,
        versusTestId: resolveVersusForOpts(opts),
        dispositionMode: resolveDispositionForOpts(opts),
        world,
        entityId,
        headline: "Circles",
        characterName: character.name,
      },
      conditions,
      opts?.contributions,
      obstacle,
    );
  },
  toPayload: (spec, { entityId }) => makePayload(spec, entityId),
});

/* -------------------------------------------------------------------------
 * Skill rollable — one rollable, opts.skillId selects which skill
 * ----------------------------------------------------------------------- */

/**
 * Single rollable parameterised on the skill id. Falls through to the
 * skill's Beginner's Luck ability when the skill is rated 0 (DH p.78).
 * The BL pool is the relevant ability halved, rounded up.
 *
 * Skill-specific auto-modifiers:
 *   - `skills.entries[skillId].taxed` — system-toggled flag for skills
 *     under condition-driven taxation; emits `-1D Skill taxed` (kept
 *     distinct from the Sick / Injured -1D so the panel can show "two
 *     -1D mods at once" when both are live).
 */
export const SkillCheck = defineRollable({
  name: "@vtt/system-torchbearer/skill-check",
  inputs: [Skills, RawAbilities, Character, Conditions, Heroic] as const,
  ambientInputs: [Team, Conditions],
  command: RequestRoll,
  interactive: true,
  opts: z.object({
    skillId: z.string().min(1),
    ...RollOptsBase,
  }),
  compute: (
    [skills, abilities, character, conditions, heroic],
    { opts, world, entityId },
  ): TbRollSpec => {
    const skill = getSkill(opts.skillId);
    const entry = skills.entries[opts.skillId];
    const rating = entry?.rating ?? 0;
    const skillName = skill?.name ?? opts.skillId;
    const obstacle = resolveObstacle({
      optsObstacle: opts.obstacle,
      panelObstacle: panelObstacleFromOpts(opts.contributions),
    });

    const extraAuto: TbRollModifier[] = [];
    if (entry?.taxed) {
      extraAuto.push({
        id: "auto:skill:taxed",
        kind: "dice",
        value: -1,
        label: `${skillName} taxed`,
        apply: "always",
        source: "condition",
        providedBy: `skill:${opts.skillId}:taxed`,
      });
    }

    const panelHeroic = panelHeroicFromOpts(opts.contributions);

    if (rating > 0) {
      const isHeroic = resolveHeroic({
        optsHeroic: opts.heroic,
        panelHeroic,
        traitHeroic: traitHeroicFor(heroic, "skill", opts.skillId),
      });
      const dispoMode = resolveDispositionForOpts(opts);
      const addTo = resolveDispositionAddToForOpts(opts);
      const dispoBase = dispoMode
        ? dispoBaseFromAbilities(abilities, addTo)
        : undefined;
      return buildSpec(
        {
          baseDice: rating,
          source: skillName,
          sourceId: opts.skillId,
          kind: "skill",
          heroic: isHeroic,
          versusTestId: resolveVersusForOpts(opts),
          dispositionMode: dispoMode,
          dispoAddTo: addTo,
          dispoBase,
          world,
          entityId,
          headline: skillName,
          characterName: character.name,
          extraAuto,
        },
        conditions,
        opts.contributions,
        obstacle,
      );
    }

    const blAbility: BeginnersLuck = skill?.bl ?? "will";
    const blRating =
      blAbility === "will" ? abilities.will.rating : abilities.health.rating;
    // baseDice carries the *full* ability rating; the halving lives
    // inside `foldBlModifiers` so DH p.59's "ability + wises + help +
    // supplies + gear, halved" applies (rather than halving the
    // ability alone and adding pre-half modifiers at full strength,
    // which produced a more generous pool than RAW).
    const blLabel = `${skillName} (Beginner's Luck, ${blAbility})`;
    const isHeroic = resolveHeroic({
      optsHeroic: opts.heroic,
      panelHeroic,
      traitHeroic: traitHeroicFor(heroic, "skill-bl", opts.skillId),
    });
    const blDispoMode = resolveDispositionForOpts(opts);
    const blAddTo = resolveDispositionAddToForOpts(opts);
    const blDispoBase = blDispoMode
      ? dispoBaseFromAbilities(abilities, blAddTo)
      : undefined;
    return buildSpec(
      {
        baseDice: blRating,
        source: blLabel,
        sourceId: opts.skillId,
        kind: "skill-bl",
        heroic: isHeroic,
        versusTestId: resolveVersusForOpts(opts),
        dispositionMode: blDispoMode,
        dispoAddTo: blAddTo,
        dispoBase: blDispoBase,
        world,
        entityId,
        headline: blLabel,
        characterName: character.name,
        extraAuto,
      },
      conditions,
      opts.contributions,
      obstacle,
    );
  },
  toPayload: (spec, { entityId }) => makePayload(spec, entityId),
});

/* -------------------------------------------------------------------------
 * The full registered set, exported for the manifest
 * ----------------------------------------------------------------------- */

/**
 * Marker referenced from a system that wants to flag conditions in the
 * roll label. Imported by views to avoid a hidden reference cycle.
 */
export const ALL_TB_ROLLABLES = [
  WillCheck,
  HealthCheck,
  NatureCheck,
  ResourcesCheck,
  CirclesCheck,
  SkillCheck,
] as const;
