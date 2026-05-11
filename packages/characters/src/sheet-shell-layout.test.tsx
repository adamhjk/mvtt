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

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { cleanup, screen } from "@solidjs/testing-library";
import {
  definePlugin,
  qualifiedName,
  type EntityId,
} from "@vtt/substrate";
import {
  buildTestClient,
  mountWithClient,
} from "@vtt/substrate/client-testing";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { notes } from "@vtt/notes";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { ownedBy, Permissions } from "@vtt/permissions/shared";
import {
  TabSentinel,
  tabSentinelEntityId,
} from "@vtt/shell-workbench/shared";
import { characters } from "./manifest.js";
import { CharacterSheet } from "./client/CharacterSheet.js";
import {
  Character,
  CharacterSheetTabsSlot,
  CharacterSheetUiState,
  type CharacterSheetTab,
} from "./shared/index.js";

beforeEach(() => cleanup());

const ME = "alice";
const ME_CLIENT = "client-alice";
const TAB_ID = "tab-1";

function sheetTabsTestPlugin() {
  const tabA: CharacterSheetTab = {
    id: qualifiedName("@test/sheet/alpha") as CharacterSheetTab["id"],
    label: "Alpha",
    render: () => <div data-testid="body">alpha</div>,
  };
  return definePlugin({
    name: "@test/sheet-tabs",
    version: "0.0.0",
    fills: {
      [CharacterSheetTabsSlot.name]: [tabA],
    },
  });
}

interface Setup {
  characterId: EntityId;
  sentinelId: EntityId;
}

function setupHarness() {
  let setup: Setup | undefined;
  const h = buildTestClient({
    plugins: [
      shellWorkbench,
      identity,
      permissions,
      notes,
      characters,
      sheetTabsTestPlugin(),
    ],
    clientId: ME_CLIENT,
    session: {
      userId: ME,
      email: "alice@test.dev",
      name: "Alice",
      role: "player",
    },
    setupWorld: ({ world }) => {
      world.spawn([
        Identity({ userId: ME, role: "player" }),
        Name({ value: "Alice" }),
        Online({ clientId: ME_CLIENT, since: 0 }),
      ]);
      const characterId = world.allocateId();
      world.spawnAt(characterId, [
        Character({ name: "Krell" }),
        Permissions(ownedBy(ME)),
      ]);
      const sentinelId = tabSentinelEntityId(TAB_ID);
      world.spawnAt(sentinelId, [
        TabSentinel({ tabId: TAB_ID }),
        Permissions(ownedBy(ME)),
        CharacterSheetUiState({ activeTabId: null }),
      ]);
      setup = { characterId, sentinelId };
    },
  });
  return { ...h, setup: setup! };
}

/* -------------------------------------------------------------------------
 * SheetShell column-mode layout — one continuous scroll
 *
 * The pre-change layout had the rail and tab body each owning their own
 * `overflow-y: auto`, which made the tab content a tiny sub-window on
 * short viewports. The new column-mode layout makes the whole sheet one
 * scroll container with sticky identity / tab bar / actions. These
 * tests assert the contract via the injected stylesheet (jsdom doesn't
 * evaluate `@container` queries, so the desktop overrides are also
 * verified textually rather than via getComputedStyle).
 * ----------------------------------------------------------------------- */

