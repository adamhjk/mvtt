import { defineView, clientOnly } from "@vtt/substrate";
import { Surface, useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { WorkbenchChatRailSurface } from "@vtt/shell-workbench/shared";
import { Identity, Online } from "@vtt/identity/shared";
import { createMemo, createSignal, Show } from "solid-js";
import { RequestRoll } from "../shared/commands.js";
import { Formula, RollResult, RolledBy } from "../shared/traits.js";
import { RollEntrySurface } from "../shared/surfaces.js";

const QUICK_ROLLS = ["1d20", "1d20+5", "2d6+3", "4d6kh3", "1d100"];

export const RollerView = defineView({
  name: "Roller",
  surface: WorkbenchChatRailSurface,
  // Sit just below the player list and above the chat stream / composer.
  priority: 80,
  render: clientOnly(() => {
    const client = useClient();
    const [notation, setNotation] = createSignal("1d20");
    const [gmOnly, setGmOnly] = createSignal(false);

    // Find the current connection's Player entity to learn its role.
    // Identity + Online are transient — they exist only while connected, so
    // a `find` on every query refresh is fine. The GM-only checkbox renders
    // only when the current user is a GM.
    const players = useQuery([Identity, Online]);
    const isGm = createMemo(() => {
      // Read both signals up front so Solid tracks them. An early return
      // before reading either would leave the memo unsubscribed — when
      // players() later updated, the memo would never re-run and the
      // checkbox would stay hidden even after the Player entity arrived.
      const list = players();
      const myClientId = client.clientId();
      if (!myClientId || list.length === 0) return false;
      const me = list.find(
        (p) => (p.values.Online as { clientId: string }).clientId === myClientId,
      );
      if (!me) return false;
      return (me.values.Identity as { role: string }).role === "gm";
    });

    const roll = (text = notation()) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      client.dispatch(
        RequestRoll({
          notation: trimmed,
          visibility: gmOnly() && isGm() ? "gm-only" : "public",
        }),
      );
    };

    return (
      <div class="flex flex-col gap-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-fg-muted">
          dice roller
        </h2>
        <form
          class="flex gap-2"
          autocomplete="off"
          data-form-type="other"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          onSubmit={(e) => {
            e.preventDefault();
            roll();
          }}
        >
          <input
            type="text"
            name="dice-notation"
            value={notation()}
            onInput={(e) => setNotation(e.currentTarget.value)}
            placeholder="e.g. 1d20+5, 4d6kh3"
            autocomplete="off"
            spellcheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            class="flex-1 rounded-(--radius-control) border border-border bg-surface px-3 py-2 font-mono text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            class="rounded-(--radius-control) bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover transition"
          >
            Roll
          </button>
        </form>
        <Show when={isGm()}>
          <label class="flex items-center gap-2 text-xs text-fg-muted select-none">
            <input
              type="checkbox"
              checked={gmOnly()}
              onChange={(e) => setGmOnly(e.currentTarget.checked)}
              class="h-3.5 w-3.5 cursor-pointer rounded-(--radius-control) border-border accent-accent"
            />
            <span>GM only — players won't see this roll</span>
          </label>
        </Show>
        <div class="flex flex-wrap gap-2">
          {QUICK_ROLLS.map((q) => (
            <button
              type="button"
              onClick={() => {
                setNotation(q);
                roll(q);
              }}
              class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-1 font-mono text-xs text-fg-muted hover:border-accent hover:text-fg transition"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    );
  }),
});

/**
 * The roll log. Mounts the per-entity RollEntrySurface so each roll
 * entity (spawned by RollRecordingSystem) renders as a card. Sits in
 * the chat rail between the roller (above) and the chat stream (below).
 *
 * Bounded height + scroll: rolls accumulate freely but don't push the
 * chat stream off-screen. `shrink-0` keeps the tray from collapsing
 * when the rail is short; `max-h-64` caps the visible history (older
 * rolls scroll in place).
 */
export const RollTrayView = defineView({
  name: "RollTray",
  surface: WorkbenchChatRailSurface,
  priority: 70,
  render: clientOnly(() => (
    <div class="flex shrink-0 flex-col gap-2">
      <h2 class="font-display text-[0.65rem] uppercase tracking-[0.16em] text-fg-muted">
        rolls
      </h2>
      <div class="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
        <Surface name={RollEntrySurface.name} />
      </div>
    </div>
  )),
});

export const RollEntryView = defineView({
  name: "RollEntry",
  surface: RollEntrySurface,
  requires: [Formula, RollResult, RolledBy],
  priority: 0,
  render: clientOnly(({ entityId }: { entityId: string }) => {
    const formula = useTrait(entityId, Formula);
    const result = useTrait(entityId, RollResult);
    const rolledBy = useTrait(entityId, RolledBy);
    return (
      <Show when={formula() && result() && rolledBy()}>
        <article class="rounded-(--radius-card) border border-border-muted bg-surface-elevated p-3">
          <header class="flex items-baseline justify-between gap-2">
            <span class="text-xs text-fg-muted">
              <span class="text-fg">{rolledBy()!.displayName}</span>{" "}
              <span class="text-fg-subtle">rolled</span>{" "}
              <code class="font-mono text-fg-muted">{formula()!.notation}</code>
            </span>
            <strong class="font-mono text-base text-accent">{result()!.total}</strong>
          </header>
          <p class="mt-1 truncate font-mono text-[11px] text-fg-subtle" title={result()!.output}>
            {result()!.output}
          </p>
        </article>
      </Show>
    );
  }),
});
