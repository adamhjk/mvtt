import {
  defineSlot,
  type EntityId,
  type QualifiedName,
  QualifiedNameSchema,
  z,
} from "@vtt/substrate";

/**
 * Per-render arguments handed to every sheet slot fill. The `characterId`
 * is the entity this sheet is bound to; fills resolve their own data
 * (traits, derivations, rollables) from it.
 */
export interface CharacterSheetRenderArgs {
  readonly characterId: EntityId;
}

/**
 * Common fill shape for the four "stacked region" slots — Identity,
 * Vitals, Status, Actions. Each fill renders a fragment of JSX into
 * its named region; the substrate stacks them in priority order.
 */
export interface CharacterSheetRegion {
  /** Plugin-namespaced id, e.g. `@vtt/dnd5e/sheet/vitals/hp`. */
  id: QualifiedName;
  /** Higher priority sorts toward the top of the region. Defaults to 0. */
  priority?: number;
  render: (args: CharacterSheetRenderArgs) => unknown;
}

/**
 * Tabs slot fill — same as a region plus a `label` for the tab bar.
 * The label is what the user clicks; `id` is the stable key for
 * keyboard nav and persistence of the active tab.
 */
export interface CharacterSheetTab {
  id: QualifiedName;
  label: string;
  priority?: number;
  render: (args: CharacterSheetRenderArgs) => unknown;
}

const RegionSchema = z.object({
  id: QualifiedNameSchema,
  priority: z.number().optional(),
  render: z.any(),
});

const TabSchema = z.object({
  id: QualifiedNameSchema,
  label: z.string().min(1),
  priority: z.number().optional(),
  render: z.any(),
});

/**
 * Identity region — sticky top of the sheet on every viewport. The
 * default characters plugin fills this with name + player-assignment
 * fields; game systems extend it with a sub-line ("Lvl 4 Ranger · NG"),
 * portrait, etc. Fills stack vertically inside the identity region.
 */
export const CharacterSheetIdentitySlot = defineSlot({
  name: "@vtt/characters/sheet-identity",
  schema: RegionSchema,
  description:
    "Sticky top region of the character sheet — name, portrait, level/class line, etc. Fills stack vertically and remain visible while the body scrolls.",
});

/**
 * Vitals region — numeric stats the player watches every turn (HP, AC,
 * initiative, hunger, willpower). On phone, this region collapses to a
 * tight horizontal strip below the identity. Empty = the rail collapses.
 */
export const CharacterSheetVitalsSlot = defineSlot({
  name: "@vtt/characters/sheet-vitals",
  schema: RegionSchema,
  description:
    "Always-visible numeric stats (HP, AC, initiative). Renders in the rail on desktop, in a horizontal strip on phone.",
});

/**
 * Status region — condition chips, buffs, ongoing effects. Renders
 * directly under Vitals on every viewport. On phone, overflows to
 * `+N more` rather than wrapping.
 */
export const CharacterSheetStatusSlot = defineSlot({
  name: "@vtt/characters/sheet-status",
  schema: RegionSchema,
  description:
    "Always-visible condition chips and ongoing effects. Renders below Vitals; overflows to a `+N more` chip on narrow viewports.",
});

/**
 * Tabs slot — the bulk of the sheet. Each fill becomes a tab in the
 * tab bar; the active tab's `render` mounts in the body area. Game
 * systems contribute their Stats / Skills / Spells / Inventory tabs.
 * Priority orders the tabs left-to-right (higher = leftmost).
 */
export const CharacterSheetTabsSlot = defineSlot({
  name: "@vtt/characters/sheet-tabs",
  schema: TabSchema,
  description:
    "Tabs filling the body area of the sheet. Each fill provides an id, label, and render fn; the shell renders the tab bar and mounts the active tab's body.",
});

/**
 * Actions region — quick-access roll buttons and pre-roll triggers.
 * Sticky at the bottom of the sheet so combat rolls stay one tap away.
 * On phone, fills overflowing the strip collapse into a "more" sheet.
 */
export const CharacterSheetActionsSlot = defineSlot({
  name: "@vtt/characters/sheet-actions",
  schema: RegionSchema,
  description:
    "Sticky bottom region of the character sheet — quick rolls, common actions. Always visible; overflow collapses into a more-sheet on phone.",
});

/**
 * Per-render arguments handed to a PendingRoll contributor. The
 * contributor renders extra UI inside the panel (a "Help" button, an
 * aspect picker, etc.) and calls `contribute` to append a contribution
 * to the pending roll. Server-side ownership validation runs on the
 * resulting ContributeToPendingRoll dispatch.
 */
export interface PendingRollContributorArgs {
  /** The PendingRoll entity id. */
  readonly pendingRollId: EntityId;
  /** The rollable's qualified name — for system-aware contributors. */
  readonly rollableName: string;
  /** The initiator's character id and userId — for "help me?" UIs. */
  readonly initiatorCharacterId: EntityId;
  readonly initiatorUserId: string;
  /**
   * Append a contribution. The kit dispatches
   * `ContributeToPendingRoll` for you; just hand back the contribution
   * payload. Must include `fromUserId` matching the dispatcher.
   */
  readonly contribute: (contribution: {
    kind: string;
    label: string;
    fromUserId: string;
    fromCharacterId?: EntityId;
    payload: unknown;
  }) => void;
}

/**
 * Game-system fills for in-panel contribution UI. The built-in panel
 * already has Commit / Cancel / Add-modifier; this slot is where game
 * systems plug in their own contribution affordances (Burning Wheel
 * Help, FATE invocations, "spend a benny on someone else's roll").
 *
 * Permissive on functions, like the sheet section slots.
 */
export interface PendingRollContributor {
  id: QualifiedName;
  /** Higher priority sorts toward the top of the contributor stack. */
  priority?: number;
  /**
   * Optional filter: only render when the pending roll's rollable
   * name matches this prefix. e.g. `"@vtt/system-simple/"` for system-
   * simple contributors. Omit to render for every pending roll.
   */
  rollablePrefix?: string;
  render: (args: PendingRollContributorArgs) => unknown;
}

const PendingRollContributorSchema = z.object({
  id: QualifiedNameSchema,
  priority: z.number().optional(),
  rollablePrefix: z.string().optional(),
  render: z.any(),
});

export const PendingRollContributorsSlot = defineSlot({
  name: "@vtt/characters/pending-roll-contributors",
  schema: PendingRollContributorSchema,
  description:
    "Game-system fills for in-panel contribution UI on PendingRoll panels (Help, invoke aspect, etc.).",
});
