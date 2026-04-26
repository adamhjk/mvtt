# mrpg-vtt — Modern Virtual Tabletop

An open source, modern virtual tabletop for playing role playing games. The goal is a framework that AI agents can extend trivially: writing new rule systems, new content, new presentation, and new interaction models without touching anything outside the plugin they're authoring. Humans are not expected to write code against this framework directly. Every architectural choice is graded on how legible and patternable the code is to an AI author.

## Vision

Existing virtual tabletops are difficult to develop, test, and extend. New rule systems, mechanics, and content require deep changes across many seams. mrpg-vtt inverts that: a tiny substrate of universal plumbing, with **every game concept — including dice, scenes, initiative, identity, chat — implemented as a plugin on equal footing.** A new rule system is a new plugin. A new spellbook is a new plugin. A custom UI is a new plugin. Plugins compose through typed events, traits, and surface registries.

## Architectural pillars

1. **Thin substrate, plugins everywhere.** The substrate provides entities, traits, events, commands, systems, views, networking, and reactivity. Nothing else. Scene, dice, initiative, identity — all plugins.
2. **ECS as the data model.** Entities are IDs. Traits are typed data attached to entities. Systems are pure functions reacting to events. No class hierarchies, no inheritance, no monolithic objects. Composition is the type system.
3. **Event sourcing as the spine.** Every world mutation flows: `Command (intent) → validation → Event (fact) → state change + UI signal + network broadcast.` Events are the wire format, the audit log, the test fixtures, and the source of UI updates.
4. **Server-authoritative, optimistic clients.** The server runs the canonical world. Clients are caches that may predict for UX. Concurrency is handled by compare-and-swap on commands, never locks or consensus.
5. **Solid for reactive UI.** Fine-grained signals map directly onto trait mutations with no reconciliation tax. Views are Solid components bound to surfaces and trait queries.
6. **Schema-first.** Every trait, event, command, and plugin manifest is a Zod schema. Validation, types, AI legibility, and runtime introspection all derive from one source.
7. **Domain-driven design throughout.** Plugins are bounded contexts. The live game World is one DDD aggregate root; ECS is the internal pattern for that aggregate's contents. Everything outside the World — substrate plumbing, persistence, content catalogs, user accounts, orchestration — uses classic DDD building blocks. See the `ddd` and `ecs` skills.
8. **Persistence in SQLite + JSON.** Each world pins to one server process (see non-goals), so we don't need a distributed datastore — SQLite with JSON columns gives us the document-shaped storage MongoDB would, plus zero-ops, atomic transactions over multiple tables, and a single-file backup/import/export story. Trait records and event payloads live in JSON columns; `worldId`/`seq` are indexed scalar columns. (Earlier design notes said MongoDB; we revised to SQLite once it was clear we don't need cross-region distribution.)

## Architectural framework: DDD + ECS

mvtt uses two complementary patterns. **Classic DDD** structures the substrate, persistence, content catalogs, asset storage, user accounts, and long-running orchestration. **ECS** structures the live game World, which is itself one DDD aggregate root. Plugins are bounded contexts and may contribute to both.

| DDD building block | mvtt expression |
|---|---|
| **Aggregate Root** | The `World` — owns all entities, traits, the event log, and the consistency of the entire game session |
| **Aggregate (logical, within the World)** | Sentinel entity + its traits + the systems and validators that maintain its invariants (e.g. `Encounter`, `PendingAttack`, in-flight `Spell`, `Roll`) |
| **Entity (within an aggregate)** | An ECS entity (bare ID with composed traits) |
| **Value Object** | Trait instance, Event payload, Command payload, schema-defined immutable shapes; cross-plugin types like `DiceFormula`, `Coordinates`, `Money` |
| **Domain Service** | A System — pure function over event + world snapshot |
| **Application Service** | A Command's `validate` + `apply` (one transactional mutation on the World); for non-World workflows like campaign import, classic async-iterable application services per the `ddd` skill |
| **Repository** | The `PersistenceAdapter` for the World aggregate; classic repositories for content catalogs, asset metadata, user accounts, plugin registry |
| **Domain Event** | An Event in the event-sourced spine |
| **Factory** | Pattern helpers like `defineDamageSpell` produce template Value Objects |
| **Bounded Context** | A plugin |
| **Ubiquitous Language** | Plugin-namespaced trait/event/command names (`@vtt/scene/Position`, `@vtt/dnd5e/HitDice`) |

