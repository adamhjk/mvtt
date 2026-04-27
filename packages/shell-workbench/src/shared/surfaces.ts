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
