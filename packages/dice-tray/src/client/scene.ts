/**
 * Babylon.js 3D scene for the dice tray.
 *
 * Each die is built procedurally: hand-defined geometry with
 * per-face vertex duplication so every face gets its own UV
 * mapping. Each face's UVs span the full [0,1] × [0,1] of a
 * 256×256 texture that has a single big numeral perfectly
 * centered. We use one StandardMaterial per face and a
 * MultiMaterial on the mesh, with SubMeshes routing each face's
 * triangles to its material.
 *
 * This is deliberately *not* a port of dice-box's mesh format.
 * dice-box bakes numerals into a shared texture atlas via the
 * mesh's pre-authored UVs; if we used that, we'd inherit dice-box's
 * face-mapping conventions which fight with our authoritative-roll
 * model. Building the meshes ourselves means we own the face index
 * → numeral mapping and can confidently rotate the rolled value's
 * face up later.
 *
 * v1: tumble lands at a random orientation; the visible face is
 * arbitrary. The chat carries the authoritative value. Phase 2
 * adds rotation-to-rolled-face once the rendering side is solid.
 */
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Camera } from "@babylonjs/core/Cameras/camera.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
// Side-effect imports: register InstancedMesh support, the box
// builder for the tray floor, and the StandardMaterial pipeline.
import "@babylonjs/core/Meshes/instancedMesh.js";
import "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import "@babylonjs/core/Materials/standardMaterial.js";

const VIEW_HALF_HEIGHT = 4;
const TRAY_WALL_HEIGHT = 0.4;
const SPAWN_HEIGHT = 4;
const TUMBLE_SECONDS = 1.2;
const FACE_TEX_SIZE = 256;
/** Bounding-sphere radius doubled — the size each die's bounding
 *  box measures across. Bumped from earlier values because the
 *  inscribed-radius dice (d20 fits inside a sphere of this size,
 *  but its faces near the silhouette appear small from above) felt
 *  cramped on the tray. */
const DIE_SIZE = 1.4;

/**
 * Kinds of die we know how to render.
 *
 * `100` is the *tens* d10 (faces "10", "20", … "90", "00") rolled
 * alongside `"10u"`, the *units* d10 (faces "0".."9"), to form a
 * full d100 result. Standalone `1d10` rolls use `10` (faces 1-10),
 * matching the common tabletop convention. The drawer expands a
 * sides-100 RollResolved die into one spawn each of `100` and
 * `"10u"`.
 */
export type DieKind = 4 | 6 | 8 | 10 | 12 | 20 | 100 | "F" | "10u";

interface ActiveDie {
  mesh: Mesh;
  spawnedAt: number;
}

export interface TrayHandle {
  spawn(args: {
    kind: DieKind;
    value: number;
    tintColor: Color3;
  }): Promise<void>;
  clear(): void;
  dispose(): void;
  resize(): void;
}

