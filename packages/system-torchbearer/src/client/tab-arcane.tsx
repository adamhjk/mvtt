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

import {
  qualifiedName,
  type EntityId,
} from "@vtt/substrate";
import { kit } from "@vtt/characters/client";
import type { CharacterSheetTab } from "@vtt/characters/shared";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { EditItemField, ItemIdentity } from "@vtt/items/shared";
import { TbContainer } from "../shared/items/index.js";
import { RuleRef } from "./rule-ref.js";
import {
  createMemo,
  createSignal,
  For,
  Show,
  type JSX,
} from "solid-js";
import {
  AddSpellToBook,
  AddSpellToLibrary,
  ClearMemoryPalace,
  FillMemoryPalace,
  RemoveSpellFromBook,
  RemoveSpellFromLibrary,
  ScribeSpellToScroll,
  SetMemoryPalaceCapacity,
  SpellCastRollable,
  SpellIdentity,
  TbCarries,
  TbLibrary,
  TbMemoryPalace,
  TbScroll,
  TbSpellBook,
  type SpellCircle,
} from "../shared/index.js";
import { OpenPendingRoll } from "@vtt/characters/shared";
import { MemoryPalaceStrip } from "./memory-palace-strip.js";
import { SpellCard } from "./spell-card.js";
import { SpellPicker, useSpellCatalog } from "./spell-picker.js";

/**
 * Open the standard pending-roll panel for a spell cast. Identical
 * roll infrastructure to every other TB roll — the panel mounts, the
 * player adds Help / wises / persona dice / channel-nature / etc.,
 * and clicks Commit. The only difference is `opts.spellCast` (carried
 * through the rollable into `spec.spellCast`) so the chat row's
 * post-roll commit buttons fire (Consume from palace / Burn folio /
 * Burn scroll).
 */
function openSpellCast(
  client: ReturnType<typeof useClient>,
  characterId: string,
  spellId: string,
  source:
    | { kind: "palace" }
    | { kind: "spellbook"; bookId: string }
    | { kind: "scroll"; scrollId: string },
): void {
  client.dispatch(
    OpenPendingRoll({
      initiatorCharacterId: characterId as EntityId,
      rollableName: SpellCastRollable.name,
      opts: { spellId, source },
    }),
  );
}

/**
 * Set of item entity ids the character is "live-carrying" — anywhere
 * in their inventory tree (own slots + every container they're
 * carrying, recursively), excluding entries flagged dropped or lost.
 *
 * Mirrors the reachability walk in `tab-inventory.tsx`'s Missing zone.
 * Reactive on every `TbCarries` write across the world (the inventory
 * tree's structure changes), and on the character's own carries
 * specifically (the `state` flags). Spell books and scrolls aren't
 * spatial — they're inventory-scoped — so the section list is
 * "anywhere in inventory that isn't on the floor or lost."
 */
function useLiveCarriedItemIds(
  characterId: string,
): () => ReadonlySet<string> {
  const client = useClient();
  const allCarries = useQuery([TbCarries]);
  return createMemo<ReadonlySet<string>>(() => {
    void allCarries();
    const out = new Set<string>();
    const visited = new Set<string>([characterId]);
    const visit = (holderId: string): void => {
      const got = client.world.get(holderId as never, [TbCarries]) as
        | {
            TbCarries: {
              entries: ReadonlyArray<{
                itemId: string;
                state?: { dropped?: boolean; lost?: boolean };
              }>;
            };
          }
        | undefined;
      if (!got) return;
      for (const e of got.TbCarries.entries) {
        if (e.state?.dropped || e.state?.lost) continue;
        out.add(e.itemId);
        if (
          client.world.get(e.itemId as never, [TbContainer]) &&
          !visited.has(e.itemId)
        ) {
          visited.add(e.itemId);
          visit(e.itemId);
        }
      }
    };
    visit(characterId);
    return out;
  });
}

/**
 * "Arcane" tab — Memory Palace + Spell Books + Scrolls + Library +
 * Relics. Mounted unconditionally for the shape pass; a future
 * slot-level `visible(args)` predicate will hide the tab entirely
 * for non-casters.
 */
function ArcaneTab(props: { characterId: string }): JSX.Element {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}>
      <kit.SheetSection title="Memory Palace">
        <MemoryPalaceSection characterId={props.characterId} />
      </kit.SheetSection>

      <kit.SheetSection title="Spell Books">
        <SpellBooksSection characterId={props.characterId} />
      </kit.SheetSection>

      <kit.SheetSection title="Scrolls">
        <ScrollsSection characterId={props.characterId} />
      </kit.SheetSection>

      <kit.SheetSection title="Library">
        <LibrarySection characterId={props.characterId} />
      </kit.SheetSection>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Memory Palace
 * ----------------------------------------------------------------------- */

