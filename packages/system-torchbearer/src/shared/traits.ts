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

import { defineTrait, EntityId, z } from "@vtt/substrate";
import { ALL_SKILLS } from "./skills.js";

/* -------------------------------------------------------------------------
 * Common shapes
 * ----------------------------------------------------------------------- */

/**
 * Pass / Fail advancement track. Every ability and skill carries one.
 * Counts are monotonic; advancement triggers when counts reach the
 * thresholds in the rules (DH p.74). Splitting pass and fail keeps the
 * UI's two-row track easy to render.
 */
const Advancement = z
  .object({
    pass: z.number().int().min(0).default(0),
    fail: z.number().int().min(0).default(0),
  })
  .default({ pass: 0, fail: 0 });

const RatedAbility = z
  .object({
    rating: z.number().int().min(0).max(7).default(0),
    advancement: Advancement,
  })
  .default({ rating: 0, advancement: { pass: 0, fail: 0 } });

/* -------------------------------------------------------------------------
 * Identity — "Who You Are" block
 * ----------------------------------------------------------------------- */

/**
 * The "Who You Are" header block: name, stock, class, level, and the
 * relationship anchors (parents, mentor, friend, enemy). Free-text for
 * shape-only — Stock and Class will become typed enums when class
 * mechanics land.
 */
export const Identity = defineTrait({
  name: "@vtt/system-torchbearer/Identity",
  schema: z
    .object({
      name: z.string().max(80).default(""),
      stock: z.string().max(40).default(""),
      class: z.string().max(40).default(""),
      level: z.number().int().min(1).max(10).default(1),
      age: z.number().int().min(0).max(999).default(20),
      home: z.string().max(80).default(""),
      raiment: z.string().max(240).default(""),
      parents: z.string().max(120).default(""),
      mentor: z.string().max(120).default(""),
      friend: z.string().max(120).default(""),
      enemy: z.string().max(120).default(""),
    })
    .default({
      name: "",
      stock: "",
      class: "",
      level: 1,
      age: 20,
      home: "",
      raiment: "",
      parents: "",
      mentor: "",
      friend: "",
      enemy: "",
    }),
});

/* -------------------------------------------------------------------------
 * What You Fight For — Belief, Creed, Goal, Instinct
 * ----------------------------------------------------------------------- */

/**
 * The four BICG anchors. Earning rules (DH p.86–88): upholding belief
 * earns fate; enduring a moral test from creed earns persona; achieving
 * a goal earns persona; using an instinct to aid the group earns fate.
 * Each field is free-text rewritten between sessions.
 */
export const WhatYouFightFor = defineTrait({
  name: "@vtt/system-torchbearer/WhatYouFightFor",
  schema: z
    .object({
      belief: z.string().max(240).default(""),
      creed: z.string().max(240).default(""),
      goal: z.string().max(240).default(""),
      instinct: z.string().max(240).default(""),
    })
    .default({ belief: "", creed: "", goal: "", instinct: "" }),
});

/* -------------------------------------------------------------------------
 * Pools — Fate, Persona, Checks
 * ----------------------------------------------------------------------- */

/**
 * Currency pools. Fate / Persona track both the spendable balance and
 * the lifetime spend (the latter feeds level advancement, DH p.89).
 *
 * The Checks total is intentionally NOT stored here — it's derived
 * from the sum of `CharacterTraits.entries[*].checks` so the source
 * of truth for "how many checks I have to spend at camp" is the
 * trait sheet (where checks are earned, one trait at a time, by using
 * a trait against yourself). The Pools section displays the sum
 * read-only.
 */
export const Pools = defineTrait({
  name: "@vtt/system-torchbearer/Pools",
  schema: z
    .object({
      fate: z
        .object({
          current: z.number().int().min(0).default(0),
          totalSpent: z.number().int().min(0).default(0),
        })
        .default({ current: 0, totalSpent: 0 }),
      persona: z
        .object({
          current: z.number().int().min(0).default(0),
          totalSpent: z.number().int().min(0).default(0),
        })
        .default({ current: 0, totalSpent: 0 }),
    })
    .default({
      fate: { current: 0, totalSpent: 0 },
      persona: { current: 0, totalSpent: 0 },
    }),
});

