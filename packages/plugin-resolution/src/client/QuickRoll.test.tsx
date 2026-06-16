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

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { buildTestClient, mountWithClient } from "@vtt/substrate/client-testing";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { characters } from "@vtt/characters";
import { comms } from "@vtt/comms";
import { shellWorkbench } from "@vtt/shell-workbench";
import { notes } from "@vtt/notes";
import { resolution } from "../manifest.js";
import { RequestRoll } from "../shared/commands.js";
import { QuickRollComposerFill } from "./QuickRoll.js";

beforeEach(() => cleanup());

const ME = "test-me";
const ME_CLIENT = "client-me";

function harness(opts?: { asGm?: boolean }) {
  return buildTestClient({
    plugins: [shellWorkbench, notes, identity, permissions, characters, comms, resolution],
    clientId: ME_CLIENT,
    session: {
      userId: ME,
      email: "me@test.dev",
      name: "Me",
      role: opts?.asGm ? "gm" : "player",
    },
    setupWorld: ({ world }) => {
      world.spawn([
        Identity({ userId: ME, role: opts?.asGm ? "gm" : "player" }),
        Name({ value: "Me" }),
        Online({ clientId: ME_CLIENT, since: 0 }),
      ]);
    },
  });
}

describe("resolution quick-roll composer", () => {
  it("renders a notation input and Roll button", () => {
    const h = harness();
    mountWithClient(h, () => QuickRollComposerFill.render({ onClose: () => {} }) as never);
    expect(screen.getByTestId("atelier-quick-roll-input")).toBeInTheDocument();
    expect(screen.getByTestId("atelier-quick-roll-submit")).toBeInTheDocument();
  });

  it("dispatches RequestRoll with the typed notation, then closes", () => {
    const h = harness();
    const onClose = vi.fn();
    mountWithClient(h, () => QuickRollComposerFill.render({ onClose }) as never);
    const input = screen.getByTestId("atelier-quick-roll-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "2d6+1" } });
    fireEvent.click(screen.getByTestId("atelier-quick-roll-submit"));
    expect(h.dispatched).toHaveLength(1);
    const cmd = h.dispatched[0]!;
    expect(cmd.type).toBe(RequestRoll.name);
    expect(cmd.payload).toMatchObject({
      notation: "2d6+1",
      visibility: "public",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch on an empty notation", () => {
    const h = harness();
    const onClose = vi.fn();
    mountWithClient(h, () => QuickRollComposerFill.render({ onClose }) as never);
    fireEvent.click(screen.getByTestId("atelier-quick-roll-submit"));
    expect(h.dispatched).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancel closes without dispatching", () => {
    const h = harness();
    const onClose = vi.fn();
    mountWithClient(h, () => QuickRollComposerFill.render({ onClose }) as never);
    fireEvent.click(screen.getByTestId("atelier-quick-roll-cancel"));
    expect(h.dispatched).toHaveLength(0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