ECS is not a general-purpose architecture; it is the internal pattern for the World aggregate. Anything *outside* the live World — content catalogs loaded from disk, asset storage, user accounts, plugin manifests, campaign archives, long-running orchestration — uses classic DDD with full aggregates, repositories, and application services.

Detailed guidance lives in the two skills:

- `.claude/skills/ddd/` — DDD building blocks, ubiquitous language, repositories, application services
- `.claude/skills/ecs/` — traits, systems, events, commands, views, sentinel entities, factories, plugin manifests

## Vocabulary

| Term | Meaning |
|---|---|
| **Entity** | An identifier (`EntityId`). Has no inherent type; meaning comes from attached traits. |
| **Trait** | A typed data record attached to an entity. Schema-defined. ECS "component" — renamed to avoid colliding with Solid components. |
| **Event** | An immutable record of something that happened. Authoritative facts. |
| **Command** | A typed intent issued by an actor. Validated against world state, may be rejected. Successful commands produce events. |
| **System** | A pure function `(world, event) → events[]` reacting to one event type. Never mutates the world directly; only emits further events. |
| **View** | A Solid component bound to a surface and a trait query. Subscribes to signals; dispatches commands. |
| **Surface** | A named UI extension point declared by a plugin. Other plugins fill it with views. |
| **Plugin** | A unit of distribution. Ships traits, events, commands, systems, views, and content. Has a manifest, a version, and dependencies on other plugins. |
| **Substrate** | The runtime that loads plugins and provides the registries, the world, the network, and the reactivity bridge. |

## The substrate

The substrate is intentionally tiny. It knows about plumbing, not domain.

