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

import { defineView, clientOnly } from "@vtt/substrate";
import { WorkbenchHeaderSurface } from "@vtt/shell-workbench/shared";
import { setShellPreference } from "./detect.js";

/**
 * Header chip in the workbench that flips the shell preference to
 * "mobile" and reloads. Mirrors the workbench-bound "Switch to desktop
 * layout" button inside the MobileMenu, so the switch is symmetric
 * from either shell.
 *
 * Contributed by @vtt/shell-mobile into @vtt/shell-workbench's stacked
 * header surface. Renders unconditionally while the workbench is
 * active — there's no risk of double-rendering since the mobile and
 * workbench shells are mutually exclusive on RootSurface.
 */
export const SwitchToMobileButtonView = defineView({
  name: "SwitchToMobileButton",
  surface: WorkbenchHeaderSurface,
  // Low priority so it sits to the left of higher-priority chips
  // (identity's UserMenu is priority 0; this stacks before it).
  priority: -10,
  render: clientOnly(() => {
    const switchToMobile = () => {
      setShellPreference("mobile");
      window.location.reload();
    };
    return (
      <button
        type="button"
        onClick={switchToMobile}
        title="Switch to mobile layout"
        aria-label="Switch to mobile layout"
        data-testid="switch-to-mobile"
        class="inline-flex h-7 w-7 items-center justify-center rounded-(--radius-control) border border-border bg-surface-elevated text-fg-muted hover:border-accent hover:text-fg transition"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="6" y="2" width="8" height="16" rx="1.5" />
          <line x1="9" y1="15" x2="11" y2="15" />
        </svg>
      </button>
    );
  }),
});