/* -------------------------------------------------------------------------
 * Conditions — eight booleans in canonical severity order
 * ----------------------------------------------------------------------- */

/**
 * The condition ladder from `conditions.ts`. Each condition is its own
 * boolean and they stack; only `fresh` is mutually exclusive with the
 * rest (UI enforces the toggle, validator will when commands arrive).
 */
export const Conditions = defineTrait({
  name: "@vtt/system-torchbearer/Conditions",
  schema: z
    .object({
      fresh: z.boolean().default(true),
      hungryThirsty: z.boolean().default(false),
      angry: z.boolean().default(false),
      afraid: z.boolean().default(false),
      exhausted: z.boolean().default(false),
      injured: z.boolean().default(false),
      sick: z.boolean().default(false),
      dead: z.boolean().default(false),
    })
    .default({
      fresh: true,
      hungryThirsty: false,
      angry: false,
      afraid: false,
      exhausted: false,
      injured: false,
      sick: false,
      dead: false,
    }),
});

/* -------------------------------------------------------------------------
 * Abilities — Will, Health, Nature
 * ----------------------------------------------------------------------- */

/**
 * Raw abilities: Will, Health, Nature. Nature also carries a list of
 * descriptors (Stock-Nature: "Boasting, Demanding, Running" for Humans,
 * etc.) plus a "maximum" rating that drives advancement and skill-
 * learning thresholds (DH p.47, p.69).
 */
export const RawAbilities = defineTrait({
  name: "@vtt/system-torchbearer/RawAbilities",
  schema: z
    .object({
      will: RatedAbility,
      health: RatedAbility,
      nature: z
        .object({
          rating: z.number().int().min(0).max(7).default(0),
          /**
           * Maximum Nature rating. The current `rating` can be taxed
           * (reduced) by tapping; `maximum` is the ceiling and is what
           * drives advancement requirements (DH p.69) and skill-
           * learning thresholds (DH p.78).
           */
          maximum: z.number().int().min(0).max(7).default(0),
          advancement: Advancement,
          descriptors: z.array(z.string().min(1).max(40)).default([]),
        })
        .default({
          rating: 0,
          maximum: 0,
          advancement: { pass: 0, fail: 0 },
          descriptors: [],
        }),
    })
    .default({
      will: { rating: 0, advancement: { pass: 0, fail: 0 } },
      health: { rating: 0, advancement: { pass: 0, fail: 0 } },
      nature: {
        rating: 0,
        maximum: 0,
        advancement: { pass: 0, fail: 0 },
        descriptors: [],
      },
    }),
});

/* -------------------------------------------------------------------------
 * Town Abilities — Resources, Circles, Precedence, Might
 * ----------------------------------------------------------------------- */

/**
 * Town abilities. Resources and Circles advance via P/F tracks like
 * skills; Precedence and Might are simple scalar ratings adjusted by
 * level benefits and stock (DH p.49, p.66).
 */
export const TownAbilities = defineTrait({
  name: "@vtt/system-torchbearer/TownAbilities",
  schema: z
    .object({
      resources: RatedAbility,
      circles: RatedAbility,
      precedence: z.number().int().min(0).max(10).default(0),
      might: z.number().int().min(0).max(6).default(2),
    })
    .default({
      resources: { rating: 0, advancement: { pass: 0, fail: 0 } },
      circles: { rating: 0, advancement: { pass: 0, fail: 0 } },
      precedence: 0,
      might: 2,
    }),
});

/* -------------------------------------------------------------------------
 * Skills — record keyed by skill id
 * ----------------------------------------------------------------------- */

