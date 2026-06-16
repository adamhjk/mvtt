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

/**
 * Import TB2e item data from the (vetted) tb2e-foundry-vtt module's
 * pack source YAMLs into a generated TS module that ships with the
 * @vtt/system-torchbearer plugin's catalog.
 *
 * Run with:
 *   pnpm tsx tools/import-tb-items/import.ts \
 *     --source /home/adam/src/tb2e-foundry-vtt/tb2e-foundry-vtt/packs/_source \
 *     --out packages/system-torchbearer/src/data/tb-items.generated.ts
 *
 * The output module is a typed `TB_ITEM_TEMPLATES: TbItemTemplate[]`
 * the seed hook consumes via `runCatalogMerge`. Re-run any time the
 * Foundry source updates; the generated file is checked in.
 *
 * Source-of-truth question: once generated, the TS file IS the
 * source of truth. Edits to the catalog should be made in the TS
 * file directly. The Foundry import is a one-shot bootstrap, and
 * re-running it would clobber any local edits — so don't, unless
 * you intentionally want to merge in new upstream items.
 */

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { parse } from "yaml";

/**
 * Repo-relative path that the served `/icons/...` URLs map to.
 * Used to validate that every image path we emit exists, and to
 * fall back to a sibling author when the foundry data references
 * an icon we ship under a different author folder.
 */
const ICONS_ROOT = resolve(
  dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "assets",
  "icons",
  "ffffff",
  "transparent",
  "1x1",
);

interface FoundryItem {
  _id: string;
  name: string;
  type: string;
  img?: string;
  system: Record<string, unknown>;
}

const PACK_DIRS_TO_INCLUDE = [
  "armor",
  "bulk-goods",
  "clothing",
  "containers",
  "equipment",
  "food-and-drink",
  "light-sources",
  "loot",
  "magic-items",
  "magical-religious",
  "musical-instruments",
  "potions",
  "richer-loot",
  "shamanic-relics",
  "theurge-relics",
  "weapons",
];

interface CategoryMeta {
  /** Human-friendly label (matches the Foundry pack-dir name). */
  category: string;
  /** Source-book key used in citations. */
  defaultSourceBook: "DH" | "LMM" | "SG" | "Unknown";
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  armor: { category: "armor", defaultSourceBook: "DH" },
  "bulk-goods": { category: "bulk-goods", defaultSourceBook: "LMM" },
  clothing: { category: "clothing", defaultSourceBook: "DH" },
  containers: { category: "containers", defaultSourceBook: "DH" },
  equipment: { category: "equipment", defaultSourceBook: "LMM" },
  "food-and-drink": { category: "food-and-drink", defaultSourceBook: "DH" },
  "light-sources": { category: "light-sources", defaultSourceBook: "LMM" },
  loot: { category: "loot", defaultSourceBook: "SG" },
  "magic-items": { category: "magic-items", defaultSourceBook: "SG" },
  "magical-religious": { category: "magical-religious", defaultSourceBook: "DH" },
  "musical-instruments": { category: "musical-instruments", defaultSourceBook: "DH" },
  potions: { category: "potions", defaultSourceBook: "SG" },
  "richer-loot": { category: "richer-loot", defaultSourceBook: "LMM" },
  "shamanic-relics": { category: "shamanic-relics", defaultSourceBook: "SG" },
  "theurge-relics": { category: "theurge-relics", defaultSourceBook: "SG" },
  weapons: { category: "weapons", defaultSourceBook: "DH" },
};

interface CliArgs {
  sourceDir: string;
  outFile: string;
}

function parseCli(): CliArgs {
  const args = process.argv.slice(2);
  let sourceDir = "";
  let outFile = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source") {
      sourceDir = resolve(args[++i] ?? "");
    } else if (args[i] === "--out") {
      outFile = resolve(args[++i] ?? "");
    }
  }
  if (!sourceDir || !outFile) {
    // eslint-disable-next-line no-console
    console.error("usage: import.ts --source <dir> --out <file>");
    process.exit(2);
  }
  return { sourceDir, outFile };
}

async function readPack(packDir: string): Promise<FoundryItem[]> {
  const entries = await readdir(packDir);
  const out: FoundryItem[] = [];
  for (const e of entries) {
    if (!e.endsWith(".yml")) continue;
    const text = await readFile(resolve(packDir, e), "utf8");
    try {
      const parsed = parse(text) as FoundryItem;
      if (parsed && typeof parsed === "object" && parsed.name && parsed.type) {
        out.push(parsed);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`skip ${e}: ${(err as Error).message}`);
    }
  }
  return out;
}

