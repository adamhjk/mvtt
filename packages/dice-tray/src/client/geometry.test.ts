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

import { describe, it, expect } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import {
  DIE_SIZE,
  buildD4Faces,
  buildD6Faces,
  buildD8Faces,
  buildD10Faces,
  buildD12Faces,
  buildD20Faces,
  buildLensFaces,
  buildPrismFaces,
  buildTrapezohedronFaces,
  faceInscribedRadiusPixels,
  type FaceSpec,
} from "./geometry.js";

const TARGET_BOUNDING_RADIUS = (DIE_SIZE / 2) * Math.sqrt(3);
const EPS = 1e-3;

/** Outward normal computed the same way buildDieMesh computes it
 *  for lighting and rotation slots: cross of the first two edges
 *  off the first vertex. */
function faceNormal(face: FaceSpec): Vector3 {
  const v0 = face.vertices[0]!;
  const v1 = face.vertices[1]!;
  const v2 = face.vertices[2]!;
  return Vector3.Cross(v1.subtract(v0), v2.subtract(v0)).normalize();
}

function faceCentroid(face: FaceSpec): Vector3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of face.vertices) {
    x += v.x;
    y += v.y;
    z += v.z;
  }
  const n = face.vertices.length;
  return new Vector3(x / n, y / n, z / n);
}

/** Maximum vertex distance from origin across every face's vertices. */
function maxVertexRadius(faces: FaceSpec[]): number {
  let max = 0;
  for (const f of faces) {
    for (const v of f.vertices) {
      const r = v.length();
      if (r > max) max = r;
    }
  }
  return max;
}

describe("Platonic builders — outward normals", () => {
  // d4 deliberately uses VERTEX normals (not face normals) for
  // value→orientation, because the rolled value lives at a vertex
  // (apex when the die comes to rest). Its face winding doesn't
  // need to match the outward-from-centroid rule, and the renderer
  // disables backface culling so the face still lights up. The
  // others must have outward-from-centroid winding for lighting +
  // settle-bias correctness.
  const cases: { name: string; build: () => FaceSpec[] }[] = [
    { name: "d6", build: buildD6Faces },
    { name: "d8", build: buildD8Faces },
    { name: "d12", build: buildD12Faces },
    { name: "d20", build: buildD20Faces },
  ];
  it.each(cases)(
    "$name: every face's computed normal is outward (dot with centroid > 0)",
    ({ build }) => {
      const faces = build();
      for (const f of faces) {
        const n = faceNormal(f);
        const c = faceCentroid(f);
        // c is a point on the face in world space; for a convex
        // polyhedron centred on origin, the dot of outward normal
        // with the centroid is positive.
        expect(Vector3.Dot(n, c)).toBeGreaterThan(EPS);
      }
    },
  );
});

describe("Platonic builders — bounding sphere matches target", () => {
  it.each([
    ["d6", buildD6Faces],
    ["d8", buildD8Faces],
    ["d12", buildD12Faces],
    ["d20", buildD20Faces],
  ] as const)(
    "%s: max vertex radius ≈ TARGET_BOUNDING_RADIUS",
    (_name, build) => {
      const r = maxVertexRadius(build());
      // d6 is a cube — corners sit on the circumscribed sphere,
      // bounding radius is exactly the target.
      expect(r).toBeCloseTo(TARGET_BOUNDING_RADIUS, 5);
    },
  );
});

describe("buildLensFaces", () => {
  const faces = buildLensFaces();

  it("has exactly 2 labelled faces (top + bottom caps)", () => {
    const labelled = faces.filter((f) => !f.nonLanding);
    expect(labelled).toHaveLength(2);
    expect(labelled.map((f) => f.label).sort()).toEqual(["1", "2"]);
  });

  it("top cap normal points +Y; bottom cap normal points -Y", () => {
    const labelled = faces.filter((f) => !f.nonLanding);
    const byLabel = new Map(labelled.map((f) => [f.label, f]));
    const top = byLabel.get("1")!;
    const bot = byLabel.get("2")!;
    const nTop = faceNormal(top);
    const nBot = faceNormal(bot);
    expect(nTop.y).toBeGreaterThan(0.99);
    expect(nBot.y).toBeLessThan(-0.99);
  });

  it("rim quads (nonLanding) all have horizontal outward normals", () => {
    const rim = faces.filter((f) => f.nonLanding);
    expect(rim.length).toBeGreaterThan(0);
    for (const f of rim) {
      const n = faceNormal(f);
      // Y component near zero (face is vertical-walled).
      expect(Math.abs(n.y)).toBeLessThan(0.05);
      // Dot with centroid positive — outward.
      expect(Vector3.Dot(n, faceCentroid(f))).toBeGreaterThan(0);
    }
  });

  it("bounding sphere matches target", () => {
    const r = maxVertexRadius(faces);
    expect(r).toBeCloseTo(TARGET_BOUNDING_RADIUS, 5);
  });
});