function MemoryPalaceSection(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const palace = useTrait(props.characterId, TbMemoryPalace);
  const memorized = createMemo(() => palace()?.memorized ?? []);
  const canEdit = kit.useCanEdit(props.characterId);
  const [memorizeOpen, setMemorizeOpen] = createSignal(false);

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "0.6rem" }}>
      <p style={{ "font-size": "0.85rem", color: "var(--color-fg-muted)", margin: 0, display: "flex", gap: "0.4rem", "align-items": "center", "flex-wrap": "wrap" }}>
        <span>
          The aetherial matrix in your mind. Memorize spells from your spell
          books in town or camp; cast them by clicking on a slot.
        </span>
        <RuleRef book="DH" page={89} />
        <RuleRef book="DH" page={90} />
      </p>
      <MemoryPalaceStrip characterId={props.characterId} />
      <Show when={memorized().length > 0}>
        <ul
          data-testid="memorized-list"
          style={{
            "list-style": "none",
            padding: 0,
            margin: 0,
            display: "flex",
            "flex-direction": "column",
            gap: "0.35rem",
          }}
        >
          <For each={memorized()}>
            {(slot) => (
              <li>
                <SpellCard
                  spellId={slot.spellId}
                  status={() =>
                    slot.cast ? (
                      <span
                        style={{
                          "font-size": "0.7rem",
                          color: "var(--color-fg-muted)",
                          "font-style": "italic",
                        }}
                      >
                        already cast
                      </span>
                    ) : null
                  }
                  actions={() => (
                    <button
                      type="button"
                      data-testid={`cast-from-palace-${slot.spellId}`}
                      disabled={slot.cast || !canEdit()}
                      onClick={() =>
                        openSpellCast(
                          client,
                          props.characterId,
                          slot.spellId,
                          { kind: "palace" },
                        )
                      }
                      style={btnStyle(slot.cast)}
                    >
                      Cast from palace
                    </button>
                  )}
                />
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div style={{ display: "flex", gap: "0.4rem", "flex-wrap": "wrap" }}>
        <button
          type="button"
          data-testid="open-memorize"
          disabled={!canEdit()}
          onClick={() => setMemorizeOpen((v) => !v)}
          style={btnStyle(false)}
        >
          {memorizeOpen() ? "Close memorize" : "Memorize…"}
        </button>
        <button
          type="button"
          data-testid="discharge-palace"
          disabled={!canEdit() || memorized().length === 0}
          onClick={() =>
            client.dispatch(
              ClearMemoryPalace({ characterId: props.characterId as EntityId }),
            )
          }
          style={btnStyle(memorized().length === 0)}
        >
          Discharge (empty palace)
        </button>
        <Show when={canEdit()}>
          <SetCapacityControl characterId={props.characterId} />
        </Show>
      </div>
      <Show when={memorizeOpen()}>
        <MemorizeDialog
          characterId={props.characterId}
          onClose={() => setMemorizeOpen(false)}
        />
      </Show>
    </div>
  );
}

function SetCapacityControl(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const palace = useTrait(props.characterId, TbMemoryPalace);
  const [editing, setEditing] = createSignal(false);
  const [value, setValue] = createSignal(palace()?.capacity ?? 0);
  return (
    <Show
      when={editing()}
      fallback={
        <button
          type="button"
          data-testid="set-capacity"
          onClick={() => {
            setValue(palace()?.capacity ?? 0);
            setEditing(true);
          }}
          style={btnStyle(false)}
        >
          Set capacity ({palace()?.capacity ?? 0})
        </button>
      }
    >
      <span style={{ display: "inline-flex", gap: "0.3rem", "align-items": "center" }}>
        <input
          type="number"
          value={value()}
          min={0}
          max={20}
          onInput={(e) => setValue(parseInt(e.currentTarget.value, 10) || 0)}
          style={{
            width: "4rem",
            padding: "0.3rem",
            "border-radius": "var(--radius-control)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-fg)",
          }}
        />
        <button
          type="button"
          data-testid="capacity-save"
          onClick={() => {
            client.dispatch(
              SetMemoryPalaceCapacity({
                characterId: props.characterId as EntityId,
                capacity: value(),
              }),
            );
            setEditing(false);
          }}
          style={btnStyle(false)}
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          style={btnStyle(false)}
        >
          Cancel
        </button>
      </span>
    </Show>
  );
}

/* -------------------------------------------------------------------------
 * Memorize dialog
 * ----------------------------------------------------------------------- */

