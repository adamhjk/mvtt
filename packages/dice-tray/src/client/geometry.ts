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
 * Geometry builders for every die kind the tray can render.
 *
 * The five Platonic solids (d4, d6, d8, d12, d20) are hand-rolled at
 * known proportions. The other families are procedural:
 *
 *   buildLensFaces            — N = 2 (a thick disc, "coin")
 *   buildPrismFaces(n)        — odd N (a rounded N-prism / "long die")
 *   buildTrapezohedronFaces(k) — N = 2k (kite-faced "spindle" dice,
 *                                including a true pentagonal
 *                                trapezohedron when k = 5)
 *
 * Each builder returns `FaceSpec[]` — the label-bearing faces of the
 * die. `nonLanding` faces (the small triangle fan on a prism's cone
 * caps) are included so the mesh assembler can build the full hull
 * and Havok's convex collider has every vertex, but they carry no
 * label and the spawn-side never picks them as a settle target.
 *
 * Vertices within each face are listed CCW when viewed from outside
 * the polyhedron so `Cross(b - a, c - a)` gives the outward face
 * normal. The mesh assembler in scene.ts depends on this.
 *
 * All shapes are convex by construction (so Havok's CONVEX_HULL
 * collider is exact) and sized so their bounding sphere matches
 * `(DIE_SIZE / 2) * √3` — the radius the existing Platonic dice
 * already use — making every die visually similar in size on the
 * tray regardless of side count.
 */
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";

/** Side length of the bounding cube every die kind is sized to fit
 *  inside. Same constant the spawn logic uses for spawn-position
 *  clearance. */
export const DIE_SIZE = 1.4;

/** Target bounding-sphere radius shared by every kind, so all dice
 *  look the same size on the tray. Equals the circumscribed-sphere
 *  radius of a cube of side DIE_SIZE. */
const TARGET_BOUNDING_RADIUS = (DIE_SIZE / 2) * Math.sqrt(3);

export interface FaceSpec {
  vertices: Vector3[];
  /** Single label painted at the face's centroid. Used by every die
   *  kind except d4 — d4 uses `cornerValues` instead. Empty string
   *  for `nonLanding` faces (cone-cap triangles on prism dice). */
  label: string;
  /** d4 only: the value to paint at each of this face's 3 vertex
   *  corners, in the same order as `vertices`. Tetrahedral dice
   *  show three numerals per face (one at each tip), and the rolled
   *  value corresponds to the *vertex* that lands at the apex — so
   *  each face displays the apex's value at its top corner and its
   *  other two vertices' values at the lower corners. When set,
   *  `buildDieMesh` switches to the 3-corner UV layout and
   *  `buildFaceTexture` paints three numerals instead of one. */
  cornerValues?: number[];
  /** True for faces that are part of the hull but carry no label
   *  and shouldn't be picked as a "land this face up" target — the
   *  cone-cap triangles on a prism die. The mesh assembler still
   *  emits geometry for them (the convex collider needs every
   *  vertex), but `faceValues` for those slots stays NaN and the
   *  settle-bias never targets them. */
  nonLanding?: boolean;
}

// ─── Platonic builders ──────────────────────────────────────────────

/** Tetrahedron vertex data. The scale factor is √3 so the d4's
 *  bounding cube has the same side as a d6 — both dice fit in the
 *  same DIE_SIZE box, which makes them feel proportional on the
 *  tray. (A d4 sized to its inscribed sphere alone would be tiny
 *  next to a d6 because a regular tetrahedron's inscribed-sphere
 *  radius is only 1/3 its circumscribed-sphere radius.)
 *
 *  Vertex `i` is assigned die-value `i + 1`. Each face spans 3 of
 *  the 4 vertices; the missing vertex is the one OPPOSITE the face
 *  (the value that lands at the apex when that face is on the
 *  bottom). */
const D4_SCALE = Math.sqrt(3);
export function getD4VertexData(): { positions: Vector3[]; values: number[] } {
  const r = (DIE_SIZE / 2) * D4_SCALE;
  const k = r / Math.sqrt(3);
  const positions = [
    new Vector3(+k, +k, +k),
    new Vector3(-k, -k, +k),
    new Vector3(-k, +k, -k),
    new Vector3(+k, -k, -k),
  ];
  const values = [1, 2, 3, 4];
  return { positions, values };
}

