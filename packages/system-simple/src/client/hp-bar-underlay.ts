import {
  qualifiedName,
  type EntityId,
  type World,
} from "@vtt/substrate";
import { Container, Graphics } from "pixi.js";
import { LinkedCharacter, Sprite, type TokenUnderlay } from "@vtt/scene/shared";
import { MaxHp, Vitals } from "../shared/index.js";

/**
 * Per-token HP bar drawn beneath the sprite for any token whose linked
 * character has system-simple's Vitals + MaxHp traits. Demonstrates the
 * scene plugin's `TokenUnderlaysSlot` extension surface — game systems
 * project per-character state onto the map without the scene plugin
 * knowing anything about HP, conditions, or Stats.
 *
 * Mount-time wiring:
 *   1. Read `LinkedCharacter` off the token; bail out if absent (this
 *      is a plain icon-picker token, not a placed character).
 *   2. Subscribe to world mutations and redraw on any change to
 *      `Sprite` (size — the bar tracks the sprite's footprint),
 *      `Vitals` or `MaxHp` (the values the bar visualises) on the
 *      relevant entities.
 *   3. Return a cleanup that unsubscribes and clears the Graphics
 *      object the canvas will then destroy.
 *
 * Layout: a 6 px-tall bar centred horizontally on the token, sitting
 * 4 px below the bottom edge. Width = sprite size. Background is a
 * dim track (so missing HP shows through); foreground is a green→red
 * gradient based on hp ratio.
 */
export const HpBarUnderlay: TokenUnderlay = {
  id: qualifiedName("@vtt/system-simple/hp-bar"),
  priority: 10,
  mount: ({ tokenId, container, world, initialSize }) => {
    const c = container as Container;
    const w = world as World;

    const bg = new Graphics();
    bg.eventMode = "none";
    const fg = new Graphics();
    fg.eventMode = "none";
    c.addChild(bg);
    c.addChild(fg);

    let lastSize = initialSize;

    const draw = () => {
      bg.clear();
      fg.clear();

      const link = w.get(tokenId, [LinkedCharacter]) as
        | { LinkedCharacter: { characterId: EntityId } }
        | undefined;
      if (!link) {
        // Plain token (no linked character) — no HP to draw. Leave
        // the empty Graphics in place; if a future event attaches a
        // LinkedCharacter trait the redraw fires again.
        return;
      }
      const charId = link.LinkedCharacter.characterId;
      const vitals = w.get(charId, [Vitals]) as
        | { Vitals: { current: number } }
        | undefined;
      const max = w.get(charId, [MaxHp]) as { MaxHp: number } | undefined;
      // Only draw when both traits are attached. A character with no
      // game-system projection (rare in a system-simple world but
      // possible during a partial replay) shows no bar.
      if (!vitals || !max) return;
      const cur = Math.max(0, Math.min(vitals.Vitals.current, max.MaxHp));
      const ratio = max.MaxHp > 0 ? cur / max.MaxHp : 0;

      // Re-read sprite size each draw so the bar tracks size edits
      // (the GM can resize a token via Sprite.size; we shouldn't keep
      // drawing a stale-width bar after that).
      const sprite = w.get(tokenId, [Sprite]) as
        | { Sprite: { size: number } }
        | undefined;
      const size = sprite?.Sprite.size ?? lastSize;
      lastSize = size;

      const barWidth = size;
      const barHeight = 6;
      const barX = -barWidth / 2;
      const barY = size / 2 + 4;

      bg.roundRect(barX, barY, barWidth, barHeight, 2)
        .fill({ color: 0x222222, alpha: 0.85 })
        .stroke({ width: 1, color: 0x000000, alpha: 0.6 });

      // Colour the foreground based on remaining ratio: green at full,
      // amber under half, red under quarter. Hard cutoffs are easier
      // for players to read at a glance than a smooth gradient.
      const color =
        ratio > 0.5 ? 0x2ea043 : ratio > 0.25 ? 0xd29922 : 0xcf222e;
      const filledWidth = Math.max(0, Math.round(barWidth * ratio));
      if (filledWidth > 0) {
        fg.roundRect(barX, barY, filledWidth, barHeight, 2).fill({ color });
      }
    };

    draw();

    // Subscribe to the traits that affect this token's HP bar:
    //   - Sprite on the token  → size changes
    //   - LinkedCharacter on the token → re-resolves the character
    //   - Vitals / MaxHp on the linked character → values change
    // The canvas owns position/movedAt synchronisation; we don't need
    // to redraw on Position because the parent container's local
    // origin is glued to the sprite's centre.
    let lastCharacterId: EntityId | null = null;
    const link0 = w.get(tokenId, [LinkedCharacter]) as
      | { LinkedCharacter: { characterId: EntityId } }
      | undefined;
    if (link0) lastCharacterId = link0.LinkedCharacter.characterId;

    const off = w.subscribe((id, name) => {
      if (id === tokenId) {
        if (name === Sprite.name || name === LinkedCharacter.name) {
          // Refresh the cached character id so subsequent Vitals/MaxHp
          // mutations on a changed link still trigger redraws.
          const next = w.get(tokenId, [LinkedCharacter]) as
            | { LinkedCharacter: { characterId: EntityId } }
            | undefined;
          lastCharacterId = next ? next.LinkedCharacter.characterId : null;
          draw();
        }
        return;
      }
      if (
        lastCharacterId !== null &&
        id === lastCharacterId &&
        (name === Vitals.name || name === MaxHp.name)
      ) {
        draw();
      }
    });

    return () => {
      off();
      bg.clear();
      fg.clear();
    };
  },
};
