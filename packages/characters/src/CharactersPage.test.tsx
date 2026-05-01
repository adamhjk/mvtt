import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, cleanup, fireEvent } from "@solidjs/testing-library";
import {
  buildTestClient,
  mountWithClient,
} from "@vtt/substrate/client-testing";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { OwnedBy } from "@vtt/permissions/shared";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { shellWorkbench } from "@vtt/shell-workbench";
import { notes } from "@vtt/notes";
import { characters } from "./manifest.js";
import { Character } from "./shared/traits.js";
import { CreateCharacter } from "./shared/commands.js";
import { CharactersPageProvider } from "./client/CharactersPage.js";

beforeEach(() => cleanup());

const ME = "test-me";
const ME_CLIENT = "client-me";

function harness() {
  return buildTestClient({
    plugins: [shellWorkbench, notes, identity, permissions, characters],
    clientId: ME_CLIENT,
    session: {
      userId: ME,
      email: "me@test.dev",
      name: "Me",
      role: "player",
    },
    setupWorld: ({ world }) => {
      world.spawn([
        Identity({ userId: ME, role: "player" }),
        Name({ value: "Me" }),
        Online({ clientId: ME_CLIENT, since: Date.now() }),
      ]);
    },
  });
}

describe("CharactersPageProvider", () => {
  it("renders the empty hub when no characters exist", () => {
    const h = harness();
    mountWithClient(h, () =>
      CharactersPageProvider.render({
        tabId: "tab-1",
        entityId: null,
      }) as never,
    );
    expect(screen.getByText(/no characters yet/i)).toBeInTheDocument();
  });

  it("lists existing characters in the hub", () => {
    const h = harness();
    h.world.spawn([
      Character({ name: "Aelric" }),
      OwnedBy({ userId: ME }),
    ]);
    h.world.spawn([
      Character({ name: "Tarn" }),
      OwnedBy({ userId: ME }),
    ]);
    mountWithClient(h, () =>
      CharactersPageProvider.render({
        tabId: "tab-1",
        entityId: null,
      }) as never,
    );
    expect(screen.getByText("Aelric")).toBeInTheDocument();
    expect(screen.getByText("Tarn")).toBeInTheDocument();
  });

  it("dispatches CreateCharacter when the form is submitted", () => {
    const h = harness();
    mountWithClient(h, () =>
      CharactersPageProvider.render({
        tabId: "tab-1",
        entityId: null,
      }) as never,
    );
    const input = screen.getByPlaceholderText(/Tarn the Bold/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "New Hero" } });
    const submit = screen.getByRole("button", { name: /create character/i });
    fireEvent.click(submit);
    expect(h.dispatched.some((c) => c.type === CreateCharacter.name)).toBe(true);
    const create = h.dispatched.find((c) => c.type === CreateCharacter.name)!;
    expect((create.payload as { name: string }).name).toBe("New Hero");
  });

  it("does not dispatch when the name is empty", () => {
    const h = harness();
    mountWithClient(h, () =>
      CharactersPageProvider.render({
        tabId: "tab-1",
        entityId: null,
      }) as never,
    );
    const submit = screen.getByRole("button", { name: /create character/i });
    expect(submit).toBeDisabled();
  });

  it("renders the character sheet when entityId is set", () => {
    const h = harness();
    const id = h.world.spawn([
      Character({ name: "Tarn" }),
      OwnedBy({ userId: ME }),
    ]);
    mountWithClient(h, () =>
      CharactersPageProvider.render({
        tabId: "tab-1",
        entityId: id,
      }) as never,
    );
    // SheetShell mounts; the default Identity fill renders the name input.
    const nameInput = screen.getByDisplayValue("Tarn") as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
  });

  it("list() returns one entry per Character entity", () => {
    const h = harness();
    const a = h.world.spawn([Character({ name: "A" }), OwnedBy({ userId: ME })]);
    const b = h.world.spawn([Character({ name: "B" }), OwnedBy({ userId: ME })]);
    const list = CharactersPageProvider.list({
      world: h.world,
      userId: ME,
      role: "player",
    });
    expect(list).toEqual(
      expect.arrayContaining([
        { id: a, label: "A" },
        { id: b, label: "B" },
      ]),
    );
  });
});