/** Tetrahedron, 4 triangular faces. Each face lists its 3 vertex
 *  indices in CCW-from-outside order; `cornerValues` carries those
 *  vertices' die-values so the texture-painter knows which numeral
 *  goes at each corner. Vertex order within `vertices` is also the
 *  order used by the corner-UV layout in `buildDieMesh`:
 *    vertices[0] → top of texture (apex when face is upright)
 *    vertices[1] → bottom-left
 *    vertices[2] → bottom-right */
export function buildD4Faces(): FaceSpec[] {
  const { positions: v, values } = getD4VertexData();
  const face = (a: number, b: number, c: number): FaceSpec => ({
    vertices: [v[a]!, v[b]!, v[c]!],
    cornerValues: [values[a]!, values[b]!, values[c]!],
    // `label` is unused for d4 (cornerValues drive painting); set
    // to a placeholder so structural code can still parseInt it
    // without throwing.
    label: "0",
  });
  return [
    face(0, 1, 2),
    face(0, 3, 1),
    face(0, 2, 3),
    face(1, 3, 2),
  ];
}

/** Cube, 6 square faces. */
export function buildD6Faces(): FaceSpec[] {
  const r = DIE_SIZE / 2;
  return [
    {
      label: "1",
      vertices: [
        new Vector3(-r, -r, +r),
        new Vector3(+r, -r, +r),
        new Vector3(+r, +r, +r),
        new Vector3(-r, +r, +r),
      ],
    },
    {
      label: "2",
      vertices: [
        new Vector3(+r, -r, +r),
        new Vector3(+r, -r, -r),
        new Vector3(+r, +r, -r),
        new Vector3(+r, +r, +r),
      ],
    },
    {
      label: "3",
      vertices: [
        new Vector3(-r, +r, +r),
        new Vector3(+r, +r, +r),
        new Vector3(+r, +r, -r),
        new Vector3(-r, +r, -r),
      ],
    },
    {
      label: "4",
      vertices: [
        new Vector3(-r, -r, -r),
        new Vector3(-r, +r, -r),
        new Vector3(+r, +r, -r),
        new Vector3(+r, -r, -r),
      ],
    },
    {
      label: "5",
      vertices: [
        new Vector3(-r, -r, -r),
        new Vector3(-r, -r, +r),
        new Vector3(-r, +r, +r),
        new Vector3(-r, +r, -r),
      ],
    },
    {
      label: "6",
      vertices: [
        new Vector3(-r, -r, -r),
        new Vector3(+r, -r, -r),
        new Vector3(+r, -r, +r),
        new Vector3(-r, -r, +r),
      ],
    },
  ];
}

/** Octahedron, 8 triangular faces — two pyramids back-to-back.
 *  Scaled to match d6's bounding sphere (same √3 factor as d4) so
 *  the d8 doesn't appear smaller than the cube on the tray. Each
 *  face's vertices are listed CCW from outside so Cross(e1, e2)
 *  gives the outward normal — required for correct Lambertian
 *  lighting. */
const D8_SCALE = Math.sqrt(3);
export function buildD8Faces(): FaceSpec[] {
  const r = (DIE_SIZE / 2) * D8_SCALE;
  const top = new Vector3(0, +r, 0);
  const bot = new Vector3(0, -r, 0);
  const px = new Vector3(+r, 0, 0);
  const nx = new Vector3(-r, 0, 0);
  const pz = new Vector3(0, 0, +r);
  const nz = new Vector3(0, 0, -r);
  return [
    { label: "1", vertices: [top, pz, px] },
    { label: "2", vertices: [top, nx, pz] },
    { label: "3", vertices: [top, nz, nx] },
    { label: "4", vertices: [top, px, nz] },
    { label: "5", vertices: [bot, px, pz] },
    { label: "6", vertices: [bot, pz, nx] },
    { label: "7", vertices: [bot, nx, nz] },
    { label: "8", vertices: [bot, nz, px] },
  ];
}

/** Dodecahedron, 12 pentagonal faces. Each pentagon is fan-
 *  triangulated by `buildDieMesh`; here we just describe the 5
 *  pentagon vertices in CCW order. */
