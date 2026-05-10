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

const PREF_KEY = "mvtt-shell-preference";

export type ShellPreference = "mobile" | "desktop" | null;

/**
 * Read the user's explicit shell preference from localStorage.
 * Returns null when unset (auto-detect).
 */
export function getShellPreference(): ShellPreference {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(PREF_KEY);
  if (v === "mobile" || v === "desktop") return v;
  return null;
}

/**
 * Persist the user's explicit shell preference. Pass null to clear
 * (revert to auto-detect).
 */
export function setShellPreference(pref: ShellPreference): void {
  if (typeof localStorage === "undefined") return;
  if (pref === null) {
    localStorage.removeItem(PREF_KEY);
  } else {
    localStorage.setItem(PREF_KEY, pref);
  }
}

/**
 * Auto-detect whether this is a mobile device. Checked once at mount
 * time — does NOT react to window resizing. Uses `pointer: coarse` +
 * `hover: none` which targets finger-input devices that can't hover
 * (phones, tablets) and ignores desktop users who just shrink their
 * browser window.
 */
export function detectMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse) and (hover: none)").matches;
}

/**
 * Should the mobile shell be active? Reads preference first, falls
 * back to auto-detection. Called once at view mount time.
 */
export function shouldUseMobileShell(): boolean {
  const pref = getShellPreference();
  if (pref === "mobile") return true;
  if (pref === "desktop") return false;
  return detectMobileDevice();
}
