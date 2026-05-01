// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, it } from "vitest";
// @ts-expect-error — plain .mjs script, no type declarations.
import { walkSourceFiles, hasHeader } from "../../../scripts/apply-license-header.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("license headers", () => {
  it("every source file under packages/ starts with the AGPL license header", async () => {
    const missing: string[] = [];
    for await (const file of walkSourceFiles() as AsyncIterable<string>) {
      const content = await readFile(file, "utf8");
      if (!hasHeader(content)) missing.push(relative(REPO_ROOT, file));
    }
    if (missing.length > 0) {
      throw new Error(
        `${missing.length} source file(s) are missing the AGPL license header.\n` +
          `Run \`pnpm license:apply\` to add it.\n\nMissing files:\n  ` +
          missing.sort().join("\n  "),
      );
    }
  });
});
