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

import type { JSX } from "solid-js";
import type { AtelierState } from "../use-atelier.js";
import { PoolCard } from "../cards/PoolCard.jsx";
import { ResultCard } from "../cards/ResultCard.jsx";
import { ModifiersCard } from "../cards/ModifiersCard.jsx";
import { InvocationsCard } from "../cards/InvocationsCard.jsx";
import { HelpCard } from "../cards/HelpCard.jsx";
import { PersonaNatureCard } from "../cards/PersonaNatureCard.jsx";

/**
 * Disposition test variant — pool + result formula on top. Modifier card
 * hides the ±Ob quick buttons (no obstacle in disposition); ResultCard
 * carries the add-to picker (PC) or within/outside Nature toggle
 * (monster). Persona / Channel Nature card is suppressed for monsters
 * inside its own Show.
 */
export function TbDispositionEditor(props: {
  atelier: AtelierState;
}): JSX.Element {
  return (
    <div class="grid gap-3 sm:grid-cols-2" data-testid="atelier-variant-disposition">
      <PoolCard atelier={props.atelier} />
      <ResultCard atelier={props.atelier} />
      <div class="sm:col-span-2">
        <ModifiersCard atelier={props.atelier} mode="disposition" />
      </div>
      <InvocationsCard atelier={props.atelier} />
      <HelpCard atelier={props.atelier} />
      <div class="sm:col-span-2">
        <PersonaNatureCard atelier={props.atelier} />
      </div>
    </div>
  );
}
