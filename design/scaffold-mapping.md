# Scaffold ↔ DDD/ECS mapping

This doc walks the live scaffold and confirms each piece against the `ddd`
and `ecs` skills, plus the architectural pillars in `basics.md`. It's
maintained alongside the code — when you ship a substrate feature or
close a gap, update the relevant row.

## Workspace layout

```
packages/
  substrate/             tiny core: World, EventBus, CommandPipeline,
                         registries, definers, ws server/client, wire
                         protocol, persistence interface, visibility,
                         slots, reactivity bridge, dev proxy
  auth/                  @vtt/auth — better-auth wrapper + SQLite-backed
                         user/session, role per user (gm | player), the
                         AuthSession schema others narrow against
  identity/              @vtt/identity — Player entity per WS connection
                         (transient Identity / Name / Online traits) plus
                         lifecycle systems on the substrate's
                         ConnectionOpened/Closed events
  permissions/           @vtt/permissions — OwnedBy + EntityVisibility
                         traits, visibility builders (everyone/gmOnly/
                         actors/whisper), command-validate helpers, the
                         entity-visibility resolver the substrate's
                         snapshot filter calls
  shell-default/         @vtt/shell-default — fills @vtt/substrate/root,
                         declares the page-level surfaces
                         (header / main / sidebar / footer)
  plugin-ping/           @vtt/ping — minimal entity-spawning demo
                         (kept as the smallest exemplar plugin)
  plugin-resolution/     @vtt/resolution — dice rolls via rpg-dice-roller;
                         Formula/RolledBy/RollResult traits, a per-entity
                         RollEntrySurface, GM-only checkbox in the roller
  persistence-sqlite/    @vtt/persistence-sqlite — concrete adapter (event
                         log + snapshots) sharing the auth DB file
  tokens/                @vtt/tokens — Tailwind v4 @theme tokens with
                         light-dark() so any shell renders both modes
  server/                Node entry: wires auth + persistence + plugins
                         into startServer; HTTP at /api/auth/*, WS at /ws,
                         optional dev proxy to Vite
  client/                Vite + Solid; AuthGate gates the live app, then
                         renders the @vtt/substrate/root surface

design/                  basics.md (manifesto), this file
.claude/skills/          ddd / ecs (per-skill guidance)
```

## Substrate components (`basics.md` diagram)

| Component             | Status | Notes |
| --------------------- | ------ | ----- |
| `World`               | ✓     | Per-world id, `dump(includeFilter?)` for snapshot, `restore` fires subscribers (so reactive views refresh on catchup), spawn/despawn notify per-trait. |
| `TraitRegistry`       | ✓     | Branded `TraitName` keys. Trait-level `transient` flag (presence/Identity/Online opt out of persistence). |
| `EventRegistry`       | ✓     | Branded `EventName` keys. Event-level `transient` (skip log) and `broadcast` (skip wire) flags. |
| `CommandRegistry`     | ✓     | Branded `CommandName` keys. Mandatory `validate` / `apply` split. |
| `SystemRegistry`      | ✓     | Stored as a flat array; runner matches on `on.name`. Existential `AnySystemDef` shape at the bag site. |
| `ViewRegistry`        | ✓     | Priority-sorted per surface. View `requires` validated at registry validate time. |
| `SurfaceRegistry`     | ✓     | Branded `SurfaceName` keys, `kind: single | stacked | per-entity`, Zod context schema. |
| `SlotRegistry`        | ✓     | `defineSlot<T>` + manifest `slots` (declarations) and `fills` (contributions). Cross-plugin extension primitive. |
| `EventBus`            | ✓     | Typed pub/sub + wildcard. |
| `CommandPipeline`     | ✓     | Async dispatch with internal serialisation (seq stays monotonic across concurrent WS messages). Ring-buffered in-memory log + `WeakMap<EventInstance, seq>` for O(1) lookup at broadcast. Persists durable events transactionally before broadcast. |
| `PluginLoader`        | partial | `Registry.load(plugin)` + `validate()` runs at boot. Doesn't yet check `dependsOn` versions or topo-sort by dependency. Hot-loading not implemented. |
| `NetworkTransport`    | ✓     | http.Server with WebSocketServer attached; static-from-`clientRoot` fallback; dev proxy mode forwards non-API HTTP and non-`/ws` WS upgrades to Vite. |
| `ReactivityBridge`    | ✓     | `useTrait`, `useQuery`, `<Surface name=…/>`. Client state (clientId/connected/synced/lastAppliedSeq) exposed as Solid signal accessors so memos/effects track them correctly. |
| `PresenceChannel`     | ✗     | Not yet built. Transient *events* and *traits* exist (good for "PlayerJoined" / "Online"), but the design's high-frequency ephemeral side-channel for cursor-position / drag-ghost is absent. Will land alongside `@vtt/scene`. |
| `PersistenceAdapter`  | ✓     | Interface in substrate; concrete `@vtt/persistence-sqlite`. Cold-boot replay loads snapshot + replays tail; periodic snapshots every N durable events; final snapshot on graceful shutdown. |
| `Visibility filter`   | ✓     | Per-event broadcast filter (`Visibility` union + recipient match) **and** per-entity snapshot filter (plugin-registered `entityVisibility` resolvers). Persisted events keep their visibility for future "since: N" replay. |
| `Schema`              | ✓     | Zod re-exported as `z`. `QualifiedNameSchema` for the wire boundary. |

