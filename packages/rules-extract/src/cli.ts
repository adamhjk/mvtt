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

// Invoked via tsx (e.g. `pnpm rules-extract`); no shebang because the
// file would need to live at line 1 ahead of the AGPL header, which
// the license-headers validator rejects.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { RulesProfile } from "@vtt/rules-corpus/shared";
import { extractCorpus } from "./extract.js";

interface ParsedArgs {
  values: {
    "asset-path"?: string;
    "out-dir"?: string;
    profile?: string;
    tags?: string;
    title?: string;
    "game-system"?: string;
    help?: boolean;
  };
}

function usage(): void {
  process.stderr.write(
    [
      "Usage: rules-extract --asset-path <pdf> --out-dir <dir> [options]",
      "",
      "Required:",
      "  --asset-path <pdf>      Source PDF path.",
      "  --out-dir <dir>         Output directory; will be created if missing.",
      "",
      "Optional:",
      "  --profile <json>        Path to a JSON-serialised RulesProfile.",
      "  --tags <csv>            Comma-separated tags for skill aliasing.",
      "  --title <string>        Override title (else: PDF metadata or filename).",
      "  --game-system <name>    Game-system plugin name (recorded in manifest).",
      "  --help                  Show this message and exit.",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        "asset-path": { type: "string" },
        "out-dir": { type: "string" },
        profile: { type: "string" },
        tags: { type: "string" },
        title: { type: "string" },
        "game-system": { type: "string" },
        help: { type: "boolean" },
      },
      strict: true,
    }) as ParsedArgs;
  } catch (err) {
    process.stderr.write(`error parsing args: ${(err as Error).message}\n`);
    usage();
    process.exit(2);
  }

  if (parsed.values.help) {
    usage();
    process.exit(0);
  }

  if (!parsed.values["asset-path"] || !parsed.values["out-dir"]) {
    usage();
    process.exit(2);
  }

  const profile = parsed.values.profile
    ? RulesProfile.parse(JSON.parse(readFileSync(parsed.values.profile, "utf8")))
    : undefined;

  const tags = parsed.values.tags
    ? parsed.values.tags.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
    : [];

  try {
    const manifest = await extractCorpus({
      pdfPath: parsed.values["asset-path"],
      outDir: parsed.values["out-dir"],
      profile,
      tags,
      title: parsed.values.title,
      gameSystemPlugin: parsed.values["game-system"] ?? null,
    });
    process.stdout.write(JSON.stringify(manifest) + "\n");
    process.exit(0);
  } catch (err) {
    process.stderr.write(`extraction failed: ${(err as Error).message}\n`);
    process.stderr.write(((err as Error).stack ?? "") + "\n");
    process.exit(1);
  }
}

void main();