describe("SheetShell column-mode layout", () => {
  function injectedSheetCss(): string {
    const el = document.getElementById(
      "vtt-characters-sheet-shell-styles",
    ) as HTMLStyleElement | null;
    if (!el) throw new Error("expected sheet-shell stylesheet to be injected");
    return el.textContent ?? "";
  }

  it("makes the shell itself the scroll container in column mode", () => {
    const h = setupHarness();
    mountWithClient(h, () => (
      <CharacterSheet characterId={h.setup.characterId} tabId={TAB_ID} />
    ));
    const css = injectedSheetCss();
    expect(css).toMatch(/\.sheet-shell\s*\{[^}]*overflow-y:\s*auto/);
  });

  it("makes identity, actions, and the tab bar all sticky", () => {
    const h = setupHarness();
    mountWithClient(h, () => (
      <CharacterSheet characterId={h.setup.characterId} tabId={TAB_ID} />
    ));
    const css = injectedSheetCss();
    expect(css).toMatch(/\.sheet-shell__identity\s*\{[^}]*position:\s*sticky/);
    expect(css).toMatch(/\.sheet-shell__identity\s*\{[^}]*top:\s*0/);
    expect(css).toMatch(/\.sheet-shell__actions\s*\{[^}]*position:\s*sticky/);
    expect(css).toMatch(/\.sheet-shell__actions\s*\{[^}]*bottom:\s*0/);
    expect(css).toMatch(
      /\.sheet-shell\s+\.vk-tabs__bar\s*\{[^}]*position:\s*sticky/,
    );
    expect(css).toMatch(
      /\.sheet-shell\s+\.vk-tabs__bar\s*\{[^}]*top:\s*var\(--sheet-identity-height/,
    );
    expect(css).toMatch(
      /\.sheet-shell\s+\.vk-tabs__bar\s*\{[^}]*scroll-margin-top:\s*var\(--sheet-identity-height/,
    );
  });

  it("does not lock the rail or tab body to their own scrollers in column mode", () => {
    // Pre-change pathology: rail had `max-height: 40%; overflow-y: auto`
    // and the tab body had `overflow-y: auto` — the bug being fixed.
    // The column-mode rail/body rules must be free of either.
    const h = setupHarness();
    mountWithClient(h, () => (
      <CharacterSheet characterId={h.setup.characterId} tabId={TAB_ID} />
    ));
    const css = injectedSheetCss();
    // Split the stylesheet at the `@container` boundary so we only
    // inspect the column-mode (default) rules.
    const columnCss = css.split("@container")[0]!;
    const railRule = columnCss.match(/\.sheet-shell__rail\s*\{[^}]*\}/)?.[0] ?? "";
    expect(railRule).not.toMatch(/overflow-y:\s*auto/);
    expect(railRule).not.toMatch(/max-height:/);
    const bodyRule =
      columnCss.match(/\.sheet-shell\s+\.vk-tabs__body\s*\{[^}]*\}/)?.[0] ?? "";
    expect(bodyRule).toMatch(/overflow-y:\s*visible/);
  });

  it("restores independent rail + body scrolling in the desktop @container override", () => {
    // The desktop side-by-side layout still wants the rail as a fixed
    // 280px sidebar with its own scroll, and the tab body scrollable
    // independently — vitals stay pinned next to the user as they
    // scroll inventory. jsdom can't evaluate container queries, so
    // we just assert the rule exists in the injected CSS.
    const h = setupHarness();
    mountWithClient(h, () => (
      <CharacterSheet characterId={h.setup.characterId} tabId={TAB_ID} />
    ));
    const css = injectedSheetCss();
    const desktopBlock =
      css.match(/@container sheet \(min-width: 1024px\)\s*\{[\s\S]*$/)?.[0] ?? "";
    expect(desktopBlock).toMatch(/\.sheet-shell\s*\{[^}]*overflow:\s*hidden/);
    expect(desktopBlock).toMatch(
      /\.sheet-shell__rail\s*\{[^}]*overflow-y:\s*auto/,
    );
    expect(desktopBlock).toMatch(
      /\.sheet-shell\s+\.vk-tabs__body\s*\{[^}]*overflow-y:\s*auto/,
    );
    expect(desktopBlock).toMatch(
      /\.sheet-shell\s+\.vk-tabs__bar\s*\{[^}]*position:\s*static/,
    );
  });

  it("writes --sheet-identity-height onto the shell on mount", () => {
    // The sticky tab bar's `top` and `scroll-margin-top` both reference
    // this var, so SheetShell must measure the identity bar and write
    // it before any meaningful scroll happens. ResizeObserver is
    // stubbed in jsdom (it never fires), but we sync once
    // synchronously in onMount before observing — that's what this
    // verifies.
    const h = setupHarness();
    mountWithClient(h, () => (
      <CharacterSheet characterId={h.setup.characterId} tabId={TAB_ID} />
    ));
    // The shell wrapper should be in the DOM after mount.
    const shell = document.querySelector(".sheet-shell") as HTMLElement;
    expect(shell).not.toBeNull();
    const value = shell.style.getPropertyValue("--sheet-identity-height");
    // jsdom reports offsetHeight as 0 for unmeasured elements, so we
    // can't assert a particular pixel value — just that the property
    // was written (any "Npx" string).
    expect(value).toMatch(/^\d+px$/);
    // Tab body got rendered (sanity check that the harness mounted).
    expect(screen.getByTestId("body")).toHaveTextContent("alpha");
  });
});
