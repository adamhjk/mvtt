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

export { ConflictPageProvider } from "./ConflictPage.js";
export { ActionMatrix } from "./ActionMatrix.js";
export { ArmorPanel } from "./ArmorPanel.js";
export { CompromisePanel } from "./CompromisePanel.js";
export { ConditionsPanel } from "./ConditionsPanel.js";
export { ResolutionRow } from "./ResolutionRow.js";
export { ScriptInline } from "./ScriptInline.js";
export { TeamColumn } from "./TeamColumn.js";
export { TopStripe } from "./TopStripe.js";
// Legacy components — kept exported so existing component tests
// still compile. The live ConflictBoard no longer mounts them.
export { RosterColumn } from "./RosterColumn.js";
export { RoundBand } from "./RoundBand.js";
