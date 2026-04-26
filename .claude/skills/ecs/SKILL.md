---
name: ecs
description: Entity-Component-System (ECS) guidance for the mvtt live game World and the plugins that extend it. Apply when writing or modifying code inside any @vtt/* plugin that contributes traits, events, commands, systems, views, sentinel entities, or pattern helpers (factories) to the World. Use alongside the ddd skill — ECS structures the contents of the World aggregate; DDD structures everything else (substrate, persistence, content catalogs, orchestration).
---

# Entity-Component-System

Apply these patterns when contributing to the live game World inside an mvtt plugin. The substrate around the World, content catalogs loaded from disk, persistence, user accounts, and long-running orchestration use classic DDD (see the `ddd` skill).

## Building Block Selection

Choose the appropriate type based on these criteria:

| Type                       | Mutability                                | Identity                                | When to Use                                                                                                                |
| -------------------------- | ----------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Trait**                  | Immutable record (replaced, never mutated) | None — attached to an entity            | Typed data describing one facet of an entity (`Position`, `Health`, `Strength`)                                            |
| **Entity**                 | Bare ID; meaning by composition            | Unique within the World                 | An addressable thing in the World; a token, a creature, or a sentinel for coordination                                     |
| **Sentinel Entity**        | Same as Entity; ephemeral lifetime         | Unique within the World                 | Form a logical aggregate for stateful coordination (`PendingAttack`, `Encounter`, `Roll`, `Concentration`)                 |
| **Event**                  | Immutable                                  | Has a sequence number when committed    | A fact about what happened in the World; the wire format and the audit log                                                 |
| **Command**                | Immutable intent                           | Has a `CommandId` for dedup             | Client intent to mutate the World; validated against world state, may be rejected                                          |
| **System**                 | Stateless function                         | None                                    | React to one event type; emit further events; never mutate the World except through trait writes declared in `writes`      |
| **View**                   | Stateless Solid component                  | None — bound to surface + entity query  | Render trait queries; dispatch commands; never mutate state                                                                |
| **Pattern Helper / Factory** | Stateless function                       | None                                    | Produce template value objects (`defineDamageSpell`, `defineMonster`, `defineFeat`)                                        |
| **Surface**                | Declarative slot                           | Named string                            | Declare a UI extension point views can fill                                                                                |
| **Slot**                   | Declarative typed list                     | Named within the declaring plugin       | Allow dependent plugins to contribute typed data (`spellTemplates`, `monsterTemplates`)                                    |

### Quick Decision Flow

```
Is it data attached to an entity?
└─ Yes → Trait

Is it a fact about something that already happened in the World?
└─ Yes → Event

Is it client intent to change the World?
└─ Yes → Command (split: validate reads world, apply only emits events)

Does it react to events and produce more events?
└─ Yes → System (declare reads/writes; never call other systems directly)

Does it render UI from world state?
└─ Yes → View (read trait signals; dispatch commands; never mutate)

Does it produce reusable template value objects?
└─ Yes → Pattern Helper / Factory

Does it need to coordinate state across multiple entities or ticks?
└─ Yes → Sentinel Entity (a logical aggregate)

Does it live outside the live World (content catalogs, accounts, archives)?
└─ Yes → use the ddd skill instead
```

## TypeScript Patterns

See [references/patterns.md](references/patterns.md) for implementation examples covering trait, event, command, system, view, sentinel entity, factory, plugin manifest, and test patterns.

## Plugin Vocabulary

Namespace every trait, event, and command by its owning plugin. Plugin-namespaced names are how the AI and human readers tell which bounded context owns a concept.

```
@vtt/scene/Position
@vtt/scene/TokenMoved              (event)
@vtt/scene/MoveToken               (command)
@vtt/dnd5e/HitDice
@vtt/dnd5e/SpellCast               (event)
@vtt/d20-initiative/EndTurn        (command)
```

## Per-Side Bundling

Plugin code is split across three slices:

- **Shared** — schemas, types, command/event/trait definitions. Loaded by both server and client.
- **Server** — command validators and appliers, system handlers, spell `cast` functions, anything that mutates the authoritative World.
- **Client** — Solid views, predictive code, UI-only state.

Mark code that runs on only one side with `serverOnly()` or `clientOnly()`. The bundler strips the wrong half from each artifact. Schemas and definitions are universal and require no marker.

## Sentinel-Entity Pattern

For anything that needs to coordinate across multiple ticks, multiple entities, or asynchronous resolution, spawn a sentinel entity carrying the coordination state as traits, then have a follow-up system react to completion events. This is how logical aggregates (Encounter, PendingAttack, Roll, Concentration, Reaction) are expressed in ECS.

The sentinel entity + its associated traits + the systems and validators that maintain the invariants form one logical DDD Aggregate.

## Anti-Patterns to Avoid

- **Trait with methods.** Traits are value objects. Behavior lives in systems and command validators.
- **System mutating the world without emitting events.** Breaks event-sourced replay, network sync, and tests. All meaningful state changes must be expressed as events.
- **System calling another system directly.** Systems coordinate by emitting events that other systems subscribe to. Direct calls hide dependencies and prevent parallelization.
- **View running server-side logic.** Views are read-only render. They subscribe to signals and dispatch commands. They never mutate state.
- **View subscribing to events instead of trait signals.** Exception: log-style components (`CombatLogView`) that render an event stream. Otherwise, prefer trait signals.
- **Reaching across plugin boundaries by importing internals.** Cross-plugin coordination is via published events, slots, and shared trait definitions only. Never import another plugin's systems or private state.
- **Using ECS for things that aren't part of the live World.** Content catalogs, user accounts, asset metadata, campaign archives — those are DDD aggregates with repositories. ECS is for the World only.
- **Mutating a trait in place.** Trait values are replaced atomically (`world.set(id, Trait, newValue)`); never mutated by reference. Reactivity, persistence, and replay all depend on this.
- **Reading state inside `apply` instead of `validate`.** Validation reads the world and rejects; application produces events. Don't query the world inside `apply` — by then the decision is made.
- **Dispatching commands from a system.** Systems emit events, not commands. Commands are external intent crossing the trust boundary; events are internal facts. Conflating them undermines the trust model.

## Relationship to DDD

The live game World is one DDD Aggregate Root. ECS is the internal pattern for that aggregate's contents. The mapping:

| DDD building block          | ECS expression in mvtt                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Aggregate Root**          | The `World` — owns all entities, traits, and the event log                                              |
| **Aggregate (logical)**     | Sentinel entity + its traits + the systems/validators that maintain its invariants                      |
| **Entity (within aggregate)** | An ECS entity (bare ID with composed traits)                                                          |
| **Value Object**            | Trait instance, Event payload, Command payload                                                          |
| **Domain Service**          | A System                                                                                                |
| **Application Service**     | A Command's `validate` + `apply` (one transactional mutation)                                           |
| **Repository**              | The substrate's `PersistenceAdapter` for the World aggregate                                            |
| **Domain Event**            | An Event in the event-sourced spine                                                                     |
| **Factory**                 | Pattern helpers like `defineDamageSpell`                                                                |
| **Bounded Context**         | A plugin                                                                                                |
| **Ubiquitous Language**     | Plugin-namespaced trait/event/command names                                                             |

For everything *outside* the live World — content catalogs, asset storage, user accounts, plugin manifests, long-running orchestration like campaign import — use classic DDD per the `ddd` skill. ECS is not a general-purpose architecture; it is the internal pattern for one specific aggregate.
