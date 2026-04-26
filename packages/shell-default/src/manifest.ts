import { definePlugin } from "@vtt/substrate";
import {
  HeaderSurface,
  MainSurface,
  SidebarSurface,
  FooterSurface,
} from "./shared/surfaces.js";
import { ChromeView } from "./client/Chrome.js";

export const shellDefault = definePlugin({
  name: "@vtt/shell-default",
  version: "0.1.0",
  dependsOn: ["@vtt/substrate@^0"],
  surfaces: [HeaderSurface, MainSurface, SidebarSurface, FooterSurface],
  views: [ChromeView],
});

export default shellDefault;
