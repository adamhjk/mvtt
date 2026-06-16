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

import { beforeEach, describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, screen } from "@solidjs/testing-library";
import { buildTestClient, mountWithClient } from "@vtt/substrate/client-testing";
import { ConnectionBanner } from "./ConnectionBanner";

/**
 * Drive the banner through the full disconnect/reconnect/resync cycle by
 * substituting live signals for the harness's static connected/synced
 * accessors — the banner only reads those two, so the rest of the fake
 * `ClientHandle` serves as-is.
 */
function mountBanner(initial: { connected: boolean; synced: boolean }) {
  const h = buildTestClient({ plugins: [] });
  const [connected, setConnected] = createSignal(initial.connected);
  const [synced, setSynced] = createSignal(initial.synced);
  mountWithClient({ ...h, client: { ...h.client, connected, synced } }, () => <ConnectionBanner />);
  return { setConnected, setSynced };
}

describe("ConnectionBanner", () => {
  beforeEach(() => cleanup());

  it("renders nothing during the initial handshake (never synced yet)", () => {
    mountBanner({ connected: false, synced: false });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stays hidden while connected and synced", () => {
    mountBanner({ connected: true, synced: true });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows 'reconnecting' when an established session loses its socket", () => {
    const { setConnected, setSynced } = mountBanner({
      connected: true,
      synced: true,
    });
    // The drop: connection layer resets both signals.
    setConnected(false);
    setSynced(false);
    const banner = screen.getByRole("status");
    expect(banner.textContent).toMatch(/reconnecting/i);
    expect(banner.textContent).toMatch(/won't be saved/i);
  });

  it("shows 'catching up' between reconnect and resync, then hides", () => {
    const { setConnected, setSynced } = mountBanner({
      connected: true,
      synced: true,
    });
    setConnected(false);
    setSynced(false);
    // Socket re-established; snapshot replay still in flight.
    setConnected(true);
    expect(screen.getByRole("status").textContent).toMatch(/catching up/i);
    // `synced` arrives: banner clears.
    setSynced(true);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("never flashes during first connect→sync even as signals flip", () => {
    const { setConnected, setSynced } = mountBanner({
      connected: false,
      synced: false,
    });
    setConnected(true); // connected but still catching up — initial load
    expect(screen.queryByRole("status")).toBeNull();
    setSynced(true);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
