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

import { qualifiedName, type EntityId } from "@vtt/substrate";
import { useTrait } from "@vtt/substrate/client";
import {
  PendingRoll,
  type PendingRollEditor,
  type PendingRollEditorArgs,
} from "@vtt/characters/shared";
import { Match, Show, Switch, type JSX } from "solid-js";
import { useAtelier } from "./use-atelier.js";
import { TopStrip } from "./TopStrip.jsx";
import { TbIndependentEditor } from "./variants/Independent.jsx";
import { TbVersusEditor } from "./variants/Versus.jsx";
import { TbDispositionEditor } from "./variants/Disposition.jsx";
import { FooterActions } from "./cards/FooterActions.jsx";

function TbAtelierEditorBody(props: {
  rollId: EntityId;
  initiatorCharacterId: EntityId;
}): JSX.Element {
  const atelier = useAtelier(props.rollId, props.initiatorCharacterId);
  const mode = atelier.activeMode;

  return (
    <article
      class="flex flex-col gap-3"
      data-testid="atelier-editor"
      data-mode={mode()}
    >
      <TopStrip atelier={atelier} mode={mode()} />
      <Switch>
        <Match when={mode() === "disposition"}>
          <TbDispositionEditor atelier={atelier} />
        </Match>
        <Match when={mode() === "versus"}>
          <TbVersusEditor atelier={atelier} />
        </Match>
        <Match when={true}>
          <TbIndependentEditor atelier={atelier} />
        </Match>
      </Switch>
      <FooterActions atelier={atelier} mode={mode()} />
    </article>
  );
}

/**
 * Outer wrapper that defers mounting the hook (and the trait
 * subscriptions inside it) until the PendingRoll trait has landed.
 * Keeps `useAtelier` honest — by the time it runs, both the rollId and
 * the initiator character id are known good and the trait subscriptions
 * have stable targets.
 */
function TbAtelierEditorFor(args: PendingRollEditorArgs): JSX.Element {
  const pr = useTrait(args.rollId, PendingRoll);
  return (
    <Show when={pr()}>
      {(prAcc) => (
        <TbAtelierEditorBody
          rollId={args.rollId}
          initiatorCharacterId={prAcc().initiatorCharacterId as EntityId}
        />
      )}
    </Show>
  );
}

export const TbAtelierEditor: PendingRollEditor = {
  id: qualifiedName("@vtt/system-torchbearer/atelier-editor") as PendingRollEditor["id"],
  priority: 100,
  rollablePrefix: "@vtt/system-torchbearer/",
  render: (args) => TbAtelierEditorFor(args),
};