const SkillEntry = z
  .object({
    rating: z.number().int().min(0).max(6).default(0),
    advancement: Advancement,
    /**
     * `taxed` for skills under conditions like Sick / Injured that
     * impose a −1D until cleared. Toggled by the conditions system
     * once mechanics land.
     */
    taxed: z.boolean().default(false),
    /**
     * Count of Beginner's Luck attempts logged toward learning this
     * skill (DH p.75 "Learning a New Skill"). Each BL test counts
     * once — pass or fail doesn't matter, just the number of tests.
     * When this reaches the character's maximum Nature rating, the
     * skill is learned at rating 2 and the counter resets.
     *
     * Stays at 0 once the skill has been learned (rating ≥ 1) — at
     * that point standard advancement (pass/fail bubbles) takes over.
     */
    learningTests: z.number().int().min(0).default(0),
  })
  .default({
    rating: 0,
    advancement: { pass: 0, fail: 0 },
    taxed: false,
    learningTests: 0,
  });

/**
 * Skill ratings keyed by the canonical skill id (see `skills.ts`).
 * Defaults to a record with every known skill at rating 0 so the UI
 * can render the table without conditional null checks. New skills
 * (e.g. when the LMM additions or future books are catalogued) light
 * up automatically by being added to ALL_SKILLS.
 */
export const Skills = defineTrait({
  name: "@vtt/system-torchbearer/Skills",
  schema: z
    .object({
      entries: z.record(z.string(), SkillEntry).default({}),
    })
    .default({ entries: defaultSkillsRecord() }),
});

function defaultSkillsRecord(): Record<string, z.infer<typeof SkillEntry>> {
  const out: Record<string, z.infer<typeof SkillEntry>> = {};
  for (const s of ALL_SKILLS) {
    out[s.id] = {
      rating: 0,
      advancement: { pass: 0, fail: 0 },
      taxed: false,
      learningTests: 0,
    };
  }
  return out;
}

/* -------------------------------------------------------------------------
 * Character Traits — TB "Traits" (the personality kind)
 * ----------------------------------------------------------------------- */

/**
 * Character traits in the TB sense: named personality tags rated 1–3.
 * Distinct namespace from substrate "traits" (data shapes).
 *
 * Per DH p.79, the trait level controls how often the +1D bonus
 * applies in a session — Lv1: once, Lv2: twice, Lv3: every appropriate
 * passed/tied test (no per-session cap).
 *
 * `beneficialUses` tracks how many of those bonuses have been spent
 * this session — the dot count caps at the trait's level (and at level
 * 3 the cap shows the third dot for parity, even though the +1s effect
 * doesn't actually consume a use).
 *
 * `checks` is the resource earned by using a trait *against* yourself
 * (DH p.80 "Checks Against Traits" — −1D on self for 1 check, +2D to
 * an opponent or break-tie-for-opponent for 2 checks). Once per session
 * per trait, but checks accumulate across multiple sessions between
 * camps so this is a counter, not a flag.
 *
 * `usedAgainst` enforces the per-session cap on against-self use
 * (DH p.80: "You may use each trait against yourself only once per
 * session"). Auto-set true by `TraitUsageLoggedSystem` when an
 * against-self log fires; the player can flip it manually in the
 * traits table to reset for a new session or correct a misclick.
 */
export const CharacterTraits = defineTrait({
  name: "@vtt/system-torchbearer/CharacterTraits",
  schema: z
    .object({
      entries: z
        .array(
          z.object({
            name: z.string().min(1).max(60),
            level: z.number().int().min(1).max(3),
            beneficialUses: z.number().int().min(0).max(3).default(0),
            checks: z.number().int().min(0).max(20).default(0),
            usedAgainst: z.boolean().default(false),
          }),
        )
        .default([]),
    })
    .default({ entries: [] }),
});

/* -------------------------------------------------------------------------
 * Wises — named insights with Pass/Fail/Fate/Persona check matrix
 * ----------------------------------------------------------------------- */

/**
 * Wises grant rerolls and other bonuses (DH p.85). Each wise tracks
 * four boolean uses across a session — when all four are checked the
 * wise can be rewritten or used to mark a Beginner's Luck advancement.
 */
