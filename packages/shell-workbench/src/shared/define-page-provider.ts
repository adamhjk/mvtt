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

import { qualifiedName, type TraitMeta } from "@vtt/substrate";
import type { PageProvider } from "./slots.js";

/**
 * Plugin-facing definer for a page kind. Mirrors the substrate definers
 * (`defineTrait`, `defineEvent`, etc.) so AI authors recognise the shape.
 *
 * The signature is structural — we don't need a runtime side beyond
 * branding the `kind` string (the slot's Zod parse already runs at load
 * time). The type assertion to `PageProvider` is the load-bearing
 * constraint that validates `list`/`render`/`defaultEntity` shapes against
 * their expected signatures at the call site.
 */
export function definePageProvider(def: {
  kind: string;
  icon?: string;
  label: string;
  /**
   * Traits this provider reads — the workbench uses these to subscribe
   * for fine-grained reactivity. See PageProvider['reads'] for the full
   * rationale.
   */
  reads: ReadonlyArray<TraitMeta>;
  list: PageProvider["list"];
  defaultEntity?: PageProvider["defaultEntity"];
  render: PageProvider["render"];
  summarizeTabState?: PageProvider["summarizeTabState"];
  priority?: number;
}): PageProvider {
  return {
    kind: qualifiedName(def.kind),
    icon: def.icon,
    label: def.label,
    reads: def.reads,
    list: def.list,
    defaultEntity: def.defaultEntity,
    render: def.render,
    summarizeTabState: def.summarizeTabState,
    priority: def.priority,
  };
}
