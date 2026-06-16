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

export { RulesLibrary, RulesCorpus } from "./traits.js";
export {
  RulesIndexingStarted,
  RulesIndexingCompleted,
  RulesIndexingFailed,
  RulesCorpusRemoved,
} from "./events.js";
export {
  IndexRules,
  RemoveRulesCorpus,
  MarkRulesIndexingCompleted,
  MarkRulesIndexingFailed,
} from "./commands.js";
export { RulesProfile, DEFAULT_RULES_PROFILE, type RulesProfileT } from "./profile.js";
export {
  pendingRulesQuery,
  publishRulesQuery,
  clearRulesQuery,
  __resetPendingRulesQueryForTests,
  type PendingRulesQuery,
} from "./pending-search.js";