```
┌─────────────────────────────────────────────────────────────────┐
│  SUBSTRATE                                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   World           — entities, trait stores, query engine,       │
│                     reactive signal source                      │
│                                                                 │
│   TraitRegistry   — register a trait def (Zod schema)           │
│   EventRegistry   — register an event def (Zod schema)          │
│   CommandRegistry — register a command def + validate/apply     │
│   SystemRegistry  — register a system (event subscription)      │
│   ViewRegistry    — register a Solid view by surface+query      │
│   SurfaceRegistry — declare an extension point                  │
│   SlotRegistry    — declare a named slot another plugin can fill│
│                                                                 │
│   EventBus        — typed pub/sub                               │
│   CommandPipeline — dedup, CAS, validate, apply, broadcast      │
│   PluginLoader    — read manifests, resolve deps, register      │
│                                                                 │
│   NetworkTransport — websocket adapter, server + client         │
│   ReactivityBridge — trait mutations → Solid signals            │
│   PresenceChannel  — ephemeral side channel (non-sourced)       │
│                                                                 │
│   PersistenceAdapter — snapshot + event log (MongoDB)           │
│                                                                 │
│   Schema (Zod re-export)                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

A bare substrate boots an empty world that does nothing useful. All meaning is loaded by plugins.

## The ECS model

### Entities and traits

An entity is just an identifier. Meaning is composition:

```
  hero (entity #1)              goblin (entity #2)
  ┌───────────────────┐         ┌───────────────────┐
  │ Identity {Hero}   │         │ Identity {Goblin} │
  │ Strength  {80}    │         │ Strength  {30}    │
  │ Health    {10/10} │         │ Health    {10/10} │
  │ Combatant {party} │         │ Combatant {enemy} │
  └───────────────────┘         └───────────────────┘
```

Same trait set, different values, different role. The engine never needs to know what a "character" or "monster" is.

### Traits are pure data

```ts
export const Health = defineTrait({
  name: "Health",
  schema: z.object({
    current: z.number().int(),
    max:     z.number().int().positive(),
  }),
})
```

No methods. No behavior. One file per trait, owned by one plugin. The trait's name is namespaced by its owning plugin (`@vtt/scene/Position`, `@vtt/dnd5e/HitDice`).

### Events are immutable facts

```ts
export const DamageDealt = defineEvent({
  name: "@vtt/simple-d100/DamageDealt",
  schema: z.object({
    targetId: EntityId,
    amount:   z.number().int().positive(),
    source:   z.string().optional(),
  }),
})
```

Events carry visibility metadata that the substrate uses to filter per-recipient broadcasts (see Trust & visibility below).

### Commands are typed intent

```ts
export const DeclareAttack = defineCommand({
  name: "@vtt/simple-d100/DeclareAttack",
  schema: z.object({ attackerId: EntityId, targetId: EntityId }),

  validate: ({ cmd, world, actor }) => {
    const attacker = world.get(cmd.attackerId, [Strength, Health, Combatant])
    const target   = world.get(cmd.targetId,   [Strength, Health, Combatant])
    if (!attacker || !target)         return fail("missing required traits")
    if (attacker.Health.current <= 0) return fail("attacker is defeated")
    if (target.Health.current <= 0)   return fail("target is already defeated")
    if (!world.turn.isCurrentActor(cmd.attackerId, actor)) return fail("not your turn")
    return ok()
  },

  apply: ({ cmd }) => [AttackDeclared({ attackerId: cmd.attackerId, targetId: cmd.targetId })],
})
```

The split between `validate` and `apply` is intentional: validation reads world state, application produces events. Systems then react to those events.

### Systems are pure functions over events

```ts
export const DamageApplicationSystem = defineSystem({
  name: "DamageApplication",
  on: DamageDealt,
  reads:  [Health],
  writes: [Health],
  run: ({ event, world }) => {
    const target = world.get(event.targetId, [Health])!
    const next = Math.max(0, target.Health.current - event.amount)
    world.set(event.targetId, Health, { ...target.Health, current: next })
    return next === 0 ? [CombatantDefeated({ id: event.targetId })] : []
  },
})
```

`reads`/`writes` are declared so the substrate can parallelize systems and so the AI author can see what touches what without reading bodies.

### Sentinel-entity pattern for async coordination

Anything that requires waiting — dice rolls, multi-step resolution, reactions, animations — becomes a temporary entity with its own traits. A second system reacts to completion events and finishes the work. This is the same pattern everywhere; the AI learns it once.

## Plugins

A plugin is a directory with a manifest and a handful of small files:

```
plugins/<plugin-name>/
  manifest.ts          # declares everything below + dependencies
  shared/              # universal: trait/event/command schemas, helpers
  server/              # authoritative: validators, system handlers
  client/              # presentational: Solid views, predictive code
  content/             # static data interpreted via shared schemas
  tests/               # given/when/then over events
```

The manifest is the contract surface. Nothing in a plugin reaches outside its declared seams.

```ts
export default definePlugin({
  name:    "@vtt/simple-d100",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^1",
    "@vtt/scene@^1",
    "@vtt/identity@^1",
    "@vtt/resolution@^1",
    // ships its own minimal turn system; doesn't depend on a shared initiative plugin
  ],

  traits:    [Strength, Health, Combatant],
  events:    [AttackDeclared, AttackResolved, DamageDealt, CombatantDefeated],
  commands:  [DeclareAttack],
  systems:   [AttackInitiationSystem, AttackCompletionSystem, DamageApplicationSystem],
  views:     [HealthBarView, CombatLogView, AttackButtonView],

  // declarations of slots this plugin exposes for other plugins to fill
  slots: {
    statusEffects: defineSlot<StatusEffectDef>(),
  },
})
```

### Slots: how plugins extend each other

A slot is a typed list a plugin maintains and exposes for dependents to fill in their manifests. `@vtt/dnd5e` declares a `spellTemplates` slot; `@vtt/dnd5e-srd-spells` fills it with 300 spell templates. The substrate ships a generic `defineSlot<T>()` helper; plugins are responsible for what's in their slots and how to use the contents at runtime.

This is the ONLY substrate-level convention required for plugins to extend each other cleanly.

### Content is also plugins

There is no separate "content" abstraction. A spellbook, monster manual, or campaign setting is a plugin that fills slots with typed data using the game-system plugin's pattern helpers. Benefits over the YAML/JSON content packs used by other VTTs:

- Full TypeScript expressiveness; no DSL to outgrow
- End-to-end type safety from definition to consumer
- Real code reuse via helpers like `defineDamageSpell`, `defineFeat`, `defineMonster`
- Tests live next to the content
- Homebrew and official content are the same shape; no second-class status
- Versioning is just package versioning

The AI author never context-switches between writing code and writing data.

```ts
// @vtt/dnd5e-srd-spells/spells/fireball.ts
export const fireball = defineDamageSpell({
  id: "fireball",
  name: "Fireball",
  level: 3,
  school: "evocation",
  components: { v: true, s: true, m: "a tiny ball of bat guano and sulfur" },
  range: 150,
  damage: { dice: "8d6", type: "fire", scaling: { perLevel: "1d6" } },
  targeting: { kind: "sphere", radius: 20, originatesFrom: "point" },
  save: { ability: "dex", halfOnSave: true },
})
```

## Standard core plugins

The substrate ships with a default bundle (`@vtt/standard-core`) of plugins. Each is independently swappable; choosing not to install the bundle gives you a bare substrate suitable for any kind of tabletop.

The bar for inclusion in standard core is high: **it must be universal across tabletops, not just RPGs.** Anything specific to a genre (initiative, hit points, inventory) or a family of systems (d20 mechanics, dice pools, card draws beyond raw randomization) belongs in a layer above core.

| Plugin | Bounded context | Provides |
|---|---|---|
| `@vtt/identity` | Identity | `Name`, `OwnedBy`, actor concepts |
| `@vtt/permissions` | Permissions | Visibility rules, GM/player roles |
| `@vtt/scene` | Scene | `Scene`, `Layer`, `Position`, `Token`, surfaces for token overlays |
| `@vtt/resolution` | Resolution | `Formula`, `RollResult`, `Visibility`; dice rolls as entities |
| `@vtt/comms` | Communication | `ChatMessage`, `Whisper`, `Channel` |

Notably **not** in standard core:

- **Initiative / turns / rounds.** Wildly system-specific (d20 rolled order, FATE narrative exchanges, PbtA's lack of structured turns, wargame simultaneous resolution). Lives in shared-mechanics plugins like `@vtt/d20-initiative` that game systems depend on.
- **Inventory.** RPG-shaped, not VTT-shaped. Lives in `@vtt/rpg-inventory` or in game-system plugins directly.
- **Hit points, conditions, status effects, ability scores.** All game-system concerns.
- **Encounters as a structured concept.** Even "what is an encounter" is system-specific.

Between standard core and game systems sits a **shared-mechanics tier** of plugins that capture mechanics common to *families* of systems. They have no privileged status — they're just plugins that depend on standard core and are depended on by multiple game systems.

```
                       ┌──────────────────┐
                       │  @vtt/substrate  │
                       └────────┬─────────┘
                                │
        ┌───────────────┬───────┼─────────────┬───────────────┐
        ▼               ▼       ▼             ▼               ▼
  ┌──────────┐   ┌──────────┐ ┌────┐    ┌──────────┐   ┌─────────────┐
  │ identity │   │  scene   │ │comms│   │resolution│   │ permissions │
  └────┬─────┘   └────┬─────┘ └──┬─┘    └────┬─────┘   └─────┬───────┘
       │              │          │           │               │
       └──────────────┴──────────┼───────────┴───────────────┘
                                 │  standard core (universal VTT primitives)
                                 │
                  ┌──────────────┴──────────────────┐
                  ▼                                 ▼
        ┌────────────────────┐            ┌────────────────────┐
        │ @vtt/d20-initiative│            │ @vtt/rpg-inventory │   …
        └────────┬───────────┘            └────────┬───────────┘
                 │           shared mechanics      │
                 │       (depended on by many      │
                 │        game systems, but not    │
                 │        universal)               │
                 └────────────┬────────────────────┘
                              ▼
                       ┌──────────┐         ┌──────────┐
                       │  dnd5e   │         │   pf2    │   …
                       └─────┬────┘         └──────────┘
                             │   game systems
                             │
              ┌──────────────┼──────────────────┐
              ▼              ▼                  ▼
       ┌──────────┐   ┌──────────────┐   ┌────────────────┐
       │srd-spells│   │ srd-monsters │   │ yourtable-     │   …
       └──────────┘   └──────────────┘   │   homebrew     │
                                         └────────────────┘
                              content plugins
                       (siblings, no privilege difference)