export const Wises = defineTrait({
  name: "@vtt/system-torchbearer/Wises",
  schema: z
    .object({
      entries: z
        .array(
          z.object({
            name: z.string().min(1).max(80),
            pass: z.boolean().default(false),
            fail: z.boolean().default(false),
            fate: z.boolean().default(false),
            persona: z.boolean().default(false),
          }),
        )
        .default([]),
    })
    .default({ entries: [] }),
});


/* -------------------------------------------------------------------------
 * Arcane — Spells, Relics, Memory Palace, Urðr / Burden
 * ----------------------------------------------------------------------- */

/**
 * Arcane spells (DH "Spells" chapter). Each spell tracks where it
 * lives (library / spellbook / memorized / cast / scroll) and whether
 * it has the supplies needed to cast. Free-text effect summary for
 * fast at-the-table reading.
 */
export const Spells = defineTrait({
  name: "@vtt/system-torchbearer/Spells",
  schema: z
    .object({
      entries: z
        .array(
          z.object({
            name: z.string().min(1).max(80),
            ob: z.number().int().min(0).max(10).default(0),
            library: z.boolean().default(false),
            spellbook: z.boolean().default(false),
            memorized: z.boolean().default(false),
            cast: z.boolean().default(false),
            scroll: z.boolean().default(false),
            supplies: z.boolean().default(false),
            effect: z.string().max(240).default(""),
          }),
        )
        .default([]),
      /**
       * Memory palace slots — how many spells the caster can hold
       * memorized at once. Six dots on the printed sheet (DH p.96).
       */
      memoryPalace: z.number().int().min(0).max(6).default(0),
    })
    .default({ entries: [], memoryPalace: 0 }),
});

/**
 * Relics for theurges, shamans, and other relic-bearing classes.
 * Each relic carries an inventory slot reference (where on the
 * inventory page it sits), an invocation/name/circle, and the table
 * also tracks Urðr and Burden — the divine-favor / divine-debt
 * counters described in DH "Theurge" and LMM "Shaman" chapters.
 */
export const Relics = defineTrait({
  name: "@vtt/system-torchbearer/Relics",
  schema: z
    .object({
      entries: z
        .array(
          z.object({
            relic: z.string().min(1).max(80),
            inventory: z.string().max(80).default(""),
            invocation: z.string().max(120).default(""),
          }),
        )
        .default([]),
      urdr: z.number().int().min(0).max(4).default(1),
      burden: z.number().int().min(0).max(6).default(0),
    })
    .default({ entries: [], urdr: 1, burden: 0 }),
});

/* -------------------------------------------------------------------------
 * Allies & Enemies — relationship table
 * ----------------------------------------------------------------------- */

export const AlliesEnemies = defineTrait({
  name: "@vtt/system-torchbearer/AlliesEnemies",
  schema: z
    .object({
      entries: z
        .array(
          z.object({
            name: z.string().min(1).max(80),
            location: z.string().max(80).default(""),
            status: z.string().max(80).default(""),
          }),
        )
        .default([]),
    })
    .default({ entries: [] }),
});

/* -------------------------------------------------------------------------
 * SkillImprovementOpportunity — chat-timeline entity for "ready to improve"
 * ----------------------------------------------------------------------- */

/**
 * Spawned by `SkillImprovementOpenedSystem` when an editor's click on
 * the sheet fills both advancement tracks. Rendered into the chat
 * timeline as a row that says "{Character} improved at {Skill}!" and
 * carries an [Improve] button. Clicking the button dispatches
 * `ImproveSkill`, which bumps the rating, zeroes the tracks, and
 * despawns this opportunity entity (so the prompt disappears once
 * acted on).
 *
 * Character + skill names are denormalised at spawn time so the row
 * still attributes correctly after a rename or despawn — same pattern
 * the comms `ChatMessage` uses for `authorName`.
 *
 * `rating` is the rating *at the time the track filled* (i.e. the
 * pre-improvement rating). It's recorded so a stale opportunity row
 * still tells the reader what the click would do, and so the server's
 * dedup check can compare against the current rating to detect that a
 * previously-opened opportunity is no longer valid.
 */