interface OutputTemplate {
  id: string;
  name: string;
  category: string;
  sourceBook: "DH" | "LMM" | "SG" | "Unknown";
  sourcePage: number | null;
  description: string;
  img: string;
  cost?: number;
  value?: { dice: number; negotiated: boolean };
  slotOptions: Record<string, number>;
  skillBonuses: Array<{ skill: string; value: number; condition: string }>;
  specialRules: string;
  kind:
    | { type: "gear" }
    | { type: "armor"; armorType: string; absorbs: number }
    | { type: "weapon"; wield: 1 | 2; conflictBonuses: ConflictBonuses }
    | {
        type: "supply";
        supplyType: string;
        turnsRemaining: number;
        lit: boolean;
        nameSingular: string;
      }
    | { type: "container"; containerType: string; containerSlots: number };
}

interface ConflictBonuses {
  attack: { type: string; value: number };
  defend: { type: string; value: number };
  feint: { type: string; value: number };
  maneuver: { type: string; value: number };
}

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['"’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Convert a Foundry img path ("systems/tb2e/icons/.../delapouite/foo.svg")
 * to the local serving path ("/icons/delapouite/foo.svg"). The repo
 * ships a Game-Icons.net set under `/assets/icons/ffffff/transparent/1x1/`,
 * served at `/icons/<author>/<name>.svg`.
 *
 * If the exact author/file pair the foundry data references isn't in
 * our local set, scan every author folder for the same filename and
 * pick the first match. The Foundry tb2e module shipped some icons
 * under different author paths than our snapshot of Game-Icons.net,
 * so the fallback keeps the catalog visually intact instead of
 * leaking to "" (which would render as no icon).
 */
function mapImgPath(foundryImg: string | undefined): string {
  if (!foundryImg) return "";
  const m = foundryImg.match(/\/([^/]+)\/([^/]+\.svg)$/);
  if (!m) return "";
  const author = m[1]!;
  const file = m[2]!;
  if (existsSync(resolve(ICONS_ROOT, author, file))) {
    return `/icons/${author}/${file}`;
  }
  return findIconAcrossAuthors(file);
}

let cachedAuthors: ReadonlyArray<string> | null = null;
function authorDirs(): ReadonlyArray<string> {
  if (cachedAuthors) return cachedAuthors;
  try {
    const entries = require("node:fs").readdirSync(ICONS_ROOT, {
      withFileTypes: true,
    }) as Array<{ name: string; isDirectory(): boolean }>;
    cachedAuthors = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    cachedAuthors = [];
  }
  return cachedAuthors;
}

function findIconAcrossAuthors(file: string): string {
  for (const author of authorDirs()) {
    if (existsSync(resolve(ICONS_ROOT, author, file))) {
      return `/icons/${author}/${file}`;
    }
  }
  return "";
}

function parseSourcePage(description: string): number | null {
  const m = description.match(/p\.\s*(\d+)/);
  if (!m) return null;
  return Number.parseInt(m[1] ?? "", 10);
}

function inferSourceBook(
  description: string,
  defaultBook: "DH" | "LMM" | "SG" | "Unknown",
): "DH" | "LMM" | "SG" | "Unknown" {
  const d = description.toLowerCase();
  if (d.includes("dungeoneer")) return "DH";
  if (d.includes("lore master")) return "LMM";
  if (d.includes("loremaster")) return "LMM";
  if (d.includes("scholar")) return "SG";
  return defaultBook;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function buildSlotOptions(raw: unknown): Record<string, number> {
  if (!isObject(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = asNumber(v);
    if (n === undefined || n <= 0) continue;
    out[k] = Math.floor(n);
  }
  return out;
}

function buildSkillBonuses(raw: unknown): OutputTemplate["skillBonuses"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObject)
    .map((entry) => ({
      skill: String(entry.skill ?? ""),
      value: asNumber(entry.value) ?? 0,
      condition: String(entry.condition ?? ""),
    }))
    .filter((e) => e.skill);
}

function buildKind(item: FoundryItem): OutputTemplate["kind"] {
  const sys = item.system;
  switch (item.type) {
    case "armor":
      return {
        type: "armor",
        armorType: String(sys.armorType ?? "leather"),
        absorbs: asNumber(sys.absorbs) ?? 1,
      };
    case "weapon": {
      const cb = (sys.conflictBonuses ?? {}) as Record<string, unknown>;
      const action = (key: string): { type: string; value: number } => {
        const slot = isObject(cb[key]) ? (cb[key] as Record<string, unknown>) : {};
        return {
          type: String(slot.type ?? "dice"),
          value: asNumber(slot.value) ?? 0,
        };
      };
      return {
        type: "weapon",
        wield: (asNumber(sys.wield) ?? 1) === 2 ? 2 : 1,
        conflictBonuses: {
          attack: action("attack"),
          defend: action("defend"),
          feint: action("feint"),
          maneuver: action("maneuver"),
        },
      };
    }
    case "supply":
      return {
        type: "supply",
        supplyType: String(sys.supplyType ?? "other"),
        turnsRemaining: asNumber(sys.turnsRemaining) ?? 0,
        lit: Boolean(sys.lit),
        nameSingular: String(sys.nameSingular ?? ""),
      };
    case "container":
      return {
        type: "container",
        containerType: String(sys.containerType ?? "generic"),
        containerSlots: asNumber(sys.containerSlots) ?? 0,
      };
    case "gear":
    default:
      return { type: "gear" };
  }
}

async function importPacks(sourceDir: string): Promise<OutputTemplate[]> {
  const out: OutputTemplate[] = [];
  for (const dir of PACK_DIRS_TO_INCLUDE) {
    const meta = CATEGORY_META[dir];
    if (!meta) continue;
    const items = await readPack(resolve(sourceDir, dir));
    for (const item of items) {
      const sys = item.system;
      const description = String(sys.description ?? "");
      const tmpl: OutputTemplate = {
        id: `tb/${meta.category}/${slugifyName(item.name)}-${item._id.slice(0, 6)}`,
        name: item.name,
        category: meta.category,
        sourceBook: inferSourceBook(description, meta.defaultSourceBook),
        sourcePage: parseSourcePage(description),
        description,
        img: mapImgPath(item.img),
        cost: asNumber(sys.cost),
        value: isObject(sys.value)
          ? {
              dice: asNumber((sys.value as Record<string, unknown>).dice) ?? 0,
              negotiated: Boolean((sys.value as Record<string, unknown>).negotiated),
            }
          : undefined,
        slotOptions: buildSlotOptions(sys.slotOptions),
        skillBonuses: buildSkillBonuses(sys.skillBonuses),
        specialRules: String(sys.specialRules ?? ""),
        kind: buildKind(item),
      };
      out.push(tmpl);
    }
  }
  return out;
}

function emitTs(templates: OutputTemplate[]): string {
  const lines: string[] = [];
  lines.push("// mvtt, an RPG virtual tabletop");
  lines.push("// Copyright (C) 2026, Adam Jacob");
  lines.push("//");
  lines.push("// This file is part of mvtt.");
  lines.push("//");
  lines.push("// mvtt is free software: you can redistribute it and/or modify");
  lines.push("// it under the terms of the GNU Affero General Public License version 3");
  lines.push("// as published by the Free Software Foundation.");
  lines.push("//");
  lines.push("// mvtt is distributed in the hope that it will be useful,");
  lines.push("// but WITHOUT ANY WARRANTY; without even the implied warranty of");
  lines.push("// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the");
  lines.push("// GNU Affero General Public License for more details.");
  lines.push("//");
  lines.push("// You should have received a copy of the GNU Affero General Public License");
  lines.push("// along with mvtt.  If not, see <https://www.gnu.org/licenses/>.");
  lines.push("");
  lines.push("// AUTO-GENERATED by tools/import-tb-items/import.ts.");
  lines.push("// Source: https://github.com/luiniscarrasco/tb2e-foundry-vtt");
  lines.push("// Once generated, this file is the source of truth. Edits made");
  lines.push("// here are preserved across re-seed via the @vtt/items merge");
  lines.push("// engine's override-tracking. Re-run the importer only when");
  lines.push("// upstream Foundry data changes AND you want those changes to");
  lines.push("// flow through.");
  lines.push("");
  lines.push('import type { TbItemTemplate } from "./catalog-types.js";');
  lines.push("");
  lines.push("export const TB_ITEM_TEMPLATES: ReadonlyArray<TbItemTemplate> = [");
  for (const t of templates) {
    lines.push(`  ${JSON.stringify(t)},`);
  }
  lines.push("];");
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { sourceDir, outFile } = parseCli();
  const templates = await importPacks(sourceDir);
  templates.sort((a, b) => a.id.localeCompare(b.id));
  const text = emitTs(templates);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, text);
  // eslint-disable-next-line no-console
  console.log(`wrote ${templates.length} templates to ${outFile}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