```

A game system (`@vtt/dnd5e`) depends on the shared-mechanics plugins it wants and ignores the rest. A wargame plugin would skip both `@vtt/d20-initiative` and `@vtt/rpg-inventory` and ship its own simultaneous-turn mechanism.

## Client/server relationship

### Authority model

The server is the single source of truth. It owns the authoritative world and the canonical event sequence. Clients are caches that may predict for UX. This is non-negotiable; everything else falls out of it.

- Only commands cross the wire from client → server.
- Only events flow from server → client.
- The server validates every command independently. **Client code is untrusted.** A modified or malicious client cannot corrupt server state.

### Command envelopes

Every command crosses the wire with metadata that lets the substrate handle dedup, ordering, and concurrency:

```ts
{
  id:           CommandId,         // uuid; server keeps an LRU and drops duplicates
  causalState:  { ... },           // CAS — what the client believed when it issued the command
  issuedBy:     ClientId,
  issuedAt:     Timestamp,         // client clock; advisory
  payload:      { ... },           // the actual command data
}
```

The server runs commands through a single-threaded queue per world (per game session). Within a world, processing is sequential: assign global sequence number → dedup by id → validate causalState against current world → run `apply` → run reactive systems to fixpoint → broadcast events. Multiple worlds run in parallel.

### Concurrency: optimistic clients with CAS

When two clients issue conflicting commands at the same moment, the server arbitrates by sequencing them and validating each in turn. The first is accepted; the second's `causalState` no longer matches, so it's rejected.

```
client A                          server                              client B
   │                                  │                                   │
   │ 1. user clicks "End Turn"        │                                   │
   │ 2. apply optimistically locally  │                                   │
   │ 3. send command (id, causal)     │                                   │
   │ ────────────────────────────────►│                                   │
   │                                  │ 4. dedup, validate causalState    │
   │                                  │ 5. apply → events                 │
   │                                  │ 6. systems react                  │
   │                                  │ 7. mutate world                   │
   │                                  │ 8. broadcast                      │
   │ ◄────────────────────────────────│ ──────────────────────────────►   │
   │                                  │                                   │
   │ 9. compare authoritative events  │                            apply  │
   │    to predicted:                 │                            events │
   │     match  ──► commit            │                                   │
   │     diverge ► rollback + replay  │                                   │
