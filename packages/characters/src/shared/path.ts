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
 * Path-based read/write for the small POJO trees that traits hold. Used
 * by SetField (any field on any trait can be edited via a generic
 * command) and by the kit's `useTraitPath` hook (any field on any trait
 * can be read into a Solid signal).
 *
 * Path = an array of string keys or numeric indices, e.g.
 *   ["scores", "str"]                  → object property
 *   ["abilities", 0, "name"]           → array element + property
 *   []                                 → the trait value itself
 *
 * Both helpers are pure: `setAtPath` returns a new object/array, leaving
 * the input untouched, so trait writes can stay atomic via `world.set`.
 */

export type PathSegment = string | number;
export type Path = ReadonlyArray<PathSegment>;

/**
 * Read the value at `path` inside `root`. Returns undefined if any
 * intermediate key is absent or has the wrong shape. Empty path returns
 * `root` itself.
 */
export function getAtPath(root: unknown, path: Path): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg];
    } else {
      if (typeof cur !== "object" || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

/**
 * Return a structurally-cloned copy of `root` with `value` placed at
 * `path`. Empty path returns `value` itself (sets the whole trait). The
 * substrate validates the resulting object against the trait's Zod
 * schema in `world.set`, so any path that produces a structurally
 * invalid trait gets rejected at the boundary.
 *
 * Intermediate object containers are created if absent. Numeric segments
 * indexing a non-array container throws — arrays must already exist
 * (their length isn't blindly extended; that would silently swallow
 * mistakes in the path).
 */
export function setAtPath(root: unknown, path: Path, value: unknown): unknown {
  if (path.length === 0) return value;

  const head = path[0]!;
  const rest = path.slice(1);

  if (typeof head === "number") {
    if (!Array.isArray(root)) {
      throw new Error(
        `setAtPath: numeric segment ${head} requires an array container, got ${typeof root}`,
      );
    }
    if (head < 0 || head >= root.length) {
      throw new Error(`setAtPath: numeric segment ${head} is out of range (0..${root.length - 1})`);
    }
    const next = root.slice();
    next[head] = setAtPath(root[head], rest, value);
    return next;
  }

  // String segment — object container.
  const container =
    root === undefined || root === null
      ? {}
      : typeof root === "object" && !Array.isArray(root)
        ? { ...(root as Record<string, unknown>) }
        : null;
  if (container === null) {
    throw new Error(
      `setAtPath: string segment ${JSON.stringify(head)} requires an object container, got ${typeof root}`,
    );
  }
  container[head] = setAtPath(container[head], rest, value);
  return container;
}
