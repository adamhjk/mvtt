<!-- BEGIN swamp managed section - DO NOT EDIT -->

# Project

This repository is managed with [swamp](https://github.com/swamp-club/swamp).

## Rules

1. **Search before you build.** When automating AWS, APIs, or any external service: (a) search community extensions with `swamp extension search <query>` — prefer `@swamp/*` official extensions first, (b) search local/installed types with `swamp model type search <query>`, (c) if a community extension exists, install it with `swamp extension pull <package>` instead of building from scratch, (d) extend an existing type if it covers the domain but lacks the method you need, (e) only create a custom extension model in `extensions/models/` as a last resort. Use the `swamp` skill for guidance. The `command/shell` model is ONLY for ad-hoc one-off shell commands, NEVER for wrapping CLI tools or building integrations.
2. **Extend, don't be clever.** When a model covers the domain but lacks the method you need, extend it with `export const extension` — don't bypass it with shell scripts, CLI tools, or multi-step hacks. One method, one purpose. Use `swamp model type describe <type> --json` to check available methods.
3. **Use the data model.** Once data exists in a model (via `lookup`, `start`, `sync`, etc.), reference it with CEL expressions. Don't re-fetch data that's already available.
4. **CEL expressions everywhere.** Wire models together with CEL expressions. Always prefer `data.latest("<name>", "<dataName>").attributes.<field>` over the deprecated `model.<name>.resource.<spec>.<instance>.attributes.<field>` pattern.
5. **Verify before destructive operations.** Always `swamp model get <name> --json` and verify resource IDs before running delete/stop/destroy methods.
6. **Prefer fan-out methods over loops.** When operating on multiple targets, use a single method that handles all targets internally (factory pattern) rather than looping N separate `swamp model method run` calls against the same model. Multiple parallel calls against the same model contend on the per-model lock, causing timeouts. A single fan-out method acquires the lock once and produces all outputs in one execution. Check `swamp model type describe` for methods that accept filters or produce multiple outputs.
7. **Extension npm deps are bundled, not lockfile-tracked.** Swamp's bundler inlines all npm packages (except zod) into extension bundles at bundle time. `deno.lock` and `package.json` do NOT cover extension model dependencies — this is by design. Always pin explicit versions in `npm:` import specifiers (e.g., `npm:lodash-es@4.17.21`).
8. **Reports for reusable data pipelines.** When the task involves building a repeatable pipeline to transform, aggregate, or analyze model output (security reports, cost analysis, compliance checks, summaries), create a report extension. Use the `swamp` skill for guidance.
9. **"Workflow" means a swamp workflow.** In this repository the word "workflow" (and "create/run/execute/validate/debug workflow", "automate", "orchestrate", "automated/nightly job") refers to a swamp workflow — a declarative YAML DAG of model-method steps authored via `swamp workflow create`. Load and follow the `swamp` skill for these requests. Do NOT interpret these as a request to build an agent task list, spin up worktrees, or schedule a cron/remote agent. Only use those orchestration mechanisms when the user explicitly names one (e.g. "task list", "subagent", "worktree", "cron", "remote agent") or explicitly asks you to do the work yourself step by step rather than author a swamp workflow.

## Skills

**IMPORTANT:** Always load swamp skills, even when in plan mode. The skills provide
essential context for working with this repository.

- `swamp` - Swamp CLI — models, workflows, data, vaults, extensions, publishing, repos, reports, issues, and troubleshooting
- `swamp-getting-started` - Interactive onboarding for new swamp users

## Getting Started

**IMPORTANT:** At the start of every conversation, run
`swamp model search --json`. If no models are returned (empty result), you MUST
immediately invoke the `swamp-getting-started` skill before doing anything else.
This walks new users through an interactive onboarding tutorial.

If models already exist, start by using the `swamp` skill to work with
swamp models.

## Commands

Use `swamp --help` to see available commands. For a machine-readable JSON
schema of the CLI (commands, options, arguments) intended for agent
consumption, run `swamp help [<command>...]` — e.g. `swamp help` returns
the full tree, and `swamp help model method run` scopes to a subtree.

<!-- END swamp managed section -->

# mvtt — agent guide

mrpg-vtt is an open-source modern virtual tabletop. The substrate is intentionally tiny; **every game concept (dice, scenes, initiative, identity, chat, rule systems, content) is a plugin on equal footing.** Humans are not expected to write code against the framework directly — every architectural choice is graded on how legible and patternable the code is to an AI author.

## Read these first

- **`design/basics.md`** — the architectural manifesto. Read in full before writing code outside an existing plugin. Covers the substrate, the plugin model, client/server trust boundary, presence channel, persistence, and the standard core layout.
- **`design/scaffold-mapping.md`** — how each piece of the current scaffold corresponds to a DDD building block, plus the list of deliberate gaps (per-side bundling, sentinel-entity sugar, plugin dep resolution, etc.). Also covers the multi-world layer (WorldsRegistry/Service/Repository) and how the `Worlds` aggregate composes with the `World` aggregate.
- **`design/optimistic-ui-state.md`** — proposal for `createOptimisticTrait` plus per-plugin UI-state traits on per-tab sentinels. Read before adding any new transient/per-tab UI state; supersedes the workbench's `WorkspaceTab.uiState` blob.
- **`design/torchbearer-rolling.md`** — the TB rolling subsystem: TbRollSpec/TbRollModifier shape, the `meta` passthrough on Formula/RollResolved/RequestRoll, and how auto / manual / provider modifier sources compose. Read before touching any TB rollable, the pending-roll panel UI, or the chat row.
- **`design/items.md`** — items + inventory architecture: items are real entities shared by reference, customize is copy-on-write, per-character state lives on the holder's `TbCarries` entry, catalog data seeds entities via `definePlugin.seed`, GM edits track field overrides for upstream-merge. Read before touching any item, inventory, or catalog code.
- **`design/torchbearer-conflict.md`** — TB conflict subsystem: the Reference Board UI, the action interaction matrix, the per-conflict-type disposition / action skill tables, weapon and armor pipelines, the side-scoped script secrecy model, and the resolution algorithm. Read before touching any conflict code, action chip, weapon-bonus engine, or condition-affects-conflict logic.
- **`design/torchbearer-spells.md`** — TB arcane subsystem: spells as catalog entities (shared by reference, like items), spell books and scrolls as real items, memory palace and library as per-character traits, casting through the existing rolling subsystem with post-roll commit buttons, fuzzy spell picker. Read before touching any code in `client/tab-arcane.tsx`, `shared/spells/`, `data/tb-spells.generated.ts`, or anything that wires casting through the chat row.
- **`design/adventures.md`** — adventures + fenced-block authoring: notes are the source of truth, fenced YAML blocks (`item` / `character` / `monster` / `encounter` / `loot`) materialise into entities via `BlockParseSystem`, schema-driven autocomplete, hybrid encounter binding (singular = bind, quantified = spawn copies), bundle import/export with `AdventureProvenance`, per-block update diffs. Also documents the `tbSeed` migration that promotes monsters/NPCs/spells to eager seeded templates. Read before touching `@vtt/adventures`, the TB block kinds (`packages/system-torchbearer/src/shared/blocks/`), the catalog seed (`packages/system-torchbearer/src/data/seed.ts`), or anything that materialises an entity from a fenced block.
  - **Block-kind choice follows DATA SHAPE, not uniqueness.** Monsters are monsters. If the printed stat block is monster-shaped — Nature + Might + descriptors + per-conflict disposition HP + named conflict-weapon abilities (Cursed Blade, Stench of Death, etc.) with no will/health/skills/wises/belief/goal/instinct — use a `monster` block, _even if the foe is a one-of-a-kind named boss_ (Haathor-Vash, the Barrow Wight, a named dragon, an undead king). Reach for `character` only when the foe carries PC-shape stats: will + health + skills + wises + belief/goal/instinct (e.g. Beronin the Bandit Chief with a full sheet). Bind-vs-spawn is decided by the _quantifier on the encounter ref_, not by the block kind — `[[monster:Haathor-Vash]]` (singular) binds to that one entity; `3× [[monster:thoul]]` spawns three copies from the template.
- **`.claude/skills/ecs/SKILL.md`** — patterns for traits, events, commands, systems, views, sentinel entities, factories, and plugin manifests. Apply when working **inside a plugin** that contributes to the live game World.
- **`.claude/skills/ddd/SKILL.md`** — Domain Driven Design building blocks. Apply for everything **outside the live World**: substrate plumbing, persistence, content catalogs, user accounts, orchestration.

The two skills compose: ECS structures the contents of the World aggregate; DDD structures everything else. **A plugin is a bounded context** and may contribute to both.

## Layout

```
packages/
  substrate/         # tiny core: World, EventBus, CommandPipeline, definers, ws server/client, wire protocol,
                     # plus the multi-world layer: WorldsRepository, WorldsService, WorldsRegistry, WorldRuntime,
                     # resolveActivePlugins (game-system + deps + infra), InMemoryWorldsRepository for tests.
  plugin-ping/       # minimal demo plugin (Ping command → Pong event)
  system-simple/     # first game-system plugin (gameSystem: true, deps: dice-tray + characters)
  server/            # Node entry: boots substrate, loads plugins, HTTP API for /api/worlds + memberships,
                     # opens http+ws on :3001 (WS routed by ?worldId=)
  client/            # Vite + Solid; AuthGate → WorldGate → mounts views by surface; world picker in header
design/
  basics.md
  scaffold-mapping.md
.claude/skills/
  ecs/   ddd/
```

A plugin's internal layout follows the ECS skill:

```
packages/<plugin>/src/
  shared/    # universal: trait/event/command schemas
  server/    # validators, system handlers, spell cast() functions
  client/    # Solid views, predictive code
  manifest.ts
```

## Tech stack

- **TypeScript** with `moduleResolution: bundler`, strict mode, `noUncheckedIndexedAccess`
- **pnpm** workspaces
- **Solid + Vite** for the client (HMR via Vite's `/ws` proxy in dev)
- **Zod** for every trait/event/command schema and the wire boundary
- **ws** for WebSockets; substrate also vends the built client over plain HTTP
- **vitest** for everything testable: pure unit tests (node env), wire-protocol smokes (node env, real ws client + server), and component tests (jsdom env, `@solidjs/testing-library`). One `pnpm test` runs all three.

## Dev workflow

```sh
pnpm install
pnpm dev                  # server :3001 + Vite :5173 (HMR), proxied /ws
pnpm test                 # vitest: unit + wire smokes + jsdom component tests
pnpm -r typecheck
```

For a single-port (deploy-shape) run:

```sh
pnpm --filter @vtt/client build
pnpm --filter @vtt/server start    # serves /, /assets/*, and /ws on :3001
```

## Conventions

### Backwards compatibility — we have users now

mvtt is in production. Real people have characters, scenes, rolls, and uploaded assets in their databases. **Their data must survive every change you make.** The old "if it breaks, `pnpm reset`" reflex is dead — that wipes someone's campaign.

Three shape-change surfaces, each with a required pattern:

- **Trait shape changes.** When you add, rename, or remove a field on a trait that's already in use, the world is full of values written under the old shape. `world.get` returns those values without re-parsing, so legacy data flows straight into your code. Either (a) write an upgrade pass — a one-shot system that reads old-shape values, normalizes them, and writes the new shape via `world.set` plus the appropriate event so replicas converge — or (b) make your readers defensively normalize at the point of use. Schema changes alone don't migrate anything.

- **Event payload changes.** Events are persisted in `world_event` with a `payloadVersion` column (see `packages/persistence-sqlite/src/index.ts`). When you change a payload, bump the version on the event definer and accept both shapes during replay: the schema parser should upgrade old payloads to new-shape values, or your replay path should branch on `payloadVersion`. Old logs replay forever; new code must be able to read them.

- **Database schema changes.** The `migrate()` methods in `packages/persistence-sqlite/src/{index,worlds}.ts` are the canonical pattern. New tables: `CREATE TABLE IF NOT EXISTS`. New columns: `ALTER TABLE ADD COLUMN` wrapped in a duplicate-column-error catch (STRICT tables). The `visibility` column rollout in `index.ts:91-100` is a working example. **Additive only.** Never drop a column or rewrite existing rows in place; if you need to backfill, ship the backfill as a separate forward-only step.

Diagnose stale-shape errors as bugs, not as setup issues to be wiped. `pnpm reset` is still a developer convenience for _local_ dev fixtures — never assume your users have that option.

### Plugin-namespaced names are branded

Every trait, event, and command is named `@scope/plugin/Type` and the substrate brands the name into one of `TraitName`, `EventName`, `CommandName` — these are **not interchangeable** at the type level. Always go through the definers (`defineTrait`, `defineEvent`, `defineCommand`); never construct names by hand.

### Per-side code

Mark code that runs only on one side with `serverOnly()` or `clientOnly()`. Schemas and definitions are universal and need no marker. Today these markers are no-ops at runtime — when a real bundler is added it will strip the wrong half from each artifact, so don't put side-specific imports at module top level if you can avoid it.

### Commands have a mandatory `validate` / `apply` split

`validate` reads the world and may reject. `apply` only emits events. Never query the world inside `apply`. Systems react to the emitted events. Systems never dispatch commands.

### Mutations only via events

Systems may write to traits but must always emit the corresponding events. No silent mutation — replay, networking, and tests all depend on the event log being the source of truth.

### Trust boundary

Only **commands** cross client → server. Only **events** cross server → client. Treat all client-side code as untrusted; the server validates every command independently.

### Entity ids are server-authoritative

Every entity id is allocated by the server in a command's `apply` via `world.allocateId()` and embedded in the emitted event. Universal-mirror systems on every side then call `world.spawnAt(event.<id>, traits)` — never `world.spawn(...)`. Predicting ids by running a per-side counter "in lockstep" with the server is silently broken under per-recipient event filtering, secondary-event timing differences, and any future per-side codepath difference; the counters drift and clients reference entities the server never allocated. See "Entity ids are server-authoritative" in `design/basics.md`.

### Real-time reactivity is essential — never snapshot derivable state

mvtt is a live, multi-player VTT. Every UI surface must update in real time as the underlying world changes — players renaming characters, equipping armor mid-fight, taking conditions, dropping weapons, all of it should propagate to every other player's screen with no manual refresh. **Treat snapshotting as a bug.**

Concretely:

- **Don't copy character data into derived entities.** A conflict participant doesn't need a `displayName` field copied off `Character.name` — read the character's name live via `useTrait(characterId, Character)` at the leaf component. A "currently equipped armor" reference doesn't need to be cached on a conflict-armor-state entity at declare time — derive it live from the holder's `TbCarries` trait. Snapshots inevitably drift from the source of truth and break the "real-time" promise.
- **Conflict-local state legitimately exists separately.** HP this round, scripted actions for this round, weapon binding for this round, armor degradation this fight — these aren't snapshots of character state, they're new facts created by the conflict. Store those.
- **Pass entity ids down through props, not snapshotted values.** `<TopStripe conflictId={c.id} />` not `<TopStripe conflict={c} />`. The leaf calls `useTrait` / `useQuery` and subscribes to its own slice. Solid only re-runs the leaf when its slice changes — and the snapshot pattern (`const c = cAcc(); return <Comp v={c} />`) silently breaks reactivity because `c` is captured at first render and never updates.
- **Server-side resolvers should also read live.** Don't cache "what armor was equipped at conflict-declare" — read the character's `TbCarries` at slot-resolve time so a mid-fight equip is reflected immediately.
- **The server is the source of truth; the world's traits are the canonical view.** Anything you'd be tempted to "save for safety" lives on its owning entity already — stop, look it up, and read it live.

### Password managers stay out of the in-app UI

The signed-in shell is wrapped in `data-1p-ignore` / `data-lpignore` / `data-bwignore` / `data-form-type="other"` (see `packages/shell-default/src/client/Chrome.tsx`) so password managers don't autofill or pop suggestions over plugin forms — game-content forms (dice notation, chat input, character sheets later) routinely look like login forms to those extensions. The auth gate (`packages/client/src/AuthGate.tsx`) is mounted _outside_ this wrapper and intentionally still gets password manager support.

When a plugin adds a form inside the chrome:

- Default-trust the wrapper — most fields need nothing.
- For an `<input>` + button pair (the shape password managers most aggressively pattern-match), be defensive on the form and input directly: `autocomplete="off"`, `data-1p-ignore="true"`, `data-lpignore="true"`, `data-bwignore="true"`, `data-form-type="other"` on the form; the same attributes plus `spellcheck={false}` and a non-credential-shaped `name` on the input. The dice roller in `plugin-resolution/src/client/views.tsx` is the reference.
- Never use `type="password"` for non-credential masked input.

## Testing — required, not optional

mvtt depends on tests being ubiquitous. Three layers; all are mandatory for any plugin that ships the corresponding surface.

### Unit tests (every package, every plugin)

- Every command must have given/when/then tests (see `ecs/SKILL.md` and `plugin-ping/src/ping.test.ts`): given a world state, dispatch a command, assert the resulting events and state.
- Every system must have tests covering at minimum: the happy path, every branch in `run`, and the no-op case (unrelated event types).
- Every trait/event/command schema must have tests for both accepted and rejected inputs at the schema layer.
- Tests live next to source as `*.test.ts` and run under vitest's **node** project (no DOM).
- Use real types and real schemas. No `any` casts to dodge type errors. No mocks for substrate primitives — the substrate is small enough to use real instances.

### Wire smoke tests (every plugin that exposes commands)

- Every plugin that crosses the WS boundary needs at least one `*.smoke.test.ts` file in `packages/server/src/` that spins up `startServer` + a real WebSocket client and round-trips one or more commands end-to-end. Existing exemplars: `ping.smoke.test.ts`, `scene.smoke.test.ts`, `characters.smoke.test.ts`, `books.smoke.test.ts`, `multi-world.smoke.test.ts`.
- Smokes are _transport tests_, not behavior tests: they catch wire-format regressions, broadcast/visibility bugs, ack/seq drift, snapshot/tail replay. Don't grow them per-feature; add one only when the wire surface itself changes.
- The `*.smoke.test.ts` naming puts them in the same vitest pass as everything else (parallel, same `pnpm test` invocation).

### Visual / component tests (every plugin that ships views) — jsdom integration tests

**Required for any plugin under `packages/<name>/src/client/` that contains a `.tsx`.** Tests live next to source as `*.test.tsx` and run under vitest's **jsdom** project. Three rules:

1. **Mount via the canonical harness.** Use `buildTestClient` from `@vtt/substrate/client-testing` (or `buildCharacterHarness` from `@vtt/characters/testing` for character-bound views). Both expose a fake `ClientHandle` whose `dispatch` pipes through a real `CommandPipeline` against a real `World` — so trait subscriptions see the after-effects of dispatched commands and "edit value → sibling re-renders" loops are testable end-to-end.

2. **Cover the primary user actions.** At minimum: each interactive control gets a test that asserts both the rendered output and the dispatched command (type + payload). Owner / GM gating where the view applies it. Snapshot tests do not count.

3. **For canvas-heavy views** (PixiJS scenes, Babylon 3D trays, PDF.js viewers), test the _descriptor_ and _plumbing_ in jsdom — id, label, edge, autoOpen wiring, slot fills — and verify the actual rendering manually in the browser. jsdom doesn't provide a working WebGL/Canvas context. Existing exemplar: `packages/dice-tray/src/DiceTrayDrawer.test.tsx`.

Cross-plugin coordination (Plugin A subscribes to Plugin B's events, fills Plugin B's slot, etc.) must have a jsdom test that loads both plugins via `buildTestClient({ plugins: [a, b] })` and asserts the contract holds.

#### The harness in one line

```ts
import { buildTestClient, mountWithClient } from "@vtt/substrate/client-testing";

const h = buildTestClient({
  plugins: [shellDefault, myPlugin],
  setupWorld: ({ world }) => world.spawn([...]),
  session: { userId: "me", email: "me@test.dev", name: "Me", role: "player" },
});
mountWithClient(h, () => <MyView />);
fireEvent.click(screen.getByRole("button", { name: /go/i }));
expect(h.dispatched[0].type).toBe(MyCommand.name);
```

For character-bound views (anything that uses the kit's owner-gating or `useTraitPath`):

```ts
import { buildCharacterHarness } from "@vtt/characters/testing";

const h = buildCharacterHarness({
  plugins: [myGameSystemPlugin],
  asGm: true,
  setupWorld: ({ world, characterId }) => world.set(characterId, MyTrait, {...}),
});
```

The harness pre-spawns a Character + OwnedBy + Identity + Online, so `useMe()` and `useCanEdit()` resolve correctly out of the box.

### When you change substrate

A substrate change without a new or updated unit test in `packages/substrate/src/*.test.ts` is a bug. The wire smokes must continue to pass; if your change touches the wire format, update the affected smoke (`packages/server/src/*.smoke.test.ts`) and the per-side decoders in lockstep.

### What "passes" means

`pnpm test` (vitest: node + jsdom + smoke, all in one run) **and** `pnpm -r typecheck` must both be green before any change is considered complete. CI will run both.

## Anti-patterns to refuse

From the ECS skill — bullets repeated here so they're loud:

- Trait with methods.
- System mutating the world without emitting events.
- System calling another system directly.
- View running server-side logic.
- View subscribing to events instead of trait signals (exception: log-style components).
- Reaching across plugin boundaries by importing internals. Cross-plugin coordination is via published events, slots, and shared trait definitions only.
- ECS for things outside the live World — those are DDD aggregates with repositories.
- Mutating a trait in place. Trait values are replaced atomically via `world.set(id, Trait, newValue)`.
- Reading state inside `apply`. Validation reads; application emits. (`world.allocateId()` is the one allowed write.)
- Dispatching commands from a system. Systems emit events.
- Calling `world.spawn(...)` from a universal-mirror system. Allocate the id via `world.allocateId()` in the command's `apply`, embed it in the event, and call `world.spawnAt(event.<id>, traits)` from the system. Predicting ids on the client is silently broken under filtered events.

## When in doubt

1. Find the closest existing exemplar (`plugin-ping` for a minimal plugin, `substrate/src/command-pipeline.ts` for the pipeline shape, `substrate/src/define.ts` for definers).
2. Re-read the relevant skill — `ecs` if you're in a plugin contributing to the World, `ddd` if you're outside it.
3. If neither covers it, write a short proposal in `design/` first and link it from this file.
