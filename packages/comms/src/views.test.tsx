import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, cleanup, fireEvent } from "@solidjs/testing-library";
import {
  buildTestClient,
  mountWithClient,
} from "@vtt/substrate/client-testing";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { characters } from "@vtt/characters";
import { shellWorkbench } from "@vtt/shell-workbench";
import { notes } from "@vtt/notes";
import { comms } from "./manifest.js";
import { SendMessage } from "./shared/commands.js";
import { ChatMessage } from "./shared/traits.js";
import { ChatComposerView, ChatStreamView } from "./client/views.js";

beforeEach(() => cleanup());

const ME = "test-me";
const ME_CLIENT = "client-me";

function harness(opts?: { asGm?: boolean }) {
  return buildTestClient({
    plugins: [shellWorkbench, notes, identity, permissions, characters, comms],
    clientId: ME_CLIENT,
    session: {
      userId: ME,
      email: "me@test.dev",
      name: "Me",
      role: opts?.asGm ? "gm" : "player",
    },
    setupWorld: ({ world }) => {
      // useMe-style helpers in the composer match identity entities by
      // clientId; spawn the matching presence so the composer enables.
      world.spawn([
        Identity({ userId: ME, role: opts?.asGm ? "gm" : "player" }),
        Name({ value: "Me" }),
        Online({ clientId: ME_CLIENT, since: Date.now() }),
      ]);
    },
  });
}

describe("comms ChatComposerView", () => {
  it("renders the composer input and Send button", () => {
    const h = harness();
    mountWithClient(h, () => ChatComposerView.render({}) as never);
    expect(screen.getByPlaceholderText(/say something/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("dispatches SendMessage with the typed body on submit", () => {
    const h = harness();
    mountWithClient(h, () => ChatComposerView.render({}) as never);
    const input = screen.getByPlaceholderText(/say something/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "hello world" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(h.dispatched).toHaveLength(1);
    const cmd = h.dispatched[0]!;
    expect(cmd.type).toBe(SendMessage.name);
    expect(cmd.payload).toMatchObject({
      body: "hello world",
      visibility: "public",
    });
  });

  it("clears the input after a successful send", () => {
    const h = harness();
    mountWithClient(h, () => ChatComposerView.render({}) as never);
    const input = screen.getByPlaceholderText(/say something/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "ack" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(input.value).toBe("");
  });

  it("does not dispatch when the input is empty whitespace", () => {
    const h = harness();
    mountWithClient(h, () => ChatComposerView.render({}) as never);
    const input = screen.getByPlaceholderText(/say something/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(h.dispatched).toHaveLength(0);
  });

  it("shows the GM-only checkbox when the user is a GM and routes the message accordingly", () => {
    const h = harness({ asGm: true });
    mountWithClient(h, () => ChatComposerView.render({}) as never);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox).toBeInTheDocument();
    fireEvent.click(checkbox);
    const input = screen.getByPlaceholderText(/say something/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(h.dispatched).toHaveLength(1);
    expect((h.dispatched[0]!.payload as { visibility: string }).visibility).toBe(
      "gm-only",
    );
  });

  it("hides the GM-only checkbox for non-GM users", () => {
    const h = harness({ asGm: false });
    mountWithClient(h, () => ChatComposerView.render({}) as never);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("comms ChatStreamView", () => {
  it("renders existing chat messages from the world", async () => {
    const h = harness();
    h.world.spawn([
      ChatMessage({
        body: "first thought",
        authorUserId: "u1",
        authorName: "Adam",
        sentAt: 100,
      }),
    ]);
    h.world.spawn([
      ChatMessage({
        body: "second thought",
        authorUserId: "u1",
        authorName: "Adam",
        sentAt: 200,
      }),
    ]);
    mountWithClient(h, () => ChatStreamView.render({}) as never);
    expect(await screen.findByText("first thought")).toBeInTheDocument();
    expect(await screen.findByText("second thought")).toBeInTheDocument();
  });
});
