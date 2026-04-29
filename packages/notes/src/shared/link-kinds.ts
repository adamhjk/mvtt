import {
  defineSlot,
  QualifiedNameSchema,
  z,
  type EntityId,
  type Registry,
  type World,
} from "@vtt/substrate";

/**
 * What a link's `activate(...)` returns. The notes UI dispatches each
 * variant differently:
 *
 *  - `peek`: render in a transient popover; default for clicks.
 *  - `navigate`: switch the workbench to a tab targeting an entity in
 *    the named page-kind (e.g. open the character sheet, the scene tab).
 *  - `command`: dispatch a substrate command — useful for actions like
 *    "ping this token on the map."
 *  - `custom`: arbitrary side effect — escape hatch for plugins with
 *    one-off behaviours. Usually one of the typed variants is preferred.
 */
export type LinkActivation =
  | { type: "peek"; render: () => unknown }
  | { type: "navigate"; pageKind: string; entityId: EntityId }
  | { type: "command"; command: string; payload: unknown }
  | { type: "custom"; run: (ctx: LinkActivationContext) => void };

export interface LinkActivationContext {
  /** Modifier keys at click time, for "primary vs alternate" routing. */
  readonly modifiers: {
    readonly meta: boolean;
    readonly shift: boolean;
    readonly alt: boolean;
  };
}

/**
 * What an autocomplete row contributes — a bare suggestion the consumer
 * can render however it wants. `body` is what the editor will store
 * (post-normalisation), `display` is what the chip will show.
 */
export interface LinkSuggestion {
  readonly kind: string;
  readonly body: string;
  readonly display: string;
  /** Extra strings the matcher should consider for fuzzy-matching. */
  readonly aliases?: ReadonlyArray<string>;
  /** Free-form tag shown to disambiguate similar suggestions. */
  readonly badge?: string;
}

/**
 * A link kind's behaviour. Each plugin that wants `[[…]]` references to
 * point at one of its entity types ships one of these and registers it
 * via `LinkKindsSlot`.
 *
 * Generic over `Ref` so the kind's own functions can share a typed
 * resolved-reference shape. The registry stores them existentially as
 * `AnyLinkKindDef`.
 */
export interface LinkKindDef<Ref = unknown> {
  /** e.g. "note", "character", "scene", "asset". */
  readonly name: string;
  /**
   * Optional single-character sigil — `[[@Krell]]` parses as
   * `[[character:Krell]]` when `character` registers `"@"`. Sigils
   * are sugar; storage normalises to `kind:body`.
   */
  readonly sigil?: string;
  /**
   * Resolve the typed-or-id body to a typed reference. Return `null`
   * when the body can't be resolved (e.g. typed name has no matching
   * entity). Resolved refs typically include the resolved `entityId`.
   */
  readonly parse: (
    body: string,
    anchor: string | null,
    world: World,
  ) => Ref | null;
  /** Display text for the chip / tooltip. Reactive over trait state. */
  readonly display: (ref: Ref, world: World) => string;
  /** What entity is this link pointing at? */
  readonly target: (ref: Ref, world: World) => { entityId: EntityId } | null;
  /** Click semantics. */
  readonly activate: (ref: Ref, ctx: LinkActivationContext) => LinkActivation;
  /** `[[` autocomplete contributions for a substring query. */
  readonly autocomplete: (query: string, world: World) => LinkSuggestion[];
  /**
   * Substrate event names this kind cares about for the
   * `LinkTargets` index. e.g. `["@vtt/notes/NoteCreated", "@vtt/notes/NoteRenamed"]`.
   * The index system listens for these to know when to refresh.
   */
  readonly indexEvents: ReadonlyArray<string>;
}

/** Existential storage shape — kinds in the registry are heterogeneous. */
export type AnyLinkKindDef = LinkKindDef<unknown>;

/**
 * Plugin-side helper: just an identity function with type inference.
 * Mirrors `defineCommand` / `defineEvent` style.
 */
export function defineLinkKind<Ref>(
  def: LinkKindDef<Ref>,
): LinkKindDef<Ref> {
  return def;
}

/**
 * Plugins fill this slot with `LinkKindDef` contributions. The notes
 * plugin reads them out of `registry.fills.get(LinkKindsSlot.name)` to
 * build the live registry used by the wiki-link parser, the chip
 * renderer, and `[[` autocomplete.
 *
 * Schema is permissive on functions, like other "render-fn-bearing"
 * slots in the codebase (see characters/sheet-* slots). The runtime
 * trusts that fills are LinkKindDef-shaped — there's no schema-level
 * way to validate function presence.
 */
export const LinkKindsSlot = defineSlot({
  name: "@vtt/notes/link-kinds",
  schema: z.object({
    name: z.string().min(1),
    sigil: z.string().length(1).optional(),
    parse: z.any(),
    display: z.any(),
    target: z.any(),
    activate: z.any(),
    autocomplete: z.any(),
    indexEvents: z.array(z.string()),
  }),
  description:
    "Plugins contribute a LinkKindDef per kind they want linkable from `[[…]]` references. Notes reads the slot to build the wiki-link registry.",
});

/** Default kind name when no `kind:` prefix and no sigil matches. */
export const DEFAULT_LINK_KIND = "note";

/**
 * Build a query-time view of the live registry from the substrate's
 * `Registry`. Notes' editor + renderer call this on render to get the
 * current set of registered kinds.
 */
export interface LinkKindIndex {
  readonly all: ReadonlyArray<AnyLinkKindDef>;
  readonly byName: ReadonlyMap<string, AnyLinkKindDef>;
  readonly bySigil: ReadonlyMap<string, AnyLinkKindDef>;
  /** Shape compatible with `parseLinks`'s `ParseOptions`. */
  readonly knownKinds: ReadonlySet<string>;
  readonly sigils: Readonly<Record<string, string>>;
}

export function buildLinkKindIndex(registry: Registry): LinkKindIndex {
  const fills = registry.fills.get(LinkKindsSlot.name) ?? [];
  const all: AnyLinkKindDef[] = fills as AnyLinkKindDef[];
  const byName = new Map<string, AnyLinkKindDef>();
  const bySigil = new Map<string, AnyLinkKindDef>();
  const sigils: Record<string, string> = {};
  for (const k of all) {
    byName.set(k.name, k);
    if (k.sigil) {
      bySigil.set(k.sigil, k);
      sigils[k.sigil] = k.name;
    }
  }
  return {
    all,
    byName,
    bySigil,
    knownKinds: new Set(byName.keys()),
    sigils,
  };
}

/**
 * Schema for QualifiedName re-exported for plugin authors who want to
 * tag their own kind ids — purely for ergonomics.
 */
export { QualifiedNameSchema };
