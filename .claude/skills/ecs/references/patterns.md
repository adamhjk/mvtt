# mvtt ECS Patterns

Implementation patterns for traits, events, commands, systems, views, sentinel entities, factories, and plugin manifests inside an mvtt plugin. All examples use TypeScript with the substrate's `defineX` helpers and Zod schemas.

## Trait

Pure data. Schema-defined. Immutable: replace, never mutate.

```typescript
import { defineTrait, EntityId } from "@vtt/substrate";
import { z } from "zod";

export const Health = defineTrait({
  name: "@vtt/dnd5e/Health",
  schema: z.object({
    current: z.number().int(),
    max: z.number().int().positive(),
  }),
});

export const Strength = defineTrait({
  name: "@vtt/simple-d100/Strength",
  schema: z.object({ value: z.number().int().min(1).max(100) }),
});

export const Combatant = defineTrait({
  name: "@vtt/simple-d100/Combatant",
  schema: z.object({ side: z.enum(["party", "enemy"]) }),
});
```

No methods. No constructors. The schema is the type and the validator. The exported binding is a value object factory the substrate uses to construct, validate, and serialize trait instances.

## Event

An immutable fact. Carries visibility metadata so the substrate can filter per recipient.

```typescript
import { defineEvent, EntityId } from "@vtt/substrate";
import { z } from "zod";

export const DamageDealt = defineEvent({
  name: "@vtt/simple-d100/DamageDealt",
  schema: z.object({
    targetId: EntityId,
    amount: z.number().int().positive(),
    source: z.string().optional(),
  }),
});

export const SaveResolved = defineEvent({
  name: "@vtt/dnd5e/SaveResolved",
  schema: z.object({
    targetId: EntityId,
    saved: z.boolean(),
    rollTotal: z.number().int(),
    dc: z.number().int(),
    modifier: z.number().int(),
  }),
  // private fields delivered only to GM clients
  visibility: {
    publicFields: ["targetId", "saved"],
    privateFields: ["rollTotal", "dc", "modifier"],
  },
});
```

## Command

Client intent, validated against world state, applied to produce events. The `validate` / `apply` split is mandatory.

```typescript
import { defineCommand, EntityId, fail, ok } from "@vtt/substrate";
import { z } from "zod";
import { Strength } from "../traits/Strength";
import { Health } from "../traits/Health";
import { Combatant } from "../traits/Combatant";
import { AttackDeclared } from "../events/AttackDeclared";

export const DeclareAttack = defineCommand({
  name: "@vtt/simple-d100/DeclareAttack",
  schema: z.object({ attackerId: EntityId, targetId: EntityId }),

  validate: ({ cmd, world, actor }) => {
    const attacker = world.get(cmd.attackerId, [Strength, Health, Combatant]);
    const target = world.get(cmd.targetId, [Strength, Health, Combatant]);
    if (!attacker || !target) return fail("missing required traits");
    if (attacker.Health.current <= 0) return fail("attacker is defeated");
    if (target.Health.current <= 0) return fail("target is already defeated");
    if (attacker.Combatant.side === target.Combatant.side) return fail("friendly fire not allowed");
    if (!world.turn.isCurrentActor(cmd.attackerId, actor)) return fail("not your turn");
    return ok();
  },

  apply: ({ cmd }) => [AttackDeclared({ attackerId: cmd.attackerId, targetId: cmd.targetId })],
});
```

`validate` reads the world and may reject. `apply` only emits events. Never query the world inside `apply` — by the time it runs, the decision has been made.

## System

Pure function from `(event, world)` to events. Declares its `reads` and `writes` so the substrate can parallelize and so the AI author can see what it touches without reading the body.

```typescript
import { defineSystem } from "@vtt/substrate";
import { Health } from "../traits/Health";
import { DamageDealt } from "../events/DamageDealt";
import { CombatantDefeated } from "../events/CombatantDefeated";

export const DamageApplicationSystem = defineSystem({
  name: "DamageApplication",
  on: DamageDealt,
  reads: [Health],
  writes: [Health],
  run: ({ event, world }) => {
    const target = world.get(event.targetId, [Health])!;
    const next = Math.max(0, target.Health.current - event.amount);
    world.set(event.targetId, Health, { ...target.Health, current: next });
    return next === 0 ? [CombatantDefeated({ id: event.targetId })] : [];
  },
});
```