```

No locks, no transactions, no consensus protocol. Just CAS plus event replay.

### When clients should predict

Optimistic prediction is a UX comfort layer; the default is **don't predict**.

| Command | Predict? | Why |
|---|---|---|
| `MoveToken` (drag end) | yes | Deterministic, snappy UX matters |
| `SendChatMessage` | yes | Local echo is universally expected |
| `EndTurn` | yes | No randomness, predictable advancement |
| `OpenContainer` (UI-only) | yes | Cheap, local, easily reverted |
| `RollDice` (raw) | no | Randomness lives on server |
| `CastSpell` | no | GM-private info, dice, cascading effects |
| `AttackRoll` | no | Same |
| `ApplyCondition` | usually no | May depend on resistances client can't see |

A 50–150ms wait for server confirmation is fine for almost anything that involves a die. The dramatic beat of "I cast fireball → brief pause → roar of dice → damage numbers floating up" is good UX, not bad.

### Continuous state: the presence channel

Token drag, cursor position, "X is typing" — high-frequency ephemeral state — never goes through the command/event pipeline. The substrate provides a separate **presence channel** for this:

- Throttled position updates broadcast to all clients
- Other clients render these as ghost overlays, not authoritative state
- On drag-end, the dragging client fires *one* `MoveToken` command with CAS
- If CAS fails (someone else moved the token first), the ghost snaps back

In ECS terms: presence state is **never event-sourced**. It lives as ephemeral traits in client memory only. A `BeingDragged{by, ghostX, ghostY}` trait is a different kind of trait than `Position` — different store, different rules, no conflation.

### Reconnection and late joiners

Because the canonical state is an event log, reconnection is mechanical:

- Client tracks the highest event sequence number it has applied.
- On reconnect, requests "events since seq #N".
- Server replays events from log; client catches up.

Late joiners get a snapshot + tail of events. Spectators are read-only late joiners. Server crash recovery is "snapshot periodically, replay events since snapshot." All of these reduce to one mechanism.

## Plugin loading: dual-mode, isomorphic

Plugins ship three slices of code:

- **Shared** — schemas, types, command/event/trait definitions. Universal. Loaded by both server and client.
- **Server** — command validators and appliers, system handlers, spell `cast` functions. Runs only on the server.
- **Client** — Solid views, predictive code, UI-only state. Runs only on the client.

The bundler reads `serverOnly()` and `clientOnly()` markers (or directory structure) and produces two bundles per plugin.

```
                  ┌────────────────────┐
                  │  plugin manifest   │
                  └────────┬───────────┘
                           │
         ┌─────────────────┴─────────────────┐
         ▼                                   ▼
  ┌─────────────────┐                ┌─────────────────┐
  │ Server Loader   │                │ Client Loader   │
  │  • commands     │                │  • schemas      │
  │  • systems      │                │  • views        │
  │  • spell cast() │                │  • predictive   │
  │  • validators   │                │    handlers     │
  │  • world store  │                │  • surfaces     │
  └─────────────────┘                └─────────────────┘
