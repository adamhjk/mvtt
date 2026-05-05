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

import { Show, type JSX } from "solid-js";

/**
 * Theme-aware item icon. The repo's icon set (Game-Icons.net under
 * `assets/icons/ffffff/transparent/1x1/`) ships *only* a white-on-
 * transparent variant — fine for dark mode, invisible on light. We
 * render via CSS `mask-image` so the glyph takes on `currentColor`,
 * which inherits from the surrounding text colour and follows the
 * theme's `--color-fg` automatically when light/dark flips.
 *
 * `src` is the local serving path the catalog stores in
 * `ItemIdentity.img` (e.g. `/icons/lorc/arrow-cluster.svg`). Empty
 * string skips the render — the caller decides whether to leave
 * blank space or substitute a glyph.
 */
export function ItemIcon(props: {
  src: string;
  size?: number;
  title?: string;
  class?: string;
}): JSX.Element {
  const size = (): number => props.size ?? 20;
  return (
    <Show when={props.src}>
      <span
        role="img"
        aria-label={props.title ?? ""}
        title={props.title}
        class={props.class}
        style={{
          display: "inline-block",
          width: `${size()}px`,
          height: `${size()}px`,
          "background-color": "currentColor",
          "-webkit-mask": `url(${props.src}) center / contain no-repeat`,
          mask: `url(${props.src}) center / contain no-repeat`,
          "vertical-align": "middle",
          "flex-shrink": 0,
        }}
      />
    </Show>
  );
}