Systems never call other systems directly. Coordination happens by emitting events the other systems subscribe to.

## View

A Solid component bound to a surface and a trait query. Read-only: subscribes to signals and dispatches commands.

```tsx
import {
  defineView,
  useTrait,
  useDispatch,
  useSelectedTarget,
  useIsMyTurn,
  clientOnly,
} from "@vtt/substrate";
import { Health } from "../traits/Health";
import { Combatant } from "../traits/Combatant";
import { DeclareAttack } from "../commands/DeclareAttack";

export const HealthBarView = defineView({
  surface: "token-overlay",
  requires: [Health],
  render: clientOnly(({ entityId }) => {
    const health = useTrait(entityId, Health);
    return (
      <div class="health-bar">
        <div class="fill" style={{ width: `${(health().current / health().max) * 100}%` }} />
        <span>
          {health().current} / {health().max}
        </span>
      </div>
    );
  }),
});

export const AttackButtonView = defineView({
  surface: "token-action-bar",
  requires: [Combatant, Health],
  render: clientOnly(({ entityId }) => {
    const target = useSelectedTarget();
    const dispatch = useDispatch();
    const myTurn = useIsMyTurn(entityId);
    return (
      <button
        disabled={!target() || !myTurn()}
        onClick={() =>
          dispatch(
            DeclareAttack({
              attackerId: entityId,
              targetId: target()!.id,
            }),
          )
        }
      >
        Attack
      </button>
    );
  }),
});
```

Views never mutate state. They subscribe to trait signals (not events) for normal rendering; the exception is log-style components that consume an event stream.

## Sentinel Entity (logical aggregate)

When state has to coordinate across multiple ticks or entities — pending rolls, in-flight attacks, encounters, concentration — spawn a sentinel entity holding the coordination traits, then have a completion system react to the relevant events.

**Entity ids are server-allocated.** The command's `apply` calls `world.allocateId()` for each entity it will create, embeds the ids in the emitted event, and the spawning system on every side calls `world.spawnAt(event.<id>, traits)`. Never have a system call `world.spawn(...)` to allocate an id — the per-side counters drift and clients end up referencing entities the server never allocated.

