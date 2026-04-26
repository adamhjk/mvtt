import { definePlugin, type Visibility } from "@vtt/substrate";
import { EntityVisibility, OwnedBy } from "./shared/traits.js";

/**
 * Permissions is the *contract* plugin — visibility builders, ownership
 * traits, and the entity-visibility resolver that the substrate uses for
 * per-recipient snapshot filtering. The substrate stays trait-agnostic:
 * it just runs the resolver permissions registers below to translate
 * `EntityVisibility{visibility}` into the substrate's union shape.
 */
export const permissions = definePlugin({
  name: "@vtt/permissions",
  version: "0.1.0",
  dependsOn: ["@vtt/substrate@^0", "@vtt/auth@^0", "@vtt/identity@^0"],
  traits: [OwnedBy, EntityVisibility],
  entityVisibility: (traits) => {
    const ev = traits[EntityVisibility.name] as
      | { visibility: Visibility }
      | undefined;
    return ev?.visibility ?? null;
  },
});

export default permissions;
