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
import {
  definePlugin,
  defineTrait,
  Registry,
  World,
  z,
} from "@vtt/substrate";
import { permissions } from "@vtt/permissions";
import {
  Page,
  BelongsToNote,
  PageBodySet,
  MarkdownPostRenderSlot,
  EditorCompletionSourcesSlot,
  NotesReferenceSlot,
} from "@vtt/notes/shared";
import { adventures } from "./manifest.js";
import {
  BlockKindsSlot,
  buildBlockKindIndex,
  defineBlockKind,
} from "./shared/index.js";
import { runBlockParse, blockEntityId } from "./server/block-parse-system.js";
import { mountBlockWidgets } from "./client/block-widget.js";

const Stat = defineTrait({
  name: "@vtt/adventures-widget-test/Stat",
  schema: z.object({ label: z.string(), value: z.number() }),
});

const dispatched: Array<{ id: string }> = [];

const statKind = defineBlockKind({
  name: "stat",
  description: "A test stat block",
  schema: z.object({ label: z.string().min(1), value: z.number().int() }),
  display: (entityId, world) => {
    const got = world.get(entityId, [Stat]) as
      | { Stat: { label: string } }
      | undefined;
    return got?.Stat.label ?? "stat";
  },
  actions: [
    {
      id: "go",
      label: "Go",
      run: ({ entityId }) => {
        dispatched.push({ id: entityId });
      },
    },
    {
      id: "gm-only",
      label: "GM Only",
      visibility: "gm",
      run: () => {},
    },
  ],
  project: (parsed) => {
    const p = parsed as { label: string; value: number };
    return { traits: [{ trait: Stat, value: p }] };
  },
});

const stubKindPlugin = definePlugin({
  name: "@vtt/adventures-widget-test-stub",
  version: "0",
  dependsOn: ["@vtt/adventures@^0"],
  traits: [Stat],
  fills: { [BlockKindsSlot.name]: [statKind as never] },
});

const notesStub = definePlugin({
  name: "@vtt/notes",
  version: "0.1.0",
  traits: [Page, BelongsToNote],
  events: [PageBodySet],
  slots: [MarkdownPostRenderSlot, EditorCompletionSourcesSlot, NotesReferenceSlot],
});

function setup() {
  dispatched.length = 0;
  const registry = new Registry();
  registry.load(permissions);
  registry.load(notesStub);
  registry.load(adventures);
  registry.load(stubKindPlugin);
  registry.validate();
  const world = new World();
  return { registry, world };
}

describe("mountBlockWidgets", () => {
  let registry: Registry;
  let world: World;
  let pageId: string;

  beforeEach(() => {
    const s = setup();
    registry = s.registry;
    world = s.world;
    const noteId = world.spawn([]);
    pageId = world.spawn([
      Page({ title: "p", body: "", bodyRev: 0 }),
      BelongsToNote({ noteId }),
    ]);
  });

  function setupContainer(body: string): HTMLElement {
    const idx = buildBlockKindIndex(registry);
    runBlockParse(world, pageId as never, body, idx);
    const container = document.createElement("div");
    container.dataset.pageId = pageId;
    // Simulate what remark-rehype produces: a <pre><code class="language-stat">…</code></pre>.
    // The body is what would normally be the YAML between fences.
    const block = body.match(/```stat\s+([^\n]+)\n([\s\S]*?)\n```/);
    if (block) {
      const info = block[1]!.trim();
      const yaml = block[2]!;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.className = "language-stat";
      // For tests, embed a `name: <info>` line so the widget can
      // recover the info-string (mirrors what real fence rendering
      // would produce + the autocomplete-friendly `name:` hint).
      code.textContent = `name: ${info}\n${yaml}`;
      pre.appendChild(code);
      container.appendChild(pre);
    }
    return container;
  }

  it("replaces a <pre><code language-stat> with a widget div", () => {
    const container = setupContainer(
      ["```stat Hello", "label: a", "value: 1", "```"].join("\n"),
    );
    document.body.appendChild(container);
    mountBlockWidgets(container, { world, registry, worldId: "test" });
    const widgets = container.querySelectorAll(".block-widget");
    expect(widgets).toHaveLength(1);
    expect(container.querySelectorAll("pre")).toHaveLength(0);
  });

  it("shows the entity's display() in the widget header when materialized", () => {
    const container = setupContainer(
      ["```stat Hello", "label: My Label", "value: 5", "```"].join("\n"),
    );
    document.body.appendChild(container);
    mountBlockWidgets(container, { world, registry, worldId: "test" });
    const widget = container.querySelector(".block-widget");
    expect(widget!.textContent).toContain("My Label");
  });

  it("renders non-gm actions but hides gm-only actions when no session role", () => {
    const container = setupContainer(
      ["```stat Hello", "label: a", "value: 1", "```"].join("\n"),
    );
    document.body.appendChild(container);
    mountBlockWidgets(container, { world, registry, worldId: "test" });
    const buttons = container.querySelectorAll(".block-widget-action");
    expect(buttons.length).toBe(1);
    expect(buttons[0]!.textContent).toBe("Go");
  });

  it("clicking an action button invokes the action's run handler", () => {
    const container = setupContainer(
      ["```stat Hello", "label: a", "value: 1", "```"].join("\n"),
    );
    document.body.appendChild(container);
    mountBlockWidgets(container, { world, registry, worldId: "test" });
    const button = container.querySelector(
      ".block-widget-action",
    ) as HTMLButtonElement;
    button.click();
    expect(dispatched.length).toBe(1);
    expect(dispatched[0]!.id).toBe(blockEntityId(pageId as never, "hello"));
  });

  it("ignores fences whose language isn't a registered block kind", () => {
    const container = document.createElement("div");
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.className = "language-typescript";
    code.textContent = "const x = 1;";
    pre.appendChild(code);
    container.appendChild(pre);
    mountBlockWidgets(container, { world, registry, worldId: "test" });
    expect(container.querySelector("pre")).not.toBeNull();
    expect(container.querySelector(".block-widget")).toBeNull();
  });

  it("shows a 'not yet materialized' message when the entity is missing", () => {
    const container = document.createElement("div");
    container.dataset.pageId = pageId;
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.className = "language-stat";
    code.textContent = "name: Phantom\nlabel: x\nvalue: 1";
    pre.appendChild(code);
    container.appendChild(pre);
    mountBlockWidgets(container, { world, registry, worldId: "test" });
    const widget = container.querySelector(".block-widget");
    expect(widget).not.toBeNull();
    expect(widget!.querySelector(".block-widget-error")).not.toBeNull();
  });
});
