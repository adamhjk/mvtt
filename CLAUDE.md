# mvtt — agent guide

mrpg-vtt is an open-source modern virtual tabletop. The substrate is intentionally tiny; **every game concept (dice, scenes, initiative, identity, chat, rule systems, content) is a plugin on equal footing.** Humans are not expected to write code against the framework directly — every architectural choice is graded on how legible and patternable the code is to an AI author.

## Read these first

- **`design/basics.md`** — the architectural manifesto. Read in full before writing code outside an existing plugin. Covers the substrate, the plugin model, client/server trust boundary, presence channel, persistence, and the standard core layout.
- **`design/scaffold-mapping.md`** — how each piece of the current scaffold corresponds to a DDD building block, plus the list of deliberate gaps (per-side bundling, sentinel-entity sugar, plugin dep resolution, etc.). Also covers the multi-world layer (WorldsRegistry/Service/Repository) and how the `Worlds` aggregate composes with the `World` aggregate.
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
- **vitest** for unit tests, plus a `tsx` smoke harness for the wire protocol

## Dev workflow

```sh
pnpm install
pnpm dev                  # server :3001 + Vite :5173 (HMR), proxied /ws
pnpm test                 # unit suite + wire smoke
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

### Password managers stay out of the in-app UI

The signed-in shell is wrapped in `data-1p-ignore` / `data-lpignore` / `data-bwignore` / `data-form-type="other"` (see `packages/shell-default/src/client/Chrome.tsx`) so password managers don't autofill or pop suggestions over plugin forms — game-content forms (dice notation, chat input, character sheets later) routinely look like login forms to those extensions. The auth gate (`packages/client/src/AuthGate.tsx`) is mounted *outside* this wrapper and intentionally still gets password manager support.

When a plugin adds a form inside the chrome:
- Default-trust the wrapper — most fields need nothing.
- For an `<input>` + button pair (the shape password managers most aggressively pattern-match), be defensive on the form and input directly: `autocomplete="off"`, `data-1p-ignore="true"`, `data-lpignore="true"`, `data-bwignore="true"`, `data-form-type="other"` on the form; the same attributes plus `spellcheck={false}` and a non-credential-shaped `name` on the input. The dice roller in `plugin-resolution/src/client/views.tsx` is the reference.
- Never use `type="password"` for non-credential masked input.

## Testing — required, not optional

mvtt depends on tests being ubiquitous. Both layers are mandatory; one without the other is rejected.

### Unit tests (every package, every plugin)

- Every command must have given/when/then tests (see `ecs/SKILL.md` and `plugin-ping/src/ping.test.ts`): given a world state, dispatch a command, assert the resulting events and state.
- Every system must have tests covering at minimum: the happy path, every branch in `run`, and the no-op case (unrelated event types).
- Every trait/event/command schema must have tests for both accepted and rejected inputs at the schema layer.
- Tests live next to source as `*.test.ts` and run under vitest.
- Use real types and real schemas. No `any` casts to dodge type errors. No mocks for substrate primitives — the substrate is small enough to use real instances.

### Integration tests (every plugin that crosses a boundary)

- Every plugin that exposes commands must have at least one integration test that exercises the **wire protocol** end-to-end: real `startServer`, real WebSocket client, real command envelope, real event broadcast. The pattern is `packages/server/src/smoke.ts` — copy it.
- Every plugin that ships views must have at least one integration test that mounts the view in jsdom (or equivalent) and asserts both the rendered output and that user actions dispatch the right command. Snapshot tests do not count.
- Cross-plugin coordination (Plugin A subscribes to Plugin B's events, fills Plugin B's slot, etc.) must have an integration test that loads both plugins and asserts the contract holds.

### When you change substrate

A substrate change without a new or updated unit test in `packages/substrate/src/*.test.ts` is a bug. The wire protocol smoke (`pnpm --filter @vtt/server smoke`) must continue to pass; if your change touches the wire format, update both the smoke and the per-side decoders in lockstep.

### What "passes" means

`pnpm test` (unit + smoke) **and** `pnpm -r typecheck` must both be green before any change is considered complete. CI will run both.

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
- Reading state inside `apply`. Validation reads; application emits.
- Dispatching commands from a system. Systems emit events.

## When in doubt

1. Find the closest existing exemplar (`plugin-ping` for a minimal plugin, `substrate/src/command-pipeline.ts` for the pipeline shape, `substrate/src/define.ts` for definers).
2. Re-read the relevant skill — `ecs` if you're in a plugin contributing to the World, `ddd` if you're outside it.
3. If neither covers it, write a short proposal in `design/` first and link it from this file.