```typescript
import {
  defineCommand,
  defineTrait,
  defineEvent,
  defineSystem,
  EntityId,
  fail,
  ok,
} from "@vtt/substrate";
import { z } from "zod";
import { Formula, RollContext, Visibility, RollResult } from "@vtt/resolution";
import { Strength } from "../traits/Strength";

// Trait
export const PendingAttack = defineTrait({
  name: "@vtt/simple-d100/PendingAttack",
  schema: z.object({
    attackerId: EntityId,
    targetId: EntityId,
    attackerRollId: EntityId,
    defenderRollId: EntityId,
  }),
});

// Event — carries the three ids the command pre-allocated
export const AttackDeclared = defineEvent({
  name: "@vtt/simple-d100/AttackDeclared",
  schema: z.object({
    attackerId: EntityId,
    targetId: EntityId,
    attackerRollId: EntityId,
    defenderRollId: EntityId,
    pendingAttackId: EntityId,
  }),
});

// Command — apply allocates ids server-side, embeds in the event
export const DeclareAttack = defineCommand({
  name: "@vtt/simple-d100/DeclareAttack",
  schema: z.object({ attackerId: EntityId, targetId: EntityId }),
  validate: ({ cmd, world, actor }) => {
    // ... usual validation reads
    return ok();
  },
  apply: ({ cmd, world }) => [
    AttackDeclared({
      attackerId: cmd.attackerId,
      targetId: cmd.targetId,
      attackerRollId: world.allocateId(),
      defenderRollId: world.allocateId(),
      pendingAttackId: world.allocateId(),
    }),
  ],
});

// Initiation system — universal mirror; spawns at the ids from the event
export const AttackInitiationSystem = defineSystem({
  name: "AttackInitiation",
  on: AttackDeclared,
  run: ({ event, world }) => {
    world.spawnAt(event.attackerRollId, [
      Formula({ count: 1, sides: 100 }),
      RollContext({ reason: "d100.attack", actorId: event.attackerId, targetId: event.targetId }),
      Visibility({ mode: "public" }),
    ]);
    world.spawnAt(event.defenderRollId, [
      Formula({ count: 1, sides: 100 }),
      RollContext({ reason: "d100.defense", actorId: event.targetId }),
      Visibility({ mode: "public" }),
    ]);
    world.spawnAt(event.pendingAttackId, [
      PendingAttack({
        attackerId: event.attackerId,
        targetId: event.targetId,
        attackerRollId: event.attackerRollId,
        defenderRollId: event.defenderRollId,
      }),
    ]);
    return [];
  },
});

// Completion: react when both rolls resolve, then despawn the sentinel
export const AttackCompletionSystem = defineSystem({
  name: "AttackCompletion",
  on: RollResolved,
  run: ({ event, world }) => {
    const pending = world
      .query([PendingAttack])
      .find(
        (p) =>
          p.PendingAttack.attackerRollId === event.rollId ||
          p.PendingAttack.defenderRollId === event.rollId,
      );
    if (!pending) return [];

    const aResult = world.get(pending.PendingAttack.attackerRollId, [RollResult]);
    const dResult = world.get(pending.PendingAttack.defenderRollId, [RollResult]);
    if (!aResult || !dResult) return []; // other roll still pending

    const attacker = world.get(pending.PendingAttack.attackerId, [Strength])!;
    const target = world.get(pending.PendingAttack.targetId, [Strength])!;
    const hit =
      aResult.RollResult.total < attacker.Strength.value &&
      !(dResult.RollResult.total < target.Strength.value);

    world.despawn(pending.id);
    const out = [
      AttackResolved({
        attackerId: pending.PendingAttack.attackerId,
        targetId: pending.PendingAttack.targetId,
        attackerRoll: aResult.RollResult.total,
        defenderRoll: dResult.RollResult.total,
        hit,
      }),
    ];
    if (hit) out.push(DamageDealt({ targetId: pending.PendingAttack.targetId, amount: 1 }));
    return out;
  },
});
```

The `PendingAttack` sentinel + its two roll entities + the systems above form one logical DDD Aggregate (an in-flight attack). The aggregate boundary is the set of traits owned by the sentinel; invariants are enforced by the systems.

## Pattern Helper / Factory

Reusable producers of template value objects. Used heavily in content plugins to avoid per-thing boilerplate.

```typescript
import {
  defineSpellTemplate,
  SpellTemplate,
  SpellSchool,
  SpellComponents,
  SpellTargeting,
  SpellScaling,
  Ability,
  DamageType,
} from "@vtt/dnd5e";
import { serverOnly } from "@vtt/substrate";
import { DealDamage } from "../commands/DealDamage";

export function defineDamageSpell(def: {
  id: string;
  name: string;
  level: number;
  school: SpellSchool;
  components: SpellComponents;
  range: number;
  damage: { dice: string; type: DamageType; scaling?: SpellScaling };
  targeting: SpellTargeting;
  save?: { ability: Ability; halfOnSave?: boolean };
}): SpellTemplate {
  return defineSpellTemplate({
    id: def.id,
    metadata: {
      name: def.name,
      level: def.level,
      school: def.school,
      components: def.components,
      range: def.range,
    },
    cast: serverOnly(async (ctx) => {
      const targets = await ctx.resolveTargets(def.targeting);
      const roll = await ctx.rollDamage(def.damage, ctx.castingLevel);
      for (const t of targets) {
        if (def.save) {
          const saved = await ctx.requestSave(t, def.save);
          ctx.dispatch(
            DealDamage({
              targetId: t,
              amount: saved && def.save.halfOnSave ? Math.floor(roll.total / 2) : roll.total,
              type: def.damage.type,
            }),
          );
        } else {
          ctx.dispatch(DealDamage({ targetId: t, amount: roll.total, type: def.damage.type }));
        }
      }
    }),
  });
}
```