function MemorizeDialog(props: {
  characterId: string;
  onClose: () => void;
}): JSX.Element {
  const client = useClient();
  const palace = useTrait(props.characterId, TbMemoryPalace);
  const liveCarried = useLiveCarriedItemIds(props.characterId);
  const lib = useTrait(props.characterId, TbLibrary);
  const [picks, setPicks] = createSignal<ReadonlyArray<string>>([]);
  // Memorize candidates: every spell in (a) any carried spell book,
  // and (b) the character's at-home library. RAW p.92 reads strictly
  // as "spells in the spell books in their inventory" but in
  // practice players want a single picker that shows what they
  // actually have access to — at home or in the field. The library
  // is included with a source tag so the player can tell which is
  // which. (When you're physically away from home, the library
  // entries gray out — see the notes in the source markup below.)
  const bookContents = useQuery([TbSpellBook]);
  type SpellSource = "book" | "library";
  const candidatesWithSource = createMemo<
    ReadonlyArray<{ spellId: string; source: SpellSource }>
  >(() => {
    const carriedSet = liveCarried();
    const seen = new Set<string>();
    const out: Array<{ spellId: string; source: SpellSource }> = [];
    for (const row of bookContents()) {
      if (!carriedSet.has(row.id)) continue;
      const v = row.values.TbSpellBook as { contents: string[] };
      for (const sid of v.contents) {
        if (seen.has(sid)) continue;
        seen.add(sid);
        out.push({ spellId: sid, source: "book" });
      }
    }
    for (const sid of lib()?.spellIds ?? []) {
      if (seen.has(sid)) continue;
      seen.add(sid);
      out.push({ spellId: sid, source: "library" });
    }
    return out;
  });
  const candidateSpellIds = createMemo<ReadonlyArray<string>>(() =>
    candidatesWithSource().map((c) => c.spellId),
  );
  const sourceById = createMemo(() => {
    const map = new Map<string, SpellSource>();
    for (const c of candidatesWithSource()) map.set(c.spellId, c.source);
    return map;
  });
  const identityRows = useQuery([SpellIdentity]);
  const identityById = createMemo(() => {
    const map = new Map<string, { name: string; circle: SpellCircle }>();
    for (const row of identityRows()) {
      const v = row.values.SpellIdentity as { name: string; circle: SpellCircle };
      map.set(row.id, { name: v.name, circle: v.circle });
    }
    return map;
  });
  const slotsUsed = createMemo(() => {
    const map = identityById();
    let total = 0;
    for (const id of picks()) {
      total += map.get(id)?.circle ?? 0;
    }
    return total;
  });
  const capacity = createMemo(() => palace()?.capacity ?? 0);
  const overCapacity = createMemo(() => slotsUsed() > capacity());
  const memorized = createMemo(() => palace()?.memorized.length ?? 0);
  const loreMasterOb = createMemo(() => slotsUsed() + memorized());
  const palaceFilled = createMemo(() => (palace()?.memorized.length ?? 0) > 0);
  const togglePick = (id: string) => {
    setPicks((cur) =>
      cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id],
    );
  };

  return (
    <div
      data-testid="memorize-dialog"
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.5rem",
        padding: "0.6rem",
        "border-radius": "var(--radius-control)",
        background: "var(--color-surface-elevated)",
        border: "1px solid var(--color-border)",
      }}
    >
      <p
        style={{
          "font-size": "0.8rem",
          color: "var(--color-fg-muted)",
          margin: 0,
          display: "flex",
          gap: "0.4rem",
          "align-items": "center",
          "flex-wrap": "wrap",
        }}
      >
        <span>
          Pick spells from your spell books. Sum of circles ≤ palace
          capacity ({capacity()}). Lore Master Ob = sum of circles + 1
          per spell already in palace.
        </span>
        <RuleRef book="DH" page={90} />
      </p>
      <Show
        when={candidateSpellIds().length > 0}
        fallback={
          <p
            style={{
              "font-size": "0.8rem",
              color: "var(--color-fg-muted)",
              "font-style": "italic",
              margin: 0,
            }}
          >
            no spell books in inventory — equip a spell book first.
          </p>
        }
      >
        <ul
          style={{
            "list-style": "none",
            padding: 0,
            margin: 0,
            display: "flex",
            "flex-direction": "column",
            gap: "0.25rem",
          }}
        >
          <For each={candidateSpellIds()}>
            {(sid) => {
              const ident = identityById().get(sid);
              return (
                <li>
                  <label
                    style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "0.4rem",
                      "font-size": "0.8rem",
                    }}
                  >
                    <input
                      type="checkbox"
                      data-testid={`memorize-pick-${sid}`}
                      checked={picks().includes(sid)}
                      onChange={() => togglePick(sid)}
                    />
                    <span>{ident?.name ?? "Unknown"}</span>
                    <span
                      style={{
                        color: "var(--color-fg-muted)",
                        "font-size": "0.7rem",
                      }}
                    >
                      circle {ident?.circle ?? "?"}
                    </span>
                    <span
                      style={{
                        "margin-left": "auto",
                        "font-size": "0.65rem",
                        color:
                          sourceById().get(sid) === "library"
                            ? "var(--color-accent)"
                            : "var(--color-fg-muted)",
                        padding: "0 0.3rem",
                        "border-radius": "var(--radius-control)",
                        background:
                          sourceById().get(sid) === "library"
                            ? "var(--color-accent-soft)"
                            : "transparent",
                      }}
                      title={
                        sourceById().get(sid) === "library"
                          ? "From your library (RAW p.92 strictly requires the spell book; included here for accessibility)"
                          : "From a carried spell book"
                      }
                    >
                      {sourceById().get(sid) === "library" ? "library" : "book"}
                    </span>
                  </label>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
      <div
        style={{
          "font-size": "0.75rem",
          color: overCapacity() ? "var(--color-fg-error)" : "var(--color-fg-muted)",
        }}
      >
        Slots: {slotsUsed()} / {capacity()} {overCapacity() ? "— over capacity" : ""} ·
        Lore Master Ob: {loreMasterOb()}
      </div>
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <button
          type="button"
          data-testid="memorize-commit"
          disabled={
            picks().length === 0 ||
            overCapacity() ||
            palaceFilled()
          }
          onClick={() => {
            // Direct dispatch: the Arcane tab is a manager, not a
            // rule-enforcer. The Ob calculation is shown to the
            // player as informational (the GM may ask for a Lore
            // Master roll separately if their table runs strict
            // RAW). See the pending-roll panel — clicking the Lore
            // Master skill on the sheet still works for that.
            client.dispatch(
              FillMemoryPalace({
                characterId: props.characterId as EntityId,
                picks: picks().map((sid) => ({ spellId: sid as EntityId })),
              }),
            );
            props.onClose();
          }}
          style={btnStyle(picks().length === 0 || overCapacity() || palaceFilled())}
        >
          Memorize
        </button>
        <button type="button" onClick={props.onClose} style={btnStyle(false)}>
          Cancel
        </button>
      </div>
      <Show when={palaceFilled()}>
        <p
          style={{
            "font-size": "0.7rem",
            color: "var(--color-fg-error)",
            margin: 0,
            display: "flex",
            gap: "0.4rem",
            "align-items": "center",
            "flex-wrap": "wrap",
          }}
        >
          <span>Discharge the palace first — refilling requires uninterrupted time.</span>
          <RuleRef book="DH" page={90} />
        </p>
      </Show>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Spell Books
 * ----------------------------------------------------------------------- */

function SpellBooksSection(props: { characterId: string }): JSX.Element {
  const liveCarried = useLiveCarriedItemIds(props.characterId);
  const bookRows = useQuery([TbSpellBook]);
  const booksHeld = createMemo<ReadonlyArray<string>>(() => {
    const carriedSet = liveCarried();
    const result: string[] = [];
    for (const row of bookRows()) {
      if (carriedSet.has(row.id)) result.push(row.id);
    }
    return result;
  });
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "0.6rem" }}>
      <p style={{ "font-size": "0.85rem", color: "var(--color-fg-muted)", margin: 0, display: "flex", gap: "0.4rem", "align-items": "center", "flex-wrap": "wrap" }}>
        <span>
          Your portable spell collection. Each book has 5 folios; a spell
          consumes folios equal to its circle. Use a spell book to memorize,
          or cast directly from one (burns the folio). Scribing from your
          library uses a Scholar test (the spell's scribe Ob).
        </span>
        <RuleRef book="DH" page={92} />
        <RuleRef book="DH" page={93} />
      </p>
      <Show
        when={booksHeld().length > 0}
        fallback={
          <p
            style={{
              "font-size": "0.8rem",
              "font-style": "italic",
              color: "var(--color-fg-muted)",
              margin: 0,
            }}
          >
            no spell books carried — pick one up via Inventory.
          </p>
        }
      >
        <ul
          data-testid="spell-books-list"
          style={{
            "list-style": "none",
            padding: 0,
            margin: 0,
            display: "flex",
            "flex-direction": "column",
            gap: "0.6rem",
          }}
        >
          <For each={booksHeld()}>
            {(bid) => (
              <li>
                <SpellBookCard characterId={props.characterId} bookId={bid} />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function SpellBookCard(props: {
  characterId: string;
  bookId: string;
}): JSX.Element {
  const client = useClient();
  const ident = useTrait(props.bookId, ItemIdentity);
  const book = useTrait(props.bookId, TbSpellBook);
  const canEdit = kit.useCanEdit(props.characterId);
  const [adding, setAdding] = createSignal(false);
  // Default: pick from library (the common path — RAW p.92). Toggle
  // to "all" to show the full catalog (for chargen, homebrew, or
  // cases where the GM is filling a book with a spell the player
  // hasn't libraried yet).
  const [pickerScope, setPickerScope] = createSignal<"library" | "all">("library");
  const folios = createMemo(() => book()?.folios ?? 5);
  const contents = createMemo(() => book()?.contents ?? []);
  const identityRows = useQuery([SpellIdentity]);
  const identityById = createMemo(() => {
    const map = new Map<string, { name: string; circle: SpellCircle }>();
    for (const row of identityRows()) {
      const v = row.values.SpellIdentity as { name: string; circle: SpellCircle };
      map.set(row.id, { name: v.name, circle: v.circle });
    }
    return map;
  });
  const usedFolios = createMemo(() => {
    let used = 0;
    for (const sid of contents()) {
      used += identityById().get(sid)?.circle ?? 0;
    }
    return used;
  });
  const excludeIds = createMemo(() => new Set(contents()));
  // Source list for the "+ Scribe spell into book" picker. RAW p.92:
  // copying spells from library to spell book is personal business
  // in town. The library is the natural source; we filter the full
  // catalog down to spell ids the player has in their library.
  const lib = useTrait(props.characterId, TbLibrary);
  const catalog = useSpellCatalog();
  const libraryCandidates = createMemo(() => {
    const libIds = new Set(lib()?.spellIds ?? []);
    return catalog().filter((c) => libIds.has(c.id));
  });
  // Active candidate list: library by default, full catalog when the
  // user toggles "show all". Both lists exclude what's already in
  // the book.
  const activeCandidates = createMemo(() =>
    pickerScope() === "library" ? libraryCandidates() : catalog(),
  );
  return (
    <div
      data-testid={`spell-book-${props.bookId}`}
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.4rem",
        padding: "0.5rem 0.7rem",
        "border-radius": "var(--radius-control)",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border-muted)",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "0.5rem",
          "font-size": "0.85rem",
          "font-weight": "500",
        }}
      >
        <span>📕</span>
        <SpellBookNameField
          bookId={props.bookId}
          name={() => ident()?.name ?? "Spell book"}
          canEdit={canEdit()}
        />
        <span
          style={{
            "margin-left": "auto",
            "font-size": "0.7rem",
            color: "var(--color-fg-muted)",
            "font-variant-numeric": "tabular-nums",
          }}
        >
          {usedFolios()} / {folios()} folios
        </span>
      </div>
      <Show
        when={contents().length > 0}
        fallback={
          <p
            style={{
              "font-size": "0.75rem",
              "font-style": "italic",
              color: "var(--color-fg-muted)",
              margin: 0,
            }}
          >
            empty book — add spells from your library.
          </p>
        }
      >
        <ul
          style={{
            "list-style": "none",
            padding: 0,
            margin: 0,
            display: "flex",
            "flex-direction": "column",
            gap: "0.3rem",
          }}
        >
          <For each={contents()}>
            {(sid) => (
              <li>
                <SpellCard
                  spellId={sid}
                  testid={`book-${props.bookId}-spell-${sid}`}
                  actions={() => (
                    <>
                      <button
                        type="button"
                        data-testid={`cast-from-book-${props.bookId}-${sid}`}
                        disabled={!canEdit()}
                        onClick={() =>
                          openSpellCast(
                            client,
                            props.characterId,
                            sid,
                            { kind: "spellbook", bookId: props.bookId },
                          )
                        }
                        style={btnStyle(false)}
                      >
                        Cast from book
                      </button>
                      <button
                        type="button"
                        data-testid={`copy-to-library-${props.bookId}-${sid}`}
                        disabled={!canEdit()}
                        onClick={() =>
                          client.dispatch(
                            AddSpellToLibrary({
                              characterId: props.characterId as EntityId,
                              spellId: sid as EntityId,
                            }),
                          )
                        }
                        style={btnStyle(false)}
                      >
                        Copy → library
                      </button>
                      <button
                        type="button"
                        data-testid={`remove-from-book-${props.bookId}-${sid}`}
                        disabled={!canEdit()}
                        onClick={() =>
                          client.dispatch(
                            RemoveSpellFromBook({
                              bookId: props.bookId as EntityId,
                              spellId: sid as EntityId,
                            }),
                          )
                        }
                        style={btnStyle(false)}
                      >
                        Remove
                      </button>
                    </>
                  )}
                />
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={canEdit()}>
        <Show
          when={adding()}
          fallback={
            <button
              type="button"
              data-testid={`open-add-to-book-${props.bookId}`}
              onClick={() => setAdding(true)}
              style={{ ...btnStyle(false), "align-self": "flex-start" }}
            >
              + Scribe spell into book
            </button>
          }
        >
          <div
            style={{
              display: "flex",
              "flex-direction": "column",
              gap: "0.4rem",
              padding: "0.5rem",
              "border-radius": "var(--radius-control)",
              background: "var(--color-surface-elevated)",
              border: "1px dashed var(--color-border)",
            }}
          >
            {/* Scope toggle: library (default) ↔ full catalog. */}
            <div
              style={{
                display: "flex",
                gap: "0.4rem",
                "align-items": "center",
                "font-size": "0.7rem",
                color: "var(--color-fg-muted)",
              }}
            >
              <span>Source:</span>
              <button
                type="button"
                data-testid={`book-add-scope-library-${props.bookId}`}
                onClick={() => setPickerScope("library")}
                style={scopeBtnStyle(pickerScope() === "library")}
              >
                Library ({libraryCandidates().length})
              </button>
              <button
                type="button"
                data-testid={`book-add-scope-all-${props.bookId}`}
                onClick={() => setPickerScope("all")}
                style={scopeBtnStyle(pickerScope() === "all")}
              >
                All spells ({catalog().length})
              </button>
            </div>
            <SpellPicker
              selected={() => null}
              setSelected={() => {}}
              candidates={activeCandidates}
              excludeIds={excludeIds}
              placeholder={
                pickerScope() === "library"
                  ? "Search your library…"
                  : "Search all spells…"
              }
              testid={`book-add-picker-${props.bookId}`}
              onRowAdd={(sid) =>
                client.dispatch(
                  AddSpellToBook({
                    bookId: props.bookId as EntityId,
                    spellId: sid as EntityId,
                  }),
                )
              }
            />
            <Show
              when={
                pickerScope() === "library" && libraryCandidates().length === 0
              }
            >
              <p
                style={{
                  "font-size": "0.7rem",
                  color: "var(--color-fg-muted)",
                  "font-style": "italic",
                  margin: 0,
                }}
              >
                Your library is empty — switch to “All spells” above, or add
                spells to your library first.
              </p>
            </Show>
            <button
              type="button"
              data-testid={`close-add-to-book-${props.bookId}`}
              onClick={() => setAdding(false)}
              style={{ ...btnStyle(false), "align-self": "flex-start" }}
            >
              Close
            </button>
          </div>
        </Show>
      </Show>
    </div>
  );
}

/**
 * Inline rename for a spell book's `ItemIdentity.name`. Click the
 * name to edit; commits via `EditItemField`. The same write
 * propagates to the Inventory tab's display because the inventory
 * row reads `ItemIdentity` live (per the project's
 * "no-snapshotting-derivable-state" rule).
 */
function SpellBookNameField(props: {
  bookId: string;
  name: () => string;
  canEdit: boolean;
}): JSX.Element {
  const client = useClient();
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  return (
    <Show
      when={editing()}
      fallback={
        <span
          role={props.canEdit ? "button" : undefined}
          data-testid={`spellbook-name-${props.bookId}`}
          onClick={() => {
            if (!props.canEdit) return;
            setDraft(props.name());
            setEditing(true);
          }}
          style={{
            cursor: props.canEdit ? "text" : "default",
            "border-bottom": props.canEdit
              ? "1px dashed var(--color-border-muted)"
              : "none",
            padding: "0 0.1rem",
          }}
          title={props.canEdit ? "Click to rename" : undefined}
        >
          {props.name()}
        </span>
      }
    >
      <input
        type="text"
        value={draft()}
        autocomplete="off"
        data-1p-ignore="true"
        data-lpignore="true"
        data-bwignore="true"
        data-form-type="other"
        spellcheck={false}
        data-testid={`spellbook-name-input-${props.bookId}`}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const next = draft().trim();
            if (next.length > 0 && next !== props.name()) {
              client.dispatch(
                EditItemField({
                  itemId: props.bookId as EntityId,
                  path: "ItemIdentity.name",
                  value: next,
                }),
              );
            }
            setEditing(false);
          } else if (e.key === "Escape") {
            setEditing(false);
          }
        }}
        onBlur={() => {
          const next = draft().trim();
          if (next.length > 0 && next !== props.name()) {
            client.dispatch(
              EditItemField({
                itemId: props.bookId as EntityId,
                path: "ItemIdentity.name",
                value: next,
              }),
            );
          }
          setEditing(false);
        }}
        style={{
          padding: "0.2rem 0.4rem",
          "border-radius": "var(--radius-control)",
          border: "1px solid var(--color-accent)",
          background: "var(--color-surface-elevated)",
          color: "var(--color-fg)",
          "font-size": "0.85rem",
          "font-weight": "500",
          "min-width": "12rem",
        }}
      />
    </Show>
  );
}