export const SkillImprovementOpportunity = defineTrait({
  name: "@vtt/system-torchbearer/SkillImprovementOpportunity",
  schema: z.object({
    characterId: EntityId,
    characterName: z.string().min(1).max(120),
    skillId: z.string().min(1).max(60),
    skillName: z.string().min(1).max(80),
    /** Rating at the moment the track filled (= rating before improvement). */
    rating: z.number().int().min(0).max(6),
    /** Unix millis. Sort key for the chat timeline. */
    sentAt: z.number(),
  }),
});

/* -------------------------------------------------------------------------
 * SkillLearningOpportunity — chat-rail entity for "ready to learn"
 * ----------------------------------------------------------------------- */

/**
 * Spawned by `SkillLearningOpenedSystem` when a character's BL
 * learning track has filled to max-Nature (DH p.75) — analogous to
 * `SkillImprovementOpportunity` but for the 0 → 2 jump that completes
 * a Beginner's Luck learning cycle. The chat row reads "{Character}
 * learned {Skill}!" and carries a [Learn] button that dispatches
 * `LearnSkill` to bump the rating and despawn the row.
 *
 * Same denormalised-name + read-everyone / write-gm pattern as
 * `SkillImprovementOpportunity` — the prompt stays legible if the
 * character is renamed or the player un-fills a learning pip
 * (sweep system despawns the row in that case).
 */
export const SkillLearningOpportunity = defineTrait({
  name: "@vtt/system-torchbearer/SkillLearningOpportunity",
  schema: z.object({
    characterId: EntityId,
    characterName: z.string().min(1).max(120),
    skillId: z.string().min(1).max(60),
    skillName: z.string().min(1).max(80),
    /**
     * The learning-tests count at the moment the opportunity opened
     * (= max Nature when threshold crossed). Lets a stale row tell
     * the reader what the click would commit, and lets the sweep
     * detect "they un-filled a pip and the row no longer applies".
     */
    learningTests: z.number().int().min(0).max(20),
    /** Unix millis. Sort key for the chat timeline. */
    sentAt: z.number(),
  }),
});

/* -------------------------------------------------------------------------
 * AdvancementLogged — marker trait on a Roll entity
 * ----------------------------------------------------------------------- */

/**
 * Attached to a Roll entity by `AdvancementLoggedSystem` once a player
 * (or GM) has translated the roll's pass/fail into an advancement
 * mark on the character. Presence of this trait suppresses the
 * "Log Advancement" button on the chat row, so a single roll can't
 * advance a track twice.
 *
 * The denormalised `target` + `outcome` + `loggedAt` fields let the
 * chat row show a small confirmation footer ("✓ pass logged for
 * Fighter"), and let an audit / replay tool reconstruct what the
 * click did without re-deriving from the spec.
 */
export const AdvancementLogged = defineTrait({
  name: "@vtt/system-torchbearer/AdvancementLogged",
  schema: z.object({
    characterId: EntityId,
    target: z.object({
      kind: z.enum(["ability", "town-ability", "skill", "skill-bl"]),
      /** `"will"`, `"resources"`, `"<skill-id>"`, etc. */
      id: z.string().min(1).max(80),
      /** Display label captured at log time (`"Will"`, `"Fighter"`). */
      label: z.string().min(1).max(120),
    }),
    outcome: z.enum(["pass", "fail"]),
    /** Unix millis stamped when the command applied. */
    loggedAt: z.number(),
  }),
});

/**
 * Attached to a Roll entity once the player has clicked "Log" on a
 * trait-usage chat card — bumps the trait's `beneficialUses` (for
 * Lv1/2 "for self" usage) or `checks` counter (for "against self").
 * Existence of this trait gates the chat row's "Log" button so a
 * single roll can only be marked once.
 *
 * `traitNameAtLog` is denormalised at log time so audit and chat
 * footers stay legible after the trait is renamed or removed.
 */
