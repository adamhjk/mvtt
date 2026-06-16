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

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import type { EntityId, EventInstance, WorldId, WorldRuntime } from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import {
  MarkRulesIndexingCompleted,
  MarkRulesIndexingFailed,
  RulesIndexingStarted,
  RulesCorpus,
} from "../shared/index.js";
import type { RulesSearchIndex, RulesChunkRow } from "./search-index.js";

/**
 * Server-side extraction runner. Subscribes to `RulesIndexingStarted`
 * on each world's bus, spawns `tools/rules-extract` against the
 * referenced asset, ingests the resulting `chunks.jsonl` into FTS5,
 * then dispatches `MarkRulesIndexing{Completed,Failed}` to flip the
 * corpus's status trait and broadcast the result to clients.
 *
 * One runner per server process; attach to each world runtime as it
 * boots. Synthetic GM session for completion dispatches — see the
 * trust-model note on `MarkRulesIndexingCompleted`.
 */
export class RulesExtractRunner {
  /**
   * @param deps
   *   - `index` — FTS5 wrapper for chunk storage.
   *   - `pluginDataDir` — root of `data/plugin-data` (assets and
   *     corpus dirs both live under this).
   *   - `cliEntry` — absolute path to `packages/rules-extract/src/cli.ts`.
   *   - `nodeBin` (optional) — path to node binary; defaults to
   *     `process.execPath`.
   *   - `profilesDir` (optional) — directory of fallback profile
   *     JSON files keyed by game-system plugin slug.
   */
  constructor(
    private readonly deps: {
      index: RulesSearchIndex;
      pluginDataDir: string;
      cliEntry: string;
      nodeBin?: string;
      profilesDir?: string;
    },
  ) {}

  /**
   * Subscribe to a runtime's bus. Returns an unsubscribe handle. The
   * runner stays alive across the runtime's lifetime; the WorldRegistry
   * calls the unsubscribe handle when it evicts the runtime.
   */
  attachToWorldRuntime(runtime: WorldRuntime): () => void {
    console.log(`[rules-corpus] runner attached to world ${runtime.worldId}`);
    const off = runtime.bus.onAny((ev: EventInstance) => {
      if (ev.type !== RulesIndexingStarted.name) return;
      const payload = ev.payload as {
        corpusId: EntityId;
        assetId: EntityId;
        tags: string[];
        gameSystemPlugin: string | null;
        issuedBy: { userId: string; email: string; name: string };
      };
      console.log(
        `[rules-corpus] received RulesIndexingStarted for corpus ${payload.corpusId} in world ${runtime.worldId}`,
      );
      // Don't await — the bus handler returns immediately and the
      // subprocess runs in the background. Failures dispatch the
      // failure command.
      void this.run(runtime, payload).catch((err: unknown) => {
        // Last-resort: failure path's failure path. Log and try to
        // mark the corpus failed so the GM sees the error in the UI.
        console.error(`[rules-corpus] runner crashed for corpus ${payload.corpusId}:`, err);
        void dispatchMarkFailed(
          runtime,
          payload.corpusId,
          String(err),
          issuerSession(payload.issuedBy),
        );
      });
    });
    return off;
  }

