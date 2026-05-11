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
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { ClientProvider } from "@vtt/substrate/client";
import { buildTestClient } from "@vtt/substrate/client-testing";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { notes } from "./manifest.js";
import { headingIdFor, extractHeadings } from "./shared/headings.js";
import { MarkdownView } from "./client/markdown.jsx";

beforeEach(() => cleanup());

function harness() {
  return buildTestClient({
    plugins: [shellWorkbench, identity, permissions, notes],
  });
}

describe("MarkdownView heading ids", () => {
  it("stamps the id matching `extractHeadings` on each rendered heading", () => {
    const h = harness();
    const body = "# Tactics\n\nstuff goes here\n\n## Inhabitants\n\nmore stuff";
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <MarkdownView
          body={body}
          world={h.client.world}
          registry={h.client.registry}
          worldId="test-world"
        />
      </ClientProvider>
    ));

    const items = extractHeadings(body);
    expect(items.map((i) => i.text)).toEqual(["Tactics", "Inhabitants"]);

    // Each heading element in the rendered DOM should carry the id
    // produced by `extractHeadings` for the same source body.
    for (const item of items) {
      const el = container.querySelector(`[id="${item.id}"]`);
      expect(el, `no element for ${item.text} (${item.id})`).not.toBeNull();
      expect(el?.textContent).toContain(item.text);
    }
  });

  it("disambiguates duplicate-text headings via occurrence count", () => {
    const h = harness();
    const body = "# Tactics\n\n# Tactics";
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <MarkdownView
          body={body}
          world={h.client.world}
          registry={h.client.registry}
          worldId="test-world"
        />
      </ClientProvider>
    ));
    const id1 = headingIdFor("Tactics", 1);
    const id2 = headingIdFor("Tactics", 2);
    expect(id1).not.toBe(id2);
    expect(container.querySelector(`[id="${id1}"]`)).not.toBeNull();
    expect(container.querySelector(`[id="${id2}"]`)).not.toBeNull();
  });
});

describe("MarkdownView scrollToAnchor", () => {
  it("calls scrollIntoView on the matching heading and fires onScrolled", async () => {
    const h = harness();
    const body = "# Tactics\n\nstuff";
    const expectedId = headingIdFor("Tactics", 1);

    // jsdom doesn't implement scrollIntoView; install a spy on the
    // prototype so any heading element in the rendered tree picks it up.
    const scrollSpy = vi.fn();
    const original = (Element.prototype as { scrollIntoView?: () => void })
      .scrollIntoView;
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });

    const onScrolled = vi.fn();
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <MarkdownView
          body={body}
          world={h.client.world}
          registry={h.client.registry}
          worldId="test-world"
          scrollToAnchor={expectedId}
          onScrolled={onScrolled}
        />
      </ClientProvider>
    ));

    // Sanity: heading IS in the DOM with the expected id.
    const heading = container.querySelector(`[id="${expectedId}"]`);
    expect(heading, `expected heading with id ${expectedId}`).not.toBeNull();

    // The scroll fires inside requestAnimationFrame; wait for it.
    await waitFor(
      () => {
        expect(scrollSpy).toHaveBeenCalled();
      },
      { timeout: 500 },
    );
    await waitFor(
      () => {
        expect(onScrolled).toHaveBeenCalled();
      },
      { timeout: 500 },
    );

    // And the spy was invoked on the *heading* element specifically.
    expect(scrollSpy.mock.instances).toContain(heading);

    // Restore.
    if (original) {
      Object.defineProperty(Element.prototype, "scrollIntoView", {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });

  it("scrolls once the body arrives async (anchor armed before body)", async () => {
    const h = harness();
    const expectedId = headingIdFor("Tactics", 1);

    const scrollSpy = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });

    // Body starts empty (page trait still loading from server) and the
    // parent has already armed the anchor. The scroll effect must NOT
    // give up before the body arrives — it should re-attempt on body
    // change.
    const [body, setBody] = createSignal("");
    render(() => (
      <ClientProvider value={h.client}>
        <MarkdownView
          body={body()}
          world={h.client.world}
          registry={h.client.registry}
          worldId="test-world"
          scrollToAnchor={expectedId}
        />
      </ClientProvider>
    ));

    // Give the initial RAFs a chance to fire while body is still empty.
    await new Promise((r) => setTimeout(r, 50));
    expect(
      scrollSpy,
      "should not have scrolled — heading didn't exist yet",
    ).not.toHaveBeenCalled();

    // Body arrives — scroll should now fire.
    setBody("# Tactics\n\nstuff");
    await waitFor(
      () => {
        expect(scrollSpy).toHaveBeenCalled();
      },
      { timeout: 500 },
    );
  });

  it("does not re-scroll for the same anchor when body re-renders", async () => {
    const h = harness();
    const expectedId = headingIdFor("Tactics", 1);

    const scrollSpy = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });

    const [body, setBody] = createSignal("# Tactics\n\nfirst body");
    render(() => (
      <ClientProvider value={h.client}>
        <MarkdownView
          body={body()}
          world={h.client.world}
          registry={h.client.registry}
          worldId="test-world"
          scrollToAnchor={expectedId}
        />
      </ClientProvider>
    ));

    await waitFor(
      () => {
        expect(scrollSpy).toHaveBeenCalledTimes(1);
      },
      { timeout: 500 },
    );

    // Body re-renders (e.g. another user edited the page). The anchor
    // is still armed but we shouldn't fire ANOTHER scroll for it —
    // smooth-scroll interruption was the original bug.
    setBody("# Tactics\n\nfirst body, plus more text");
    await new Promise((r) => setTimeout(r, 100));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("does not scroll when scrollToAnchor is null", async () => {
    const h = harness();
    const scrollSpy = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });

    render(() => (
      <ClientProvider value={h.client}>
        <MarkdownView
          body="# Tactics"
          world={h.client.world}
          registry={h.client.registry}
          worldId="test-world"
          scrollToAnchor={null}
        />
      </ClientProvider>
    ));

    await new Promise((r) => setTimeout(r, 100));
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});

