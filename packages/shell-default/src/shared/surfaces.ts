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