export const TraitUsageLogged = defineTrait({
  name: "@vtt/system-torchbearer/TraitUsageLogged",
  schema: z.object({
    characterId: EntityId,
    traitIndex: z.number().int().min(0).max(20),
    traitNameAtLog: z.string().min(1).max(60),
    direction: z.enum(["for", "against"]),
    severity: z.enum(["minus-1d", "plus-2d-opp"]).optional(),
    /** Unix millis stamped when the command applied. */
    loggedAt: z.number(),
  }),
});

/* -------------------------------------------------------------------------
 * RollSpends — fate / persona spend ledger on a resolved Roll
 * ----------------------------------------------------------------------- */

/**
 * Each kind of post-roll fate / persona spend the TB system supports.
 * The shape is shared across spends so a single trait + system pair
 * can hold the full audit trail for a roll:
 *
 *   - `luck`                — DH p.23, p.250: 1 fate, reroll 6s as bonus dice
 *   - `deeper-understanding`— DH p.77: 1 fate, reroll one failed die on a
 *                             wise-related test
 *   - `of-course`           — DH p.77: 1 persona, reroll all failed dice on
 *                             a wise-related test
 *   - `persona-dice`        — DH p.8 / p.250: 1–3 persona, +1D each (cap 3)
 *   - `channel-nature`      — DH p.67: 1 persona, +Nature dice; outside-of-
 *                             nature taxes Nature post-roll
 *   - `synergy`             — DH p.87: helper spends 1 fate, learns from
 *                             the roller's test on a pass
 */
const RollSpendKindSchema = z.enum([
  "luck",
  "deeper-understanding",
  "of-course",
  "persona-dice",
  "channel-nature",
  "synergy",
]);
export type RollSpendKind = z.infer<typeof RollSpendKindSchema>;

const RollSpendEntrySchema = z.object({
  kind: RollSpendKindSchema,
  /** Whether this spend drew from the fate or persona pool. */
  pool: z.enum(["fate", "persona"]),
  /** Points spent (1–3 — persona-dice can land 1, 2, or 3 in a single click). */
  cost: z.number().int().min(1).max(3),
  /**
   * Indices of dice in `RollResult.dice` that this spend rerolled.
   * Empty for purely-additive spends (persona-dice, channel-nature).
   * Used by validators on subsequent spends to enforce DH p.77's
   * "may not reroll a die that's already been rerolled" rule.
   */
  rerolledIndices: z.array(z.number().int().min(0)).default([]),
  /**
   * Number of new dice this spend appended to `RollResult.dice`. Each
   * append slot is recorded so the chat-card legend can attribute new
   * dice to the correct spend ("+5D Channel Nature", "+1D Persona").
   */
  appendedCount: z.number().int().min(0).default(0),
  /**
   * Net change in successes the spend produced (positive when a
   * reroll lifted a fail to a success). Display-only for the chat
   * row's running ledger; `RollResult.dice` is canonical.
   */
  newSuccesses: z.number().int().default(0),
  /**
   * Wise index for `deeper-understanding` and `of-course` — points
   * into the rolling character's `Wises.entries[]`. The wise's pass /
   * fail / fate / persona box that this spend earns is decided by
   * the spend kind: DU bumps `fate`, OC bumps `persona` (DH p.78
   * "Evolving Wises").
   */
  wiseIndex: z.number().int().min(0).max(40).optional(),
  /**
   * For `channel-nature`: whether the player declared the test as
   * "within" or "outside" their character's Nature descriptors. Drives
   * the post-resolution Nature tax (DH p.67–68): within = no tax;
   * outside + pass = -1; outside + fail = -margin.
   */
  channelScope: z.enum(["within", "outside"]).optional(),
  /** User who clicked the spend (the roller, or — for synergy — the helper). */
  byUserId: z.string(),
  /**
   * The character whose pool was spent. For roller-spends this is
   * the `RolledBy.speakingAsCharacterId`; for synergy it's the
   * helper's character.
   */
  byCharacterId: EntityId,
  loggedAt: z.number(),
});