  private async run(
    runtime: WorldRuntime,
    args: {
      corpusId: EntityId;
      assetId: EntityId;
      tags: string[];
      gameSystemPlugin: string | null;
      issuedBy: { userId: string; email: string; name: string };
    },
  ): Promise<void> {
    const { corpusId, assetId, tags } = args;
    const session = issuerSession(args.issuedBy);
    const worldId = runtime.worldId as WorldId;
    console.log(
      `[rules-corpus] extraction started for corpus ${corpusId} (asset ${assetId}, world ${worldId}, issuedBy ${args.issuedBy.userId})`,
    );
    const assetPath = resolve(this.deps.pluginDataDir, worldId, "assets", assetId);
    if (!existsSync(assetPath)) {
      console.error(`[rules-corpus] asset bytes missing for corpus ${corpusId} at ${assetPath}`);
      await dispatchMarkFailed(
        runtime,
        corpusId,
        `asset bytes missing on disk at ${assetPath}`,
        session,
      );
      return;
    }
    const outDir = resolve(this.deps.pluginDataDir, worldId, "@vtt", "rules-corpus", assetId);
    mkdirSync(outDir, { recursive: true });

    // Resolve a profile, if any, from the world's gameSystemPlugin.
    const profileArg = this.resolveProfileArg(args.gameSystemPlugin);
    const cliArgs = [
      "--import",
      "tsx",
      this.deps.cliEntry,
      "--asset-path",
      assetPath,
      "--out-dir",
      outDir,
      "--tags",
      tags.join(","),
    ];
    if (args.gameSystemPlugin) {
      cliArgs.push("--game-system", args.gameSystemPlugin);
    }
    if (profileArg) {
      cliArgs.push("--profile", profileArg);
    }

    const nodeBin = this.deps.nodeBin ?? process.execPath;
    console.log(
      `[rules-corpus] spawning extract CLI for corpus ${corpusId}: ${nodeBin} ${cliArgs.join(" ")}`,
    );
    const startedAt = Date.now();
    const proc = spawn(nodeBin, cliArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      // Stream subprocess stderr through to the server log so progress
      // (e.g. per-page chunker output) is visible without tail-reading
      // a stash file. The CLI uses stderr for diagnostic logs and
      // reserves stdout for the final manifest JSON.
      const text = chunk.toString("utf8");
      stderr += text;
      for (const line of text.split("\n")) {
        if (line.length > 0) {
          console.log(`[rules-corpus] [extract ${corpusId}] ${line}`);
        }
      }
    });