Then content uses it:

```typescript
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
});
```

A factory is a DDD Factory; the produced `SpellTemplate` is a Value Object.

## Plugin Manifest

The contract surface. Registers everything the plugin contributes and declares its dependencies.

```typescript
import { definePlugin, defineSlot } from "@vtt/substrate";
import { Strength, Health, Combatant, PendingAttack } from "./shared/traits";
import { AttackDeclared, AttackResolved, DamageDealt, CombatantDefeated } from "./shared/events";
import { DeclareAttack } from "./shared/commands/DeclareAttack";
import {
  AttackInitiationSystem,
  AttackCompletionSystem,
  DamageApplicationSystem,
} from "./server/systems";
import { HealthBarView, CombatLogView, AttackButtonView } from "./client/views";
import type { StatusEffectDef } from "./shared/types";

export default definePlugin({
  name: "@vtt/simple-d100",
  version: "0.1.0",
  dependsOn: ["@vtt/substrate@^1", "@vtt/scene@^1", "@vtt/identity@^1", "@vtt/resolution@^1"],

  traits: [Strength, Health, Combatant, PendingAttack],
  events: [AttackDeclared, AttackResolved, DamageDealt, CombatantDefeated],
  commands: [DeclareAttack],
  systems: [AttackInitiationSystem, AttackCompletionSystem, DamageApplicationSystem],
  views: [HealthBarView, CombatLogView, AttackButtonView],

  // typed slots dependent plugins can fill in their own manifests
  slots: {
    statusEffects: defineSlot<StatusEffectDef>(),
  },
});
```

## Test Pattern

Given an event log, dispatch a command, assert the resulting events and state. Pure: no mocks, no fixtures, no UI plumbing.

```typescript
import { test, expect } from "vitest";
import { given } from "@vtt/substrate/testing";
import { Identity } from "@vtt/identity";
import { Strength } from "../traits/Strength";
import { Health } from "../traits/Health";
import { Combatant } from "../traits/Combatant";
import { DeclareAttack } from "../commands/DeclareAttack";
import { AttackDeclared } from "../events/AttackDeclared";
import { AttackResolved } from "../events/AttackResolved";
import { DamageDealt } from "../events/DamageDealt";
import { CombatantDefeated } from "../events/CombatantDefeated";

test("attack hits when attacker rolls under and defender does not", () => {
  given((world) =>
    world
      .entity("hero", [
        Identity({ name: "Hero" }),
        Strength({ value: 80 }),
        Health({ current: 10, max: 10 }),
        Combatant({ side: "party" }),
      ])
      .entity("goblin", [
        Identity({ name: "Goblin" }),
        Strength({ value: 30 }),
        Health({ current: 10, max: 10 }),
        Combatant({ side: "enemy" }),
      ])
      .turn("hero"),
  )
    .withDice([42, 90])
    .when(DeclareAttack({ attackerId: "hero", targetId: "goblin" }))
    .expectEvents([
      AttackDeclared,
      AttackResolved.where({ hit: true }),
      DamageDealt.where({ amount: 1 }),
    ])
    .expectState((w) => expect(w.get("goblin", Health)!.current).toBe(9));
});

test("a goblin reduced to 0 HP is defeated", () => {
  given((world) =>
    world
      .entity("hero", [
        Strength({ value: 99 }),
        Health({ current: 10, max: 10 }),
        Combatant({ side: "party" }),
      ])
      .entity("goblin", [
        Strength({ value: 10 }),
        Health({ current: 1, max: 10 }),
        Combatant({ side: "enemy" }),
      ])
      .turn("hero"),
  )
    .withDice([5, 99])
    .when(DeclareAttack({ attackerId: "hero", targetId: "goblin" }))
    .expectEvents.toContain(CombatantDefeated.where({ id: "goblin" }));
});
```

The given/when/then shape mirrors the natural-language form a rules document would use. Tests double as readable specifications.
