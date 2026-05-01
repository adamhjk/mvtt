// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import type { PluginDef } from "./define.js";

/**
 * Extract the plugin name out of a `dependsOn` spec string. Specs look
 * like `"@scope/name@semver"` or just `"@scope/name"`. The plugin name
 * itself starts with `@`, so we split on the *second* `@`.
 */
function specToName(spec: string): string {
  const at = spec.indexOf("@", 1);
  return at === -1 ? spec : spec.slice(0, at);
}

export interface ActivePluginSet {
  /** Plugins to load for this world's Registry, in topological-ish order. */
  readonly plugins: ReadonlyArray<PluginDef>;
  /** The chosen game-system plugin, for convenience. */
  readonly gameSystem: PluginDef;
}

/**
 * Build the per-world active plugin set:
 *   infrastructure ∪ chosenGameSystem ∪ chosenGameSystem's transitive dependsOn
 *
 * `infrastructure` is whatever plugins the deployment considers
 * always-on (auth, identity, permissions, comms, shell-workbench, etc.
 * — the substrate doesn't hardcode this). `optional` is the universe of
 * non-infrastructure plugins compiled into the binary; the resolver
 * picks the chosen game system out of it and walks its dependency graph.
 *
 * Throws if the named game-system plugin isn't present in `optional` or
 * isn't actually marked `gameSystem: true`, or if any transitive
 * dependency can't be resolved against `infrastructure ∪ optional`.
 *
 * Plugins that depend on the substrate-core plugin (`@vtt/substrate`)
 * silently get the substrate's own auto-loaded core — those entries in
 * dependsOn are ignored here since the Registry already includes it.
 */
export function resolveActivePlugins(
  args: {
    infrastructure: ReadonlyArray<PluginDef>;
    optional: ReadonlyArray<PluginDef>;
    gameSystemPlugin: string;
  },
): ActivePluginSet {
  const { infrastructure, optional, gameSystemPlugin } = args;
  const all = new Map<string, PluginDef>();
  for (const p of infrastructure) all.set(p.name, p);
  for (const p of optional) all.set(p.name, p);

  const game = all.get(gameSystemPlugin);
  if (!game) {
    throw new Error(
      `unknown game-system plugin ${JSON.stringify(gameSystemPlugin)}; ` +
        `not in infrastructure or optional plugin set`,
    );
  }
  if (!game.gameSystem) {
    throw new Error(
      `plugin ${JSON.stringify(gameSystemPlugin)} is not marked gameSystem: true`,
    );
  }

  const visited = new Set<string>();
  // Always include infrastructure. Order: infra first (registry load
  // order matters — fills have to follow slots, and validators run in
  // accumulation order), game-system + its deps appended after.
  const out: PluginDef[] = [];
  for (const p of infrastructure) {
    if (visited.has(p.name)) continue;
    visited.add(p.name);
    out.push(p);
  }

  const visit = (p: PluginDef): void => {
    if (visited.has(p.name)) return;
    visited.add(p.name);
    for (const spec of p.dependsOn) {
      const depName = specToName(spec);
      // The substrate-core plugin is auto-loaded by the Registry; entries
      // referencing `@vtt/substrate` aren't separate PluginDefs we need
      // to walk. Skip silently.
      if (depName === "@vtt/substrate") continue;
      const dep = all.get(depName);
      if (!dep) {
        throw new Error(
          `plugin ${JSON.stringify(p.name)} depends on ` +
            `${JSON.stringify(spec)}, but ${JSON.stringify(depName)} ` +
            `is not present in the active plugin set`,
        );
      }
      visit(dep);
    }
    out.push(p);
  };

  visit(game);

  return { plugins: out, gameSystem: game };
}

/**
 * Filter the universe of optional plugins to just those marked
 * `gameSystem: true`. Used by the HTTP API to expose
 * `GET /api/game-systems` for the world-creation UI.
 */
export function listGameSystems(
  optional: ReadonlyArray<PluginDef>,
): ReadonlyArray<PluginDef> {
  return optional.filter((p) => p.gameSystem === true);
}