export function buildD12Faces(): FaceSpec[] {
  const phi = (1 + Math.sqrt(5)) / 2;
  const inv = 1 / phi;
  const all = [
    new Vector3(+1, +1, +1),
    new Vector3(+1, +1, -1),
    new Vector3(+1, -1, +1),
    new Vector3(+1, -1, -1),
    new Vector3(-1, +1, +1),
    new Vector3(-1, +1, -1),
    new Vector3(-1, -1, +1),
    new Vector3(-1, -1, -1),
    new Vector3(0, +phi, +inv),
    new Vector3(0, +phi, -inv),
    new Vector3(0, -phi, +inv),
    new Vector3(0, -phi, -inv),
    new Vector3(+inv, 0, +phi),
    new Vector3(-inv, 0, +phi),
    new Vector3(+inv, 0, -phi),
    new Vector3(-inv, 0, -phi),
    new Vector3(+phi, +inv, 0),
    new Vector3(+phi, -inv, 0),
    new Vector3(-phi, +inv, 0),
    new Vector3(-phi, -inv, 0),
  ];
  // Vertices above sit on a sphere of radius √3; scale to the
  // shared bounding-sphere target.
  const norm = TARGET_BOUNDING_RADIUS / Math.sqrt(3);
  for (const v of all) v.scaleInPlace(norm);
  const faceIndices: number[][] = [
    [8, 4, 13, 12, 0],
    [16, 1, 9, 8, 0],
    [12, 2, 17, 16, 0],
    [13, 6, 10, 2, 12],
    [4, 18, 19, 6, 13],
    [8, 9, 5, 18, 4],
    [1, 14, 15, 5, 9],
    [16, 17, 3, 14, 1],
    [2, 10, 11, 3, 17],
    [6, 19, 7, 11, 10],
    [18, 5, 15, 7, 19],
    [7, 15, 14, 3, 11],
  ];
  return faceIndices.map((indices, i) => ({
    label: String(i + 1),
    vertices: indices.map((idx) => all[idx]!.clone()),
  }));
}

/** Icosahedron, 20 triangular faces. */
export function buildD20Faces(): FaceSpec[] {
  const phi = (1 + Math.sqrt(5)) / 2;
  const v = [
    new Vector3(0, +1, +phi),
    new Vector3(0, +1, -phi),
    new Vector3(0, -1, +phi),
    new Vector3(0, -1, -phi),
    new Vector3(+1, +phi, 0),
    new Vector3(+1, -phi, 0),
    new Vector3(-1, +phi, 0),
    new Vector3(-1, -phi, 0),
    new Vector3(+phi, 0, +1),
    new Vector3(+phi, 0, -1),
    new Vector3(-phi, 0, +1),
    new Vector3(-phi, 0, -1),
  ];
  const radius = Math.sqrt(1 + phi * phi);
  const norm = TARGET_BOUNDING_RADIUS / radius;
  for (const p of v) p.scaleInPlace(norm);
  const faceIndices: number[][] = [
    [0, 2, 8],
    [0, 8, 4],
    [0, 4, 6],
    [0, 6, 10],
    [0, 10, 2],
    [3, 1, 9],
    [3, 9, 5],
    [3, 5, 7],
    [3, 7, 11],
    [3, 11, 1],
    [2, 5, 8],
    [8, 5, 9],
    [8, 9, 4],
    [4, 9, 1],
    [4, 1, 6],
    [6, 1, 11],
    [6, 11, 10],
    [10, 11, 7],
    [10, 7, 2],
    [2, 7, 5],
  ];
  return faceIndices.map((indices, i) => ({
    label: String(i + 1),
    vertices: indices.map((idx) => v[idx]!.clone()),
  }));
}

// ─── Procedural builders ───────────────────────────────────────────

/** Lens / coin (N = 2). Two parallel discs joined by a thin
 *  cylindrical band. Practical mesh: a short triangle-strip cylinder
 *  with two fan-triangulated end caps. The two caps carry the
 *  labels (1 / 2); the band's quad strips are non-landing.
 *
 *  Geometry is sized so the lens fits inside the shared bounding
 *  sphere. The thickness/diameter ratio (~12%) puts the lens
 *  squarely outside the "balances on its edge" regime — physics
 *  will always tip it to one face. */