export function tintForUser(userId: string): Color3 {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return Color3.FromHSV(h % 360, 0.55, 0.78);
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

// ─── Geometry builders ──────────────────────────────────────────────
//
// Each builder returns face data for one die kind:
//   - faces: Array<{ vertices: Vector3[], label: string }>
//
// Faces are returned with vertices in CCW order when viewed from
// outside the polyhedron — that gives Cross(b-a, c-a) as the
// outward face normal. The actual mesh assembly (with per-face
// vertex duplication, per-face UVs, and per-face SubMeshes) is
// done in `buildDieMesh` below; geometry builders only describe
// the polyhedron's face vertices.

interface FaceSpec {
  vertices: Vector3[];
  /** Single label painted at the face's centroid. Used by every die
   *  kind except d4 — d4 uses `cornerValues` instead. */
  label: string;
  /** d4 only: the value to paint at each of this face's 3 vertex
   *  corners, in the same order as `vertices`. Tetrahedral dice
   *  show three numerals per face (one at each tip), and the
   *  rolled value corresponds to the *vertex* that lands at the
   *  apex — so each face displays the apex's value at its top
   *  corner and its other two vertices' values at the lower
   *  corners. When this is set, `buildDieMesh` switches to the
   *  3-corner UV layout and `buildFaceTexture` paints three
   *  numerals instead of one. */
  cornerValues?: number[];
}

/**
 * Tetrahedron vertex data. The scale factor is √3 so the d4's
 * bounding cube has the same side as a d6 — both dice fit in the
 * same DIE_SIZE box, which makes them feel proportional on the
 * tray. (A d4 sized to its inscribed sphere alone would be tiny
 * next to a d6 because a regular tetrahedron's inscribed sphere
 * radius is only 1/3 its circumscribed sphere radius.)
 *
 * Vertex `i` is assigned die-value `i + 1`. Each face spans 3 of
 * the 4 vertices; the missing vertex is the one OPPOSITE the face
 * (the value that lands at the apex when that face is on the
 * bottom).
 */
const D4_SCALE = Math.sqrt(3);
function getD4VertexData(): { positions: Vector3[]; values: number[] } {
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
 *    vertices[2] → bottom-right
 */
function buildD4Faces(): FaceSpec[] {
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
function buildD6Faces(): FaceSpec[] {
  const r = DIE_SIZE / 2;
  // Each face: 4 corners CCW from outside.
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
 *  the d8 doesn't appear smaller than the cube on the tray.
 *  Each face's vertices are listed CCW from outside so
 *  Cross(e1, e2) gives the outward normal — required for correct
 *  Lambertian lighting (the +Y, +X, +Z apex of the octahedron's
 *  upper-front-right face has outward normal (+, +, +)). */
const D8_SCALE = Math.sqrt(3);
function buildD8Faces(): FaceSpec[] {
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

/** Pentagonal bipyramid — 10 triangular faces. Stand-in for a
 *  proper pentagonal trapezohedron d10; visually distinct enough
 *  from a d20 that it reads as "different die," and trivially
 *  buildable from a pentagon + two apexes. Scaled by √3 so the
 *  bounding sphere matches d6's, putting the d10 at the same
 *  visual size as the cube on the tray. */
const D10_SCALE = Math.sqrt(3);
function buildD10Faces(): FaceSpec[] {
  const r = (DIE_SIZE / 2) * D10_SCALE;
  const top = new Vector3(0, +r, 0);
  const bot = new Vector3(0, -r, 0);
  // 5 equator vertices on a regular pentagon in the XZ plane.
  const eq: Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    eq.push(new Vector3(r * Math.cos(a), 0, r * Math.sin(a)));
  }
  const faces: FaceSpec[] = [];
  // Top fan, values 1..5.
  for (let i = 0; i < 5; i++) {
    faces.push({
      label: String(i + 1),
      vertices: [top, eq[(i + 1) % 5]!, eq[i]!],
    });
  }
  // Bottom fan, values 6..10.
  for (let i = 0; i < 5; i++) {
    faces.push({
      label: String(i + 6),
      vertices: [bot, eq[i]!, eq[(i + 1) % 5]!],
    });
  }
  return faces;
}

/** Dodecahedron, 12 pentagonal faces. Each pentagon is fan-
 *  triangulated with a centroid vertex into 5 triangles, but at
 *  the FaceSpec level we just describe the 5 pentagon vertices in
 *  CCW order; `buildDieMesh` does the fan triangulation. */
function buildD12Faces(): FaceSpec[] {
  // Regular dodecahedron vertex coordinates use the golden ratio.
  // Standard set (20 vertices) on a sphere of radius √3 ≈ 1.732.
  const phi = (1 + Math.sqrt(5)) / 2;
  const inv = 1 / phi;
  // The vertices are: (±1, ±1, ±1), (0, ±phi, ±1/phi), (±1/phi, 0, ±phi),
  // (±phi, ±1/phi, 0).
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
  // Scale to target size: the vertices above sit on a sphere of
  // radius √3, and we want the final bounding sphere to match d6's
  // (DIE_SIZE × √3 / 2) so the d12 looks the same size as the cube.
  // That means each scaled vertex should have magnitude (√3/2) ×
  // DIE_SIZE, i.e. each axis-1 vertex needs scale (DIE_SIZE/2).
  const D12_SCALE = Math.sqrt(3);
  const norm = ((DIE_SIZE / 2) * D12_SCALE) / Math.sqrt(3);
  for (const v of all) v.scaleInPlace(norm);
  // 12 faces, each a pentagon, by vertex indices into `all`.
  // Each row is CCW from outside so Cross(e1, e2) gives the
  // outward normal — without this, faces light up only from the
  // inside and render black to the camera (same gotcha that hit
  // the d8 octahedron). The lists below are the reverse of the
  // common Wikipedia ordering, which assumes the opposite winding
  // convention.
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
function buildD20Faces(): FaceSpec[] {
  const phi = (1 + Math.sqrt(5)) / 2;
  // Standard icosahedron vertices on a sphere of radius √(1+φ²).
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
  // Scale so the d20's bounding sphere matches d6's (= DIE_SIZE ×
  // √3/2), keeping every die kind at the same visual size on the
  // tray. The base vertices sit on a sphere of radius √(1+φ²).
  const D20_SCALE = Math.sqrt(3);
  const radius = Math.sqrt(1 + phi * phi);
  const norm = ((DIE_SIZE / 2) * D20_SCALE) / radius;
  for (const p of v) p.scaleInPlace(norm);
  // 20 faces by vertex indices, each CCW from outside.
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

function buildFacesForKind(kind: DieKind): FaceSpec[] {
  if (kind === "F") {
    // Fudge die — render as a d6 with +/-/blank labels arranged
    // 2-2-2. The numeral text drawing accepts any label string.
    const faces = buildD6Faces();
    const labels = ["+", "+", "−", "−", " ", " "];
    return faces.map((f, i) => ({ ...f, label: labels[i]! }));
  }
  if (kind === 100) {
    // Tens d10 — labels "10", "20", ... "90", "00". Reuses d10's
    // pentagonal-bipyramid geometry.
    return buildD10Faces().map((f, i) => ({
      ...f,
      label: i === 9 ? "00" : String((i + 1) * 10).padStart(2, "0"),
    }));
  }
  if (kind === "10u") {
    // Units d10 — labels "0".."9". Same geometry as d10/d100,
    // distinct face labels so faceValues parses to 0..9 (rather
    // than 1..10 or the tens-multiples).
    return buildD10Faces().map((f, i) => ({
      ...f,
      label: String(i),
    }));
  }
  switch (kind) {
    case 4:
      return buildD4Faces();
    case 6:
      return buildD6Faces();
    case 8:
      return buildD8Faces();
    case 10:
      return buildD10Faces();
    case 12:
      return buildD12Faces();
    case 20:
      return buildD20Faces();
  }
}

// ─── Mesh assembly ──────────────────────────────────────────────────
//
// Given a list of FaceSpec, assemble a mesh with:
//   - per-face vertex duplication (so each face has its own UV set)
//   - fan-triangulation for polygonal faces
//   - per-face UV mapping that puts the face's centroid at (0.5, 0.5)
//     in texture space and inscribes the face's outline within
//     [0,1] × [0,1]
//   - subMeshes: one SubMesh per face, indexing only that face's
//     triangles, with a unique materialIndex
//
// The resulting mesh's MultiMaterial slots map directly to
// faceIndex 0..N-1.

interface BuiltMesh {
  mesh: Mesh;
  /** Per-face label, in face index order — used to label the
   *  per-face DynamicTextures. */
  labels: string[];
  /** Rotation that aligns face[i]'s outward normal with +Y, so the
   *  die settles with face[i] on top. Computed once per kind at
   *  mesh build time. For d4 these are overridden after build to
   *  be *vertex*-up rotations instead. */
  faceRotations: Quaternion[];
  /** Numeric die-value of face[i], parallel to `labels`. Used to
   *  look up the right face rotation for a rolled value. NaN for
   *  faces whose label isn't a parseable number (Fudge blanks). */
  faceValues: number[];
  /** d4 only: per-face corner-value triplets (parallel to `labels`)
   *  passed through to texture building so each face paints its
   *  three vertex-corner numerals. */
  faceCornerValues: (number[] | undefined)[];
}

/** Quaternion rotating unit vector `from` to align with unit
 *  vector `to`. Handles parallel and antiparallel edge cases. */
function rotationFromTo(from: Vector3, to: Vector3): Quaternion {
  const dot = Vector3.Dot(from, to);
  if (dot > 0.9999) return Quaternion.Identity();
  if (dot < -0.9999) {
    // Antiparallel — pick any axis perpendicular to `from`.
    const perp =
      Math.abs(from.x) < 0.9
        ? new Vector3(1, 0, 0)
        : new Vector3(0, 1, 0);
    const axis = Vector3.Cross(from, perp).normalize();
    return Quaternion.RotationAxis(axis, Math.PI);
  }
  const axis = Vector3.Cross(from, to).normalize();
  const angle = Math.acos(dot);
  return Quaternion.RotationAxis(axis, angle);
}

function buildDieMesh(scene: Scene, name: string, faces: FaceSpec[]): BuiltMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const subMeshRanges: { indexStart: number; indexCount: number; vertStart: number; vertCount: number }[] = [];
  const faceRotations: Quaternion[] = [];

  for (const face of faces) {
    const verts = face.vertices;
    if (verts.length < 3) continue;
    // Face plane: normal is Cross(v1 - v0, v2 - v0) for first triangle.
    const v0 = verts[0]!;
    const v1 = verts[1]!;
    const v2 = verts[2]!;
    const e1 = v1.subtract(v0);
    const e2 = v2.subtract(v0);
    const normal = Vector3.Cross(e1, e2).normalize();

    let faceUVs: { u: number; v: number }[];
    if (face.cornerValues) {
      // d4-style: each of the 3 vertices maps to a fixed corner of
      // the texture (apex top, then bottom-left and bottom-right
      // CCW). Skips the centroid-projection math entirely — the
      // corners are baked into the texture at known UV positions
      // by `buildFaceTexture`.
      faceUVs = [
        { u: 0.5, v: 0.95 },
        { u: 0.067, v: 0.07 },
        { u: 0.933, v: 0.07 },
      ];
    } else {
      // Centroid of face (average of vertices).
      let cx = 0, cy = 0, cz = 0;
      for (const v of verts) {
        cx += v.x;
        cy += v.y;
        cz += v.z;
      }
      cx /= verts.length;
      cy /= verts.length;
      cz /= verts.length;
      const centroid = new Vector3(cx, cy, cz);

      // Build a 2D basis on the face plane to project vertices into UV space.
      // `up` order is `Cross(right, normal)` (not `Cross(normal,
      // right)`) so the texture's V axis points in the direction
      // that, after the face is rotated to land on top of the die,
      // ends up aligned with the camera's screen-up.
      const refUp =
        Math.abs(normal.y) < 0.9
          ? new Vector3(0, 1, 0)
          : new Vector3(1, 0, 0);
      const right = Vector3.Cross(refUp, normal).normalize();
      const up = Vector3.Cross(right, normal).normalize();

      const local2D: { u: number; v: number }[] = verts.map((vx) => {
        const d = vx.subtract(centroid);
        return {
          u: Vector3.Dot(d, right),
          v: Vector3.Dot(d, up),
        };
      });
      let maxAbs = 0;
      for (const p of local2D) {
        maxAbs = Math.max(maxAbs, Math.abs(p.u), Math.abs(p.v));
      }
      // Pad slightly so the face's outline doesn't bleed off the
      // texture edge — leave a 5% margin on each side.
      const scale = 0.5 / (maxAbs * 1.1);
      faceUVs = local2D.map(({ u, v }) => ({
        u: 0.5 + u * scale,
        v: 0.5 + v * scale,
      }));
    }

    // Append vertices for this face. Each face gets its own copies
    // (no sharing across faces) so per-face UVs can differ at a
    // shared physical position.
    const vertStart = positions.length / 3;
    for (let i = 0; i < verts.length; i++) {
      positions.push(verts[i]!.x, verts[i]!.y, verts[i]!.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(faceUVs[i]!.u, faceUVs[i]!.v);
    }

    // Fan-triangulate: triangles (v0, v1, v2), (v0, v2, v3), ...
    const indexStart = indices.length;
    for (let i = 1; i < verts.length - 1; i++) {
      indices.push(vertStart, vertStart + i, vertStart + i + 1);
    }
    const indexCount = indices.length - indexStart;
    subMeshRanges.push({
      indexStart,
      indexCount,
      vertStart,
      vertCount: verts.length,
    });
    // Rotation that lands this face on top of the die.
    faceRotations.push(rotationFromTo(normal, new Vector3(0, 1, 0)));
  }

  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.indices = indices;
  vd.applyToMesh(mesh, true);

  // Replace default subMeshes with one per face.
  mesh.subMeshes = [];
  for (let i = 0; i < subMeshRanges.length; i++) {
    const r = subMeshRanges[i]!;
    new SubMesh(i, r.vertStart, r.vertCount, r.indexStart, r.indexCount, mesh);
  }

  // Parse each label to its numeric die-value. Non-numeric labels
  // (Fudge symbols) get NaN; the spawn-side lookup falls back to
  // a random face when a target value can't be matched.
  const faceValues = faces.map((f) => {
    if (f.label === "+") return 1;
    if (f.label === "−") return -1;
    if (f.label === " ") return 0;
    const n = parseInt(f.label, 10);
    return Number.isFinite(n) ? n : NaN;
  });

  return {
    mesh,
    labels: faces.map((f) => f.label),
    faceRotations,
    faceValues,
    faceCornerValues: faces.map((f) => f.cornerValues),
  };
}

/** Paint one face's numeral, perfectly centered, on a fresh
 *  DynamicTexture. The texture's background is the player's tint
 *  (baked in) and the numeral is white. The material uses this as
 *  its diffuseTexture with diffuseColor = white, so what we paint
 *  here is exactly what shows up on the face — no multiplication,
 *  no emissive surprises.
 *
 *  Per-(kind, tint) caching upstream keeps us from re-creating
 *  these for every die of the same colour. */
function shouldUnderline(label: string): boolean {
  // Numerals that read ambiguously when rotated 180° (6/9 and the
  // two-digit numbers containing them or that flip to other valid
  // values).
  return (
    label === "6" ||
    label === "9" ||
    label === "11" ||
    label === "16" ||
    label === "18" ||
    label === "19" ||
    label === "66" ||
    label === "68" ||
    label === "69" ||
    label === "86" ||
    label === "88" ||
    label === "89" ||
    label === "91" ||
    label === "96" ||
    label === "98" ||
    label === "99"
  );
}

function buildFaceTexture(
  scene: Scene,
  label: string,
  tint: Color3,
  cornerValues?: number[],
  centeredFontSize?: number,
): DynamicTexture {
  const tex = new DynamicTexture(
    cornerValues
      ? `face-corners-${cornerValues.join("_")}-${tint.toHexString()}`
      : `face-${label}-${tint.toHexString()}`,
    FACE_TEX_SIZE,
    scene,
    true,
  );
  // Babylon's ICanvasRenderingContext is a stripped subset of the
  // browser's CanvasRenderingContext2D — cast through `unknown` to
  // get the full DOM API (text*, font properties).
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;

  const r = Math.round(tint.r * 255);
  const g = Math.round(tint.g * 255);
  const b = Math.round(tint.b * 255);
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, FACE_TEX_SIZE, FACE_TEX_SIZE);

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (cornerValues && cornerValues.length === 3) {
    // d4: paint a numeral at each of the three vertex corners.
    // Each numeral is rotated so its "top" points toward its
    // vertex (away from the face centroid). That way, whichever
    // vertex lands at the apex of the standing die, the value at
    // that vertex's corner on every visible face reads upright.
    //
    // Apex (vertex 0) sits at the top of the canvas → no rotation.
    // Bottom-left (vertex 1) → +120° (CW in canvas).
    // Bottom-right (vertex 2) → −120° (CCW in canvas).
    //
    // Positions are pulled in from the texture corners enough that
    // each numeral sits comfortably inside the triangle's tip
    // without clipping past the triangle's edge, while still
    // reading as a *corner* numeral rather than something near the
    // centre.
    const fontSize = 64;
    ctx.font = `bold ${fontSize}px sans-serif`;
    const drawCorner = (
      canvasX: number,
      canvasY: number,
      value: number,
      rotateDeg: number,
    ) => {
      const text = String(value);
      ctx.save();
      ctx.translate(canvasX, canvasY);
      ctx.rotate((rotateDeg * Math.PI) / 180);
      ctx.fillText(text, 0, fontSize * 0.04);
      if (shouldUnderline(text)) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#ffffff";
        const halfW = 16;
        ctx.beginPath();
        ctx.moveTo(-halfW, fontSize * 0.5);
        ctx.lineTo(halfW, fontSize * 0.5);
        ctx.stroke();
      }
      ctx.restore();
    };
    // Each numeral's "top" should point toward its own vertex
    // (away from the face centroid) so that, when that vertex
    // lands at the apex of the standing die, the numeral reads
    // upright on screen.
    //   - Apex (vertex 0) sits at canvas-up of centroid → 0°.
    //   - Vertex 1 sits to the canvas-down-left of centroid →
    //     numeral rotates 120° CCW (negative ctx angle).
    //   - Vertex 2 sits to the canvas-down-right of centroid →
    //     numeral rotates 120° CW (positive ctx angle).
    drawCorner(FACE_TEX_SIZE * 0.5, FACE_TEX_SIZE * 0.27, cornerValues[0]!, 0);
    drawCorner(FACE_TEX_SIZE * 0.32, FACE_TEX_SIZE * 0.71, cornerValues[1]!, -120);
    drawCorner(FACE_TEX_SIZE * 0.68, FACE_TEX_SIZE * 0.71, cornerValues[2]!, 120);
  } else {
    // Single centred numeral (every kind except d4). The default
    // size assumes a square face (d6 / Fudge); triangular faces
    // (d8 / d10 / d20 / d100) and pentagonal faces (d12) have a
    // smaller inscribed circle, so the caller passes a smaller
    // `centeredFontSize` for those.
    const baseSize = centeredFontSize ?? 170;
    const fontSize = label.length > 1 ? Math.round(baseSize * 0.76) : baseSize;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillText(
      label,
      FACE_TEX_SIZE / 2,
      FACE_TEX_SIZE / 2 + fontSize * 0.04,
    );
    if (shouldUnderline(label)) {
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#ffffff";
      const underlineY = FACE_TEX_SIZE / 2 + fontSize * 0.5;
      const halfW = label.length > 1 ? 50 : 30;
      ctx.beginPath();
      ctx.moveTo(FACE_TEX_SIZE / 2 - halfW, underlineY);
      ctx.lineTo(FACE_TEX_SIZE / 2 + halfW, underlineY);
      ctx.stroke();
    }
  }

  tex.update();
  return tex;
}

interface KindMeshBundle {
  /** Hidden master mesh; per-spawn we clone from it. */
  master: Mesh;
  /** Labels in face-index order — used to build textures. */
  labels: string[];
  /** Per-face corner-value triplets (d4 only); undefined elsewhere. */
  faceCornerValues: (number[] | undefined)[];
  /** Rotation that lands the i'th rotation slot on top. For d4
   *  these are vertex-up rotations (4 of them, one per vertex);
   *  for other kinds, face-up rotations parallel to `labels`. */
  faceRotations: Quaternion[];
  /** Numeric value at each rotation slot. For d4 = vertex values
   *  1..4 (parallel to `faceRotations`). For others = face values
   *  parallel to `labels`. The value→slot lookup at spawn time
   *  uses this. */
  faceValues: number[];
}

interface KindTintBundle {
  /** MultiMaterial for this (kind, tint) pair, ready to assign. */
  multi: MultiMaterial;
}

export function createTray(canvas: HTMLCanvasElement): TrayHandle {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: false,
    stencil: false,
    antialias: true,
  });
  engine.resize();

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.08, 0.07, 0.1, 0);

  // Camera: orthographic, ~20° off vertical so the dice look 3D
  // rather than purely top-down. The orthographic bounds are
  // recomputed in `refit` to fully fill the canvas.
  const camera = new ArcRotateCamera(
    "tray-camera",
    -Math.PI / 2,
    Math.PI / 9, // ~20° from vertical
    20,
    Vector3.Zero(),
    scene,
  );
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = 0.01;
  camera.maxZ = 50;

  // Lights tuned bright so the diffuse-tinted bodies read clearly
  // against the dark tray. The white numerals come through the
  // emissive channel and are constant regardless of these — but
  // the body shading was washing toward black at the previous
  // intensities.
  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  ambient.intensity = 1.2;
  const key = new DirectionalLight("key", new Vector3(-0.3, -1, -0.4), scene);
  key.intensity = 0.8;
  const fill = new DirectionalLight("fill", new Vector3(0.5, -0.6, 0.7), scene);
  fill.intensity = 0.4;

  const floorMat = new StandardMaterial("floor-mat", scene);
  floorMat.diffuseColor = new Color3(0.16, 0.15, 0.19);
  floorMat.specularColor = new Color3(0.05, 0.05, 0.05);
  const wallMat = new StandardMaterial("wall-mat", scene);
  wallMat.diffuseColor = new Color3(0.22, 0.21, 0.26);
  wallMat.specularColor = new Color3(0.1, 0.1, 0.1);

  let floor: Mesh | null = null;
  let walls: Mesh[] = [];
  let halfWidth = VIEW_HALF_HEIGHT;
  const halfDepth = VIEW_HALF_HEIGHT;

  const buildTray = (): void => {
    floor?.dispose();
    for (const w of walls) w.dispose();
    walls = [];
    const width = halfWidth * 2;
    const depth = halfDepth * 2;
    floor = MeshBuilder.CreateBox(
      "tray-floor",
      { width, depth, height: 0.05 },
      scene,
    );
    floor.position.y = -0.025;
    floor.material = floorMat;
    const wallThickness = 0.1;
    const buildWall = (
      n: string,
      w: number,
      d: number,
      x: number,
      z: number,
    ): Mesh => {
      const wall = MeshBuilder.CreateBox(
        n,
        { width: w, depth: d, height: TRAY_WALL_HEIGHT },
        scene,
      );
      wall.position.set(x, TRAY_WALL_HEIGHT / 2, z);
      wall.material = wallMat;
      return wall;
    };
    walls = [
      buildWall("wall-n", width, wallThickness, 0, -halfDepth),
      buildWall("wall-s", width, wallThickness, 0, halfDepth),
      buildWall("wall-w", wallThickness, depth, -halfWidth, 0),
      buildWall("wall-e", wallThickness, depth, halfWidth, 0),
    ];
  };

  const refit = (): void => {
    engine.resize();
    const w = canvas.clientWidth || canvas.width || 1;
    const h = canvas.clientHeight || canvas.height || 1;
    const aspect = w / h;
    halfWidth = VIEW_HALF_HEIGHT * aspect;
    camera.orthoTop = halfDepth;
    camera.orthoBottom = -halfDepth;
    camera.orthoLeft = -halfWidth;
    camera.orthoRight = halfWidth;
    buildTray();
  };

  refit();
  engine.runRenderLoop(() => scene.render());

  // Per-kind master mesh, built lazily on first use. The mesh is
  // tint-agnostic (geometry + UVs only); per-(kind, tint) materials
  // live in `kindTintCache` below.
  const kindMeshCache = new Map<DieKind, KindMeshBundle>();
  const kindTintCache = new Map<string, KindTintBundle>();

  function getKindMesh(kind: DieKind): KindMeshBundle {
    const cached = kindMeshCache.get(kind);
    if (cached) return cached;
    const faces = buildFacesForKind(kind);
    const built = buildDieMesh(scene, `master-${String(kind)}`, faces);
    built.mesh.setEnabled(false); // master is invisible; we clone for spawns
    built.mesh.isPickable = false;

    // d4 special case: the rolled value lives at a *vertex* (apex
    // when the die comes to rest), not on a face. Override the
    // face-up rotations the build computed with vertex-up rotations
    // — one per vertex, mapping value V to the rotation that
    // points the V-valued vertex straight up. The face textures
    // already carry three corner numerals so any of the three
    // visible faces shows the value at its apex corner.
    let faceRotations = built.faceRotations;
    let faceValues = built.faceValues;
    if (kind === 4) {
      const { positions, values } = getD4VertexData();
      faceRotations = positions.map((p) =>
        rotationFromTo(p.clone().normalize(), new Vector3(0, 1, 0)),
      );
      faceValues = values;
    }

    const bundle: KindMeshBundle = {
      master: built.mesh,
      labels: built.labels,
      faceCornerValues: built.faceCornerValues,
      faceRotations,
      faceValues,
    };
    kindMeshCache.set(kind, bundle);
    return bundle;
  }

  /** Per-kind centred-numeral font size. Square faces (d6, Fudge)
   *  comfortably fit a big glyph; triangular faces (d8, d10, d20,
   *  d100) only have ~half the inscribed-circle radius, so a 170px
   *  glyph overflows the triangle's edges. d12's pentagons sit
   *  between. d4 is unaffected — it uses the corner-numeral path. */
  function centeredFontSizeForKind(kind: DieKind): number {
    if (kind === 6 || kind === "F") return 170;
    if (kind === 12) return 140;
    // Triangular-face dice: d8, d10, d20, d100.
    return 110;
  }

  function getKindTintMaterial(kind: DieKind, tint: Color3): KindTintBundle {
    const key = `${String(kind)}:${tint.toHexString()}`;
    const cached = kindTintCache.get(key);
    if (cached) return cached;
    const meshBundle = getKindMesh(kind);
    const fontSize = centeredFontSizeForKind(kind);
    const multi = new MultiMaterial(`multi-${key}`, scene);
    multi.subMaterials = meshBundle.labels.map((label, i) => {
      const m = new StandardMaterial(`mat-${key}-${i}-${label}`, scene);
      // d4 faces use cornerValues to paint three numerals; every
      // other kind uses the single-label centred path. The texture
      // has the tint baked into the bg + white numerals, so we
      // hand it to diffuseTexture with diffuseColor = white. No
      // emissive, no multiplications that could blow out the body.
      m.diffuseTexture = buildFaceTexture(
        scene,
        label,
        tint,
        meshBundle.faceCornerValues[i],
        fontSize,
      );
      m.diffuseColor = new Color3(1, 1, 1);
      m.specularColor = new Color3(0.35, 0.35, 0.35);
      m.specularPower = 48;
      m.backFaceCulling = false;
      return m;
    });
    const bundle: KindTintBundle = { multi };
    kindTintCache.set(key, bundle);
    return bundle;
  }

  const active: ActiveDie[] = [];
  const SOFT_CAP = 30;

  function pickLandingSpot(): Vector3 {
    const margin = 0.7;
    const x = (Math.random() * 2 - 1) * (halfWidth - margin);
    const z = (Math.random() * 2 - 1) * (halfDepth - margin);
    return new Vector3(x, DIE_SIZE / 2, z);
  }

  function randomStartQuat(): Quaternion {
    return Quaternion.RotationYawPitchRoll(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
    );
  }

  /** Pick the face-up rotation for the face whose value matches
   *  `targetValue`, composed with a random rotation around world-Y
   *  so the die's yaw on landing varies. Falls back to a random
   *  face if the target value isn't on this die kind (e.g. an
   *  exotic d-value the parser produced).
   *
   *  The world-Y yaw is composed AFTER the face rotation, which
   *  keeps the chosen face on top while spinning the die around
   *  its vertical axis. */
  function pickFaceUpRotForValue(
    bundle: KindMeshBundle,
    targetValue: number,
  ): Quaternion {
    let faceIdx = bundle.faceValues.indexOf(targetValue);
    if (faceIdx < 0) {
      faceIdx = Math.floor(Math.random() * bundle.faceRotations.length);
    }
    // eslint-disable-next-line no-console
    console.log(
      `[dice-tray] target value=${targetValue} → faceIdx=${faceIdx} label="${bundle.labels[faceIdx]}"`,
    );
    const faceRot = bundle.faceRotations[faceIdx]!;
    const yaw = Quaternion.RotationAxis(
      new Vector3(0, 1, 0),
      Math.random() * Math.PI * 2,
    );
    return yaw.multiply(faceRot);
  }

  async function spawn(args: {
    kind: DieKind;
    value: number;
    tintColor: Color3;
  }): Promise<void> {
    const meshBundle = getKindMesh(args.kind);
    const tintBundle = getKindTintMaterial(args.kind, args.tintColor);

    const name = `die-${active.length}-${Date.now().toString(36)}`;
    const mesh = meshBundle.master.clone(name) as Mesh;
    mesh.setEnabled(true);
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    // Share the (kind, tint) MultiMaterial across all dice with
    // the same colour — no per-die material allocation needed.
    mesh.material = tintBundle.multi;

    const landing = pickLandingSpot();
    const spawnPos = new Vector3(
      landing.x + (Math.random() - 0.5) * 1.2,
      SPAWN_HEIGHT,
      landing.z + (Math.random() - 0.5) * 1.2,
    );
    mesh.position.copyFrom(spawnPos);
    const startRot = randomStartQuat();
    const endRot = pickFaceUpRotForValue(meshBundle, args.value);
    mesh.rotationQuaternion = startRot.clone();

    const startTime = performance.now();
    const durationMs = TUMBLE_SECONDS * 1000;
    const completion = new Promise<void>((resolve) => {
      const observer = scene.onBeforeRenderObservable.add(() => {
        const elapsed = performance.now() - startTime;
        const tRaw = Math.min(1, elapsed / durationMs);
        const t = easeOutQuad(tRaw);
        mesh.position.x = spawnPos.x + (landing.x - spawnPos.x) * t;
        mesh.position.y = spawnPos.y + (landing.y - spawnPos.y) * t;
        mesh.position.z = spawnPos.z + (landing.z - spawnPos.z) * t;
        Quaternion.SlerpToRef(startRot, endRot, t, mesh.rotationQuaternion!);
        if (tRaw >= 1) {
          scene.onBeforeRenderObservable.remove(observer);
          resolve();
        }
      });
    });

    active.push({ mesh, spawnedAt: Date.now() });

    while (active.length > SOFT_CAP) {
      const oldest = active.shift();
      if (!oldest) break;
      fadeAndDispose(oldest.mesh);
    }

    await completion;
  }

  function fadeAndDispose(mesh: Mesh): void {
    const startTime = performance.now();
    const durationMs = 500;
    const observer = scene.onBeforeRenderObservable.add(() => {
      const t = Math.min(1, (performance.now() - startTime) / durationMs);
      mesh.visibility = 1 - t;
      if (t >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
        mesh.dispose();
      }
    });
  }

  function clear(): void {
    while (active.length > 0) {
      const a = active.pop()!;
      a.mesh.dispose();
    }
  }

  function dispose(): void {
    clear();
    engine.stopRenderLoop();
    scene.dispose();
    engine.dispose();
  }

  function resize(): void {
    refit();
  }

  return { spawn, clear, dispose, resize };
}
