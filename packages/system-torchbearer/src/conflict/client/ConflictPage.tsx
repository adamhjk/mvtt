// mvtt, an RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of mvtt.
//
// mvtt is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// mvtt is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with mvtt.  If not, see <https://www.gnu.org/licenses/>.

import type { CommandInstance, EntityId } from "@vtt/substrate";
import { definePageProvider, RetargetTab } from "@vtt/shell-workbench/shared";
import { useClient, useQuery } from "@vtt/substrate/client";
import {
  createMemo,
  createSignal,
  For,
  Match,
  onMount,
  Show,
  Switch,
  type JSX,
} from "solid-js";
import {
  Active,
  Character,
  SetField,
  Team,
  isActive,
} from "@vtt/characters/shared";
import { EncounterTemplate } from "@vtt/adventures/shared";
import { Note } from "@vtt/notes/shared";
import { peelRef } from "../../shared/blocks/encounter.js";
import {
  CreateMonsterFromCatalog,
  CreateNpcFromCatalog,
  MonsterCreated,
  NpcCreated,
  TB_MONSTER_TEMPLATES,
  TB_NPC_TEMPLATES,
  TbMonster,
  TbNpc,
  mapConflictType,
} from "../../shared/index.js";
import {
  NpcRack,
  filterNpcCatalogByQuery,
} from "../../client/npc-picker.js";
import {
  ALL_CONFLICT_TYPES,
  CONFLICT_PAGE_KIND,
  DeclareConflict,
  TB_CONFLICT_TYPES,
  TbConflict,
  TbConflictParticipant,
  type ConflictType,
} from "../shared/index.js";
import {
  BestiaryRack,
  filterCatalogByQuery,
} from "../../client/bestiary-picker.js";
import { useConflict, useScript } from "./hooks.js";
import { TopStripe } from "./TopStripe.js";
import { TeamColumn } from "./TeamColumn.js";
import { ResolutionRow } from "./ResolutionRow.js";
import { ActionMatrix } from "./ActionMatrix.js";
import { ConflictWeaponsReference, WeaponPanel } from "./WeaponPanel.js";
import { ArmorRulesLegend, ArmorSidePanel } from "./ArmorPanel.js";
import { ConditionsPanel } from "./ConditionsPanel.js";
import { CompromisePanel } from "./CompromisePanel.js";
import { useMe } from "./use-me.js";


/**
 * Workbench page provider for the Reference Board. Lists every
 * `TbConflict` entity in the world; clicking opens the live board.
 * Empty branch is the management hub: list every conflict + an
 * inline declare-conflict form (GM only). Mirrors the
 * Notes / Characters / Books / Items hub pattern.
 */
export const ConflictPageProvider = definePageProvider({
  kind: CONFLICT_PAGE_KIND,
  icon: "swords",
  label: "Conflicts",
  reads: [TbConflict, TbConflictParticipant],
  list: ({ world }) => {
    const out: { id: EntityId; label: string }[] = [];
    for (const row of world.query([TbConflict])) {
      const c = row.values.TbConflict as ReturnType<typeof TbConflict>["value"];
      const label =
        c.locationLabel || `${TB_CONFLICT_TYPES[c.type].label} (round ${c.round})`;
      out.push({ id: row.id, label });
    }
    return out;
  },
  defaultEntity: () => null,
  render: ({ tabId, entityId }) =>
    (<ConflictPage tabId={tabId} entityId={entityId} />) as unknown,
});

function ConflictPage(props: {
  tabId: string;
  entityId: EntityId | null;
}): JSX.Element {
  const client = useClient();
  // Reactively read the entity's traits to decide how to render:
  //   - TbConflict       → live board for the conflict
  //   - EncounterTemplate → declare form pre-filled from the
  //                         encounter (the GM clicked "Set up
  //                         conflict" on an encounter card)
  //   - null / otherwise  → hub (list + declare form)
  const isConflict = createMemo(() => {
    const eid = props.entityId;
    if (!eid) return false;
    return Boolean(client.world.get(eid, [TbConflict]));
  });
  const isEncounter = createMemo(() => {
    const eid = props.entityId;
    if (!eid) return false;
    return Boolean(client.world.get(eid, [EncounterTemplate]));
  });
  return (
    <Switch
      fallback={
        <section class="flex h-full flex-col gap-3">
          <ConflictsHub tabId={props.tabId} fromEncounterId={null} />
        </section>
      }
    >
      <Match when={isConflict()}>
        <ConflictBoard conflictId={props.entityId as EntityId} />
      </Match>
      <Match when={isEncounter()}>
        <section class="flex h-full flex-col gap-3">
          <ConflictsHub
            tabId={props.tabId}
            fromEncounterId={props.entityId as EntityId}
          />
        </section>
      </Match>
    </Switch>
  );
}

/* -------------------------------------------------------------------------
 * Hub view — empty state + list + create form
 * ----------------------------------------------------------------------- */