describe("MarkdownView wiki-link click delegation", () => {
  it("compiles `[[…]]` to a chip with data-wiki-ref and routes clicks via onLink", () => {
    const h = harness();
    const onLink = vi.fn();
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <MarkdownView
          body="see [[Goblin Cave]] for details"
          world={h.client.world}
          registry={h.client.registry}
          worldId="test-world"
          onLink={onLink}
        />
      </ClientProvider>
    ));

    const chip = container.querySelector(
      "[data-wiki-ref]",
    ) as HTMLElement | null;
    expect(chip, "expected a chip with data-wiki-ref").not.toBeNull();
    expect(chip?.tagName).toBe("BUTTON");
    expect(chip?.getAttribute("data-link-kind")).toBe("note");
    expect(chip?.getAttribute("data-link-body")).toBe("Goblin Cave");
    // Body text fallback (since no real "Goblin Cave" note exists in
    // the test world, kind.display can't find a target — the chip
    // shows the literal body, marked unresolved).
    expect(chip?.getAttribute("data-link-resolved")).toBe("no");
    expect(chip?.textContent).toContain("Goblin Cave");

    fireEvent.click(chip!);
    expect(onLink).toHaveBeenCalledTimes(1);
    const [refArg] = onLink.mock.calls[0]!;
    expect(refArg).toMatchObject({
      kind: "note",
      body: "Goblin Cave",
      embed: false,
    });
  });

  it("works when the click lands on a child of the chip (event delegation)", () => {
    const h = harness();
    const onLink = vi.fn();
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <MarkdownView
          body="[[Some Note]]"
          world={h.client.world}
          registry={h.client.registry}
          worldId="test-world"
          onLink={onLink}
        />
      </ClientProvider>
    ));

    // The chip wraps a `<span>` with the display text. A click on the
    // span must walk up to the [data-wiki-ref] node.
    const span = container.querySelector(
      "[data-wiki-ref] span",
    ) as HTMLElement | null;
    expect(span).not.toBeNull();
    fireEvent.click(span!);
    expect(onLink).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks on non-wikilink content", () => {
    const h = harness();
    const onLink = vi.fn();
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <MarkdownView
          body="just a paragraph with no links"
          world={h.client.world}
          registry={h.client.registry}
          worldId="test-world"
          onLink={onLink}
        />
      </ClientProvider>
    ));

    const para = container.querySelector("p") as HTMLElement | null;
    expect(para).not.toBeNull();
    fireEvent.click(para!);
    expect(onLink).not.toHaveBeenCalled();
  });
});