export type RollSpendEntry = z.infer<typeof RollSpendEntrySchema>;

/**
 * Attached to a Roll entity the first time any fate / persona spend is
 * logged against it. Subsequent spends append to the same `entries`
 * array — one trait, full ledger — so the chat card can render the
 * running history and validators can enforce stacking rules (DH p.77
 * "OC before Luck", "no double-reroll", DH p.8 "up to three persona
 * per roll").
 */
export const RollSpends = defineTrait({
  name: "@vtt/system-torchbearer/RollSpends",
  schema: z.object({
    entries: z.array(RollSpendEntrySchema).default([]),
  }),
});

/**
 * Per-roll marker tracking which synergy helpers have already logged
 * their advancement test (DH p.87 — "If the player rolling the dice
 * passes the test, the helper marks a passed test for advancement").
 *
 * Each declared synergy helper gets one Log Pass button on the chat
 * card; this trait records which ones have been clicked so the same
 * helper can't double-log on the same roll.
 *
 * Shape mirrors the per-helper synergy entry on `RollSpends` —
 * `helperCharacterId` is the key, `target` is the advancement target
 * resolved from the helper's help modifier on the spec, and `loggedAt`
 * is the unix-ms when the helper's player clicked.
 */
export const SynergyAdvancementLogged = defineTrait({
  name: "@vtt/system-torchbearer/SynergyAdvancementLogged",
  schema: z.object({
    entries: z
      .array(
        z.object({
          helperCharacterId: EntityId,
          target: z.object({
            kind: z.enum(["ability", "town-ability", "skill", "skill-bl"]),
            id: z.string().min(1).max(60),
            label: z.string().min(1).max(80),
          }),
          /** Pass / fail — mirrors the roller's outcome (SG p.87). */
          outcome: z.enum(["pass", "fail"]),
          loggedAt: z.number(),
        }),
      )
      .default([]),
  }),
});

/* -------------------------------------------------------------------------
 * Heroic — per-character "this is heroic" registry
 * ----------------------------------------------------------------------- */

/**
 * The set of abilities, town abilities, and skills the character has
 * elevated to **heroic** — for those, every die showing 3+ counts
 * as a success instead of the usual 4+ (rolling subsystem behaviour).
 *
 * Sources of heroic mastery in TB include level benefits that
 * promote a particular skill, certain relic gear, ritual states like
 * a Theologian's faith-aligned tests, and the campaign's optional
 * "heroic mode" toggle. Modelled here as plain string arrays so any
 * of those mechanics — current or future — can flip a flag via
 * `SetField` without inventing per-source plumbing.
 *
 * The rolling subsystem checks this trait against the rollable's
 * `sourceId` (e.g. `"will"`, `"fighter"`, `"resources"`) to decide
 * the success target for a given roll. Per-roll `opts.heroic` and
 * panel toggle contributions still override this trait when the
 * player or GM explicitly forces the mode on or off.
 *
 * Defaults to empty arrays — every roll starts at the standard 4+
 * target until a mechanic populates one of these lists.
 */
export const Heroic = defineTrait({
  name: "@vtt/system-torchbearer/Heroic",
  schema: z
    .object({
      /** Subset of `["will", "health", "nature"]` — abilities turned heroic. */
      abilities: z.array(z.string().min(1).max(40)).default([]),
      /** Subset of `["resources", "circles"]` — town abilities turned heroic. */
      townAbilities: z.array(z.string().min(1).max(40)).default([]),
      /** Skill ids (from the canonical catalog) turned heroic. */
      skills: z.array(z.string().min(1).max(60)).default([]),
    })
    .default({ abilities: [], townAbilities: [], skills: [] }),
});