/* -------------------------------------------------------------------------
 * Scrolls
 * ----------------------------------------------------------------------- */

function ScrollsSection(props: { characterId: string }): JSX.Element {
  const liveCarried = useLiveCarriedItemIds(props.characterId);
  const scrollRows = useQuery([TbScroll]);
  const scrollsHeld = createMemo<ReadonlyArray<string>>(() => {
    const carriedSet = liveCarried();
    const out: string[] = [];
    for (const row of scrollRows()) {
      if (!carriedSet.has(row.id)) continue;
      const v = row.values.TbScroll as { consumed: boolean };
      if (v.consumed) continue;
      out.push(row.id);
    }
    return out;
  });
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
      <p style={{ "font-size": "0.85rem", color: "var(--color-fg-muted)", margin: 0, display: "flex", gap: "0.4rem", "align-items": "center", "flex-wrap": "wrap" }}>
        <span>
          Single-use spells. Casting from a scroll uses the same Arcanist
          roll as casting from memory; the scroll burns on success. Scribing
          a scroll uses a Scholar test against the spell's scribe Ob and
          requires the spell memorized.
        </span>
        <RuleRef book="DH" page={95} />
      </p>
      <Show
        when={scrollsHeld().length > 0}
        fallback={
          <p
            style={{
              "font-size": "0.8rem",
              "font-style": "italic",
              color: "var(--color-fg-muted)",
              margin: 0,
            }}
          >
            no scrolls in inventory.
          </p>
        }
      >
        <ul
          data-testid="scrolls-list"
          style={{
            "list-style": "none",
            padding: 0,
            margin: 0,
            display: "flex",
            "flex-direction": "column",
            gap: "0.4rem",
          }}
        >
          <For each={scrollsHeld()}>
            {(scrollId) => (
              <li>
                <ScrollCard
                  characterId={props.characterId}
                  scrollId={scrollId}
                />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function ScrollCard(props: {
  characterId: string;
  scrollId: string;
}): JSX.Element {
  const client = useClient();
  const scroll = useTrait(props.scrollId, TbScroll);
  const canEdit = kit.useCanEdit(props.characterId);
  const spellId = createMemo(() => scroll()?.spellId ?? null);
  return (
    <Show
      when={spellId()}
      fallback={
        <BlankScrollCard
          characterId={props.characterId}
          scrollId={props.scrollId}
          canEdit={canEdit()}
        />
      }
    >
      {(sid) => (
        <SpellCard
          spellId={sid()}
          testid={`scroll-${props.scrollId}`}
          status={() => (
            <span
              style={{
                "font-size": "0.7rem",
                color: "var(--color-fg-muted)",
              }}
            >
              📜 scroll
            </span>
          )}
          actions={() => (
            <>
              <button
                type="button"
                data-testid={`cast-from-scroll-${props.scrollId}`}
                disabled={!canEdit()}
                onClick={() =>
                  openSpellCast(
                    client,
                    props.characterId,
                    sid(),
                    { kind: "scroll", scrollId: props.scrollId },
                  )
                }
                style={btnStyle(false)}
              >
                Cast from scroll
              </button>
              <button
                type="button"
                data-testid={`copy-scroll-to-library-${props.scrollId}`}
                disabled={!canEdit()}
                onClick={() =>
                  client.dispatch(
                    AddSpellToLibrary({
                      characterId: props.characterId as EntityId,
                      spellId: sid() as EntityId,
                    }),
                  )
                }
                style={btnStyle(false)}
              >
                Copy → library
              </button>
            </>
          )}
        />
      )}
    </Show>
  );
}

/**
 * Blank-scroll fallback. Shows a Scribe affordance: pick a spell
 * from the player's library or memory palace; on commit, dispatches
 * `ScribeSpellToScroll` (RAW DH p.95). Scribing from the palace
 * removes the spell from the palace (RAW p.90 — "ways to remove a
 * spell from the memory palace: casting, scribing as a scroll,
 * temerarious discharge").
 */
function BlankScrollCard(props: {
  characterId: string;
  scrollId: string;
  canEdit: boolean;
}): JSX.Element {
  const client = useClient();
  const [adding, setAdding] = createSignal(false);
  const [pickedSpellId, setPickedSpellId] = createSignal<string | null>(null);
  const lib = useTrait(props.characterId, TbLibrary);
  const palace = useTrait(props.characterId, TbMemoryPalace);
  // Available sources: spells in the library + uncast spells in the
  // memory palace. Each option records its source so the dispatch
  // knows whether to consume from the palace.
  type Option = { id: string; source: "library" | "palace" };
  const options = createMemo<ReadonlyArray<Option>>(() => {
    const out: Option[] = [];
    const seen = new Set<string>();
    for (const sid of palace()?.memorized ?? []) {
      if (sid.cast) continue;
      if (seen.has(sid.spellId)) continue;
      seen.add(sid.spellId);
      out.push({ id: sid.spellId, source: "palace" });
    }
    for (const sid of lib()?.spellIds ?? []) {
      if (seen.has(sid)) continue;
      seen.add(sid);
      out.push({ id: sid, source: "library" });
    }
    return out;
  });
  const optionSourceById = createMemo(() => {
    const m = new Map<string, "library" | "palace">();
    for (const o of options()) m.set(o.id, o.source);
    return m;
  });
  // Limit the picker's catalog to the spell ids the player can scribe
  // from. The picker reads SpellCatalogIndex globally; pass an
  // explicit candidate list rather than excluding the rest.
  const scribeCandidates = useSpellCatalog();
  const scribeCandidatesFiltered = createMemo(() => {
    const allowed = new Set(options().map((o) => o.id));
    return scribeCandidates().filter((c) => allowed.has(c.id));
  });
  return (
    <div
      data-testid={`blank-scroll-${props.scrollId}`}
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.4rem",
        padding: "0.4rem 0.55rem",
        "border-radius": "var(--radius-control)",
        background: "var(--color-surface-elevated)",
        border: "1px dashed var(--color-border)",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "0.5rem",
          "font-size": "0.8rem",
          color: "var(--color-fg-muted)",
          "font-style": "italic",
        }}
      >
        📜 blank scroll
        <Show when={props.canEdit}>
          <button
            type="button"
            data-testid={`open-scribe-scroll-${props.scrollId}`}
            disabled={options().length === 0}
            onClick={() => {
              setPickedSpellId(null);
              setAdding((v) => !v);
            }}
            style={{
              ...btnStyle(options().length === 0),
              "margin-left": "auto",
            }}
          >
            {adding() ? "Cancel" : "Scribe spell"}
          </button>
        </Show>
      </div>
      <Show when={options().length === 0 && props.canEdit}>
        <span
          style={{
            "font-size": "0.7rem",
            color: "var(--color-fg-muted)",
          }}
        >
          No spells available — memorize from a spell book or add one to your
          library first.
        </span>
      </Show>
      <Show when={adding() && props.canEdit}>
        <SpellPicker
          selected={pickedSpellId}
          setSelected={setPickedSpellId}
          candidates={scribeCandidatesFiltered}
          placeholder="Search library / palace…"
          testid={`scribe-picker-${props.scrollId}`}
        />
        <div
          style={{
            "font-size": "0.7rem",
            color: "var(--color-fg-muted)",
            display: "flex",
            gap: "0.4rem",
            "align-items": "center",
            "flex-wrap": "wrap",
          }}
        >
          <Show when={pickedSpellId()}>
            {(sid) => {
              const source = optionSourceById().get(sid()) ?? "library";
              return (
                <>
                  <span>Source: {source}</span>
                  <Show when={source === "palace"}>
                    <span>— scribing will remove it from your palace</span>
                    <RuleRef book="DH" page={90} />
                  </Show>
                </>
              );
            }}
          </Show>
        </div>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <button
            type="button"
            data-testid={`scribe-commit-${props.scrollId}`}
            disabled={pickedSpellId() === null}
            onClick={() => {
              const sid = pickedSpellId();
              if (!sid) return;
              const source = optionSourceById().get(sid) ?? "library";
              client.dispatch(
                ScribeSpellToScroll({
                  characterId: props.characterId as EntityId,
                  scrollId: props.scrollId as EntityId,
                  spellId: sid as EntityId,
                  source,
                }),
              );
              setAdding(false);
              setPickedSpellId(null);
            }}
            style={btnStyle(pickedSpellId() === null)}
          >
            Scribe
          </button>
        </div>
      </Show>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Library
 * ----------------------------------------------------------------------- */

function LibrarySection(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const lib = useTrait(props.characterId, TbLibrary);
  const canEdit = kit.useCanEdit(props.characterId);
  const spellIds = createMemo<ReadonlyArray<string>>(() =>
    lib()?.spellIds ?? [],
  );
  const [adding, setAdding] = createSignal(false);
  const excludeIds = createMemo(() => new Set(spellIds()));
  const catalog = useSpellCatalog();
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
      <p style={{ "font-size": "0.85rem", color: "var(--color-fg-muted)", margin: 0, display: "flex", gap: "0.4rem", "align-items": "center", "flex-wrap": "wrap" }}>
        <span>
          Your at-home collection of spells. The library doesn't travel with
          you — copy spells into spell books to take them adventuring.
          Spells from your own books or scrolls can be added freely; learning
          from another arcanist's source uses a Lore Master test.
        </span>
        <RuleRef book="DH" page={92} />
        <RuleRef book="DH" page={96} />
      </p>
      <Show
        when={spellIds().length > 0}
        fallback={
          <p
            style={{
              "font-size": "0.8rem",
              "font-style": "italic",
              color: "var(--color-fg-muted)",
              margin: 0,
            }}
          >
            no spells in library yet.
          </p>
        }
      >
        <ul
          data-testid="library-list"
          style={{
            "list-style": "none",
            padding: 0,
            margin: 0,
            display: "flex",
            "flex-direction": "column",
            gap: "0.4rem",
          }}
        >
          <For each={spellIds()}>
            {(sid) => (
              <li>
                <SpellCard
                  spellId={sid}
                  testid={`library-spell-${sid}`}
                  actions={() => (
                    <button
                      type="button"
                      data-testid={`remove-from-library-${sid}`}
                      disabled={!canEdit()}
                      onClick={() =>
                        client.dispatch(
                          RemoveSpellFromLibrary({
                            characterId: props.characterId as EntityId,
                            spellId: sid as EntityId,
                          }),
                        )
                      }
                      style={btnStyle(false)}
                    >
                      Remove
                    </button>
                  )}
                />
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={canEdit()}>
        <Show
          when={adding()}
          fallback={
            <button
              type="button"
              data-testid="open-add-to-library"
              disabled={catalog().length === 0}
              onClick={() => setAdding(true)}
              style={{ ...btnStyle(catalog().length === 0), "align-self": "flex-start" }}
            >
              + Add spell from catalog
            </button>
          }
        >
          <div
            style={{
              display: "flex",
              "flex-direction": "column",
              gap: "0.4rem",
              padding: "0.5rem",
              "border-radius": "var(--radius-control)",
              background: "var(--color-surface-elevated)",
              border: "1px dashed var(--color-border)",
            }}
          >
            <SpellPicker
              selected={() => null}
              setSelected={() => {}}
              excludeIds={excludeIds}
              placeholder="Search catalog…"
              testid="library-add-picker"
              onRowAdd={(sid) =>
                client.dispatch(
                  AddSpellToLibrary({
                    characterId: props.characterId as EntityId,
                    spellId: sid as EntityId,
                  }),
                )
              }
            />
            <button
              type="button"
              data-testid="close-add-to-library"
              onClick={() => setAdding(false)}
              style={{ ...btnStyle(false), "align-self": "flex-start" }}
            >
              Close
            </button>
          </div>
        </Show>
      </Show>
    </div>
  );
}

function btnStyle(disabled: boolean): JSX.CSSProperties {
  return {
    padding: "0.3rem 0.55rem",
    "border-radius": "var(--radius-control)",
    border: "1px solid var(--color-border)",
    background: disabled ? "var(--color-surface-sunken)" : "var(--color-surface)",
    color: disabled ? "var(--color-fg-muted)" : "var(--color-fg)",
    cursor: disabled ? "not-allowed" : "pointer",
    "font-size": "0.75rem",
    opacity: disabled ? 0.6 : 1,
  };
}

/**
 * Scope-toggle pill — used by the book-add picker to switch between
 * "library" and "all spells" sources. The active pill paints in
 * accent; the inactive one stays subtle so the default (library)
 * reads as the easy path.
 */
function scopeBtnStyle(active: boolean): JSX.CSSProperties {
  return {
    padding: "0.15rem 0.5rem",
    "border-radius": "var(--radius-control)",
    border: active
      ? "1px solid var(--color-accent)"
      : "1px solid var(--color-border-muted)",
    background: active
      ? "var(--color-accent-soft)"
      : "var(--color-surface)",
    color: active ? "var(--color-accent)" : "var(--color-fg-muted)",
    cursor: "pointer",
    "font-size": "0.7rem",
  };
}

export const TbArcaneTabFill: CharacterSheetTab = {
  id: qualifiedName("@vtt/system-torchbearer/tab-arcane") as CharacterSheetTab["id"],
  label: "Arcane",
  priority: 50,
  render: ({ characterId }) => ArcaneTab({ characterId }),
};