    const exitCode = await new Promise<number>((res, rej) => {
      proc.on("close", res);
      proc.on("error", rej);
    });
    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[rules-corpus] extract CLI for corpus ${corpusId} exited code=${exitCode} after ${elapsedMs}ms`,
    );

    if (exitCode !== 0) {
      const detail = stderr.trim().split("\n").slice(0, 4).join(" — ") || "unknown error";
      await dispatchMarkFailed(
        runtime,
        corpusId,
        `extract-cli exit ${exitCode}: ${detail}`,
        session,
      );
      return;
    }

    // Parse the manifest from stdout (the CLI writes one JSON line on
    // success). chunks.jsonl is on disk; load it and insert into FTS5.
    let manifest: {
      title: string | null;
      pageCount: number;
      indexedAt: number;
    };
    try {
      const lastLine = stdout.trim().split("\n").pop() ?? "";
      manifest = JSON.parse(lastLine);
    } catch (err) {
      await dispatchMarkFailed(
        runtime,
        corpusId,
        `extract-cli stdout was not valid manifest JSON: ${(err as Error).message}`,
        session,
      );
      return;
    }

    try {
      const chunks = loadChunksJsonl(resolve(outDir, "chunks.jsonl"));
      this.deps.index.insertChunks({ worldId, corpusId, chunks });
    } catch (err) {
      await dispatchMarkFailed(
        runtime,
        corpusId,
        `FTS5 insert failed: ${(err as Error).message}`,
        session,
      );
      return;
    }

    // Sanity-check that the corpus entity still exists (it could have
    // been removed mid-extraction). If gone, drop FTS5 rows back out
    // and don't dispatch a completion.
    if (!runtime.world.has(corpusId)) {
      console.warn(
        `[rules-corpus] corpus ${corpusId} disappeared mid-extraction; rolling back FTS5 rows`,
      );
      this.deps.index.removeCorpus(worldId, corpusId);
      return;
    }
    // Skip dispatch if the corpus already moved past pending/indexing
    // (e.g. someone double-completed it).
    const got = runtime.world.get(corpusId, [RulesCorpus]) as
      | { RulesCorpus: { status: string } }
      | undefined;
    if (got && got.RulesCorpus.status === "ready") {
      console.log(`[rules-corpus] corpus ${corpusId} already ready; skipping completion dispatch`);
      return;
    }

    console.log(
      `[rules-corpus] dispatching MarkRulesIndexingCompleted for corpus ${corpusId} (pageCount=${manifest.pageCount}, title=${JSON.stringify(manifest.title)})`,
    );
    const completionResult = await runtime.pipeline.dispatch({
      id: `rules-complete-${randomBytes(8).toString("hex")}`,
      issuedBy: "server-rules-extract" as never,
      issuedAt: Date.now(),
      cmd: MarkRulesIndexingCompleted({
        corpusId,
        pageCount: manifest.pageCount,
        title: manifest.title,
        indexedAt: manifest.indexedAt,
      }),
      session,
    });
    // dispatch resolves with `result.ok = false` for validator rejection
    // — no exception, so a silent failure here would strand the corpus in
    // `pending`. Surface and downgrade to a failure mark so the GM sees
    // *something* in the UI rather than a perma-spinner.
    if (!completionResult.result.ok) {
      const reason = completionResult.result.reason ?? "unknown";
      console.error(
        `[rules-corpus] MarkRulesIndexingCompleted rejected for corpus ${corpusId}: ${reason}`,
      );
      await dispatchMarkFailed(
        runtime,
        corpusId,
        `completion dispatch rejected: ${reason}`,
        session,
      );
    } else {
      console.log(`[rules-corpus] corpus ${corpusId} marked ready (worldId=${worldId})`);
    }
  }

  private resolveProfileArg(gameSystemPlugin: string | null): string | null {
    if (!gameSystemPlugin || !this.deps.profilesDir) return null;
    // Profile filename: trailing slug after the last `/`. e.g.
    // `@vtt/system-torchbearer` → `system-torchbearer.json`.
    const slug = gameSystemPlugin.split("/").pop() ?? gameSystemPlugin;
    const path = resolve(this.deps.profilesDir, `${slug}.json`);
    return existsSync(path) ? path : null;
  }
}

/**
 * Rebuild an AuthSession from the `issuedBy` payload of a
 * `RulesIndexingStarted` event. The role is fixed to `"gm"` because
 * `IndexRules`'s validator already gated `role === "gm"` — this is just
 * threading the originating user back through the runner-issued
 * completion / failure dispatches so they're auditable and don't need a
 * synthetic system actor that drifts away from the auth-session schema.
 */
function issuerSession(issuedBy: { userId: string; email: string; name: string }): AuthSession {
  return {
    userId: issuedBy.userId,
    email: issuedBy.email,
    name: issuedBy.name,
    role: "gm",
  };
}

async function dispatchMarkFailed(
  runtime: WorldRuntime,
  corpusId: EntityId,
  error: string,
  session: AuthSession,
): Promise<void> {
  if (!runtime.world.has(corpusId)) return;
  console.log(
    `[rules-corpus] dispatching MarkRulesIndexingFailed for corpus ${corpusId}: ${error}`,
  );
  try {
    const res = await runtime.pipeline.dispatch({
      id: `rules-fail-${randomBytes(8).toString("hex")}`,
      issuedBy: "server-rules-extract" as never,
      issuedAt: Date.now(),
      cmd: MarkRulesIndexingFailed({ corpusId, error }),
      session,
    });
    if (!res.result.ok) {
      console.error(
        `[rules-corpus] MarkRulesIndexingFailed rejected for corpus ${corpusId}: ${res.result.reason ?? "unknown"} (original error: ${error})`,
      );
    }
  } catch (err) {
    console.error(`[rules-corpus] failed to mark corpus ${corpusId} failed:`, err);
  }
}

function loadChunksJsonl(path: string): RulesChunkRow[] {
  const raw = readFileSync(path, "utf8");
  const out: RulesChunkRow[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const obj = JSON.parse(line) as {
        chunkId: string;
        pdfPage: number;
        pdfPageEnd: number | null;
        printedPage: string | number | null;
        printedPageEnd: string | number | null;
        headingPath: string[];
        body: string;
      };
      out.push({
        chunkId: obj.chunkId,
        pdfPage: obj.pdfPage,
        pdfPageEnd: obj.pdfPageEnd,
        printedPage: obj.printedPage,
        printedPageEnd: obj.printedPageEnd,
        headingPath: obj.headingPath,
        body: obj.body,
      });
    } catch {
      // skip malformed
    }
  }
  return out;
}