```

When a session starts, the server tells the connecting client which plugins are active and at which versions. The client fetches matching client bundles (cached by content hash) and loads them. **Versions must match exactly between server and client** — schema drift is the kind of bug that's miserable to debug, so the substrate refuses to connect on mismatch.

### Hot-loading

Because the server is the authority, a GM can install a new plugin mid-session:

1. AI generates `@vtt/myparty-custom-spells` from a prompt.
2. GM reviews and accepts.
3. Server loads the plugin (registers commands, systems, server-side spell `cast` functions).
4. Server pushes "new plugin available, version X" to all clients.
5. Clients fetch the client bundle, load it (registers schemas, views, predictive handlers).
6. Players use the new content the next turn.

No restart. No deploy. The substrate's plugin loader is re-entrant by design.

## Solid components: how views ship and render

### Views are Solid components bound to a surface and a query

A view declares the surface it fills, the trait set it requires, and a Solid component that renders given those traits. Views never mutate state directly; they dispatch commands.

```tsx
// @vtt/simple-d100/client/views/HealthBar.tsx
export const HealthBarView = defineView({
  surface:  "token-overlay",
  requires: [Health],
  render: ({ entityId }) => {
    const health = useTrait(entityId, Health)              // Solid signal
    return (
      <div class="health-bar">
        <div class="fill" style={{ width: `${(health().current / health().max) * 100}%` }} />
        <span>{health().current} / {health().max}</span>
      </div>
    )
  },
})
```

```tsx
export const AttackButtonView = defineView({
  surface:  "token-action-bar",
  requires: [Combatant, Health],
  render: ({ entityId }) => {
    const target   = useSelectedTarget()
    const dispatch = useDispatch()
    const myTurn   = useIsMyTurn(entityId)
    return (
      <button
        disabled={!target() || !myTurn()}
        onClick={() => dispatch(DeclareAttack({
          attackerId: entityId,
          targetId:   target()!.id,
        }))}
      >
        Attack
      </button>
    )
  },
})
```

### Surfaces are extension points

A plugin declares the surfaces it offers. Other plugins fill them. Multiple views may register against the same surface; the registry orders them by declared priority and renders the stack.

| Surface | Declared by | Purpose |
|---|---|---|
| `token-overlay` | `@vtt/scene` | Stacked above each token (HP bars, status icons) |
| `token-action-bar` | `@vtt/scene` | Buttons available when a token is selected |
| `side-panel` | app shell | Right-rail components (initiative tracker, chat) |
| `chat-stream` | `@vtt/comms` | Per-message renderers for chat entries |
| `bottom-bar` | app shell | Persistent bottom UI (dice tray) |
| `sheet:header` / `sheet:stats` / `sheet:actions` | `@vtt/scene` (sheet host) | Slots within a character sheet |
| `floating` | app shell | Transient overlays (round banners, animations) |

A FATE plugin that wants a horizontal initiative track replaces the `InitiativeTrackerView` registered against `side-panel`. Same data, different presentation.

### Reactivity bridge: trait stores → Solid signals

The substrate maintains per-entity, per-trait reactive signals. Mutating a trait — whether by local optimistic application or by applying a server-broadcast event — updates the signal exactly once per change. Solid's fine-grained reactivity model means only the views that read that signal re-render.

```
  server emits event ──► client receives ──► substrate applies to local world
                                                       │
                                                       ▼
                                              Trait store mutation
                                                       │
                                                       ▼
                                              Signal fires (Solid)
                                                       │
                       ┌───────────────────────────────┼─────────────────────────────┐
                       ▼                               ▼                             ▼
              HealthBarView                   InitiativeTrackerView          CombatLogView
              re-renders for                  re-renders order               appends entry
              affected entity                 if standings changed