function ConflictsHub(props: {
  tabId: string;
  /**
   * When set, the hub renders the declare form pre-filled from this
   * encounter template (type/location/enemies). The conflict list is
   * still shown above so the GM can see ongoing fights, but the form
   * is the primary affordance.
   */
  fromEncounterId: EntityId | null;
}): JSX.Element {
  const client = useClient();
  const me = useMe();
  const conflictRows = useQuery([TbConflict]);

  const conflicts = createMemo(() =>
    conflictRows()
      .map((row) => {
        const c = row.values.TbConflict as ReturnType<typeof TbConflict>["value"];
        return {
          id: row.id as EntityId,
          label:
            c.locationLabel ||
            `${TB_CONFLICT_TYPES[c.type].label} (round ${c.round})`,
          type: c.type,
          round: c.round,
          winner: c.winner,
          ended: c.endedAt !== null,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  const open = (id: EntityId): void => {
    client.dispatch(
      RetargetTab({
        tabId: props.tabId,
        pageKind: CONFLICT_PAGE_KIND,
        entityId: id,
      }) as CommandInstance,
    );
  };

  const isGm = (): boolean => me()?.role === "gm";

  return (
    <div class="flex h-full items-start justify-center overflow-y-auto py-10">
      <div class="flex w-full max-w-lg flex-col gap-6 px-5">
        <Show
          when={conflicts().length > 0}
          fallback={
            <div class="flex flex-col items-center gap-5 text-center">
              <p
                class="font-display text-2xl tracking-tight text-fg-muted"
                style={{ "font-family": "var(--font-display)" }}
              >
                No conflicts yet — declare the first one.
              </p>
              <Show
                when={me()}
                fallback={
                  <p class="text-xs text-fg-subtle">
                    sign in to declare a conflict…
                  </p>
                }
              >
                <Show
                  when={isGm()}
                  fallback={
                    <p class="text-xs text-fg-subtle">
                      only the GM can declare a conflict
                    </p>
                  }
                >
                  <DeclareConflictForm
                    tabId={props.tabId}
                    fromEncounterId={props.fromEncounterId}
                  />
                </Show>
              </Show>
            </div>
          }
        >
          <header class="flex items-baseline justify-between">
            <h2
              class="font-display text-xl tracking-tight text-fg"
              style={{ "font-family": "var(--font-display)" }}
            >
              Conflicts
            </h2>
            <span class="font-display text-[0.62rem] uppercase tracking-[0.16em] text-fg-subtle">
              {conflicts().length} total
            </span>
          </header>
          <ul class="flex flex-col gap-1">
            <For each={conflicts()}>
              {(c) => (
                <li class="group flex items-center gap-3 rounded-(--radius-control) border border-border-muted bg-surface-elevated px-3 py-2">
                  <button
                    type="button"
                    onClick={() => open(c.id)}
                    data-testid={`open-conflict-${c.id}`}
                    class="flex-1 truncate text-left text-sm text-fg hover:text-accent transition"
                    title={c.label}
                  >
                    <span class="font-display">{c.label}</span>
                    <span class="ml-2 text-fg-subtle">
                      · {TB_CONFLICT_TYPES[c.type as ConflictType].label} ·
                      round {c.round}
                      {c.winner ? ` · ${c.winner} won` : ""}
                      {c.ended ? " · ended" : ""}
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
          <Show when={isGm()}>
            <div class="mt-2 flex flex-col gap-3 border-t border-border-muted pt-5">
              <h3 class="font-display text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle">
                Declare a new conflict
              </h3>
              <DeclareConflictForm
                tabId={props.tabId}
                fromEncounterId={props.fromEncounterId}
              />
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Declare form
 * ----------------------------------------------------------------------- */

interface CharacterRow {
  readonly id: EntityId;
  readonly name: string;
  readonly team: "party" | "enemy";
}

function DeclareConflictForm(props: {
  tabId: string;
  /**
   * When set, the form pre-fills type/location/enemies from the
   * encounter template the GM clicked "Set up conflict" on. The
   * one-time seed runs in `onMount`; subsequent edits are owned by
   * the GM and don't snap back when the encounter template changes.
   */
  fromEncounterId: EntityId | null;
}): JSX.Element {
  const client = useClient();
  const charRows = useQuery([Character]);
  const teamRows = useQuery([Team]);
  // Subscribe to Active writes so the picker re-runs when a GM flips
  // an entity in/out of play. Read via isActive() per-row below.
  const activeRows = useQuery([Active]);

  const characters = createMemo<CharacterRow[]>(() => {
    const teams = new Map<EntityId, "party" | "enemy">();
    for (const r of teamRows()) {
      const t = r.values.Team as { kind: "party" | "enemy" };
      teams.set(r.id, t.kind);
    }
    activeRows();
    const out: CharacterRow[] = [];
    for (const r of charRows()) {
      // Hide entries the GM has marked inactive. The conflict-declare
      // form is the play surface; catalogs that materialise hundreds
      // of NPCs would otherwise flood the chip lists and the
      // switch-team scroller.
      if (!isActive(client.world, r.id)) continue;
      const c = r.values.Character as { name: string };
      out.push({
        id: r.id,
        name: c.name,
        team: teams.get(r.id) ?? "party",
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  });

  const toggleTeam = (c: CharacterRow): void => {
    const next = c.team === "party" ? "enemy" : "party";
    client.dispatch(
      SetField({
        characterId: c.id,
        trait: Team.name,
        path: ["kind"],
        value: next,
      }) as CommandInstance,
    );
    // If we just flipped a selected party or enemy out of its bucket,
    // drop it so the form stays consistent.
    if (next === "enemy" && partyIds().has(c.id)) {
      setPartyIds((cur) => {
        const n = new Set(cur);
        n.delete(c.id);
        return n;
      });
      if (captainId() === c.id) setCaptainId(null);
    }
    if (next === "party" && enemyIds().has(c.id)) {
      setEnemyCounts((cur) => {
        const n = new Map(cur);
        n.delete(c.id);
        return n;
      });
    }
  };

  const [type, setType] = createSignal<ConflictType>("kill");
  const [location, setLocation] = createSignal("");
  const [captainId, setCaptainId] = createSignal<EntityId | null>(null);
  const [partyIds, setPartyIds] = createSignal<Set<EntityId>>(new Set());

  const partyChars = createMemo(() =>
    characters().filter((c) => c.team === "party"),
  );
  const enemyChars = createMemo(() =>
    characters().filter((c) => c.team === "enemy"),
  );
  // Bestiary picker — pick a template + count, click Spawn, the
  // freshly-spawned character appears in the enemy list with the
  // requested count selected. Saves a roundtrip through the
  // Bestiary tab when declaring "throw 4 goblins at them".
  //
  // The picker is a typeahead: `bestiaryQuery` holds the typed text;
  // `bestiarySelected` is the committed pick (template id) used when
  // Spawn fires. `bestiaryQuery` and `bestiarySelected` are
  // independent so a user can keep editing the query without losing
  // their selection.
  const [bestiaryQuery, setBestiaryQuery] = createSignal("");
  const [bestiarySelected, setBestiarySelected] = createSignal<string | null>(
    TB_MONSTER_TEMPLATES[0]?.id ?? null,
  );
  const [bestiaryCount, setBestiaryCount] = createSignal<number>(1);
  const [bestiaryBusy, setBestiaryBusy] = createSignal(false);

  // Filter the catalog by the typed query. Subsequence-style fuzzy
  // match — see `filterCatalogByQuery` for details. Pulled out into a
  // shared helper so the bestiary home page uses the same matcher.
  const bestiaryCandidates = createMemo(() =>
    filterCatalogByQuery(bestiaryQuery()),
  );
  // Resolve the selected template's display label for the input's
  // placeholder + the chip alongside it. Falls back to "—" if the
  // selection has been cleared (e.g. typed a query that doesn't
  // match anything yet — Spawn stays disabled).
  const bestiarySelectedTemplate = createMemo(() =>
    TB_MONSTER_TEMPLATES.find((t) => t.id === bestiarySelected()) ?? null,
  );

  // NPC spawn-into-conflict state. Mirrors the bestiary state shape so
  // the inline picker reads as a sibling of the BestiarySpawnRow.
  const [npcQuery, setNpcQuery] = createSignal("");
  const [npcSelected, setNpcSelected] = createSignal<string | null>(
    TB_NPC_TEMPLATES[0]?.id ?? null,
  );
  const [npcCount, setNpcCount] = createSignal<number>(1);
  const [npcBusy, setNpcBusy] = createSignal(false);
  const npcCandidates = createMemo(() => filterNpcCatalogByQuery(npcQuery()));
  const npcSelectedTemplate = createMemo(
    () => TB_NPC_TEMPLATES.find((t) => t.id === npcSelected()) ?? null,
  );
  // Enemy is a multimap — characterId → count. Selecting a chip adds
  // it with count=1; the +/- stepper next to the chip lets the GM
  // bump it to 4 goblins. Unselecting removes the entry entirely.
  const [enemyCounts, setEnemyCounts] = createSignal<Map<EntityId, number>>(
    new Map(),
  );
  const enemyIds = createMemo(() => new Set(enemyCounts().keys()));
  const enemyTotalCount = createMemo(() => {
    let n = 0;
    for (const c of enemyCounts().values()) n += c;
    return n;
  });
  const [busy, setBusy] = createSignal(false);

  // One-time seed from the encounter template the GM clicked "Set up
  // conflict" on. Lifts everything the encounter already declares —
  // conflict type, location label, enemy roster (with quantities) —
  // so the only thing left for the GM at the table is picking which
  // party members are present and nominating a captain.
  //
  // Resolution rules:
  //   - Type: normalised via mapConflictType so the author-friendly
  //     "drive_off" form works alongside the canonical "driveOff".
  //   - Location: when locationRef.kind === "note" we resolve the
  //     referenced Note (by entity id first, then by case-insensitive
  //     title match) and use its current title. That way a renamed
  //     note shows the new title in the conflict label, and a
  //     wikilink-style body like `[[note:e123]]` displays the human
  //     title instead of the raw id.
  //   - Participants: resolved by case-insensitive Character.name
  //     lookup against the world. Only entities currently on the
  //     enemy Team get pre-filled into enemyCounts — encounter blocks
  //     can list PCs as a "party" side, and the GM picks party
  //     manually so we don't paint them into the enemy chips.
  //   - Each resolved enemy is auto-activated. Block-materialised
  //     monsters/NPCs default to inactive; without this dispatch the
  //     chip wouldn't render in `enemyChars()`. Same rationale as the
  //     bestiary inline-spawn flow.
  onMount(() => {
    const encounterId = props.fromEncounterId;
    if (!encounterId) return;
    const got = client.world.get(encounterId, [EncounterTemplate]) as
      | { EncounterTemplate: ReturnType<typeof EncounterTemplate>["value"] }
      | undefined;
    if (!got) return;
    const tmpl = got.EncounterTemplate;
    const mappedType = mapConflictType(tmpl.type);
    if (mappedType) setType(mappedType);
    setLocation(resolveLocationLabel(client.world, tmpl.locationRef));

    // Name lookup index — case-insensitive, covers every character
    // (PC, NPC, monster — they all carry the universal Character
    // trait by design). Used as the second-pass resolver after
    // entity-id lookup.
    const nameIndex = new Map<string, EntityId>();
    for (const row of client.world.query([Character])) {
      const v = row.values.Character as { name: string };
      nameIndex.set(v.name.toLowerCase(), row.id);
    }

    // Resolve a participant body to an entity id. The participant's
    // stored body is whatever `ParticipantSchema` produced — for new
    // encounters that's a clean entity id or name; for encounters
    // stored before the wiki-link peeler landed, the body can still
    // carry `]]` suffixes or `|alias` tails. `peelRef` makes the
    // resolver tolerant of both shapes without forcing a migration.
    //
    // Resolution order:
    //   1. Direct entity-id lookup (covers the canonical wiki-link
    //      form `[[npc:e667|Alchemist]]` once peeled).
    //   2. Case-insensitive Character.name match (covers legacy
    //      shorthand `- npc:Beekeeper`).
    const resolveParticipant = (rawBody: string): EntityId | null => {
      const body = peelRef(rawBody);
      if (client.world.has(body as EntityId)) {
        const got = client.world.get(body as EntityId, [Character]);
        if (got) return body as EntityId;
      }
      return nameIndex.get(body.toLowerCase()) ?? null;
    };

    const counts = new Map<EntityId, number>();
    for (const side of tmpl.sides) {
      for (const p of side.participants) {
        const resolved = resolveParticipant(p.body);
        if (!resolved) continue;
        // Skip non-enemy participants — the GM picks party manually
        // and an encounter that lists PCs on a "party" side shouldn't
        // poison the enemy chips. Default missing-trait to "party"
        // so unflagged entities (PCs created without a TB block)
        // don't accidentally appear as enemies.
        const teamTrait = client.world.get(resolved, [Team]) as
          | { Team: { kind: "party" | "enemy" } }
          | undefined;
        if ((teamTrait?.Team.kind ?? "party") !== "enemy") continue;
        const qty = p.quantity ?? 1;
        counts.set(resolved, (counts.get(resolved) ?? 0) + qty);
      }
    }
    if (counts.size > 0) {
      setEnemyCounts(counts);
      // Bring each resolved entity into play. The conflict-declare
      // picker filters chips by isActive(), and adventure-block
      // monsters default to inactive — without this dispatch the
      // chip wouldn't render at all.
      for (const id of counts.keys()) {
        client.dispatch(
          SetField({
            characterId: id,
            trait: Active.name,
            path: ["active"],
            value: true,
          }) as CommandInstance,
        );
      }
    }
  });

  const togglePartyMember = (id: EntityId): void => {
    setPartyIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) {
        next.delete(id);
        if (captainId() === id) setCaptainId(null);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  const toggleEnemyMember = (id: EntityId): void => {
    setEnemyCounts((cur) => {
      const next = new Map(cur);
      if (next.has(id)) next.delete(id);
      else next.set(id, 1);
      return next;
    });
  };

  const setEnemyCount = (id: EntityId, count: number): void => {
    const clamped = Math.max(1, Math.min(20, Math.floor(count)));
    setEnemyCounts((cur) => {
      const next = new Map(cur);
      if (next.has(id)) next.set(id, clamped);
      return next;
    });
  };

  /**
   * Spawn a fresh monster from the bestiary catalog and pre-select
   * it in the enemy list with the chosen count. The command itself
   * spawns ONE character entity; we just dial up `count` on the
   * enemy-counts map so DeclareConflict's expansion produces N rows
   * referencing it.
   */
  const spawnAndPickFromBestiary = (): void => {
    if (bestiaryBusy()) return;
    const tmplId = bestiarySelected();
    if (!tmplId) return;
    setBestiaryBusy(true);
    // Snapshot the existing monster ids so we can identify the new
    // one when the MonsterCreated event lands. The command's apply
    // allocates the id server-side, so we don't know it up-front.
    const beforeIds = new Set(
      client.world.query([Character, TbMonster]).map((r) => r.id as string),
    );
    const requestedCount = Math.max(1, Math.min(20, bestiaryCount()));
    const off = client.bus.on(MonsterCreated.name, () => {
      off();
      const fresh = client.world
        .query([Character, TbMonster])
        .find((r) => !beforeIds.has(r.id as string));
      if (fresh) {
        setEnemyCounts((cur) => {
          const next = new Map(cur);
          next.set(fresh.id as EntityId, requestedCount);
          return next;
        });
        // MonsterSpawningSystem defaults newly-created monsters to
        // inactive — library content shouldn't flood pickers — but
        // clicking Spawn from inside conflict-declare is the GM
        // explicitly bringing the monster into play. Auto-activate so
        // the chip appears in `enemyChars()` and the GM doesn't have
        // to bounce out to the Bestiary tab to flip a toggle.
        client.dispatch(
          SetField({
            characterId: fresh.id as EntityId,
            trait: Active.name,
            path: ["active"],
            value: true,
          }) as CommandInstance,
        );
      }
      setBestiaryBusy(false);
    });
    client.dispatch(
      CreateMonsterFromCatalog({ templateId: tmplId }) as CommandInstance,
    );
  };

  /**
   * Spawn a fresh NPC from the catalog and pre-select it in the enemy
   * list with the chosen count. Same shape as
   * `spawnAndPickFromBestiary` — the only differences are the events
   * we listen for, the trait we query, and the command we dispatch.
   */
  const spawnAndPickFromNpcCatalog = (): void => {
    if (npcBusy()) return;
    const tmplId = npcSelected();
    if (!tmplId) return;
    setNpcBusy(true);
    const beforeIds = new Set(
      client.world.query([Character, TbNpc]).map((r) => r.id as string),
    );
    const requestedCount = Math.max(1, Math.min(20, npcCount()));
    const off = client.bus.on(NpcCreated.name, () => {
      off();
      const fresh = client.world
        .query([Character, TbNpc])
        .find((r) => !beforeIds.has(r.id as string));
      if (fresh) {
        setEnemyCounts((cur) => {
          const next = new Map(cur);
          next.set(fresh.id as EntityId, requestedCount);
          return next;
        });
        // Inline conflict-declare spawn auto-activates — see the
        // monster spawn handler above for the rationale.
        client.dispatch(
          SetField({
            characterId: fresh.id as EntityId,
            trait: Active.name,
            path: ["active"],
            value: true,
          }) as CommandInstance,
        );
      }
      setNpcBusy(false);
    });
    client.dispatch(
      CreateNpcFromCatalog({ templateId: tmplId }) as CommandInstance,
    );
  };

  const canSubmit = createMemo(
    () =>
      partyIds().size > 0 &&
      enemyIds().size > 0 &&
      captainId() !== null &&
      partyIds().has(captainId() as EntityId) &&
      !busy(),
  );

  const submit = async (e: SubmitEvent): Promise<void> => {
    e.preventDefault();
    if (!canSubmit()) return;
    setBusy(true);
    const partyParticipants = [...partyIds()].map((id) => ({
      characterId: id,
      count: 1,
    }));
    const enemyParticipants = [...enemyCounts().entries()].map(
      ([id, count]) => ({ characterId: id, count }),
    );
    const before = new Set(
      client.world.query([TbConflict]).map((r) => r.id as string),
    );
    const handle = client.dispatch(
      DeclareConflict({
        type: type(),
        locationLabel: location(),
        captainCharacterId: captainId() as EntityId,
        partyParticipants,
        enemyParticipants,
      }) as CommandInstance,
    );
    try {
      await handle.ack;
      const newId = client.world
        .query([TbConflict])
        .map((r) => r.id as string)
        .find((id) => !before.has(id));
      if (newId) {
        client.dispatch(
          RetargetTab({
            tabId: props.tabId,
            pageKind: CONFLICT_PAGE_KIND,
            entityId: newId as EntityId,
          }) as CommandInstance,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      class="flex flex-col gap-3"
      data-testid="declare-conflict-form"
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      data-form-type="other"
    >
      <label class="grid grid-cols-[6rem,1fr] gap-2 items-center text-sm">
        <span class="text-xs uppercase tracking-wider text-fg-subtle">
          Type
        </span>
        <select
          value={type()}
          onChange={(e) => setType(e.currentTarget.value as ConflictType)}
          class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-sm text-fg"
          data-testid="declare-type"
        >
          <For each={ALL_CONFLICT_TYPES}>
            {(t) => <option value={t}>{TB_CONFLICT_TYPES[t].label}</option>}
          </For>
        </select>
      </label>
      <label class="grid grid-cols-[6rem,1fr] gap-2 items-center text-sm">
        <span class="text-xs uppercase tracking-wider text-fg-subtle">
          Location
        </span>
        <input
          type="text"
          value={location()}
          onInput={(e) => setLocation(e.currentTarget.value)}
          placeholder="e.g. Dread Crypt of Skogenby"
          class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          data-testid="declare-location"
          autocomplete="off"
          spellcheck={false}
          name="conflict-location"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
        />
      </label>

      <fieldset class="flex flex-col gap-2 border-0 p-0">
        <legend class="text-xs uppercase tracking-wider text-fg-subtle">
          Party ({partyIds().size}) · captain marked ★
        </legend>
        <Show
          when={partyChars().length > 0}
          fallback={
            <p class="text-xs text-fg-subtle italic">
              No party characters in this world. Create one in the
              Characters tab first.
            </p>
          }
        >
          <ul class="flex flex-wrap gap-1">
            <For each={partyChars()}>
              {(c) => (
                <li>
                <CharChip
                  c={c}
                  selected={partyIds().has(c.id)}
                  onToggle={() => togglePartyMember(c.id)}
                  badge={
                    captainId() === c.id ? (
                      <span aria-label="captain">★</span>
                    ) : partyIds().has(c.id) ? (
                      // Renders inside a selected (bg-accent) chip,
                      // so use accent-fg for legible white-on-green
                      // contrast — fg-subtle was unreadable.
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCaptainId(c.id);
                        }}
                        class="text-[0.65rem] underline text-accent-fg/80 hover:text-accent-fg"
                        data-testid={`make-captain-${c.id}`}
                      >
                        captain?
                      </button>
                    ) : null
                  }
                  testId={`party-chip-${c.id}`}
                />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </fieldset>

      <fieldset class="flex flex-col gap-2 border-0 p-0">
        <legend class="text-xs uppercase tracking-wider text-fg-subtle">
          Enemy ({enemyIds().size}/{enemyTotalCount()}) · enemy-team
          characters · count for groups (4 goblins, etc.)
        </legend>
        <Show
          when={enemyChars().length > 0}
          fallback={
            <p class="text-xs text-fg-subtle italic">
              No enemy-team characters yet. Use "Switch team" below to flip a
              character to the enemy side.
            </p>
          }
        >
          <ul class="flex flex-wrap gap-1">
            <For each={enemyChars()}>
              {(c) => (
                <li class="flex items-center gap-1">
                  <CharChip
                    c={c}
                    selected={enemyIds().has(c.id)}
                    onToggle={() => toggleEnemyMember(c.id)}
                    testId={`enemy-chip-${c.id}`}
                  />
                  <Show when={enemyIds().has(c.id)}>
                    <EnemyCountStepper
                      characterId={c.id}
                      count={enemyCounts().get(c.id) ?? 1}
                      onChange={(n) => setEnemyCount(c.id, n)}
                    />
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>

        {/* Spawn-from-bestiary inline picker. Lets the GM materialize
            a fresh monster mid-declare instead of bouncing to the
            Bestiary tab first. The freshly-spawned character is
            auto-selected with the chosen count. */}
        <BestiarySpawnRow
          query={bestiaryQuery}
          setQuery={setBestiaryQuery}
          selected={bestiarySelected}
          setSelected={setBestiarySelected}
          selectedTemplate={bestiarySelectedTemplate}
          candidates={bestiaryCandidates}
          count={bestiaryCount}
          setCount={setBestiaryCount}
          busy={bestiaryBusy}
          onSpawn={spawnAndPickFromBestiary}
        />

        {/* Spawn-from-NPC-catalog inline picker. Same shape as the
            bestiary row above; lets the GM declare "two bandits and a
            soldier" without leaving the conflict-declare form. */}
        <NpcSpawnRow
          query={npcQuery}
          setQuery={setNpcQuery}
          selected={npcSelected}
          setSelected={setNpcSelected}
          selectedTemplate={npcSelectedTemplate}
          candidates={npcCandidates}
          count={npcCount}
          setCount={setNpcCount}
          busy={npcBusy}
          onSpawn={spawnAndPickFromNpcCatalog}
        />
      </fieldset>

      <fieldset class="flex flex-col gap-1 border-t border-border-muted pt-2">
        <legend class="text-xs uppercase tracking-wider text-fg-subtle">
          Switch team
        </legend>
        <p class="text-[0.7rem] text-fg-subtle">
          Flip a character between the party and enemy teams (e.g. to make an
          NPC monster an enemy).
        </p>
        <Show
          when={characters().length > 0}
          fallback={
            <p class="text-xs text-fg-subtle italic">
              No characters yet. Create one in the Characters tab.
            </p>
          }
        >
          <ul class="flex flex-col gap-0.5 text-xs max-h-40 overflow-y-auto">
            <For each={characters()}>
              {(c) => (
                <li class="flex items-center gap-2">
                  <span class="flex-1 text-fg">{c.name}</span>
                  <span class="font-mono text-fg-subtle text-[0.7rem]">
                    {c.team}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleTeam(c)}
                    data-testid={`toggle-team-${c.id}`}
                    class="rounded-(--radius-control) border border-border-muted bg-surface-elevated px-2 py-0.5 text-[0.7rem] hover:border-accent"
                    title={`Move to ${c.team === "party" ? "enemy" : "party"} side`}
                  >
                    → {c.team === "party" ? "enemy" : "party"}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </fieldset>

      <button
        type="submit"
        disabled={!canSubmit()}
        data-testid="declare-submit"
        class="rounded-(--radius-control) border border-border bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy() ? "Declaring…" : "Declare conflict"}
      </button>
      <p class="text-[0.7rem] text-fg-subtle">
        Pick at least one party, designate a captain, and pick at least one
        enemy.
      </p>
    </form>
  );
}

/**
 * Resolve an encounter template's `locationRef` to the label string
 * the GM should see in the declare form. Behaviour:
 *
 *   - null → empty string (no location).
 *   - kind === "note": try entity-id lookup first (so a wikilink
 *     body like `e123` resolves to the note's *current* title even
 *     after a rename), then fall back to case-insensitive title
 *     match against every Note entity, then finally fall back to
 *     the raw body string when nothing resolves.
 *   - other kinds (e.g. "scene"): use the body verbatim. Resolving
 *     scenes / books / other entity kinds would require importing
 *     each kind's identity trait; the body string is what the GM
 *     typed and is a reasonable default until those resolvers land.
 */
function resolveLocationLabel(
  world: import("@vtt/substrate").World,
  ref: { kind: string; body: string } | null,
): string {
  if (!ref) return "";
  // Defensive peel for encounters stored before the projection's
  // wiki-link peeler landed: those have `kind = "[[note"`, `body =
  // "e720|Goblin Cave]]"`. Strip both halves so the resolver below
  // sees a clean entity id or title.
  const cleanKind = peelRef(ref.kind);
  const cleanBody = peelRef(ref.body);
  if (cleanKind !== "note") return cleanBody;
  // Direct entity-id lookup first — the parser accepts both
  // `note:Bywater Bridge` and `note:e123` body forms.
  if (world.has(cleanBody as EntityId)) {
    const got = world.get(cleanBody as EntityId, [Note]) as
      | { Note: { title: string } }
      | undefined;
    if (got) return got.Note.title;
  }
  // Title-match fallback. Case-insensitive so the GM doesn't have to
  // copy capitalisation exactly when authoring the encounter.
  const needle = cleanBody.toLowerCase();
  for (const row of world.query([Note])) {
    const v = row.values.Note as { title: string };
    if (v.title.toLowerCase() === needle) return v.title;
  }
  return cleanBody;
}

function CharChip(props: {
  c: CharacterRow;
  selected: boolean;
  onToggle: () => void;
  badge?: JSX.Element;
  testId: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onToggle}
      data-testid={props.testId}
      class="rounded-(--radius-control) border px-2 py-1 text-xs flex items-center gap-1 transition"
      classList={{
        "border-accent bg-accent text-accent-fg": props.selected,
        "border-border-muted bg-surface text-fg hover:border-accent":
          !props.selected,
      }}
    >
      <span>{props.c.name}</span>
      {props.badge}
    </button>
  );
}

/**
 * Per-enemy count stepper. Sits next to a selected enemy CharChip
 * so the GM can dial in "4 goblins" without separate AddParticipants
 * round-trips. Range 1..20 (the schema's hard cap).
 */
function EnemyCountStepper(props: {
  characterId: EntityId;
  count: number;
  onChange: (next: number) => void;
}): JSX.Element {
  return (
    <span
      class="inline-flex items-center gap-0.5 rounded-(--radius-control) border border-border-muted bg-surface-elevated px-1 py-0.5 text-[0.7rem]"
      data-testid={`enemy-count-${props.characterId}`}
    >
      <button
        type="button"
        onClick={() => props.onChange(Math.max(1, props.count - 1))}
        disabled={props.count <= 1}
        class="px-1 text-fg-muted hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="decrement"
        data-testid={`enemy-count-dec-${props.characterId}`}
      >
        −
      </button>
      <span
        class="min-w-[1ch] text-center tabular-nums font-mono text-fg"
        data-testid={`enemy-count-value-${props.characterId}`}
      >
        {props.count}
      </span>
      <button
        type="button"
        onClick={() => props.onChange(Math.min(20, props.count + 1))}
        disabled={props.count >= 20}
        class="px-1 text-fg-muted hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="increment"
        data-testid={`enemy-count-inc-${props.characterId}`}
      >
        +
      </button>
    </span>
  );
}

/**
 * Inline bestiary picker row inside the conflict-declare form.
 * Combobox-style: typing filters the catalog with a subsequence
 * fuzzy match, clicking a candidate commits the selection, the
 * count input dials the participant multiplier, the Spawn button
 * dispatches CreateMonsterFromCatalog and the spawn handler
 * pre-selects the resulting character with the requested count.
 *
 * Lifted into its own component so the createMemo / signals it
 * needs (filtered candidates, "is dropdown open") don't pollute
 * the larger DeclareConflictForm scope. State is owned by the
 * parent and passed in as accessor / setter pairs — keeps the
 * spawn handler colocated with the rest of the form.
 */
/**
 * Bestiary spawn picker. Replaces the prior combobox with a
 * persistent card-list rack: search filters the visible cards
 * inline, the selected creature is shouted via an inverted accent
 * surface + a thick rail on the leading edge + a chevron marker, and
 * the footer button reads as a verb-on-target ("Conjure 4 × Goblin →")
 * so the GM can see exactly what they're about to commit.
 *
 * The list is always visible — no open/closed state, no floating
 * dropdown. Filtering shrinks the rack; selection re-paints one row
 * in solid accent. Stats render in JetBrains Mono for the
 * stat-block tone; names use the display face. Selection is
 * keyboard-navigable (↑/↓ to step through filtered candidates,
 * Enter to commit, Esc to clear).
 */
function BestiarySpawnRow(props: {
  query: () => string;
  setQuery: (next: string) => void;
  selected: () => string | null;
  setSelected: (next: string | null) => void;
  selectedTemplate: () =>
    | {
        id: string;
        name: string;
        nature: { rating: number };
        might: number;
        type: string;
      }
    | null;
  candidates: () => ReadonlyArray<{
    id: string;
    name: string;
    nature: { rating: number };
    might: number;
    type: string;
  }>;
  count: () => number;
  setCount: (next: number) => void;
  busy: () => boolean;
  onSpawn: () => void;
}): JSX.Element {
  // Roving selection inside the filtered list — arrow keys move the
  // selected card up/down through whatever's currently visible. The
  // selection survives a query change as long as the card still
  // matches; otherwise we fall through to the first candidate.
  const moveSelection = (dir: 1 | -1): void => {
    const list = props.candidates();
    if (list.length === 0) return;
    const cur = props.selected();
    const idx = list.findIndex((t) => t.id === cur);
    if (idx === -1) {
      const next = dir === 1 ? list[0]! : list[list.length - 1]!;
      props.setSelected(next.id);
      return;
    }
    const nextIdx = (idx + dir + list.length) % list.length;
    props.setSelected(list[nextIdx]!.id);
  };

  // Selection auto-heals when the search trims it out. Without this
  // the user can type a query that excludes the current selection
  // and the spawn button stays "armed" with a creature they can't
  // see — confusing. createMemo runs synchronously after the query
  // signal updates so the heal lands in the same render frame.
  createMemo(() => {
    const list = props.candidates();
    const cur = props.selected();
    if (list.length === 0) return;
    if (cur && list.some((t) => t.id === cur)) return;
    props.setSelected(list[0]!.id);
  });

  const stepCount = (delta: 1 | -1): void => {
    const next = Math.max(1, Math.min(20, props.count() + delta));
    if (next !== props.count()) props.setCount(next);
  };

  return (
    <div
      class="relative mt-2"
      data-testid="declare-bestiary-picker"
      style={{
        "border-top": "1px solid var(--color-border-muted)",
        "padding-top": "0.85rem",
      }}
    >
      {/* Section header — small caps display type, with a manuscript
          ornament + a live count. Sits flush left so the rack reads
          as a single labeled object. */}
      <div class="flex items-baseline justify-between mb-2">
        <h3
          class="flex items-baseline gap-2"
          style={{
            "font-family": "var(--font-display)",
            "font-size": "0.68rem",
            "letter-spacing": "0.22em",
            "text-transform": "uppercase",
            color: "var(--color-fg)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              color: "var(--color-accent)",
              "font-size": "0.85rem",
              transform: "translateY(-0.05em)",
            }}
          >
            ❦
          </span>
          Bestiary
        </h3>
        <span
          class="tabular-nums"
          style={{
            "font-family": "var(--font-mono)",
            "font-size": "0.65rem",
            color: "var(--color-fg-subtle)",
          }}
        >
          {props.candidates().length} / {TB_MONSTER_TEMPLATES.length}
        </span>
      </div>

      {/* Search input — sits ABOVE the always-visible card rack, not
          AS the picker. Filters in place; clearing the query restores
          the full catalog. */}
      <div class="relative mb-1.5">
        <span
          aria-hidden="true"
          class="absolute left-2 top-1/2 -translate-y-1/2"
          style={{
            "font-family": "var(--font-mono)",
            "font-size": "0.7rem",
            color: "var(--color-fg-subtle)",
            "letter-spacing": "0.05em",
          }}
        >
          ▸
        </span>
        <input
          type="text"
          value={props.query()}
          placeholder="filter by name…"
          onInput={(e) => props.setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              moveSelection(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              moveSelection(-1);
            } else if (e.key === "Enter" && props.selected()) {
              e.preventDefault();
              if (!props.busy()) props.onSpawn();
            } else if (e.key === "Escape") {
              props.setQuery("");
            }
          }}
          class="w-full rounded-(--radius-control) outline-none transition-colors"
          style={{
            "padding-left": "1.6rem",
            "padding-right": props.query().length > 0 ? "1.8rem" : "0.55rem",
            "padding-top": "0.4rem",
            "padding-bottom": "0.4rem",
            "background-color": "var(--color-surface-sunken, var(--color-surface))",
            "border": "1px solid var(--color-border-muted)",
            "font-family": "var(--font-display)",
            "font-size": "0.85rem",
            color: "var(--color-fg)",
          }}
          onFocus={(e) => {
            (e.currentTarget as HTMLInputElement).style.borderColor =
              "var(--color-accent)";
          }}
          onBlur={(e) => {
            (e.currentTarget as HTMLInputElement).style.borderColor =
              "var(--color-border-muted)";
          }}
          data-testid="declare-bestiary-input"
          autocomplete="off"
          spellcheck={false}
          name="conflict-bestiary"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          disabled={props.busy()}
        />
        <Show when={props.query().length > 0}>
          <button
            type="button"
            onClick={() => props.setQuery("")}
            aria-label="clear filter"
            class="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm px-1.5 py-0.5 hover:opacity-100 transition-opacity"
            style={{
              "font-family": "var(--font-mono)",
              "font-size": "0.7rem",
              color: "var(--color-fg-subtle)",
              opacity: "0.6",
            }}
          >
            ×
          </button>
        </Show>
      </div>

      {/* The rack itself. Cards always rendered; selection paints one
          row inverted with a thick accent rail. Compact: ~2.6rem per
          row, ~5 rows visible without scrolling. */}
      <Show
        when={props.candidates().length > 0}
        fallback={
          <div
            class="flex items-center justify-center text-center py-4"
            style={{
              "border": "1px dashed var(--color-border-muted)",
              "border-radius": "var(--radius-control)",
              "background-color":
                "var(--color-surface-sunken, var(--color-surface))",
            }}
            data-testid="declare-bestiary-empty"
          >
            <span
              style={{
                "font-family": "var(--font-display)",
                "font-size": "0.78rem",
                color: "var(--color-fg-subtle)",
                "font-style": "italic",
              }}
            >
              no creature matches “{props.query()}”
            </span>
          </div>
        }
      >
        <BestiaryRack
          candidates={props.candidates}
          selected={props.selected}
          setSelected={props.setSelected}
          query={props.query}
        />
      </Show>

      {/* Footer: count stepper + dynamic spawn button. The button
          label is the verb-on-target ("Conjure 4 × Goblin →") so
          the GM can see exactly what's queued before clicking. */}
      <div
        class="mt-2 flex items-stretch gap-1.5"
        style={{ "min-height": "2.1rem" }}
      >
        <div
          class="flex items-stretch overflow-hidden"
          style={{
            "border": "1px solid var(--color-border-muted)",
            "border-radius": "var(--radius-control)",
            "background-color":
              "var(--color-surface-sunken, var(--color-surface))",
          }}
        >
          <button
            type="button"
            onClick={() => stepCount(-1)}
            disabled={props.busy() || props.count() <= 1}
            aria-label="decrement count"
            class="px-2 transition-colors hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              "font-family": "var(--font-mono)",
              "font-size": "0.95rem",
              color: "var(--color-fg-muted)",
              "border-right": "1px solid var(--color-border-muted)",
            }}
          >
            −
          </button>
          <input
            type="number"
            min="1"
            max="20"
            value={props.count()}
            onInput={(e) => {
              const v = Number.parseInt(e.currentTarget.value, 10);
              if (Number.isFinite(v)) {
                props.setCount(Math.max(1, Math.min(20, v)));
              }
            }}
            class="text-center bg-transparent outline-none tabular-nums"
            style={{
              "font-family": "var(--font-mono)",
              "font-size": "0.85rem",
              width: "2.4rem",
              color: "var(--color-fg)",
            }}
            data-testid="declare-bestiary-count"
            disabled={props.busy()}
          />
          <button
            type="button"
            onClick={() => stepCount(1)}
            disabled={props.busy() || props.count() >= 20}
            aria-label="increment count"
            class="px-2 transition-colors hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              "font-family": "var(--font-mono)",
              "font-size": "0.95rem",
              color: "var(--color-fg-muted)",
              "border-left": "1px solid var(--color-border-muted)",
            }}
          >
            +
          </button>
        </div>

        <button
          type="button"
          onClick={() => props.onSpawn()}
          disabled={props.busy() || !props.selected()}
          data-testid="declare-bestiary-spawn"
          class="flex-1 transition-all rounded-(--radius-control) flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            "background-color": props.busy()
              ? "var(--color-surface-elevated)"
              : "var(--color-accent)",
            color: "var(--color-accent-fg)",
            "font-family": "var(--font-display)",
            "font-size": "0.78rem",
            "letter-spacing": "0.08em",
            "text-transform": "uppercase",
            "font-weight": 600,
            padding: "0 0.9rem",
            border: "1px solid var(--color-accent)",
          }}
          onMouseEnter={(e) => {
            if (props.busy() || !props.selected()) return;
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              "var(--color-accent-hover, var(--color-accent))";
          }}
          onMouseLeave={(e) => {
            if (props.busy() || !props.selected()) return;
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              "var(--color-accent)";
          }}
        >
          <Show when={!props.busy()} fallback={<span>Conjuring…</span>}>
            <Show
              when={props.selectedTemplate()}
              fallback={<span>Pick a creature</span>}
            >
              <span>
                Conjure{" "}
                <span class="tabular-nums" style={{ "font-family": "var(--font-mono)" }}>
                  {props.count()}
                </span>{" "}
                ×{" "}
                <span style={{ "letter-spacing": "0.04em" }}>
                  {props.selectedTemplate()!.name}
                </span>
              </span>
              <span aria-hidden="true">→</span>
            </Show>
          </Show>
        </button>
      </div>

      {/* Helper line. Small, italic, sits just below the action so the
          GM has the rules-of-engagement in their peripheral vision. */}
      <p
        class="mt-1.5"
        style={{
          "font-family": "var(--font-display)",
          "font-size": "0.65rem",
          "font-style": "italic",
          color: "var(--color-fg-subtle)",
          "letter-spacing": "0.02em",
        }}
      >
        Materializes one character on the bestiary; expanded into{" "}
        <span class="tabular-nums" style={{ "font-family": "var(--font-mono)", "font-style": "normal" }}>
          {props.count()}
        </span>{" "}
        participant rows on declare.
      </p>
    </div>
  );
}

/**
 * Inline spawn-from-NPC-catalog picker. Mirrors `BestiarySpawnRow`
 * exactly — same search input, same rack, same count stepper, same
 * "Conjure N × Soldier →" verb-on-target footer button — but reads
 * from `TB_NPC_TEMPLATES` and dispatches `CreateNpcFromCatalog`.
 *
 * Lets the GM declare "two bandits and a soldier" mid-declare without
 * bouncing to the NPCs tab first. The freshly-spawned character is
 * auto-selected on the enemy side with the requested count.
 */
function NpcSpawnRow(props: {
  query: () => string;
  setQuery: (next: string) => void;
  selected: () => string | null;
  setSelected: (next: string | null) => void;
  selectedTemplate: () =>
    | {
        id: string;
        name: string;
        role: string;
        sourceBook: string;
        sourcePage: number | null;
      }
    | null;
  candidates: () => ReadonlyArray<{
    id: string;
    name: string;
    role: string;
    sourceBook: "DH" | "LMM" | "SG" | "Unknown";
    sourcePage: number | null;
    pageRef: { canonicalId: string; page: number };
  }>;
  count: () => number;
  setCount: (next: number) => void;
  busy: () => boolean;
  onSpawn: () => void;
}): JSX.Element {
  const moveSelection = (dir: 1 | -1): void => {
    const list = props.candidates();
    if (list.length === 0) return;
    const cur = props.selected();
    const idx = list.findIndex((t) => t.id === cur);
    if (idx === -1) {
      const next = dir === 1 ? list[0]! : list[list.length - 1]!;
      props.setSelected(next.id);
      return;
    }
    const nextIdx = (idx + dir + list.length) % list.length;
    props.setSelected(list[nextIdx]!.id);
  };

  createMemo(() => {
    const list = props.candidates();
    const cur = props.selected();
    if (list.length === 0) return;
    if (cur && list.some((t) => t.id === cur)) return;
    props.setSelected(list[0]!.id);
  });

  const stepCount = (delta: 1 | -1): void => {
    const next = Math.max(1, Math.min(20, props.count() + delta));
    if (next !== props.count()) props.setCount(next);
  };

  return (
    <div
      class="relative mt-2"
      data-testid="declare-npc-picker"
      style={{
        "border-top": "1px solid var(--color-border-muted)",
        "padding-top": "0.85rem",
      }}
    >
      <div class="flex items-baseline justify-between mb-2">
        <h3
          class="flex items-baseline gap-2"
          style={{
            "font-family": "var(--font-display)",
            "font-size": "0.68rem",
            "letter-spacing": "0.22em",
            "text-transform": "uppercase",
            color: "var(--color-fg)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              color: "var(--color-accent)",
              "font-size": "0.85rem",
              transform: "translateY(-0.05em)",
            }}
          >
            ❦
          </span>
          NPCs
        </h3>
        <span
          class="tabular-nums"
          style={{
            "font-family": "var(--font-mono)",
            "font-size": "0.65rem",
            color: "var(--color-fg-subtle)",
          }}
        >
          {props.candidates().length} / {TB_NPC_TEMPLATES.length}
        </span>
      </div>

      <div class="relative mb-1.5">
        <span
          aria-hidden="true"
          class="absolute left-2 top-1/2 -translate-y-1/2"
          style={{
            "font-family": "var(--font-mono)",
            "font-size": "0.7rem",
            color: "var(--color-fg-subtle)",
            "letter-spacing": "0.05em",
          }}
        >
          ▸
        </span>
        <input
          type="text"
          value={props.query()}
          placeholder="filter NPCs by name or role…"
          onInput={(e) => props.setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              moveSelection(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              moveSelection(-1);
            } else if (e.key === "Enter" && props.selected()) {
              e.preventDefault();
              if (!props.busy()) props.onSpawn();
            } else if (e.key === "Escape") {
              props.setQuery("");
            }
          }}
          class="w-full rounded-(--radius-control) outline-none transition-colors"
          style={{
            "padding-left": "1.6rem",
            "padding-right": props.query().length > 0 ? "1.8rem" : "0.55rem",
            "padding-top": "0.4rem",
            "padding-bottom": "0.4rem",
            "background-color":
              "var(--color-surface-sunken, var(--color-surface))",
            border: "1px solid var(--color-border-muted)",
            "font-family": "var(--font-display)",
            "font-size": "0.85rem",
            color: "var(--color-fg)",
          }}
          onFocus={(e) => {
            (e.currentTarget as HTMLInputElement).style.borderColor =
              "var(--color-accent)";
          }}
          onBlur={(e) => {
            (e.currentTarget as HTMLInputElement).style.borderColor =
              "var(--color-border-muted)";
          }}
          data-testid="declare-npc-input"
          autocomplete="off"
          spellcheck={false}
          name="conflict-npc"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          disabled={props.busy()}
        />
        <Show when={props.query().length > 0}>
          <button
            type="button"
            onClick={() => props.setQuery("")}
            aria-label="clear filter"
            class="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm px-1.5 py-0.5 hover:opacity-100 transition-opacity"
            style={{
              "font-family": "var(--font-mono)",
              "font-size": "0.7rem",
              color: "var(--color-fg-subtle)",
              opacity: "0.6",
            }}
          >
            ×
          </button>
        </Show>
      </div>

      <Show
        when={props.candidates().length > 0}
        fallback={
          <div
            class="flex items-center justify-center text-center py-4"
            style={{
              border: "1px dashed var(--color-border-muted)",
              "border-radius": "var(--radius-control)",
              "background-color":
                "var(--color-surface-sunken, var(--color-surface))",
            }}
            data-testid="declare-npc-empty"
          >
            <span
              style={{
                "font-family": "var(--font-display)",
                "font-size": "0.78rem",
                color: "var(--color-fg-subtle)",
                "font-style": "italic",
              }}
            >
              no NPC matches “{props.query()}”
            </span>
          </div>
        }
      >
        <NpcRack
          candidates={props.candidates}
          selected={props.selected}
          setSelected={props.setSelected}
          query={props.query}
          testid="declare-npc-options"
          rowTestidPrefix="declare-npc-option"
        />
      </Show>

      <div
        class="mt-2 flex items-stretch gap-1.5"
        style={{ "min-height": "2.1rem" }}
      >
        <div
          class="flex items-stretch overflow-hidden"
          style={{
            border: "1px solid var(--color-border-muted)",
            "border-radius": "var(--radius-control)",
            "background-color":
              "var(--color-surface-sunken, var(--color-surface))",
          }}
        >
          <button
            type="button"
            onClick={() => stepCount(-1)}
            disabled={props.busy() || props.count() <= 1}
            aria-label="decrement count"
            class="px-2 transition-colors hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              "font-family": "var(--font-mono)",
              "font-size": "0.95rem",
              color: "var(--color-fg-muted)",
              "border-right": "1px solid var(--color-border-muted)",
            }}
          >
            −
          </button>
          <input
            type="number"
            min="1"
            max="20"
            value={props.count()}
            onInput={(e) => {
              const v = Number.parseInt(e.currentTarget.value, 10);
              if (Number.isFinite(v)) {
                props.setCount(Math.max(1, Math.min(20, v)));
              }
            }}
            class="text-center bg-transparent outline-none tabular-nums"
            style={{
              "font-family": "var(--font-mono)",
              "font-size": "0.85rem",
              width: "2.4rem",
              color: "var(--color-fg)",
            }}
            data-testid="declare-npc-count"
            disabled={props.busy()}
          />
          <button
            type="button"
            onClick={() => stepCount(1)}
            disabled={props.busy() || props.count() >= 20}
            aria-label="increment count"
            class="px-2 transition-colors hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              "font-family": "var(--font-mono)",
              "font-size": "0.95rem",
              color: "var(--color-fg-muted)",
              "border-left": "1px solid var(--color-border-muted)",
            }}
          >
            +
          </button>
        </div>

        <button
          type="button"
          onClick={() => props.onSpawn()}
          disabled={props.busy() || !props.selected()}
          data-testid="declare-npc-spawn"
          class="flex-1 transition-all rounded-(--radius-control) flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            "background-color": props.busy()
              ? "var(--color-surface-elevated)"
              : "var(--color-accent)",
            color: "var(--color-accent-fg)",
            "font-family": "var(--font-display)",
            "font-size": "0.78rem",
            "letter-spacing": "0.08em",
            "text-transform": "uppercase",
            "font-weight": 600,
            padding: "0 0.9rem",
            border: "1px solid var(--color-accent)",
          }}
          onMouseEnter={(e) => {
            if (props.busy() || !props.selected()) return;
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              "var(--color-accent-hover, var(--color-accent))";
          }}
          onMouseLeave={(e) => {
            if (props.busy() || !props.selected()) return;
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              "var(--color-accent)";
          }}
        >
          <Show when={!props.busy()} fallback={<span>Conjuring…</span>}>
            <Show
              when={props.selectedTemplate()}
              fallback={<span>Pick an NPC</span>}
            >
              <span>
                Conjure{" "}
                <span
                  class="tabular-nums"
                  style={{ "font-family": "var(--font-mono)" }}
                >
                  {props.count()}
                </span>{" "}
                ×{" "}
                <span style={{ "letter-spacing": "0.04em" }}>
                  {props.selectedTemplate()!.name}
                </span>{" "}
                →
              </span>
            </Show>
          </Show>
        </button>
      </div>

      <p
        class="mt-1.5 text-[0.65rem]"
        style={{
          "font-family": "var(--font-display)",
          "font-style": "italic",
          color: "var(--color-fg-subtle)",
          "letter-spacing": "0.02em",
        }}
      >
        Materializes one character on the NPCs tab; expanded into{" "}
        <span
          class="tabular-nums"
          style={{ "font-family": "var(--font-mono)", "font-style": "normal" }}
        >
          {props.count()}
        </span>{" "}
        participant rows on declare.
      </p>
    </div>
  );
}


/* -------------------------------------------------------------------------
 * Live board
 * ----------------------------------------------------------------------- */

/**
 * Live board for one conflict. Slim, data-driven layout:
 *
 *   - TopStripe: type, location, round, end-conflict (GM)
 *   - Two TeamColumns side-by-side: per-side dispo input, roster
 *     with HP + weapon edit, inline scripting + lock
 *   - ResolutionRow between/below: matchup hint + reveal-next
 *   - ActionMatrix / WeaponPanel / ArmorPanel / ConditionsPanel as
 *     reference panels below the fold
 *   - DamageDistributor pop-in when overflow needs distribution
 *   - CompromisePanel when the conflict ends in compromise
 *
 * Every component subscribes to its own slice via useTrait/useQuery
 * (passing `conflictId` as a stable string, never a snapshotted
 * value object). That's why the board reacts to remote dispo / HP
 * / phase / script updates.
 */
function ConflictBoard(props: { conflictId: EntityId }): JSX.Element {
  const conflict = useConflict(props.conflictId);
  const partyScript = useScript(props.conflictId, "party");
  const enemyScript = useScript(props.conflictId, "enemy");
  const me = useMe();
  const isGm = (): boolean => me()?.role === "gm";

  const matrixHighlight = createMemo(() => {
    const c = conflict();
    if (!c) return undefined;
    const partyS = partyScript();
    const enemyS = enemyScript();
    if (!partyS || !enemyS) return undefined;
    const idx = Math.max(0, c.revealIndex - 1);
    const partySlot = partyS.slots[idx];
    const enemySlot = enemyS.slots[idx];
    if (
      partySlot?.status === "revealed" &&
      enemySlot?.status === "revealed"
    ) {
      return {
        partyAction: partySlot.action,
        enemyAction: enemySlot.action,
      };
    }
    return undefined;
  });

  return (
    <Show
      when={conflict()}
      fallback={
        <p class="text-fg-subtle italic px-5 py-4">
          Conflict not found or no longer visible.
        </p>
      }
    >
      <div class="flex h-full flex-col overflow-y-auto bg-surface text-fg">
        <TopStripe conflictId={props.conflictId} />
        {/* Parent owns 4 row tracks — header, dispo, roster, script —
            and each TeamColumn opts into them via `grid-template-rows:
            subgrid`. Both columns share the same row heights, so
            DISPOSITION, the roster band, and SCRIPT all line up across
            sides even when one side has 1 participant and the other
            has 7. The smaller side simply gets empty space below its
            roster, which is the cost of alignment. */}
        <div
          class="grid"
          style={{
            "grid-template-columns": "1fr 1fr",
            "grid-template-rows": "auto auto auto auto",
          }}
          data-testid="team-columns"
        >
          <TeamColumn
            conflictId={props.conflictId}
            side="party"
            title="Party"
          />
          <TeamColumn
            conflictId={props.conflictId}
            side="enemy"
            title="Enemy"
          />
        </div>
        <ResolutionRow conflictId={props.conflictId} />
        <ActionMatrix highlight={matrixHighlight()} />
        <div data-testid="combat-aids">
          <WeaponPanel
            conflictId={props.conflictId}
            side="party"
            title="Party Weapons"
          />
          <ArmorSidePanel
            conflictId={props.conflictId}
            side="party"
            title="Party Armor"
          />
          {/* Enemy weapon + armor possibilities are GM-only — players
              still see what the enemy *declared* via the dropdown
              binding on each row, but the full possibility tables are
              GM information. */}
          <Show when={isGm()}>
            <WeaponPanel
              conflictId={props.conflictId}
              side="enemy"
              title="Enemy Weapons"
            />
            <ArmorSidePanel
              conflictId={props.conflictId}
              side="enemy"
              title="Enemy Armor"
            />
          </Show>
          {/* Shared catalog conflict-resource weapons (Blackmail,
              Hostage, True Name, Maps, …). Visible to everyone: the
              menu of abstract weapons is identical for both sides
              and useful as table reference. */}
          <ConflictWeaponsReference conflictId={props.conflictId} />
          <ArmorRulesLegend />
        </div>
        <ConditionsPanel conflictId={props.conflictId} />
        <Show
          when={
            conflict()?.winner !== null && conflict()?.endedAt === null
          }
        >
          <CompromisePanel conflictId={props.conflictId} />
        </Show>
        <Show when={conflict()?.endedAt !== null}>
          <p
            class="px-5 py-4 font-display text-lg uppercase tracking-wider text-fg"
            data-testid="conflict-ended-banner"
          >
            {conflict()?.winner
              ? `${conflict()?.winner} won.`
              : "Conflict ended."}
          </p>
        </Show>
        <span class="px-5 py-2 text-[0.65rem] text-fg-subtle font-mono">
          conflict {props.conflictId}
        </span>
      </div>
    </Show>
  );
}
