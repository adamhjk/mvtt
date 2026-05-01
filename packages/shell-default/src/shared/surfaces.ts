// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { defineSurface, z } from "@vtt/substrate";

export const HeaderSurface = defineSurface({
  name: "@vtt/shell-default/header",
  kind: "stacked",
  context: z.object({}),
  description: "Top bar of the page. Logo, status, GM controls.",
});

export const MainSurface = defineSurface({
  name: "@vtt/shell-default/main",
  kind: "stacked",
  context: z.object({}),
  description: "Primary content column. Scenes, sheets, chat panes go here.",
});

export const SidebarSurface = defineSurface({
  name: "@vtt/shell-default/sidebar",
  kind: "stacked",
  context: z.object({}),
  description: "Right rail. Initiative, quick references, mini-maps.",
});

export const FooterSurface = defineSurface({
  name: "@vtt/shell-default/footer",
  kind: "stacked",
  context: z.object({}),
  description: "Bottom bar. Dice tray, hotbar, status.",
});