```

Views never poll. Views never subscribe to events directly except for log-style components like `CombatLogView` that consume an event stream. The substrate handles the wiring.

### Per-side bundling, in detail

```ts
// @vtt/dnd5e/spells/fireball.ts
export const fireball = defineDamageSpell({
  id: "fireball",
  name: "Fireball",
  level: 3,
  /* …shared metadata… */

  cast: serverOnly(async (ctx) => {
    // stripped from the client bundle
    const targets = await ctx.resolveTargets({ kind: "sphere", center: ctx.target, radius: 20 })
    const damage  = await ctx.rollDamage("8d6")
    for (const t of targets) {
      const saved = await ctx.requestSave(t, { ability: "dex" })
      ctx.dispatch(DealDamage({
        targetId: t,
        amount:   saved ? damage.total / 2 : damage.total,
        type:     "fire",
      }))
    }
  }),

  spellbookEntry: clientOnly(({ caster }) => {
    // stripped from the server bundle
    return <SpellCard name="Fireball" level={3} description="…" onCast={…} />
  }),
})
```

The bundler emits two artifacts per plugin: `plugin.server.js` and `plugin.client.js`. Shared code is included in both; tagged code is included in only one.

### End-to-end render: casting Fireball

```
 player        client                      server                       all clients
   │             │                            │                              │
   │ click       │                            │                              │
   │────────────►│                            │                              │
   │             │ dispatch CastSpell ───────►│                              │
   │             │                            │ validate ✓                   │
   │             │                            │ run fireball.cast(serverCtx) │
   │             │                            │   resolve targets            │
   │             │                            │   spawn 8d6 roll entity      │
   │             │                            │   DiceResolutionSystem rolls │
   │             │                            │   request saves              │
   │             │                            │   compute damage             │
   │             │                            │   dispatch DealDamage ×N     │
   │             │                            │   HealthSystem mutates HP    │
   │             │                            │   consume spell slot         │
   │             │                            │                              │
   │             │ ◄──── broadcast event sequence ──────────────────────────►│
   │             │                            │                              │
   │             │ trait stores mutate                          trait stores │
   │             │ signals fire                                 mutate       │
   │             │   • HealthBarView re-renders for affected tokens          │
   │             │   • DiceTrayView animates                                 │
   │             │   • CombatLogView appends                                 │
   │             │   • SpellSlotView ticks down                              │
```

The client did zero spell logic. It only sent intent and rendered consequences.

## Worked patterns

### Dice rolls as entities

Rolls are first-class entities, not a service. A `Formula` trait + a `RollContext` trait produces a roll; `DiceResolutionSystem` attaches a `RollResult` and emits `RollResolved`. Visibility is per-roll. Renderers query rolls like any other entity.

```
  command            spawn                  system fires           event
  ┌────────┐       ┌─────────────────┐    ┌────────────────┐    ┌──────────┐
  │Request │       │ entity #42      │    │DiceResolution  │    │RollReqsd │
  │  Roll  │─────► │ Formula{1d100}  │ ─► │ rolls 1d100=42 │ ─► │ rollId 42│
  │ d100   │       │ Context{attack} │    │ attaches Result│    └──────────┘
  └────────┘       │ Visibility{pub} │    └───────┬────────┘
                   └─────────────────┘            │
                                                   │ entity #42 now has
                                                   │ Formula + RollResult
                                                   ▼
                       ┌────────────────────────────────────────┐
                       │ views with matching queries re-render  │
                       │   PendingRollView ─── disappears       │
                       │   RollResultView ──── appears          │
                       │   DiceTrayView ────── updates          │
                       └────────────────────────────────────────┘
                                                   │
                                                   ▼
                                             ┌──────────┐
                                             │RollResolvd│  ──► other systems react
                                             └──────────┘
