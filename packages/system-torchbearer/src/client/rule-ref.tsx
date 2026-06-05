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

// Tiny inline rule-citation chip — a `<BookCitation>` styled to flow
// with the surrounding muted-grey help text. Used wherever a TB tab
// points the player at a RAW rule (memory palace, library, level
// benefits, etc.) so the player can deep-link into the rulebook page
// for strict-RAW play.

import { BookCitation } from "@vtt/books/client";
import { createMemo, type JSX } from "solid-js";
import { TB_CANONICAL_BOOK_BY_ABBREVIATION } from "../data/seed.js";

export function RuleRef(props: {
  book: "DH" | "LMM" | "SG" | "CC";
  page: number;
  /** Optional override for the chip's visible label. */
  label?: string;
}): JSX.Element {
  const canonicalId = createMemo(() => TB_CANONICAL_BOOK_BY_ABBREVIATION[props.book]);
  return (
    <BookCitation
      canonicalId={canonicalId()}
      page={props.page}
      label={props.label ?? `${props.book} p.${props.page}`}
      className="inline-flex items-center gap-1 rounded-(--radius-control) border border-border-muted bg-surface-sunken px-1 py-0 text-[0.65rem] text-fg-muted hover:text-accent transition"
    />
  );
}