describe("buildPrismFaces", () => {
  it.each([3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 30])(
    "n=%i: exactly n labelled side faces (cone caps are nonLanding)",
    (n) => {
      const faces = buildPrismFaces(n);
      const labelled = faces.filter((f) => !f.nonLanding);
      expect(labelled).toHaveLength(n);
      // Labels are sequential 1..n.
      expect(labelled.map((f) => f.label)).toEqual(
        Array.from({ length: n }, (_, i) => String(i + 1)),
      );
    },
  );

  it.each([3, 5, 7, 11, 17])(
    "n=%i: side-face outward normals are horizontal and point outward",
    (n) => {
      const faces = buildPrismFaces(n);
      const sides = faces.filter((f) => !f.nonLanding);
      for (const f of sides) {
        const norm = faceNormal(f);
        // Body faces are vertical-walled → normal Y-component is
        // ~0; XZ component must point outward.
        expect(Math.abs(norm.y)).toBeLessThan(0.05);
        expect(Vector3.Dot(norm, faceCentroid(f))).toBeGreaterThan(0);
      }
    },
  );

  it.each([3, 5, 7, 11, 17])(
    "n=%i: cone-cap (nonLanding) outward normals point outward",
    (n) => {
      const faces = buildPrismFaces(n);
      const caps = faces.filter((f) => f.nonLanding);
      // 2n cone-cap triangles (n on top, n on bottom).
      expect(caps).toHaveLength(2 * n);
      for (const f of caps) {
        const norm = faceNormal(f);
        // Centroid · normal > 0 → outward. Sign of normal.y tells
        // us which cap (top vs bottom).
        expect(Vector3.Dot(norm, faceCentroid(f))).toBeGreaterThan(0);
      }
    },
  );

  it("rejects n < 3", () => {
    expect(() => buildPrismFaces(2)).toThrow();
    expect(() => buildPrismFaces(1)).toThrow();
  });

  it("n=5: bounding sphere matches target", () => {
    const r = maxVertexRadius(buildPrismFaces(5));
    expect(r).toBeCloseTo(TARGET_BOUNDING_RADIUS, 5);
  });

  it("n=30: bounding sphere matches target", () => {
    const r = maxVertexRadius(buildPrismFaces(30));
    expect(r).toBeCloseTo(TARGET_BOUNDING_RADIUS, 5);
  });
});

describe("buildTrapezohedronFaces", () => {
  it.each([5, 7, 8, 9, 10, 15])(
    "k=%i: returns 2k kite faces",
    (k) => {
      const faces = buildTrapezohedronFaces(k);
      expect(faces).toHaveLength(2 * k);
      // Each face is a quadrilateral.
      for (const f of faces) expect(f.vertices).toHaveLength(4);
    },
  );

  it.each([5, 7, 8, 9, 10, 15])(
    "k=%i: every face's outward normal points outward",
    (k) => {
      const faces = buildTrapezohedronFaces(k);
      for (const f of faces) {
        const n = faceNormal(f);
        const c = faceCentroid(f);
        expect(Vector3.Dot(n, c)).toBeGreaterThan(EPS);
      }
    },
  );

  it.each([5, 7, 8, 9, 10, 15])(
    "k=%i: each kite face is planar (B_i in plane of apex+T_i+T_{i+1})",
    (k) => {
      const faces = buildTrapezohedronFaces(k);
      for (const f of faces) {
        const v0 = f.vertices[0]!;
        const v1 = f.vertices[1]!;
        const v2 = f.vertices[2]!;
        const v3 = f.vertices[3]!;
        // Plane through v0,v1,v2; v3 must lie in it (within ε).
        const n = Vector3.Cross(v1.subtract(v0), v2.subtract(v0));
        const d = Vector3.Dot(n.normalize(), v3.subtract(v0));
        expect(Math.abs(d)).toBeLessThan(1e-9);
      }
    },
  );

  it("k=5: labels default to 1..10", () => {
    const faces = buildTrapezohedronFaces(5);
    expect(faces.map((f) => f.label).sort((a, b) => Number(a) - Number(b))).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
    ]);
  });

  it("k=5: explicit label override (d100 tens)", () => {
    const tens = ["10", "20", "30", "40", "50", "60", "70", "80", "90", "00"];
    const faces = buildTrapezohedronFaces(5, tens);
    expect(faces.map((f) => f.label)).toEqual(tens);
  });

  it("rejects k < 3 and mismatched label arrays", () => {
    expect(() => buildTrapezohedronFaces(2)).toThrow();
    expect(() => buildTrapezohedronFaces(5, ["1"])).toThrow();
  });

  it("k=5 bounding sphere matches target", () => {
    const r = maxVertexRadius(buildTrapezohedronFaces(5));
    expect(r).toBeCloseTo(TARGET_BOUNDING_RADIUS, 5);
  });
});

describe("buildD10Faces (compatibility wrapper)", () => {
  it("returns the same shape as buildTrapezohedronFaces(5)", () => {
    const a = buildD10Faces();
    const b = buildTrapezohedronFaces(5);
    expect(a).toHaveLength(b.length);
    expect(a.map((f) => f.label)).toEqual(b.map((f) => f.label));
  });

  it("faces are values 1..10 (the standard d10 numbering)", () => {
    const labels = buildD10Faces().map((f) => f.label);
    const numeric = labels.map(Number).sort((x, y) => x - y);
    expect(numeric).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("faceInscribedRadiusPixels", () => {
  it("returns a positive value for every face of every Platonic + procedural builder", () => {
    const sets: FaceSpec[][] = [
      buildD4Faces(),
      buildD6Faces(),
      buildD8Faces(),
      buildD10Faces(),
      buildD12Faces(),
      buildD20Faces(),
      buildLensFaces(),
      buildPrismFaces(5),
      buildTrapezohedronFaces(7),
    ];
    for (const faces of sets) {
      for (const f of faces) {
        const r = faceInscribedRadiusPixels(f, 256);
        expect(r).toBeGreaterThan(0);
      }
    }
  });

  it("d6 face: ~115 pixels (square face, biggest inscribed circle)", () => {
    const faces = buildD6Faces();
    const r = faceInscribedRadiusPixels(faces[0]!, 256);
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(125);
  });

  it("d20 face: smaller than d6 face (triangle inscribed-radius < square)", () => {
    const d6Radius = faceInscribedRadiusPixels(buildD6Faces()[0]!, 256);
    const d20Radius = faceInscribedRadiusPixels(buildD20Faces()[0]!, 256);
    expect(d20Radius).toBeLessThan(d6Radius);
  });
});