export function buildLensFaces(): FaceSpec[] {
  const S = 24;                         // segments around the rim
  const t = TARGET_BOUNDING_RADIUS * 0.24;
  // Disc radius is whatever's left after the thickness — pick so
  // the bounding sphere stays at the target.
  const R = Math.sqrt(
    TARGET_BOUNDING_RADIUS * TARGET_BOUNDING_RADIUS - (t / 2) * (t / 2),
  );

  const ring = (y: number): Vector3[] => {
    const out: Vector3[] = [];
    for (let i = 0; i < S; i++) {
      const a = (i / S) * Math.PI * 2;
      out.push(new Vector3(R * Math.cos(a), y, R * Math.sin(a)));
    }
    return out;
  };
  const topRing = ring(+t / 2);
  const botRing = ring(-t / 2);

  const faces: FaceSpec[] = [];
  // Top cap (label "1"). Codebase convention: Cross(v1-v0, v2-v0)
  // must yield the outward normal, which for an axis-aligned +Y
  // face means the projected (X, Z) vertex order traverses
  // clockwise (compare buildD6Faces' label-3 face). topRing was
  // built with increasing angle (CCW in XZ), so reverse it for
  // the top cap; the bottom cap (outward -Y) takes it as-is.
  faces.push({ label: "1", vertices: [...topRing].reverse() });
  faces.push({ label: "2", vertices: [...botRing] });
  // Rim band — non-landing quads, one per segment. [top, top_next,
  // bot_next, bot] produces an outward normal in the XZ plane.
  for (let i = 0; i < S; i++) {
    const next = (i + 1) % S;
    faces.push({
      label: "",
      nonLanding: true,
      vertices: [topRing[i]!, topRing[next]!, botRing[next]!, botRing[i]!],
    });
  }
  return faces;
}

/** Rounded N-prism / "long die" for any N ≥ 3. Used for odd N
 *  (d3, d5, d7, d9, d11, …) and any non-standard N we don't have a
 *  trapezohedron for. The shape has:
 *    - N rectangular side faces (the rollable surfaces) carrying
 *      values 1..N
 *    - 2 cone end-caps (top apex + bottom apex, each a fan of N
 *      triangles) marked `nonLanding` so the die settles on a side
 *      face, not on a point. The settle-bias loop in scene.ts has
 *      an apex-rest mitigation that flicks the die over if it does
 *      come to rest pointing up.
 *
 *  Proportions are tuned so the bounding sphere matches the shared
 *  target (so a d5 and a d6 look about the same size on the tray). */
export function buildPrismFaces(n: number): FaceSpec[] {
  if (n < 3) {
    throw new Error(`buildPrismFaces: n must be ≥ 3 (got ${n})`);
  }
  // The apex is the bounding-sphere-extreme point for any cap
  // height where 2·h_cap·L/2 > R² (which is true for our chosen
  // aspect ratios), so set L/2 + h_cap = TARGET_BOUNDING_RADIUS
  // and pick R freely. With body aspect L = 2.8·R and cap height
  // h_cap = 0.8·R, that gives a recognisable "long die"
  // silhouette: taller than wide, with shortish steep caps.
  //   L/2 + h_cap = 1.4R + 0.8R = 2.2R = TARGET
  //   ⇒ R = TARGET / 2.2
  const ASPECT_L = 2.8;
  const ASPECT_CAP = 0.8;
  const halfHeight = ASPECT_L / 2 + ASPECT_CAP; // = 2.2
  const R = TARGET_BOUNDING_RADIUS / halfHeight;
  const L = ASPECT_L * R;
  const hCap = ASPECT_CAP * R;

  // Body rings.
  const top: Vector3[] = [];
  const bot: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    top.push(new Vector3(R * Math.cos(a), +L / 2, R * Math.sin(a)));
    bot.push(new Vector3(R * Math.cos(a), -L / 2, R * Math.sin(a)));
  }
  const topApex = new Vector3(0, +L / 2 + hCap, 0);
  const botApex = new Vector3(0, -L / 2 - hCap, 0);

  const faces: FaceSpec[] = [];
  // Side rectangles, CCW from outside.
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    faces.push({
      label: String(i + 1),
      vertices: [top[i]!, top[next]!, bot[next]!, bot[i]!],
    });
  }
  // Top cone cap — N triangles, all non-landing. CCW when viewed
  // from above means apex → top[i+1] → top[i].
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    faces.push({
      label: "",
      nonLanding: true,
      vertices: [topApex, top[next]!, top[i]!],
    });
  }
  // Bottom cone cap — CCW from below means apex → bot[i] → bot[i+1].
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    faces.push({
      label: "",
      nonLanding: true,
      vertices: [botApex, bot[i]!, bot[next]!],
    });
  }
  return faces;
}