describe("MarkdownView set-design blocks", () => {
  it("renders a ```setdesign block as a nested tree with header + arrows", () => {
    const h = harness();
    const body = [
      "```setdesign",
      "Old Library 7)",
      "---",
      "**Bookshelves** N+E walls -> sagging, collapsed",
      "**Oak Desk** SW -> drawers dumped",
      "  -> locked drawer -> DC 15",
      "    -> scroll case",
      "```",
    ].join("\n");
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <MarkdownView
          body={body}
          world={h.client.world}
          registry={h.client.registry}
          worldId="test-world"
        />
      </ClientProvider>
    ));

    const wrapper = container.querySelector(".set-design");
    expect(wrapper, "expected a .set-design wrapper").not.toBeNull();
    const header = wrapper!.querySelector(".set-design-header");
    expect(header?.textContent).toContain("Old Library 7");

    // Two top-level items: Bookshelves, Oak Desk.
    const topTree = wrapper!.querySelector(":scope > ul.set-design-tree");
    expect(topTree).not.toBeNull();
    const topItems = topTree!.querySelectorAll(":scope > li.set-design-node");
    expect(topItems.length).toBe(2);

    // First item: Bookshelves has bold for the visible element.
    expect(topItems[0]!.querySelector("strong")?.textContent).toBe(
      "Bookshelves",
    );

    // Arrows: `->` source should render as a → glyph in a styled span.
    const arrows = wrapper!.querySelectorAll("span.set-design-arrow");
    expect(arrows.length).toBeGreaterThan(0);
    expect(arrows[0]!.textContent).toBe("→");

    // Nesting: Oak Desk should have a child sub-tree (locked drawer → DC 15)
    // with a further-nested grandchild (scroll case).
    const oakDesk = topItems[1]!;
    const sub = oakDesk.querySelector(":scope > ul.set-design-tree");
    expect(sub, "Oak Desk should have a nested tree").not.toBeNull();
    const subItem = sub!.querySelector(":scope > li.set-design-node");
    expect(subItem?.textContent).toContain("locked drawer");
    const grand = subItem!.querySelector(":scope > ul.set-design-tree");
    expect(grand, "locked drawer should have a deeper sub-tree").not.toBeNull();
  });

  it("treats a leading `->` on a line as decorative and uses indent for parent", () => {
    const h = harness();
    const body = [
      "```setdesign",
      "**Portcullis** -> wooden",
      "  -> blocks tunnel",
      "  |-> can pass under",
      "```",
    ].join("\n");
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <MarkdownView
          body={body}
          world={h.client.world}
          registry={h.client.registry}
          worldId="test-world"
        />
      </ClientProvider>
    ));
    const top = container.querySelectorAll(
      ".set-design > ul.set-design-tree > li.set-design-node",
    );
    expect(top.length).toBe(1);
    const children = top[0]!.querySelectorAll(
      ":scope > ul.set-design-tree > li.set-design-node",
    );
    expect(children.length).toBe(2);
    expect(children[0]!.textContent).toContain("blocks tunnel");
    expect(children[1]!.textContent).toContain("can pass under");
  });

  it("rewrites [[…]] inside a set-design line into a clickable chip", () => {
    const h = harness();
    const onLink = vi.fn();
    const body = [
      "```setdesign",
      "**Innkeeper** [[character:Marta]] -> 5sp/night",
      "```",
    ].join("\n");
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <MarkdownView
          body={body}
          world={h.client.world}
          registry={h.client.registry}
          worldId="test-world"
          onLink={onLink}
        />
      </ClientProvider>
    ));
    const chip = container.querySelector(
      ".set-design [data-wiki-ref]",
    ) as HTMLElement | null;
    expect(chip, "expected a wiki-link chip inside the set-design block").not.toBeNull();
    expect(chip?.getAttribute("data-link-kind")).toBe("character");
    expect(chip?.getAttribute("data-link-body")).toBe("Marta");
    fireEvent.click(chip!);
    expect(onLink).toHaveBeenCalledTimes(1);
  });
});

describe("MarkdownView external links", () => {
  it("renders standard markdown links with target=_blank + safe rel", () => {
    const h = harness();
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <MarkdownView
          body="[example](https://example.com)"
          world={h.client.world}
          registry={h.client.registry}
          worldId="test-world"
        />
      </ClientProvider>
    ));
    const a = container.querySelector("a[href]") as HTMLAnchorElement | null;
    expect(a, "expected a real <a> for the external link").not.toBeNull();
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toContain("noreferrer");
    expect(a?.getAttribute("rel")).toContain("noopener");
  });
});

