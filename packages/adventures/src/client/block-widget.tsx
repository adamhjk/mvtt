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

import { render } from "solid-js/web";
import { For, Show, type JSX } from "solid-js";
import type { MarkdownPostRender, MarkdownPostRenderContext } from "@vtt/notes/shared";
import type { EntityId } from "@vtt/substrate";
import {
  buildBlockKindIndex,
  type BlockAction,
  type AnyBlockKindDef,
} from "../shared/block-kinds.js";
import { slugifyInfo } from "../shared/parse-blocks.js";

/**
 * Compute the deterministic block-entity id for the rendered fence.
 * Mirrors `blockEntityId` from the server module — we duplicate the
 * shape rather than reach across the server/client boundary.
 */
function blockEntityIdClient(pageId: EntityId, blockKey: string): EntityId {
  return `block:${pageId}:${blockKey}` as EntityId;
}

interface BlockWidgetProps {
  readonly kind: AnyBlockKindDef;
  readonly entityId: EntityId | null;
  readonly info: string;
  readonly bodyText: string;
  readonly ctx: MarkdownPostRenderContext;
  readonly isGm: boolean;
}

function BlockWidget(props: BlockWidgetProps): JSX.Element {
  const visibleActions = (): ReadonlyArray<BlockAction> => {
    const all = props.kind.actions ?? [];
    return all.filter((a) => {
      if (a.visibility === "gm" && !props.isGm) return false;
      return true;
    });
  };
  const displayName = (): string => {
    if (props.entityId && props.kind.display) {
      try {
        return props.kind.display(props.entityId, props.ctx.world);
      } catch {
        // fall through
      }
    }
    return props.info || `(${props.kind.name})`;
  };
  // Implicit "open the entity" action for kinds where it makes sense.
  // The widget's name link carries a `data-wiki-ref` attribute matching
  // notes' `WikiLinkRef` shape; notes' MarkdownView's onContainerClick
  // delegate sees it and routes through the link-kind registry's
  // activate() — same flow as a real `[[character:Foo]]` chip click.
  const wikiLinkRef = (): {
    embed: boolean;
    kind: string;
    body: string;
    anchor: string | null;
    alias: string | null;
    span: { start: number; end: number };
  } | null => {
    if (!props.entityId) return null;
    // Map fenced-block kind → wiki-link kind for the widget's name
    // link. The link-kind owns click activation (peek vs navigate vs
    // command), so an npc block's name should link to the `npc:`
    // kind, etc. Block kinds with no registered wiki-link kind
    // render the name as a plain span (no link).
    const blockToLink: Record<string, string> = {
      character: "character",
      monster: "monster",
      npc: "npc",
      item: "item",
    };
    const kind = blockToLink[props.kind.name];
    if (!kind) return null;
    return {
      embed: false,
      kind,
      body: props.entityId,
      anchor: null,
      alias: null,
      span: { start: 0, end: 0 },
    };
  };
  // Per-kind accent colors. Hex pairs are passed to CSS `light-dark()`
  // so the same kind reads cleanly in both themes — light variants are
  // the printed-page-readable saturated tones, dark variants are
  // brighter so they still pop on a dark surface.
  const accentByKind: Record<string, string> = {
    character: "light-dark(#7c3aed, #a78bfa)",
    npc: "light-dark(#0891b2, #22d3ee)",
    monster: "light-dark(#dc2626, #f87171)",
    item: "light-dark(#2563eb, #60a5fa)",
    encounter: "light-dark(#ea580c, #fb923c)",
    loot: "light-dark(#ca8a04, #facc15)",
  };
  const accent = (): string => accentByKind[props.kind.name] ?? "var(--color-accent)";
  return (
    <div
      class="block-widget"
      data-block-kind={props.kind.name}
      data-block-info={props.info}
      data-block-entity-id={props.entityId ?? ""}
      style={{
        border: "1px solid var(--color-border)",
        "border-left": `3px solid ${accent()}`,
        "border-radius": "6px",
        padding: "10px 12px",
        margin: "8px 0",
        // `--color-surface-raised` was a typo — the real token is
        // `--color-surface-elevated` (declared with light-dark() in
        // tokens.css), and the old fallback (#f8f8f8) baked light-mode
        // grey into dark mode.
        background: "var(--color-surface-elevated)",
        color: "var(--color-fg)",
      }}
    >
      <div
        class="block-widget-header"
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", "align-items": "baseline", gap: "8px", "min-width": 0 }}>
          <span
            class="block-widget-kind"
            style={{
              "font-size": "0.7em",
              "letter-spacing": "0.06em",
              "text-transform": "uppercase",
              "font-weight": "700",
              color: accent(),
              "flex-shrink": 0,
            }}
          >
            {props.kind.name}
          </span>
          <Show
            when={wikiLinkRef()}
            fallback={
              <span
                class="block-widget-name"
                style={{ "font-weight": "600", "font-size": "1.05em" }}
              >
                {displayName()}
              </span>
            }
          >
            {(refAcc) => (
              <a
                class="block-widget-name"
                href="#"
                data-wiki-ref={JSON.stringify(refAcc())}
                style={{
                  "font-weight": "600",
                  "font-size": "1.05em",
                  color: "var(--color-fg)",
                  "text-decoration": "none",
                  "border-bottom": "1px dotted var(--color-fg-muted)",
                }}
              >
                {displayName()}
              </a>
            )}
          </Show>
        </div>
        <Show when={visibleActions().length > 0}>
          <div class="block-widget-actions" style={{ display: "flex", gap: "6px" }}>
            <For each={visibleActions()}>
              {(action) => (
                <button
                  type="button"
                  class="block-widget-action"
                  data-action-id={action.id}
                  disabled={props.entityId === null}
                  style={{
                    padding: "4px 8px",
                    "border-radius": "4px",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface)",
                    color: "var(--color-fg)",
                    cursor: props.entityId === null ? "default" : "pointer",
                  }}
                  onClick={() => {
                    if (props.entityId === null) return;
                    void action.run({
                      entityId: props.entityId,
                      world: props.ctx.world,
                      ...(props.ctx.dispatch !== undefined && {
                        dispatch: props.ctx.dispatch,
                      }),
                      ...(props.ctx.session !== undefined && {
                        session: props.ctx.session,
                      }),
                    });
                  }}
                >
                  {action.label}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
      <Show when={props.entityId === null}>
        <div
          class="block-widget-error"
          style={{
            "margin-top": "6px",
            "font-size": "0.85em",
            color: "var(--color-fg-muted)",
          }}
        >
          Not yet materialized — save the page to create the entity.
        </div>
      </Show>
    </div>
  );
}

/**
 * Post-render hook: walk the container for `<pre><code class="language-X">`
 * elements where X is a registered BlockKindsSlot kind, replace each
 * with a Solid widget. Mounted widgets each own a `<div>` we insert
 * before the original `<pre>`, which we then remove — net effect is
 * the code block becomes a widget.
 *
 * The post-render hook fires after every innerHTML rewrite, so each
 * call re-walks and re-mounts. Solid components are GC'd when their
 * host `<div>` is detached by the next innerHTML.
 */
export function mountBlockWidgets(container: HTMLElement, ctx: MarkdownPostRenderContext): void {
  const kindIndex = buildBlockKindIndex(ctx.registry);
  if (kindIndex.all.length === 0) return;
  // Prefer the session passed through `MarkdownPostRenderContext` —
  // NoteView wires it from `useMe()`. The legacy `__mvttSession`
  // global stays as a fallback for any consumer that hasn't been
  // updated to plumb session through yet (avoids regressing existing
  // setups that relied on it).
  const isGm = ctx.session?.role === "gm" || readSessionRole() === "gm";

  // Each `<pre><code class="language-X">` is a candidate. We need to
  // know the *pageId* to derive the deterministic entity id, and the
  // notes plugin doesn't put it on the container today — we read it
  // from `container.dataset.pageId` if the host sets it; otherwise
  // we fall back to scanning the BlockEntityIndex by info-slug.
  const pageId = (container.dataset.pageId as EntityId | undefined) ?? null;

  const codes = container.querySelectorAll('pre > code[class*="language-"]');
  for (let i = 0; i < codes.length; i += 1) {
    const codeEl = codes[i] as HTMLElement;
    const pre = codeEl.parentElement;
    if (!pre || pre.tagName !== "PRE") continue;
    const cls = codeEl.className || "";
    const m = cls.match(/language-([A-Za-z][A-Za-z0-9_-]*)/);
    if (!m) continue;
    const kindName = m[1]!;
    const kindDef = kindIndex.byName.get(kindName);
    if (!kindDef) continue;
    // The fenced block's info-string (e.g. "Greta the Smith") isn't
    // preserved in the rendered HTML by remark-rehype — only the
    // language is. To get the info, we re-parse the original markdown
    // body. But we don't have it here. Workaround: use the code's
    // text content as a hint (the body), and look up the entity by
    // scanning the BlockEntityIndex for any entry whose page matches.
    // This is OK because the index has the info-slug per (pageId, key).
    //
    // Primary: notes' compile pipeline preserves the fence's
    // info-string as `data-fence-info` on the <code>. Fall back to a
    // `name:` line in the YAML body for legacy-rendered HTML.
    let info = "";
    const bodyText = codeEl.textContent ?? "";
    const fenceInfo = codeEl.getAttribute("data-fence-info");
    if (fenceInfo) {
      info = fenceInfo.trim();
    } else {
      const nameMatch = bodyText.match(/^name:\s*(.+)$/m);
      if (nameMatch) info = nameMatch[1]!.trim();
    }

    // The `# id: <stable>` annotation overrides the info-slug for
    // entity lookup (matches the parser's grammar in shared/parse-blocks.ts).
    let resolvedKey: string | null = null;
    const idMatch = bodyText.match(/^#\s*id:\s*([A-Za-z0-9._:/-]+)\s*$/m);
    if (idMatch) resolvedKey = idMatch[1]!;
    else if (info) resolvedKey = slugifyInfo(info);

    let entityId: EntityId | null = null;
    if (resolvedKey && pageId) {
      entityId = blockEntityIdClient(pageId, resolvedKey);
      if (!ctx.world.has(entityId)) entityId = null;
    }
    if (!entityId) {
      // Fallback: scan the BlockEntityIndex for any block of this kind
      // whose info-slug matches. Best-effort — without info+pageId we
      // can't guarantee a match.
      entityId = findBlockByInfoOrFirst(ctx, kindName, info);
    }
    // Build a host div, mount the Solid widget, insert before the
    // original <pre>, then remove the <pre>.
    const host = document.createElement("div");
    pre.parentElement?.insertBefore(host, pre);
    render(
      () => (
        <BlockWidget
          kind={kindDef}
          entityId={entityId}
          info={info}
          bodyText={bodyText}
          ctx={ctx}
          isGm={isGm}
        />
      ),
      host,
    );
    pre.remove();
  }
}

function findBlockByInfoOrFirst(
  ctx: MarkdownPostRenderContext,
  kindName: string,
  info: string,
): EntityId | null {
  // Walk the BlockEntityIndex for the first entity of this kind. If
  // info is provided, prefer the matching slug.
  const slug = info ? slugifyInfo(info) : null;
  // BlockEntityIndex lives at the deterministic sentinel id `block-entity-index`.
  const indexEntityId = "block-entity-index" as EntityId;
  if (!ctx.world.has(indexEntityId)) return null;
  // We can't import the BlockEntityIndex trait here without a
  // circular dep — read directly via traitsOn.
  const traits = ctx.world.traitsOn(indexEntityId);
  for (const [traitName, value] of traits.entries()) {
    if (traitName !== "@vtt/adventures/BlockEntityIndex") continue;
    const v = value as {
      entries: Record<string, { kind: string; blockKey: string; entityId: EntityId }>;
    };
    let fallback: EntityId | null = null;
    for (const e of Object.values(v.entries)) {
      if (e.kind !== kindName) continue;
      if (slug && e.blockKey === slug) return e.entityId;
      if (!fallback) fallback = e.entityId;
    }
    return fallback;
  }
  return null;
}

function readSessionRole(): "gm" | "player" | null {
  // Sessions are app-state, not world-state, so the post-render
  // context doesn't carry one. We read from a global stash the shell
  // attaches at boot. Fail-safe to "player" (hides gm-only actions)
  // when the global isn't set.
  const g = globalThis as { __mvttSession?: { role?: "gm" | "player" } };
  return g.__mvttSession?.role ?? null;
}

/**
 * MarkdownPostRender fill exported for plugin registration. Adventures
 * wires this into MarkdownPostRenderSlot.
 */
export const blockWidgetPostRender: MarkdownPostRender = {
  name: "adventures-block-widgets",
  run: mountBlockWidgets,
};
