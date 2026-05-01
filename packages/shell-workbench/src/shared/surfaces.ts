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

import { defineSurface, z } from "@vtt/substrate";

/**
 * The workbench's top-of-page slot. Logo, presence chips, palette trigger,
 * GM tools land here.
 */
export const WorkbenchHeaderSurface = defineSurface({
  name: "@vtt/shell-workbench/header",
  kind: "stacked",
  context: z.object({}),
  description:
    "Top bar of the workbench. Logo, presence chips, palette trigger.",
});

/**
 * Persistent right-rail chat surface. Comms (and future plugins) drop their
 * stream + composer + side widgets here. Same `stacked` shape as the
 * default shell's SidebarSurface so existing comms views can target either.
 */
export const WorkbenchChatRailSurface = defineSurface({
  name: "@vtt/shell-workbench/chat-rail",
  kind: "stacked",
  context: z.object({}),
  description:
    "Right-rail chat. Stream + composer + presence/dice widgets stack here.",
});

/**
 * Palette overlay slot — the fuzzy search dialog plus any plugin-supplied
 * extras (e.g. an inline date picker for a future "schedule next session"
 * command). Stacked so contributions render in priority order over the
 * core palette view.
 */
export const PaletteSurface = defineSurface({
  name: "@vtt/shell-workbench/palette",
  kind: "stacked",
  context: z.object({}),
  description:
    "Quick-switcher overlay. Stacked so plugins can add ad-hoc UI.",
});