```

For convenience, the framework offers sugar over the entity flow:

```ts
const [a, d] = await ctx.roll([
  { formula: "1d100", reason: "attack",  actor: attackerId, target: targetId },
  { formula: "1d100", reason: "defense", actor: targetId },
])
```

Under the hood it spawns the entities, awaits their `RollResolved` events, returns the results.

### Initiative and turns as entities (a shared-mechanics example)

Initiative is system-specific and lives outside standard core. A typical d20-style implementation ships in a shared-mechanics plugin like `@vtt/d20-initiative` that game systems opt into.

An encounter is an entity with traits `Encounter`, `EncounterRound`, `ActiveTurn`, and `TurnOrder` (a denormalized index maintained by a system). Each combatant gets `InEncounter{encounterId}` and `InitiativeStanding{score}`. Turn advancement is one system listening to the `EndTurn` command's emitted event.

Reactions are sentinel entities: a `Reaction{encounterId, reactingId, resumeAfterId}` trait is spawned when a trigger fires; the active turn is reassigned; on `TurnEnded` a resume system restores the prior turn. **Reactions are extension code in a game-system plugin, not a special case in the initiative plugin.**

A FATE plugin would not depend on `@vtt/d20-initiative`; it would ship its own zone-based exchange model, also as plain entities + traits + systems. A PbtA plugin might omit structured turns entirely. Standard core has no opinion either way.

### Pending state as entities

Anything stateful and temporary becomes a sentinel entity:

- `PendingAttack{attackerId, targetId, attackerRollId, defenderRollId}` — coordinates two rolls before resolving an attack
- `PendingInitiativeRoll{encounterId, participantId}` — marks a roll entity as belonging to an initiative phase
- `Reaction{encounterId, reactingId, resumeAfterId}` — interrupts the normal turn flow
- `Concentration{spellEntityId, casterId}` — tracks an ongoing spell that may break

The pattern is uniform. The AI learns it once.

## Trust and visibility

### Trust

- Server validates every command independently. Never trust a client-computed value.
- Server runs all dice rolls, all rule resolutions, all permission checks.
- Server never accepts client-emitted events. Only commands cross client → server.
- Optimistic predictions are a UX layer. Diverging from server-truth is always recoverable by replaying authoritative events.

### Per-recipient event filtering

Events declare visibility hints. The substrate filters per recipient before broadcast.

```ts
SaveResolved({
  publicData:  { saved: true },
  privateData: { rollTotal: 17, dc: 14, modifier: +3 },   // → only delivered to GM client
})
```

Players see "the orc saved." The GM sees the actual numbers. Plugins emit events with visibility metadata; the substrate enforces partitioning. This is hard to get right in a client-runs-everything architecture; trivial in this one.

### Permission-gated commands

`@vtt/permissions` ships a standard `OwnedBy` trait and conventions for "actor X can issue commands targeting entity Y." Game-system plugins can add their own permission checks in command validators.

## Persistence

SQLite stores two tables per database (multiple worlds keyed by `worldId`):

- **Snapshots** — `(worldId TEXT, atSeq INTEGER, traits JSON, PRIMARY KEY(worldId, atSeq))`. Traits serialize naturally to a JSON document. Snapshots are taken periodically to bound replay cost.
- **Events** — `(worldId TEXT, seq INTEGER, type TEXT, payload JSON, visibility JSON, at INTEGER, PRIMARY KEY(worldId, seq))`. Append-only.

Recovery is "load latest snapshot, replay events since." Reconnection and time-travel use the same primitive. WAL mode is enabled for concurrent reads without blocking writes.

The substrate provides a `PersistenceAdapter` interface; the SQLite implementation is the default. Other backends (Postgres, in-memory) can be plugged in without touching plugins. SQLite is also where auth state (users, sessions) lives, sharing one file per deployment.

## What this earns

- **Equal footing means equal swappability.** Anything in the standard core can be replaced. A research project could swap `@vtt/resolution` for `@vtt/deterministic-resolution` (no dice, fixed outcomes — useful for AI testing) without touching anything else.
- **The substrate is small enough to fully understand.** Bugs in the substrate are catastrophic; bugs in plugins are recoverable. Keeping the substrate tiny is a safety property.
- **Every concept appears in exactly one place.** "Where is `Position` defined?" → `@vtt/scene`. One file, one schema, one source.
- **AI authoring is uniform.** No "core code" is special vs. plugin code. The author-AI looks at any plugin (including standard core) as an exemplar. Patterns are visible everywhere.
- **Tests fall out of the design.** Given an event sequence and a command, assert resulting events and state. No mocks, no fixtures, no UI plumbing.
- **Deprecation is graceful.** If a plugin's design turns out to be wrong, ship v2 alongside v1; dependents migrate at their own pace; nothing in the substrate has to change.

## Non-goals

- **Multi-master replication / CRDTs.** Server-authoritative is sufficient for VTT use cases. CRDTs add complexity that doesn't pay back here.
- **Sandboxing untrusted plugin code.** Plugins are reviewed and accepted by the GM before installation. The substrate does not attempt to sandbox arbitrary plugin code at runtime.
- **A spell-description DSL.** Plugins are TypeScript. There is no separate language for content.
- **Cross-region distribution.** Each world pins to one server process. Sticky sessions at the load balancer. Multi-region is a different conversation if it ever happens.
- **Backwards compatibility across substrate major versions.** Plugins are expected to follow substrate semver. Hot-loading does not paper over schema drift.
