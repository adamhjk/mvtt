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

/**
 * The dice-tray plugin contributes only client-side rendering — no
 * traits, events, or commands of its own. It subscribes to
 * `@vtt/resolution/RollResolved` on the client bus and renders a
 * Babylon.js 3D tray when one arrives.
 *
 * This file is the public shared entry; nothing to export today, but
 * kept so the package layout matches every other plugin (the scaffold
 * pattern from `design/scaffold-mapping.md`).
 */
export {};