/** N-sided trapezohedron (the d10 generalization). Used for d10
 *  (k = 5) and for even N ≥ 14 (d14 → k = 7, d16 → k = 8, d30 →
 *  k = 15). N = 2k kite-shaped faces, 2 apexes, and 2k equator
 *  vertices in a zigzag pattern.
 *
 *  Optional `labels` override the default 1..2k sequence — used for
 *  the d100 "tens" die (labels "10"…"90","00") and the d10-units die
 *  (labels "0"…"9"). When omitted, faces are labelled with their
 *  natural 1..2k die-value.
 *
 *  For the kite to be planar (a real flat face, not a saddle), the
 *  apex height h and the equator zigzag offset δ must satisfy a
 *  ratio that depends on k. Without that ratio the "face" is split
 *  into two triangles by the mesh assembler's fan-triangulation and
 *  light reflects off two non-coplanar halves — visually obvious as
 *  a crease. The closed-form ratio is derived in the comment below;
 *  it makes every kite a true planar quad. */
export function buildTrapezohedronFaces(
  k: number,
  labels?: string[],
): FaceSpec[] {
  if (k < 3) {
    throw new Error(`buildTrapezohedronFaces: k must be ≥ 3 (got ${k})`);
  }
  const n = k * 2;
  if (labels !== undefined && labels.length !== n) {
    throw new Error(
      `buildTrapezohedronFaces: labels.length (${labels.length}) must match face count ${n}`,
    );
  }

  // Closed-form planar-kite condition.
  //
  // Let the equator ring radius be R and the apex height h. The
  // upper equator ring sits at y = +δ at angles {2π·i/k}; the lower
  // ring at y = -δ at angles {2π·(i+½)/k}. A top kite for index i
  // has vertices:
  //
  //   apex = (0, +h, 0)
  //   T_i   = (R·cos α_i,    +δ, R·sin α_i)        α_i = 2πi/k
  //   B_i   = (R·cos β_i,    -δ, R·sin β_i)        β_i = 2π(i+½)/k
  //   T_{i+1} = (R·cos α_{i+1}, +δ, R·sin α_{i+1})
  //
  // Requiring B_i to lie in the plane through {apex, T_i, T_{i+1}}
  // collapses (after a couple of pages of trigonometry, exploiting
  // the rotational symmetry that places T_i and T_{i+1} mirrored
  // about the plane of B_i) to the simple ratio
  //
  //   δ / h = (1 - cos(π/k)) / (1 + cos(π/k))
  //
  // i.e. h = δ · (1 + cos(π/k)) / (1 - cos(π/k)).
  //
  // We pick R freely and then h/δ to satisfy this. Bounding-sphere
  // target then fixes R and h together. The apex sets the bounding
  // sphere (apex is the extreme point along Y); for the equator to
  // also be on the bounding sphere we'd need √(R² + δ²) = h, which
  // combined with the planarity condition gives a 1-parameter family.
  // In practice, we set h = TARGET_BOUNDING_RADIUS (the apex *is*
  // the extreme point), and pick δ + R from the planarity ratio plus
  // an aesthetic "kite aspect ratio" choice.
  const h = TARGET_BOUNDING_RADIUS;
  const cosPiK = Math.cos(Math.PI / k);
  const ratio = (1 - cosPiK) / (1 + cosPiK); // δ / h
  const delta = h * ratio;
  // The remaining freedom is R. Pick R so the equator vertices sit
  // at roughly the same outward distance as the apex — gives a
  // "fat" trapezohedron silhouette like a real d10/d20 spindle.
  // R² + δ² = h² puts the equator on the bounding sphere too.
  const R = Math.sqrt(Math.max(0, h * h - delta * delta));

  const topRing: Vector3[] = [];
  const botRing: Vector3[] = [];
  for (let i = 0; i < k; i++) {
    const alpha = (i / k) * Math.PI * 2;
    const beta = ((i + 0.5) / k) * Math.PI * 2;
    topRing.push(new Vector3(R * Math.cos(alpha), +delta, R * Math.sin(alpha)));
    botRing.push(new Vector3(R * Math.cos(beta), -delta, R * Math.sin(beta)));
  }
  const topApex = new Vector3(0, +h, 0);
  const botApex = new Vector3(0, -h, 0);

  const faces: FaceSpec[] = [];
  // Top kites (i ∈ [0, k)). CCW-from-outside: looking at the kite
  // from "above and slightly out", the winding apex → top[i+1] →
  // bot[i] → top[i] traces a kite shape with the apex at the top
  // and the lower-ring vertex at the bottom tip. Cross(e1, e2) of
  // (top[i+1] - apex, bot[i] - apex) produces an outward normal.
  for (let i = 0; i < k; i++) {
    const next = (i + 1) % k;
    faces.push({
      label: "", // filled in below from labels[] or default
      vertices: [topApex, topRing[next]!, botRing[i]!, topRing[i]!],
    });
  }
  // Bottom kites. Same logic, mirrored.
  for (let i = 0; i < k; i++) {
    const next = (i + 1) % k;
    faces.push({
      label: "",
      vertices: [botApex, botRing[i]!, topRing[next]!, botRing[next]!],
    });
  }

  // Assign labels.
  for (let i = 0; i < faces.length; i++) {
    faces[i]!.label = labels ? labels[i]! : String(i + 1);
  }
  return faces;
}

