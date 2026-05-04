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

import { qualifiedName, type CommandInstance, type EntityId } from "@vtt/substrate";
import { useClient, useTrait } from "@vtt/substrate/client";
import { createSignal, Show, type JSX } from "solid-js";
import {
  type BookConfigSection,
  type BookConfigSectionRenderArgs,
} from "@vtt/books/shared";
import { PdfDocument } from "../shared/traits.js";
import { SetPdfDocument } from "../shared/commands.js";
import { useMe } from "./use-me.js";

/**
 * PDF upload section inside the Book's built-in Config tab. Mirrors
 * the way @vtt/scene's Config tab houses the background-image upload
 * alongside name/grid/colors — all per-book settings live in one
 * tab, regardless of which plugin owns each one.
 *
 * Plumbing: the upload POSTs raw bytes to the centralized assets
 * endpoint (`/api/worlds/<worldId>/assets/upload`); on success it
 * dispatches SetPdfDocument with the returned assetId, binding this
 * Book to that asset. GM-only.
 *
 * v0 has no "remove" button — to clear the PDF the GM either binds a
 * different asset or removes the whole Book.
 */
export const PdfConfigSection: BookConfigSection = {
  id: qualifiedName("@vtt/pdf-book/config-pdf"),
  // Below the built-in Name section (priority 100). Lower numbers
  // sort further down the Config tab.
  priority: 80,
  render: (args: BookConfigSectionRenderArgs): JSX.Element => {
    return <PdfConfigBody bookId={args.bookId} />;
  },
};

interface UploadResponse {
  assetId: string;
  url: string;
  deduped?: boolean;
}

function PdfConfigBody(props: { bookId: string }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const isGm = () => me()?.role === "gm";
  const doc = useTrait(props.bookId, PdfDocument);

  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let fileInput: HTMLInputElement | undefined;

  const upload = async (file: File) => {
    setError(null);
    const worldId = client.worldId();
    if (!worldId) {
      setError("not connected to a world");
      return;
    }
    const url = `/api/worlds/${encodeURIComponent(worldId)}/assets/upload`;
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        body: file,
        credentials: "same-origin",
        headers: {
          "content-type": "application/pdf",
          "x-filename": file.name,
        },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `upload failed (${res.status})`);
      }
      const body = (await res.json()) as UploadResponse;
      client.dispatch(
        SetPdfDocument({
          bookId: props.bookId,
          assetId: body.assetId as EntityId,
        }) as CommandInstance,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileInput) fileInput.value = "";
    }
  };

  return (
    <label class="flex flex-col gap-2">
      <span class="font-display text-[0.6rem] uppercase tracking-[0.2em] text-fg-subtle">
        PDF
      </span>
      <div class="flex items-start gap-3">
        <div
          class="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-(--radius-control) border border-border bg-surface"
          aria-label="current pdf state"
        >
          <Show
            when={doc()?.assetId}
            fallback={
              <span class="font-display text-[0.55rem] uppercase tracking-[0.18em] text-fg-subtle">
                no PDF
              </span>
            }
          >
            <span class="font-display text-[0.55rem] uppercase tracking-[0.18em] text-fg-muted">
              PDF loaded
            </span>
          </Show>
        </div>

        <div class="flex flex-1 flex-col gap-2">
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!isGm() || busy()}
              onClick={() => fileInput?.click()}
              class="rounded-(--radius-control) bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover transition disabled:opacity-50"
            >
              {busy() ? "Uploading…" : doc()?.assetId ? "Replace…" : "Upload PDF…"}
            </button>
          </div>
          <p class="text-[0.7rem] text-fg-subtle">
            PDF only. Max 250 MB. Replacing the PDF takes effect for every
            connected player as soon as the upload completes.
          </p>
          <Show when={error()}>
            <p class="rounded-(--radius-control) border border-danger/40 bg-danger/10 px-2 py-1 text-[0.7rem] text-danger">
              {error()}
            </p>
          </Show>
          <Show when={doc()?.assetId}>
            <p class="break-all rounded-(--radius-control) bg-surface-sunken px-2 py-1 font-mono text-[0.65rem] text-fg-muted">
              asset {doc()!.assetId}
            </p>
          </Show>
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        class="hidden"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) void upload(file);
        }}
      />
    </label>
  );
}
