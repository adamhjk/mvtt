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
                         slots, presence channel, reactivity bridge,
                         dev proxy. Plus the multi-world layer:
                         WorldsRepository (interface), WorldsService
                         (DDD orchestrator), WorldsRegistry (lazy
                         per-worldId WorldRuntime), resolveActivePlugins
                         (game-system + deps + infra), and an
                         InMemoryWorldsRepository for tests/smokes.
  auth/                  @vtt/auth — better-auth wrapper + SQLite-backed
                         user/session. The user-row `role` is global
                         (gm | player) and gates *world creation* —
                         per-world role is synthesized from
                         world_membership at WS upgrade and threaded
                         into the AuthSession plugin code reads. Utility
                         module, not a plugin.
  identity/              @vtt/identity — Player entity per WS connection
                         (transient Identity / Name / Online traits) plus
                         lifecycle systems on the substrate's
                         ConnectionOpened/Closed events
  permissions/           @vtt/permissions — OwnedBy + EntityVisibility
                         traits, visibility builders (everyone/gmOnly/
                         actors/whisper), command-validate helpers, the
                         entity-visibility resolver the substrate's
                         snapshot filter calls
  scene/                 @vtt/scene — Scene/Position/Sprite/Token traits,
                         SceneCanvasSurface (PixiJS v8 renderer),
                         SceneToolbarSurface, MoveToken with first-writer-
                         wins CAS validation against Position.movedAt
  comms/                 @vtt/comms — ChatMessage trait, MessageSent
                         event, SendMessage command, ChatStreamSurface,
                         ChatInputHandlerSlot for slash-command extension
  shell-default/         @vtt/shell-default — historical four-surface
                         shell (header / main / sidebar / footer). Kept
                         in tree as the smallest "fills RootSurface"
                         exemplar; no longer registered by the default
                         server entry.
  shell-workbench/       @vtt/shell-workbench — current default shell.
                         Tabbed splittable workspace, persistent right
                         chat rail, fuzzy ⌘K palette over Pages ∪
                         palette-commands, ⌘1..⌘4 / ⌘. quick focus.
                         Per-user state on a WorkspaceOwner sentinel
                         entity scoped via EntityVisibility{actors:
                         [userId]}. Declares pages,
                         palette-commands, chat-rail-widgets slots.
  plugin-ping/           @vtt/ping — minimal entity-spawning demo
                         (kept as the smallest exemplar plugin)
  plugin-resolution/     @vtt/resolution — dice rolls via rpg-dice-roller;
                         Formula/RolledBy/RollResult traits, a per-entity
                         RollEntrySurface, GM-only checkbox in the roller,
                         fills @vtt/comms/chat-input-handlers with the
                         `/r ` slash command
  system-simple/         @vtt/system-simple — first game-system plugin.
                         Marker manifest with gameSystem: true that
                         depends on @vtt/dice-tray and @vtt/characters,
                         giving "any RPG" the minimal feel. Real systems
                         (dnd5e, blades, ...) land alongside it.
  persistence-sqlite/    @vtt/persistence-sqlite — concrete adapter for
                         BOTH the event log + snapshots AND the
                         WorldsRepository (worlds + memberships tables),
                         sharing one DB file with auth.
  tokens/                @vtt/tokens — Tailwind v4 @theme tokens with
                         light-dark() so any shell renders both modes
  server/                Node entry: wires auth + persistence +
                         WorldsRepository + plugins into startServer.
                         HTTP at /api/auth/*, /api/worlds (list/create),
                         /api/worlds/:id/{archive,memberships},
                         /api/worlds/:id?confirm=true (hard delete),
                         /api/game-systems, /api/plugin-data/<worldId>/...
                         (per-world uploads). WS at /ws?worldId=...;
                         optional dev proxy to Vite. Smokes include a
                         dedicated multi-world test that proves no
                         cross-talk between concurrent worlds.
  client/                Vite + Solid. AuthGate gates auth; WorldGate
                         resolves which worldId to connect to (URL ?
                         localStorage ? first-run create modal for the
                         GM ? "ask your GM" empty state for players).
                         Authenticated mounts the substrate client with
                         /ws?worldId=. The workbench-header WorldPicker
                         lists accessible worlds, switches via full
                         reload, and (for owners) opens a Members
                         modal for invite-by-email.

design/                  basics.md (manifesto), this file
.claude/skills/          ddd / ecs (per-skill guidance), plus pixijs-*
                         reference packs used by the scene plugin's
                         renderer
```

## Substrate components (`basics.md` diagram)

| Component             | Status | Notes |
| --------------------- | ------ | ----- |
| `World`               | ✓     | Per-world id, `dump` for snapshot, `restore` fires subscribers (so reactive views refresh on catchup), spawn/despawn notify per-trait. |
| `TraitRegistry`       | ✓     | Branded `TraitName` keys. Trait-level `transient` flag (presence/Identity/Online opt out of persistence). |
| `EventRegistry`       | ✓     | Branded `EventName` keys. Event-level `transient` (skip log) and `broadcast` (skip wire) flags. |
| `CommandRegistry`     | ✓     | Branded `CommandName` keys. Mandatory `validate` / `apply` split. `causalState` threaded into `validate` for CAS-enforcing commands. |
| `SystemRegistry`      | ✓     | Stored as a flat array; runner matches on `on.name`. Existential `AnySystemDef` shape at the bag site. |
| `ViewRegistry`        | ✓     | Priority-sorted per surface. |
| `SurfaceRegistry`     | ✓     | Branded `SurfaceName` keys, `kind: single | stacked | per-entity`, Zod context schema. |
| `SlotRegistry`        | ✓     | `defineSlot<T>` + manifest `slots` (declarations) and `fills` (contributions). Cross-plugin extension primitive — first real consumer is `@vtt/comms/chat-input-handlers`, filled by `@vtt/resolution`. |
| `EventBus`            | ✓     | Typed pub/sub + wildcard. |
| `CommandPipeline`     | ✓     | Async dispatch with internal serialisation (seq stays monotonic across concurrent WS messages). Ring-buffered in-memory log + `WeakMap<EventInstance, seq>` for O(1) lookup at broadcast. Persists durable events transactionally before broadcast. |
| `PluginLoader`        | partial | `Registry.load(plugin)` + `validate()` runs at boot. Doesn't yet check `dependsOn` versions or topo-sort by dependency — load order is currently authored by hand in the server entry. Hot-loading not implemented. |
| `NetworkTransport`    | ✓     | http.Server with WebSocketServer attached; static-from-`clientRoot` fallback; dev proxy mode forwards non-API HTTP and non-`/ws` WS upgrades to Vite. |
| `ReactivityBridge`    | ✓     | `useTrait`, `useQuery`, `<Surface name=…/>`. Client state (clientId/connected/synced/lastAppliedSeq) exposed as Solid signal accessors so memos/effects track them correctly. |
| `PresenceChannel`     | ✓     | `PresenceMsg` wire kind; server fans presence frames out to every *other* connection on the matching channel; whisper-style scoping via optional `to: userId[]`. Client API is `runtime.presence.publish(channel, payload, to?)` and `runtime.presence.subscribe(channel, listener)`. Never persisted, never replayed. No visibility-trait filter applied to presence frames yet (the originator chooses scope). |
| `PersistenceAdapter`  | ✓     | Interface in substrate; concrete `@vtt/persistence-sqlite`. Cold-boot replay loads snapshot + replays tail; periodic snapshots every N durable events; final snapshot on graceful shutdown. |
| `Visibility filter`   | ✓     | Per-event broadcast filter (`Visibility` union + recipient match) **and** per-entity snapshot filter (plugin-registered `entityVisibility` resolvers). Persisted events keep their visibility for future "since: N" replay. |
| `WorldsRepository`    | ✓     | Interface in substrate (`worlds-repository.ts`); concrete `SqliteWorldsRepository` in `@vtt/persistence-sqlite`. Owns the `world` and `world_membership` tables. `InMemoryWorldsRepository` ships in `@vtt/substrate`'s testing entry for smokes. |
| `WorldsService`       | ✓     | DDD orchestrator: list/create/archive/hardDelete worlds, addMember/removeMember/listMembers, canAccess/roleFor. Coordinates the worlds repo, the event-log adapter, and the plugin-data filesystem dir on hard delete. Exported only from `@vtt/substrate/server` (uses Node fs/path/crypto). |
| `WorldsRegistry`      | ✓     | One process, many `WorldRuntime`s. Lazy-instantiates per worldId on first connection; concurrent acquires for the same id coalesce. Each runtime gets its own filtered Registry (game system + transitive deps + always-on infra), its own World/EventBus/CommandPipeline, its own snapshot cadence. `closeAll` snapshots every loaded runtime on graceful shutdown. |
| `resolveActivePlugins`| ✓     | `(infrastructure ∪ chosenGameSystem ∪ chosenGameSystem.dependsOn) → ordered PluginDef[]`. Throws on missing game system, on a `gameSystem: false` plugin being passed as the choice, or on an unresolvable transitive dep. Diamond deps deduplicated. `@vtt/substrate` is recognised as auto-loaded by Registry and skipped. |
| `WS upgrade routing`  | ✓     | `/ws?worldId=<id>` is mandatory; missing/invalid → 400. Substrate validates the world exists + isn't archived, then runs `authenticateUpgrade(req, worldId)` which returns the per-world session (or null to 401/403). Conn struct carries `worldId`; broadcasts iterate `conns` and filter to the matching runtime. |
| `Schema`              | ✓     | Zod re-exported as `z`. `QualifiedNameSchema` for the wire boundary. |

## Plugins shipped vs `basics.md` standard core

| Standard-core plugin      | Status | Notes |
| ------------------------- | ------ | ----- |
| `@vtt/identity`           | ✓     | Player entity per WS connection. Identity/Name/Online traits all transient — Players reconstitute on next connect, never persist. |
| `@vtt/permissions`        | ✓     | OwnedBy + EntityVisibility traits, visibility builders (`everyone`, `gmOnly`, `ofRole`, `actors`, `whisper`), `requireRole`, `requireOwnerOrGm`. The substrate's snapshot filter consumes the EntityVisibility resolver. |
| `@vtt/scene`              | ✓     | Scene/Position/Sprite/Token traits; CreateScene/CreateToken/MoveToken/RemoveToken commands; PixiJS v8 canvas renderer in `SceneCanvasView`. **MoveToken is the first command to use CAS** — `causalState.lastSeenMovedAt` is compared against the current `Position.movedAt` and the second writer is rejected. Drag-ghost broadcast over the presence channel is the next step (currently each drag commits an authoritative move on release). |
| `@vtt/resolution`         | ✓     | Dice rolls via `rpg-dice-roller`; per-entity `RollEntrySurface`; GM-only checkbox honors event + entity-level visibility. Fills `@vtt/comms/chat-input-handlers` with the `/r ` slash command. |
| `@vtt/comms`              | ✓     | ChatMessage trait + MessageSent event + SendMessage command. ChatStreamSurface for the message list, ChatInputHandlerSlot for plugins to teach the composer new slash commands. Whisper visibility uses `@vtt/permissions/whisper`. |

Plus the supporting plugins not in standard core: `@vtt/shell-workbench`
(default shell), `@vtt/shell-default` (legacy shell, kept as an
exemplar but not registered), `@vtt/ping` (still loaded by the smoke
tests), and `@vtt/system-simple` (first game-system plugin —
`gameSystem: true`, depends on dice-tray + characters; the minimal
"any RPG" baseline that proves the multi-world boot loop works
end-to-end). Plus the utility/infrastructure packages `@vtt/auth`,
`@vtt/persistence-sqlite`, `@vtt/tokens` (none of which call
`definePlugin`).

| Shell plugin             | Status | Notes |
| ------------------------ | ------ | ----- |
| `@vtt/shell-workbench`   | ✓     | Default shell. See `design/ui-workbench.md`. Declares `pages`, `palette-commands`, `chat-rail-widgets` slots. Persists per-user state as `WorkspaceState` on a per-user sentinel `WorkspaceOwner` entity. Bootstrap-on-join system spawns owners on `PlayerJoined`. `WorkspaceStateChanged` events are `transient: true` (skip log) + `broadcast: true` (replicate to the user's other connections). |
| `@vtt/shell-default`     | ✓     | Legacy four-surface shell. No longer registered by `packages/server/src/main.ts`; kept in tree as the smallest "fills RootSurface" exemplar. |

## ECS building blocks

| Concept                   | Substrate expression | Real consumer (where it's used) |
| ------------------------- | -------------------- | ------------------------------- |
| Trait                     | `defineTrait({ name, schema, transient? })` | `Identity`, `Name`, `Online`, `OwnedBy`, `EntityVisibility`, `Pong`, `Formula`, `RollResult`, `RolledBy`, `Scene`, `Position`, `Sprite`, `Token`, `ChatMessage` |
| Entity                    | `World.spawn` returns `EntityId` | Pong / Roll / Scene / Token / ChatMessage entities; Player entities (transient) |
| Sentinel entity           | Same mechanism | Not yet — `PendingAttack`-style coordination lands when game-system plugins arrive. |
| Event                     | `defineEvent({ name, schema, transient?, broadcast? })` | Domain: `RollResolved`, `PingReceived`, `SceneCreated`, `TokenCreated`, `TokenMoved`, `TokenRemoved`, `MessageSent`. Lifecycle: `ConnectionOpened`, `ConnectionClosed`, `PlayerJoined`, `PlayerLeft`. |
| Command                   | `defineCommand({ name, schema, validate, apply })` | `RequestRoll`, `Ping`, `CreateScene`, `CreateToken`, `MoveToken` (CAS), `RemoveToken`, `SendMessage`. |
| System                    | `defineSystem({ name, on, reads, writes, run })` | `RollRecordingSystem`, `PongRecordingSystem`, `PlayerSpawningSystem`, `PlayerMirrorSystem`, `PlayerDespawnSystem`, `PlayerLeftMirrorSystem`, `SceneSpawningSystem`, `TokenSpawningSystem`, `TokenMovementSystem`, `TokenRemovalSystem`, `MessageRecordingSystem`. |
| View                      | `defineView({ name, surface, requires?, priority?, render })` | `ChromeView`, `RollerView`, `RollTrayView`, `RollEntryView`, `PingButtonView`, `PongLogView`, `PlayerListView`, `UserMenuView`, `SceneRootView`, `SceneCanvasView`, `TokenPickerView`, `ChatComposerView`, `ChatStreamView`, `ChatMessageView`. |
| Surface                   | `defineSurface({ name, kind, context, description? })` | `RootSurface`, `HeaderSurface`, `MainSurface`, `SidebarSurface`, `FooterSurface`, `RollEntrySurface`, `SceneCanvasSurface`, `SceneToolbarSurface`, `ChatStreamSurface`. |
| Slot                      | `defineSlot({ name, schema, description? })` + `fills: { [slotName]: T[] }` on dependent manifests | `@vtt/comms/chat-input-handlers` declared by comms, filled by resolution (`/r ` command). First end-to-end use of the slot mechanism. |
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
- ✓ Reaching across plugin boundaries — cross-plugin coordination only via published events / slots / shared trait definitions (e.g. resolution depending on `@vtt/permissions/EntityVisibility`, resolution filling `@vtt/comms/chat-input-handlers`).

## DDD building blocks

| Concept                   | mvtt expression | Status |
| ------------------------- | --------------- | ------ |
| Aggregate Root            | Two roots, at different levels. **`World`** — one live game session, ECS internally. **`Worlds`** — substrate-level aggregate over the *set* of worlds the deployment hosts, plus per-world memberships. Owned by `WorldsService`, persisted via `WorldsRepository`. | ✓ |
| Logical aggregate         | Sentinel entity + traits + maintaining systems | Pattern available; not yet exercised by any plugin. |
| Value Object              | Trait/Event/Command payloads (Zod-parsed, immutable) | ✓ |
| Entity (DDD)              | `EntityId` with composed traits | ✓ |
| Domain Service            | Pure function `(event, world) → events[]` (a System) | ✓ |
| Application Service       | Command's `validate` + `apply` — single transactional mutation | ✓ |
| Repository                | `PersistenceAdapter` for the World's event log + snapshots; `WorldsRepository` for the worlds index + memberships; auth has its own better-auth Kysely-backed adapter | ✓ |
| Domain Event              | An Event in the event-sourced spine | ✓ |
| Factory                   | Pattern helpers (`defineDamageSpell`, etc.) | Type-supported via the definers; no game-system factory yet. |
| Bounded Context           | A plugin | ✓ — auth / identity / permissions / shell / scene / resolution / comms / ping / persistence / system-simple (first game-system plugin). |
| Ubiquitous Language       | Plugin-namespaced names, branded so kinds aren't interchangeable | ✓ |

### DDD anti-patterns checked

- ✓ Anemic domain model — traits are pure VOs *by design*; behaviour lives in commands and systems.
- ✓ God aggregate — World is the only ECS aggregate; auth users / sessions / world snapshots / event rows are separate aggregates with their own repositories.
- ✓ Repository per entity — only aggregate roots get repositories.
- ✓ Leaking persistence — domain code (commands/events/systems) doesn't know about SQLite; the `PersistenceAdapter` interface is the seam.

## Architectural pillars from `basics.md`

| Pillar | Status |
| ------ | ------ |
| 1. Thin substrate, plugins everywhere | ✓ — substrate has no domain knowledge; identity/permissions/scene/resolution/comms are all plugins. |
| 2. ECS as the data model | ✓ — World/Trait/Event/Command/System/View/Surface/Slot all expressed as data and pure functions; no class hierarchies anywhere in the domain layer. |
| 3. Event sourcing as the spine | ✓ — durable events persist transactionally before broadcast; cold-boot replay reconstitutes World from snapshot + tail. |
| 4. Server-authoritative, optimistic clients | partial — server authority and the trust boundary hold (only commands cross client→server). **CAS is server-side live**: command envelopes carry `causalState`, the pipeline threads it into `CommandContext`, and `MoveToken` rejects stale writers. **Optimistic client prediction with rollback is not implemented yet** — clients dispatch and wait for the broadcast; a rejection currently surfaces as the next authoritative event snapping state back. |
| 5. Solid for reactive UI | ✓ — fine-grained signals; `useTrait`/`useQuery` subscribe per-trait; client state is signal-typed so memos compose correctly. |
| 6. Schema-first | ✓ — every trait/event/command/surface/slot has a Zod schema; wire format validated by `WireMsg`. |
| 7. Domain-driven design throughout | ✓ — this document. |
| 8. Persistence in SQLite (revised from MongoDB) | ✓ — `data/mvtt.db` shared between auth, the worlds index/memberships, and the event-log/snapshot tables. WAL on. |
| 9. Multi-tenant from day one | ✓ — one process, many `WorldRuntime`s; users global / permissions per-world; `WorldsRegistry` lazy-instantiates per worldId; multi-world-smoke verifies cross-talk-free isolation at the wire level. |

## Known gaps (deferred deliberately, with the trigger that ends the deferral)

- **Optimistic client prediction & rollback** — the server-authoritative half of CAS is shipped (envelope carries `causalState`, pipeline exposes it, `MoveToken` enforces first-writer-wins). What's missing is the *client* side: predict-apply locally, then on broadcast either commit or rollback-and-replay. Trigger: a UX where the round-trip is felt (multi-token drag, simultaneous HP changes from many sources).
- **Drag-ghost over the presence channel** — the channel itself is shipped (wire kind, server fan-out, client publish/subscribe), but `@vtt/scene`'s drag interaction currently commits a `MoveToken` on release rather than streaming ghost positions during the drag. Trigger: live token drag where every viewer should see the ghost in real time.
- **Field-level visibility** (`publicData` / `privateData` per `basics.md`) — we have event-level visibility (entire event delivered or not). Field redaction (recipient gets the event but with private fields stripped) is future work. Trigger: a save-resolution or skill-check feature where players see "saved: yes" but the GM sees the full DC and modifier breakdown.
- **Reconnection resume by `lastAppliedSeq`** — every connect currently gets a full snapshot. Tail-only resume on reconnect is a small change once the wire envelope carries `since: N`. Trigger: long-running sessions where re-snapshotting becomes expensive.
- **Hot-loading** — no GM-installs-plugin-mid-session yet. The `Registry.load` is re-entrant on paper, but the WS handshake currently sends a fixed plugin list at hello. Trigger: AI-author flow that generates a plugin and wants it live without a restart.
- **Per-side bundling** — `serverOnly()`/`clientOnly()` are no-op markers; no real bundler-driven stripping. Trigger: bundle size becomes a problem.
- **Plugin dependency resolution (load order + version match)** — `dependsOn` is parsed for *names* by `resolveActivePlugins` (which walks the graph and infrastructure-vs-game-system filters per world), but the registry still doesn't check semver ranges or fail loudly on a missing dep at the always-on tier. Trigger: a plugin upgrade that changes a published-event payload shape and a dependent doesn't update in lockstep.
- **Per-world co-GMs in the UI** — the `world_membership.role` column is `gm | player` for forward-compat, but the Members modal currently only adds members at `player`. Trigger: a deployment that wants two GMs sharing one campaign.
- **Invite links / pending invites** — adding a member requires the user to already have a better-auth account. There's no "send invite to email, account-creates on accept" flow yet. Trigger: GMs onboarding players who don't have accounts.
- **Sentinel-entity sugar** — manual via `world.spawn` + a coordinating system. Trigger: an attack/save flow with multiple roll entities coordinating before resolving (i.e. the first shared-mechanics or game-system plugin lands).
- **Standard-core extensions** — basics.md flags `sheet:header` / `sheet:stats` / `sheet:actions` as the expected character-sheet surfaces. Scene declares the canvas/toolbar surfaces but not the sheet host yet. Trigger: the first plugin that wants a character sheet.
- **Shared-mechanics tier** — basics.md sketches a layer between standard core and game systems (`@vtt/d20-initiative`, `@vtt/rpg-inventory`). Nothing in this layer exists yet. Trigger: the first game-system plugin that wants initiative or inventory.

These gaps are intentional v0.x scaffolding — each maps to a future plugin or substrate feature with a clear impetus.

## Tooling status

- TypeScript with `strict` + `noUncheckedIndexedAccess`; one localised `any` (the `AnySystemDef.run` and `AnyViewDef.render` existentials) with comments explaining why.
- pnpm 10 workspaces, Volta-pinned Node 22 / 24 (per package).
- Vitest 4, vite 8 + `@tailwindcss/vite` 4.
- `@vtt/scene` is the first plugin to pull a heavy runtime dep — PixiJS v8 — into the client bundle. Per-side bundling is still a no-op (see gaps), so the full PixiJS surface ships to the browser today.
- `pnpm dev` runs Vite (`:5173`) + the substrate server (`:3001`) in parallel; both ports serve the same live experience because the substrate's `devProxy` forwards non-API HTTP and HMR upgrades to Vite.
- `pnpm test` runs vitest unit (every package has a `*.test.ts`: substrate primitives including `worlds-service`/`worlds-registry`/`active-plugins`, persistence including `worlds`, identity, permissions, scene, comms, resolution, ping, system-simple) plus five integration smokes over a real WebSocket: `smoke.ts` (single-world ping round-trip), `scene-smoke.ts`, `characters-smoke.ts`, `books-smoke.ts`, and `multi-world-smoke.ts` (two clients, two worlds, no cross-talk + ghost-world rejection). `pnpm -r typecheck` runs tsc per-package.
- `pnpm reset` clears `data/` so the next start prompts to create a Game Master from scratch (and starts with zero worlds; the GM's first action becomes the forced create-world modal).