/** Pentagonal trapezohedron with the 1..10 labels — the standard
 *  d10. Thin wrapper kept for readability at call sites. */
export function buildD10Faces(): FaceSpec[] {
  return buildTrapezohedronFaces(5);
}

// ─── Inscribed-circle helper for font sizing ───────────────────────

/**
 * Return the inscribed-circle radius (in texture pixels) of one
 * face, after the face has been projected to UV space and inscribed
 * in a (0,1)² square with 5% margin — the same projection
 * `buildDieMesh` uses. Used by scene.ts to pick a per-face centred
 * font size that scales with the face's actual usable area, instead
 * of a per-kind lookup table.
 *
 * The inscribed radius is the minimum perpendicular distance from
 * the centroid to any edge of the projected face. For regular
 * polygons this is `circumradius · cos(π/n)`; for non-regular faces
 * (kites, prism rectangles) we compute it directly.
 *
 * `faceTexSize` is the texture's pixel size (the mesh assembler
 * uses 256 × 256, but pass it explicitly so the test doesn't have
 * to import a constant).
 */
export function faceInscribedRadiusPixels(
  face: FaceSpec,
  faceTexSize: number,
): number {
  const verts = face.vertices;
  if (verts.length < 3) return 0;
  const v0 = verts[0]!;
  const v1 = verts[1]!;
  const v2 = verts[2]!;
  const e1 = v1.subtract(v0);
  const e2 = v2.subtract(v0);
  const normal = Vector3.Cross(e1, e2).normalize();

  // Same 2D basis as buildDieMesh.
  const refUp =
    Math.abs(normal.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const right = Vector3.Cross(refUp, normal).normalize();
  const up = Vector3.Cross(right, normal).normalize();

  // Centroid in 3D.
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const v of verts) {
    cx += v.x;
    cy += v.y;
    cz += v.z;
  }
  cx /= verts.length;
  cy /= verts.length;
  cz /= verts.length;
  const centroid = new Vector3(cx, cy, cz);

  // Project each vertex into face-local 2D.
  const local: { u: number; v: number }[] = verts.map((vx) => {
    const d = vx.subtract(centroid);
    return { u: Vector3.Dot(d, right), v: Vector3.Dot(d, up) };
  });
  let maxAbs = 0;
  for (const p of local) {
    maxAbs = Math.max(maxAbs, Math.abs(p.u), Math.abs(p.v));
  }
  if (maxAbs <= 0) return 0;
  const scale = 0.5 / (maxAbs * 1.1); // matches buildDieMesh
  // Minimum perpendicular distance from origin (= projected
  // centroid) to each edge in UV-coordinate space.
  let minDist = Infinity;
  for (let i = 0; i < local.length; i++) {
    const a = local[i]!;
    const b = local[(i + 1) % local.length]!;
    const dx = b.u - a.u;
    const dy = b.v - a.v;
    const len = Math.hypot(dx, dy);
    if (len <= 0) continue;
    // Perpendicular distance from (0,0) to the line through (a, b):
    // |dx·a.v - dy·a.u| / len.
    const d = Math.abs(dx * a.v - dy * a.u) / len;
    if (d < minDist) minDist = d;
  }
  if (!isFinite(minDist)) return 0;
  const uvRadius = minDist * scale; // distance in UV coords
  return uvRadius * faceTexSize;
}
