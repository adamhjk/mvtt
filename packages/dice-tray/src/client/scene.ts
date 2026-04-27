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

export type DieKind = 4 | 6 | 8 | 10 | 12 | 20 | 100 | "F";

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
  label: string;
}

/** Tetrahedron, 4 triangular faces. Edge length picked so the
 *  inscribed sphere has radius ~DIE_SIZE/2. */
function buildD4Faces(): FaceSpec[] {
  // Regular tetrahedron with vertices on a sphere of radius DIE_SIZE/2.
  const r = DIE_SIZE / 2;
  // The 4 vertices of a regular tetrahedron inscribed in a cube
  // of side 2/√3 — easy to lift positions from the cube's
  // alternating corners.
  const k = r / Math.sqrt(3);
  const v: Vector3[] = [
    new Vector3(+k, +k, +k),
    new Vector3(-k, -k, +k),
    new Vector3(-k, +k, -k),
    new Vector3(+k, -k, -k),
  ];
  return [
    { vertices: [v[0]!, v[1]!, v[2]!], label: "1" },
    { vertices: [v[0]!, v[3]!, v[1]!], label: "2" },
    { vertices: [v[0]!, v[2]!, v[3]!], label: "3" },
    { vertices: [v[1]!, v[3]!, v[2]!], label: "4" },
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

/** Octahedron, 8 triangular faces — two pyramids back-to-back. */
function buildD8Faces(): FaceSpec[] {
  const r = DIE_SIZE / 2;
  const top = new Vector3(0, +r, 0);
  const bot = new Vector3(0, -r, 0);
  // 4 vertices on the equator (XZ plane) at the cardinal directions.
  const px = new Vector3(+r, 0, 0);
  const nx = new Vector3(-r, 0, 0);
  const pz = new Vector3(0, 0, +r);
  const nz = new Vector3(0, 0, -r);
  return [
    { label: "1", vertices: [top, px, pz] },
    { label: "2", vertices: [top, pz, nx] },
    { label: "3", vertices: [top, nx, nz] },
    { label: "4", vertices: [top, nz, px] },
    { label: "5", vertices: [bot, pz, px] },
    { label: "6", vertices: [bot, nx, pz] },
    { label: "7", vertices: [bot, nz, nx] },
    { label: "8", vertices: [bot, px, nz] },
  ];
}

/** Pentagonal bipyramid — 10 triangular faces. Stand-in for a
 *  proper pentagonal trapezohedron d10; visually distinct enough
 *  from a d20 that it reads as "different die," and trivially
 *  buildable from a pentagon + two apexes. */
function buildD10Faces(): FaceSpec[] {
  const r = DIE_SIZE / 2;
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
  // Scale to target size (the vertices above sit on a sphere of
  // radius √3; scale so that the bounding cube edge = DIE_SIZE).
  const norm = DIE_SIZE / 2 / Math.sqrt(3);
  for (const v of all) v.scaleInPlace(norm);
  // 12 faces, each a pentagon, by vertex indices into `all`.
  // Authoritative order (Wikipedia): each row CCW from outside.
  const faceIndices: number[][] = [
    [0, 12, 13, 4, 8],
    [0, 8, 9, 1, 16],
    [0, 16, 17, 2, 12],
    [12, 2, 10, 6, 13],
    [13, 6, 19, 18, 4],
    [4, 18, 5, 9, 8],
    [9, 5, 15, 14, 1],
    [1, 14, 3, 17, 16],
    [17, 3, 11, 10, 2],
    [10, 11, 7, 19, 6],
    [19, 7, 15, 5, 18],
    [11, 3, 14, 15, 7],
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
  const radius = Math.sqrt(1 + phi * phi);
  const norm = DIE_SIZE / 2 / radius;
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
    // d100 uses the same geometry as d10; the label just shows the
    // tens digit. The caller spawns d100 separately from d10 if
    // they want both.
    return buildD10Faces().map((f, i) => ({
      ...f,
      label: i === 9 ? "00" : String((i + 1) * 10).padStart(2, "0"),
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
   *  mesh build time. */
  faceRotations: Quaternion[];
  /** Numeric die-value of face[i], parallel to `labels`. Used to
   *  look up the right face rotation for a rolled value. NaN for
   *  faces whose label isn't a parseable number (Fudge blanks). */
  faceValues: number[];
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
    // `right` is an arbitrary vector perpendicular to the normal;
    // pick one based on which axis is least aligned with `normal`.
    const refUp =
      Math.abs(normal.y) < 0.9
        ? new Vector3(0, 1, 0)
        : new Vector3(1, 0, 0);
    const right = Vector3.Cross(refUp, normal).normalize();
    const up = Vector3.Cross(normal, right).normalize();

    // Project each vertex into 2D, find max distance from centroid
    // so we can normalize face into [0,1]×[0,1].
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
    const faceUVs = local2D.map(({ u, v }) => ({
      u: 0.5 + u * scale,
      v: 0.5 + v * scale,
    }));

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
function buildFaceTexture(
  scene: Scene,
  label: string,
  tint: Color3,
): DynamicTexture {
  const tex = new DynamicTexture(
    `face-${label}-${tint.toHexString()}`,
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

  // White numeral, perfectly centered.
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontSize = label.length > 1 ? 130 : 170;
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillText(label, FACE_TEX_SIZE / 2, FACE_TEX_SIZE / 2 + fontSize * 0.04);

  // Underline numerals that read ambiguously when rotated.
  if (
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
  ) {
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#ffffff";
    const underlineY = FACE_TEX_SIZE / 2 + fontSize * 0.5;
    const halfW = label.length > 1 ? 50 : 30;
    ctx.beginPath();
    ctx.moveTo(FACE_TEX_SIZE / 2 - halfW, underlineY);
    ctx.lineTo(FACE_TEX_SIZE / 2 + halfW, underlineY);
    ctx.stroke();
  }

  tex.update();
  return tex;
}

interface KindMeshBundle {
  /** Hidden master mesh; per-spawn we clone from it. */
  master: Mesh;
  /** Labels in face-index order — used to build textures. */
  labels: string[];
  /** Rotation that lands face[i] on top, indexed by face. */
  faceRotations: Quaternion[];
  /** Numeric value of each face, indexed by face — used to map a
   *  rolled value to the right face rotation. */
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
    const bundle: KindMeshBundle = {
      master: built.mesh,
      labels: built.labels,
      faceRotations: built.faceRotations,
      faceValues: built.faceValues,
    };
    kindMeshCache.set(kind, bundle);
    return bundle;
  }

  function getKindTintMaterial(kind: DieKind, tint: Color3): KindTintBundle {
    const key = `${String(kind)}:${tint.toHexString()}`;
    const cached = kindTintCache.get(key);
    if (cached) return cached;
    const meshBundle = getKindMesh(kind);
    const multi = new MultiMaterial(`multi-${key}`, scene);
    multi.subMaterials = meshBundle.labels.map((label, i) => {
      const m = new StandardMaterial(`mat-${key}-${i}-${label}`, scene);
      // The texture has the tint baked into the bg + a white
      // numeral, so we hand it to the diffuse channel and leave
      // diffuseColor pure white. No emissive, no multiplications
      // that could blow out the body to white.
      m.diffuseTexture = buildFaceTexture(scene, label, tint);
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
