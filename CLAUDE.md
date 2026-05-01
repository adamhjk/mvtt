# mvtt — agent guide

mrpg-vtt is an open-source modern virtual tabletop. The substrate is intentionally tiny; **every game concept (dice, scenes, initiative, identity, chat, rule systems, content) is a plugin on equal footing.** Humans are not expected to write code against the framework directly — every architectural choice is graded on how legible and patternable the code is to an AI author.

## Read these first

- **`design/basics.md`** — the architectural manifesto. Read in full before writing code outside an existing plugin. Covers the substrate, the plugin model, client/server trust boundary, presence channel, persistence, and the standard core layout.
- **`design/scaffold-mapping.md`** — how each piece of the current scaffold corresponds to a DDD building block, plus the list of deliberate gaps (per-side bundling, sentinel-entity sugar, plugin dep resolution, etc.). Also covers the multi-world layer (WorldsRegistry/Service/Repository) and how the `Worlds` aggregate composes with the `World` aggregate.
- **`design/optimistic-ui-state.md`** — proposal for `createOptimisticTrait` plus per-plugin UI-state traits on per-tab sentinels. Read before adding any new transient/per-tab UI state; supersedes the workbench's `WorkspaceTab.uiState` blob.
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

### Password managers stay out of the in-app UI

The signed-in shell is wrapped in `data-1p-ignore` / `data-lpignore` / `data-bwignore` / `data-form-type="other"` (see `packages/shell-default/src/client/Chrome.tsx`) so password managers don't autofill or pop suggestions over plugin forms — game-content forms (dice notation, chat input, character sheets later) routinely look like login forms to those extensions. The auth gate (`packages/client/src/AuthGate.tsx`) is mounted *outside* this wrapper and intentionally still gets password manager support.

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
- Smokes are *transport tests*, not behavior tests: they catch wire-format regressions, broadcast/visibility bugs, ack/seq drift, snapshot/tail replay. Don't grow them per-feature; add one only when the wire surface itself changes.
- The `*.smoke.test.ts` naming puts them in the same vitest pass as everything else (parallel, same `pnpm test` invocation).

### Visual / component tests (every plugin that ships views) — jsdom integration tests

**Required for any plugin under `packages/<name>/src/client/` that contains a `.tsx`.** Tests live next to source as `*.test.tsx` and run under vitest's **jsdom** project. Three rules:

1. **Mount via the canonical harness.** Use `buildTestClient` from `@vtt/substrate/client-testing` (or `buildCharacterHarness` from `@vtt/characters/testing` for character-bound views). Both expose a fake `ClientHandle` whose `dispatch` pipes through a real `CommandPipeline` against a real `World` — so trait subscriptions see the after-effects of dispatched commands and "edit value → sibling re-renders" loops are testable end-to-end.

2. **Cover the primary user actions.** At minimum: each interactive control gets a test that asserts both the rendered output and the dispatched command (type + payload). Owner / GM gating where the view applies it. Snapshot tests do not count.

3. **For canvas-heavy views** (PixiJS scenes, Babylon 3D trays, PDF.js viewers), test the *descriptor* and *plumbing* in jsdom — id, label, edge, autoOpen wiring, slot fills — and verify the actual rendering manually in the browser. jsdom doesn't provide a working WebGL/Canvas context. Existing exemplar: `packages/dice-tray/src/DiceTrayDrawer.test.tsx`.

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