## Plugins shipped vs `basics.md` standard core

| Standard-core plugin      | Status | Notes |
| ------------------------- | ------ | ----- |
| `@vtt/identity`           | ✓     | Player entity per WS connection. Identity/Name/Online traits all transient — Players reconstitute on next connect, never persist. |
| `@vtt/permissions`        | ✓     | OwnedBy + EntityVisibility traits, visibility builders (`everyone`, `gmOnly`, `ofRole`, `actors`, `whisper`), `requireRole`, `requireOwnerOrGm`. The substrate's snapshot filter consumes the EntityVisibility resolver. |
| `@vtt/scene`              | ✗     | Not yet built. Will need PresenceChannel and CAS to land cleanly. |
| `@vtt/resolution`         | ✓     | Dice rolls via `rpg-dice-roller`; per-entity `RollEntrySurface`; GM-only checkbox honors event + entity-level visibility. |
| `@vtt/comms`              | ✗     | Not yet built. Slot system is in place to host renderer extensions; whisper visibility builder is ready. |

Plus the supporting plugins not in standard core: `@vtt/shell-default`,
`@vtt/ping`, `@vtt/auth`, `@vtt/persistence-sqlite`, `@vtt/tokens`.

## ECS building blocks

| Concept                   | Substrate expression | Real consumer (where it's used) |
| ------------------------- | -------------------- | ------------------------------- |
| Trait                     | `defineTrait({ name, schema, transient? })` | `Identity`, `Name`, `Online`, `OwnedBy`, `EntityVisibility`, `Pong`, `Formula`, `RollResult`, `RolledBy` |
| Entity                    | `World.spawn` returns `EntityId` | Pong / Roll entities; Player entities (transient) |
| Sentinel entity           | Same mechanism | Not yet — `PendingAttack`-style coordination lands when game-system plugins arrive. |
| Event                     | `defineEvent({ name, schema, transient?, broadcast? })` | Domain: `RollResolved`, `PingReceived`. Lifecycle: `ConnectionOpened`, `ConnectionClosed`, `PlayerJoined`, `PlayerLeft`. |
| Command                   | `defineCommand({ name, schema, validate, apply })` | `RequestRoll`, `Ping`. |
| System                    | `defineSystem({ name, on, reads, writes, run })` | `RollRecordingSystem`, `PongRecordingSystem`, `PlayerSpawningSystem`, `PlayerMirrorSystem`, `PlayerDespawnSystem`, `PlayerLeftMirrorSystem`. |
| View                      | `defineView({ name, surface, requires?, priority?, render })` | `ChromeView`, `RollerView`, `RollTrayView`, `RollEntryView`, `PingButtonView`, `PongLogView`, `PlayerListView`. |
| Surface                   | `defineSurface({ name, kind, context, description? })` | `RootSurface`, `HeaderSurface`, `MainSurface`, `SidebarSurface`, `FooterSurface`, `RollEntrySurface`. |
| Slot                      | `defineSlot({ name, schema, description? })` + `fills: { [slotName]: T[] }` on dependent manifests | API in place; not yet consumed by a real plugin (chat/content packs land first). |
| Plugin manifest           | `definePlugin({...})` | All plugins above. |
| Plugin-namespaced names   | `@scope/plugin/Type` for traits/events/commands/surfaces/slots; `@scope/plugin` for plugins | Brands (`TraitName`/`EventName`/...) make kinds non-interchangeable at compile time. |

### ECS anti-patterns checked

- ✓ Trait with methods — traits are Zod schemas only.
- ✓ System mutating without emitting events — pipeline persists + broadcasts every emitted event; in-system writes only via `world.set/spawn/despawn`.
- ✓ System calling another system — coordination is event-driven via `EventBus`.
- ✓ View running server logic — `clientOnly()` markers; views dispatch commands and read trait signals.
- ✓ Reading state inside `apply` — `apply` is constrained to emit events; cmd-payload only.
- ✓ Dispatching commands from a system — systems return events.
- ✓ Mutating a trait in place — `World.set` replaces with re-validation.
- ✓ View subscribing to events instead of trait signals — exception is documented (log-style components); the `RollTrayView` uses queries.
- ✓ Reaching across plugin boundaries — cross-plugin coordination only via published events / slots / shared trait definitions (e.g. resolution depending on `@vtt/permissions/EntityVisibility`).

## DDD building blocks

| Concept                   | mvtt expression | Status |
| ------------------------- | --------------- | ------ |
| Aggregate Root            | `World` — owns entities, traits, the event log, the consistency of the entire game session | ✓ |
| Logical aggregate         | Sentinel entity + traits + maintaining systems | Pattern available; not yet exercised by any plugin. |
| Value Object              | Trait/Event/Command payloads (Zod-parsed, immutable) | ✓ |
| Entity (DDD)              | `EntityId` with composed traits | ✓ |
| Domain Service            | Pure function `(event, world) → events[]` (a System) | ✓ |
| Application Service       | Command's `validate` + `apply` — single transactional mutation | ✓ |
| Repository                | `PersistenceAdapter` for the World; auth has its own better-auth Kysely-backed adapter | ✓ |
| Domain Event              | An Event in the event-sourced spine | ✓ |
| Factory                   | Pattern helpers (`defineDamageSpell`, etc.) | Type-supported via the definers; no game-system factory yet. |
| Bounded Context           | A plugin | ✓ — multiple bounded contexts now (auth / identity / permissions / shell / resolution / ping / persistence). |
| Ubiquitous Language       | Plugin-namespaced names, branded so kinds aren't interchangeable | ✓ |

### DDD anti-patterns checked

- ✓ Anemic domain model — traits are pure VOs *by design*; behaviour lives in commands and systems.
- ✓ God aggregate — World is the only ECS aggregate; auth users / sessions / world snapshots / event rows are separate aggregates with their own repositories.
- ✓ Repository per entity — only aggregate roots get repositories.
- ✓ Leaking persistence — domain code (commands/events/systems) doesn't know about SQLite; the `PersistenceAdapter` interface is the seam.

## Architectural pillars from `basics.md`

| Pillar | Status |
| ------ | ------ |
| 1. Thin substrate, plugins everywhere | ✓ — substrate has no domain knowledge; identity/permissions/scene/etc. are all plugins. |
| 2. ECS as the data model | ✓ — World/Trait/Event/Command/System/View/Surface/Slot all expressed as data and pure functions; no class hierarchies anywhere in the domain layer. |
| 3. Event sourcing as the spine | ✓ — durable events persist transactionally before broadcast; cold-boot replay reconstitutes World from snapshot + tail. |
| 4. Server-authoritative, optimistic clients | partial — server is authoritative, client mirrors via the system runner, trust boundary holds (only commands cross client→server). **CAS / optimistic prediction not implemented**: command envelopes carry `id` + `issuedAt` but no `causalState`; client doesn't predict. |
| 5. Solid for reactive UI | ✓ — fine-grained signals; `useTrait`/`useQuery` subscribe per-trait; client state is signal-typed so memos compose correctly. |
| 6. Schema-first | ✓ — every trait/event/command/surface/slot has a Zod schema; wire format validated by `WireMsg`. |
| 7. Domain-driven design throughout | ✓ — this document. |
| 8. Persistence in SQLite (revised from MongoDB) | ✓ — `data/mvtt.db` shared between auth and world tables, WAL on, snapshots+events. |

## Known gaps (deferred deliberately, with the trigger that ends the deferral)

- **PresenceChannel** — high-frequency ephemeral state (cursor position, drag ghost) doesn't yet have a separate non-event-sourced channel. Trigger: `@vtt/scene` wants live token drag.
- **CAS / optimistic prediction** — the command envelope schema needs a `causalState` field, the pipeline needs a CAS-validation step, and the client needs predictive apply with rollback. Trigger: any feature where two clients can edit the same entity simultaneously (token movement, character HP).
- **Field-level visibility** (`publicData` / `privateData` per `basics.md`) — we have event-level visibility (entire event delivered or not). Field redaction (recipient gets the event but with private fields stripped) is future work. Trigger: a save-resolution or skill-check feature where players see "saved: yes" but the GM sees the full DC and modifier breakdown.
- **Reconnection resume by `lastAppliedSeq`** — every connect currently gets a full snapshot. Tail-only resume on reconnect is a small change once the wire envelope carries `since: N`. Trigger: long-running sessions where re-snapshotting becomes expensive.
- **Hot-loading** — no GM-installs-plugin-mid-session yet. The `Registry.load` is re-entrant on paper, but the WS handshake currently sends a fixed plugin list at hello. Trigger: AI-author flow that generates a plugin and wants it live without a restart.
- **Per-side bundling** — `serverOnly()`/`clientOnly()` are no-op markers; no real bundler-driven stripping. Trigger: bundle size becomes a problem (right now ~830 KB gzipped 240 KB).
- **Plugin dependency resolution** — `dependsOn: ["@vtt/foo@^0", ...]` is just a string array. The registry doesn't yet validate versions or topologically sort. Trigger: the first time a plugin load order matters and we forget to hand-order.
- **Sentinel-entity sugar** — manual via `world.spawn` + a coordinating system. Trigger: an attack/save flow with multiple roll entities coordinating before resolving.
- **Standard-core completion** — `@vtt/scene` and `@vtt/comms` not yet built. Trigger: just "next."

These gaps are intentional v0.x scaffolding — each maps to a future plugin or substrate feature with a clear impetus.

## Tooling status

- TypeScript with `strict` + `noUncheckedIndexedAccess`; one localised `any` (the `AnySystemDef.run` and `AnyViewDef.render` existentials) with comments explaining why.
- pnpm 10 workspaces, Volta-pinned Node 22 / 24 (per package).
- Vitest 4, vite 8 + `@tailwindcss/vite` 4.
- `pnpm dev` runs Vite (`:5173`) + the substrate server (`:3001`) in parallel; both ports serve the same live experience because the substrate's `devProxy` forwards non-API HTTP and HMR upgrades to Vite.
- `pnpm test` runs vitest unit + an integration smoke (`packages/server/src/smoke.ts`) over a real WebSocket. `pnpm -r typecheck` runs tsc per-package.
- `pnpm reset` clears `data/` so the next start prompts to create a Game Master from scratch.
