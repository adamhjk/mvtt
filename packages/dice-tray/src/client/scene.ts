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
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin.js";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate.js";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js";
import HavokPhysics from "@babylonjs/havok";
// Side-effect imports: register InstancedMesh support, the box
// builder for the tray floor, and the StandardMaterial pipeline.
import "@babylonjs/core/Meshes/instancedMesh.js";
import "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import "@babylonjs/core/Materials/standardMaterial.js";
import "@babylonjs/core/Physics/v2/physicsEngineComponent.js";

import {
  buildD4Faces,
  buildD6Faces,
  buildD8Faces,
  buildD12Faces,
  buildD20Faces,
  buildLensFaces,
  buildPrismFaces,
  buildTrapezohedronFaces,
  faceInscribedRadiusPixels,
  getD4VertexData,
  type FaceSpec,
} from "./geometry.js";
import { specCacheKey, type DieSpec } from "./spec.js";

const VIEW_HALF_HEIGHT = 4;
/** Thickness of the invisible physics floor. Big enough that a
 *  die in free fall (~22 × dt ≈ 0.36 per frame) can't tunnel
 *  through in a single physics step. */
const TRAY_FLOOR_THICKNESS = 0.4;
const SPAWN_HEIGHT = 4;
const FACE_TEX_SIZE = 256;

export type { DieSpec } from "./spec.js";

interface ActiveDie {
  mesh: Mesh;
  spawnedAt: number;
  /** Per-die physics aggregate. Disposed when the die fades out
   *  or is cleared from the tray. Set to null after we disable
   *  physics for the snap-to-target slerp. */
  agg: PhysicsAggregate | null;
}

export interface TrayHandle {
  spawn(args: {
    spec: DieSpec;
    value: number;
    tintColor: Color3;
    /**
     * Which side of the tray the die is thrown FROM. -1 = left
     * (negative X), +1 = right (positive X). Drawer picks one
     * value per roll batch and passes it to every die in that
     * batch so they all look like they came from the same hand.
     * Omitted = random per spawn.
     */
    throwSide?: -1 | 1;
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


// ─── Spec → geometry dispatch ───────────────────────────────────────
//
// Each `DieSpec` resolves to a concrete face list via the builders in
// geometry.ts. Two specs that share underlying geometry but differ
// in labels (the d100 tens half versus the units half, or the raw
// d10 versus the units-d10) produce DIFFERENT `FaceSpec[]` here so
// the per-spec mesh + material caches in this file don't collide on
// label set.

const D100_TENS_LABELS = ["10", "20", "30", "40", "50", "60", "70", "80", "90", "00"];
const D10_UNITS_LABELS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const FUDGE_LABELS = ["+", "+", "−", "−", " ", " "];

function facesForSpec(spec: DieSpec): FaceSpec[] {
  switch (spec.kind) {
    case "platonic":
      switch (spec.sides) {
        case 4:
          return buildD4Faces();
        case 6:
          return buildD6Faces();
        case 8:
          return buildD8Faces();
        case 12:
          return buildD12Faces();
        case 20:
          return buildD20Faces();
      }
    // eslint-disable-next-line no-fallthrough
    case "trapezohedron": {
      const k = spec.sides / 2;
      const labels =
        spec.labelSet === "tens" ? D100_TENS_LABELS : undefined;
      return buildTrapezohedronFaces(k, labels);
    }
    case "prism":
      return buildPrismFaces(spec.sides);
    case "lens":
      return buildLensFaces();
    case "unitsD10":
      return buildTrapezohedronFaces(5, D10_UNITS_LABELS);
    case "fudge": {
      const faces = buildD6Faces();
      return faces.map((f, i) => ({ ...f, label: FUDGE_LABELS[i]! }));
    }
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
  /** Per-face outward normal in mesh-local space, used at snap
   *  time to compute the *minimum* correction that puts the right
   *  face up while preserving whatever yaw physics settled at. */
  faceLocalNormals: Vector3[];
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
  const faceLocalNormals: Vector3[] = [];

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
    // Rotation that lands this face on top of the die, plus the
    // raw mesh-local normal so the snap can compute a minimum
    // correction (preserving the settled yaw) at runtime.
    faceRotations.push(rotationFromTo(normal, new Vector3(0, 1, 0)));
    faceLocalNormals.push(normal.clone());
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
    faceLocalNormals,
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
/** Procedural wood-grain texture for the tray walls. Vertical
 *  brown streaks plus a few darker bands and knots — enough
 *  variation that the walls read as "wood" from a top-down view
 *  without committing to a specific species. */
function createWoodTexture(scene: Scene): DynamicTexture {
  const SIZE = 256;
  const tex = new DynamicTexture("tray-wood", SIZE, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;

  // Base wood tone: warm mid-brown.
  ctx.fillStyle = "#5a3a22";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Vertical grain bands. Quasi-deterministic via a small sine
  // mix so the grain is coherent rather than pure noise.
  for (let x = 0; x < SIZE; x++) {
    const v =
      Math.sin(x * 0.04) * 0.4 +
      Math.sin(x * 0.13) * 0.25 +
      (Math.random() - 0.5) * 0.35;
    const tint = Math.round(v * 22);
    const r = Math.max(40, Math.min(150, 90 + tint));
    const g = Math.max(25, Math.min(110, 58 + tint));
    const b = Math.max(15, Math.min(80, 34 + tint));
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(x, 0, 1, SIZE);
  }

  // Dark grain streaks.
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * SIZE;
    const w = 1 + Math.random() * 3;
    ctx.fillStyle = `rgba(40, 22, 12, ${0.25 + Math.random() * 0.2})`;
    ctx.fillRect(x, 0, w, SIZE);
  }

  // A couple of knots (oval darker spots).
  for (let i = 0; i < 3; i++) {
    const cx = Math.random() * SIZE;
    const cy = Math.random() * SIZE;
    const rx = 6 + Math.random() * 10;
    const ry = 3 + Math.random() * 5;
    ctx.fillStyle = "rgba(30, 18, 8, 0.5)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  tex.update();
  return tex;
}

/** Procedural velvet texture for the tray floor. Deep wine base
 *  with fine ImageData noise so it reads as fabric-fuzz when
 *  viewed from the orthographic camera, plus a subtle darkening
 *  vignette toward the centre that hints at depth. */
function createVelvetTexture(scene: Scene): DynamicTexture {
  const SIZE = 256;
  const tex = new DynamicTexture("tray-velvet", SIZE, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;

  // Dark forest green — classic dice-tray velvet that lets every
  // tint of die pop without clashing.
  ctx.fillStyle = "#143a1f";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Per-pixel noise for the fabric grain. Weighted so the green
  // channel carries most of the variance — keeps the noise looking
  // like felt pile rather than chromatic speckle.
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n * 0.5));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n * 0.55));
  }
  ctx.putImageData(img, 0, 0);

  // Soft radial vignette darker toward the centre — sells the
  // "well of velvet" look. Gradient from transparent at edges to
  // a slightly darker tint at the middle.
  const grad = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.1, SIZE / 2, SIZE / 2, SIZE * 0.7);
  grad.addColorStop(0, "rgba(0, 0, 0, 0.18)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);

  tex.update();
  return tex;
}

function shouldUnderline(label: string): boolean {
  // Numerals that contain 6 or 9 read ambiguously when the die
  // settles upside-down. The single rule "any 6 or 9 in the label"
  // covers every case (6, 9, 16, 19, 66, 69, 91, 96, 99, …) and any
  // future N without per-value enumeration. The single-digit "0"
  // and "1" are point-symmetric under 180° rotation, so no
  // underline is needed there either. (We could underline "8" too
  // for symmetry, but 8 is already symmetric.)
  return /[69]/.test(label);
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
  /** Mesh-local "up direction" of the i'th rotation slot — the
   *  outward face normal for face-dice, the vertex direction
   *  (normalised position) for d4. Used by the snap to compute
   *  the *minimum* rotation that puts that direction at world +Y
   *  while preserving whatever yaw physics settled at. */
  faceLocalNormals: Vector3[];
  /** Numeric value at each rotation slot. For d4 = vertex values
   *  1..4 (parallel to `faceRotations`). For others = face values
   *  parallel to `labels`. The value→slot lookup at spawn time
   *  uses this. */
  faceValues: number[];
  /** Per-face inscribed-circle radius in texture pixels (computed
   *  from the projected FaceSpec). Drives per-face font sizing —
   *  see `centeredFontSizeForFace`. */
  faceInscribedPixels: number[];
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
  floorMat.diffuseTexture = createVelvetTexture(scene);
  floorMat.diffuseColor = new Color3(1, 1, 1);
  floorMat.specularColor = new Color3(0.05, 0.05, 0.05); // velvet barely shines
  floorMat.specularPower = 8;
  const wallMat = new StandardMaterial("wall-mat", scene);
  wallMat.diffuseTexture = createWoodTexture(scene);
  wallMat.diffuseColor = new Color3(1, 1, 1);
  wallMat.specularColor = new Color3(0.18, 0.15, 0.10); // wood gloss
  wallMat.specularPower = 24;

  // The tray now separates *visual* meshes (flat: a wood frame +
  // velvet patch, both at floor height — looks like a 2D rim from
  // the orthographic top-down view) from *physics* meshes (an
  // invisible thick floor + invisible tall walls that contain
  // dice without contributing to the visible chrome).
  let floor: Mesh | null = null;
  let floorAgg: PhysicsAggregate | null = null;
  let walls: Mesh[] = [];
  let wallAggs: PhysicsAggregate[] = [];
  let frameMesh: Mesh | null = null;
  let velvetMesh: Mesh | null = null;
  let halfWidth = VIEW_HALF_HEIGHT;
  const halfDepth = VIEW_HALF_HEIGHT;
  /** Visual rim width — how thick the wood frame appears from
   *  above. Visible only; physics walls land just inside this. */
  const FRAME_WIDTH = 0.35;
  /** Physics wall thickness. Beefed up significantly (3× the
   *  visual frame width) so even fast handfuls can't tunnel
   *  through between physics frames. */
  const PHYS_WALL_THICKNESS = 1.0;
  /** Physics wall height. Tall enough that no toss can clear it.
   *  Walls extend from below the floor up well past spawn height. */
  const PHYS_WALL_HEIGHT = 6.0;

  // Havok physics — initialised lazily so createTray can stay
  // synchronous. Spawn awaits this before adding the die's
  // dynamic body. The plugin pulls in a WASM file (~700 KB) over
  // HTTP, so the first roll has a small one-time delay.
  let physicsReady = false;
  const physicsInit = (async () => {
    const havok = await HavokPhysics();
    const plugin = new HavokPlugin(true, havok);
    scene.enablePhysics(new Vector3(0, -22, 0), plugin);
    // Gravity is exaggerated (~2.2× earth) so dice settle quickly
    // without looking sluggish at the small world scale we use.
    physicsReady = true;
    rebuildTrayPhysics();
  })().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[dice-tray] physics init failed", err);
  });

  function disposeTrayPhysics(): void {
    floorAgg?.dispose();
    floorAgg = null;
    for (const a of wallAggs) a.dispose();
    wallAggs = [];
  }

  function rebuildTrayPhysics(): void {
    if (!physicsReady) return;
    disposeTrayPhysics();
    if (floor) {
      floorAgg = new PhysicsAggregate(
        floor,
        PhysicsShapeType.BOX,
        // Floor grip is the main settling brake, so it stays
        // moderately high. Per-die friction is kept low elsewhere
        // (so dice slide *off each other* and don't stack), and
        // the floor-vs-die contact ends up using a combined value
        // that's slipperier than the floor alone — that's the
        // sweet spot: dice slide off each other but the floor
        // catches them within a tile or two.
        { mass: 0, friction: 8.0, restitution: 0.32 },
        scene,
      );
    }
    for (const w of walls) {
      wallAggs.push(
        new PhysicsAggregate(
          w,
          PhysicsShapeType.BOX,
          // Walls bouncier than the floor so a thrown die that
          // hits the far wall snaps back across the tray with
          // some authority, instead of just sticking to the
          // contact point.
          { mass: 0, friction: 0.4, restitution: 0.55 },
          scene,
        ),
      );
    }
  }

  const buildTray = (): void => {
    disposeTrayPhysics();
    floor?.dispose();
    frameMesh?.dispose();
    velvetMesh?.dispose();
    frameMesh = null;
    velvetMesh = null;
    for (const w of walls) w.dispose();
    walls = [];

    const fullW = halfWidth * 2;
    const fullD = halfDepth * 2;
    const innerHalfW = halfWidth - FRAME_WIDTH;
    const innerHalfD = halfDepth - FRAME_WIDTH;

    // ── Visual layer (no physics) ──────────────────────────────
    // Wood frame: a thin slab at floor level filling the whole
    // ortho frame. The velvet patch sits ON TOP of it at a tiny
    // Y offset, leaving the frame visible only as a rim around
    // the velvet — the "2D frame from above" look.
    frameMesh = MeshBuilder.CreateBox(
      "tray-frame",
      { width: fullW, depth: fullD, height: 0.04 },
      scene,
    );
    frameMesh.position.y = -0.02;
    frameMesh.material = wallMat;
    frameMesh.isPickable = false;

    velvetMesh = MeshBuilder.CreateBox(
      "tray-velvet",
      {
        width: innerHalfW * 2,
        depth: innerHalfD * 2,
        height: 0.04,
      },
      scene,
    );
    // Tiny lift to avoid z-fighting with the frame underneath.
    velvetMesh.position.y = 0.001;
    velvetMesh.material = floorMat;
    velvetMesh.isPickable = false;

    // ── Physics layer (invisible) ──────────────────────────────
    // A thick floor that catches dice over the *entire* visible
    // area (slightly larger, even — extra margin so any die that
    // somehow escapes the wall ring still has ground under it
    // rather than falling into the void). Y-position puts its
    // top exactly where the velvet sits.
    floor = MeshBuilder.CreateBox(
      "tray-physics-floor",
      {
        width: fullW + PHYS_WALL_THICKNESS * 2,
        depth: fullD + PHYS_WALL_THICKNESS * 2,
        height: TRAY_FLOOR_THICKNESS,
      },
      scene,
    );
    floor.position.y = -TRAY_FLOOR_THICKNESS / 2;
    floor.isVisible = false;
    floor.isPickable = false;

    // Invisible thick walls just inside the visual rim. They
    // extend from below the floor up to PHYS_WALL_HEIGHT, with
    // PHYS_WALL_THICKNESS on the inward axis — together that's a
    // sealed box that fast handfuls of dice cannot tunnel through.
    const buildPhysWall = (
      n: string,
      w: number,
      d: number,
      x: number,
      z: number,
    ): Mesh => {
      const wall = MeshBuilder.CreateBox(
        n,
        { width: w, depth: d, height: PHYS_WALL_HEIGHT },
        scene,
      );
      wall.position.set(x, PHYS_WALL_HEIGHT / 2 - 0.5, z);
      wall.isVisible = false;
      wall.isPickable = false;
      return wall;
    };
    walls = [
      // West / east walls run the full depth INCLUDING the
      // corners (they extend past the inner area into the
      // wall-thickness margin). Combined with N/S walls of
      // matching outer extent, the corners are sealed by
      // overlap.
      buildPhysWall(
        "phys-w",
        PHYS_WALL_THICKNESS,
        fullD + PHYS_WALL_THICKNESS * 2,
        -innerHalfW - PHYS_WALL_THICKNESS / 2,
        0,
      ),
      buildPhysWall(
        "phys-e",
        PHYS_WALL_THICKNESS,
        fullD + PHYS_WALL_THICKNESS * 2,
        innerHalfW + PHYS_WALL_THICKNESS / 2,
        0,
      ),
      buildPhysWall(
        "phys-n",
        fullW + PHYS_WALL_THICKNESS * 2,
        PHYS_WALL_THICKNESS,
        0,
        -innerHalfD - PHYS_WALL_THICKNESS / 2,
      ),
      buildPhysWall(
        "phys-s",
        fullW + PHYS_WALL_THICKNESS * 2,
        PHYS_WALL_THICKNESS,
        0,
        innerHalfD + PHYS_WALL_THICKNESS / 2,
      ),
    ];
    rebuildTrayPhysics();
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

  // Per-spec master mesh + per-face inscribed-radius cache, built
  // lazily on first use. The mesh is tint-agnostic (geometry + UVs
  // only); per-(spec, tint) materials live in `kindTintCache` below.
  const kindMeshCache = new Map<string, KindMeshBundle>();
  const kindTintCache = new Map<string, KindTintBundle>();

  function getKindMesh(spec: DieSpec): KindMeshBundle {
    const key = specCacheKey(spec);
    const cached = kindMeshCache.get(key);
    if (cached) return cached;
    const faces = facesForSpec(spec);
    const built = buildDieMesh(scene, `master-${key}`, faces);
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
    let faceLocalNormals = built.faceLocalNormals;
    let faceValues = built.faceValues;
    if (spec.kind === "platonic" && spec.sides === 4) {
      const { positions, values } = getD4VertexData();
      const normals = positions.map((p) => p.clone().normalize());
      faceRotations = normals.map((n) =>
        rotationFromTo(n, new Vector3(0, 1, 0)),
      );
      faceLocalNormals = normals;
      faceValues = values;
    }

    // Pre-compute per-face inscribed-radius (in texture pixels) so
    // the font-size selector can pick a per-face size that scales
    // with the actual usable area, instead of a per-kind lookup.
    const faceInscribedPixels = faces.map((f) =>
      faceInscribedRadiusPixels(f, FACE_TEX_SIZE),
    );

    const bundle: KindMeshBundle = {
      master: built.mesh,
      labels: built.labels,
      faceCornerValues: built.faceCornerValues,
      faceRotations,
      faceLocalNormals,
      faceValues,
      faceInscribedPixels,
    };
    kindMeshCache.set(key, bundle);
    return bundle;
  }

  /** Pick a centred-numeral font size for one face from its
   *  inscribed-circle radius (in texture pixels) and the label
   *  length. Replaces the per-kind table — every face has its own
   *  inscribed radius, which scales naturally with shape and size.
   *  The 1.6 constant is empirical: gives the d6 ~170px (matches
   *  the prior per-kind value) and the d20 ~100px. */
  function centeredFontSizeForFace(
    label: string,
    inscribedPixels: number,
  ): number {
    if (inscribedPixels <= 0) return 110; // safety fallback
    const base = Math.round(inscribedPixels * 1.6);
    return label.length > 1 ? Math.round(base * 0.76) : base;
  }

  function getKindTintMaterial(spec: DieSpec, tint: Color3): KindTintBundle {
    const key = `${specCacheKey(spec)}:${tint.toHexString()}`;
    const cached = kindTintCache.get(key);
    if (cached) return cached;
    const meshBundle = getKindMesh(spec);
    const multi = new MultiMaterial(`multi-${key}`, scene);
    multi.subMaterials = meshBundle.labels.map((label, i) => {
      const m = new StandardMaterial(`mat-${key}-${i}-${label}`, scene);
      // d4 faces use cornerValues to paint three numerals; every
      // other kind uses the single-label centred path. The texture
      // has the tint baked into the bg + white numerals, so we
      // hand it to diffuseTexture with diffuseColor = white. No
      // emissive, no multiplications that could blow out the body.
      const inscribedPixels = meshBundle.faceInscribedPixels[i] ?? 0;
      const fontSize = centeredFontSizeForFace(label, inscribedPixels);
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

  function randomStartQuat(): Quaternion {
    return Quaternion.RotationYawPitchRoll(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
    );
  }

  /**
   * Settle thresholds: a body is "settled" once both linear and
   * angular velocity magnitudes stay below these for
   * SETTLE_FRAME_COUNT consecutive frames. Tuned empirically — too
   * loose and snap fires while the die is still tumbling, too
   * tight and the snap waits forever for a barely-moving die.
   */
  const SETTLE_LINEAR_VEL = 0.15;
  const SETTLE_ANGULAR_VEL = 0.4;
  const SETTLE_FRAME_COUNT = 8;
  /** Hard cap on physics time — even if a die never quite stops
   *  (numerical drift, collision with a fresh roll), we stop
   *  watching after this so spawn() resolves. */
  const SETTLE_TIMEOUT_MS = 3500;
  /**
   * Per-frame velocity damping that stands in for the linear/angular
   * damping API Havok v2 doesn't expose. Applied whenever the die's
   * centre is within `CONTACT_Y_THRESH` of the floor (i.e. resting
   * or sliding along the velvet, not airborne and not stacked on
   * another die — those cases have y above the threshold). The
   * effect is to kill the long post-bounce slide without raising
   * per-die friction, which would cause dice to stick to each other
   * on impact.
   *
   * 0.94 per frame ≈ velocity decays to 37% in ~16 frames (~0.27 s).
   * Anything gentler (0.97+) doesn't visibly stop a fast slide
   * before it crosses the tray; anything aggressive (0.90 or below)
   * pins single dice mid-tumble.
   */
  const LINEAR_DAMP_PER_FRAME = 0.94;
  const ANGULAR_DAMP_PER_FRAME = 0.94;
  /** Y threshold (in world units) below which the die centre is
   *  treated as "in contact with the floor" for damping purposes.
   *  Floor top is at y=0; a die's centre when at rest sits at the
   *  inscribed-sphere height of its current contact face — e.g.
   *  cube flat: y=0.7, cube on an edge: y≈1.0, cube on a corner:
   *  y≈1.21. Tumbling dice spend most frames above 0.8 (the original
   *  threshold) so the original 0.8 hardly ever fired. 1.3 catches
   *  every on-floor configuration including corner-contact moments,
   *  while still excluding dice stacked on top of another die
   *  (whose centres sit at y ≈ 2.1) and airborne dice (typically
   *  y > 2.5 mid-flight). */
  const CONTACT_Y_THRESH = 1.3;

  async function spawn(args: {
    spec: DieSpec;
    value: number;
    tintColor: Color3;
    throwSide?: -1 | 1;
  }): Promise<void> {
    await physicsInit;
    const meshBundle = getKindMesh(args.spec);
    const tintBundle = getKindTintMaterial(args.spec, args.tintColor);

    const name = `die-${active.length}-${Date.now().toString(36)}`;
    const mesh = meshBundle.master.clone(name) as Mesh;
    mesh.setEnabled(true);
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    // Share the (kind, tint) MultiMaterial across all dice with
    // the same colour — no per-die material allocation needed.
    mesh.material = tintBundle.multi;

    // Throw the die from one side of the tray as if released
    // from a hand. The drawer picks a side per roll batch so
    // every die in a `4d6` looks like it came out of the same
    // hand; absent that hint, randomise.
    //
    // Spread the spawn position generously across Z and slightly
    // across X / Y so a handful of dice don't all aim at the same
    // patch of tray — that's what causes stacking. Each die in a
    // batch starts a different distance from the throwing-side
    // wall, at a slightly different release height, and across
    // most of the tray's depth.
    const sideX: -1 | 1 = args.throwSide ?? (Math.random() < 0.5 ? -1 : 1);
    // Spawn inside the visible velvet area, away from the rim
    // (subtract FRAME_WIDTH plus clearance so the die's hull
    // doesn't intersect the invisible physics wall on frame
    // zero). Z-spread fills most of the inner depth.
    const innerHalfWidth = halfWidth - FRAME_WIDTH;
    const innerHalfDepth = halfDepth - FRAME_WIDTH;
    const spawnPos = new Vector3(
      sideX * (innerHalfWidth - 0.5 - Math.random() * 0.7),
      SPAWN_HEIGHT * 0.6 + Math.random() * 0.7,
      (Math.random() * 2 - 1) * Math.max(0.5, innerHalfDepth - 0.6),
    );
    mesh.position.copyFrom(spawnPos);
    mesh.rotationQuaternion = randomStartQuat();

    // Resolve the target face/vertex's mesh-local normal. Each
    // physics frame we'll apply a tiny corrective torque that
    // nudges this normal toward world +Y — a "weighted die"
    // bias. The torque is small enough that the tumble looks
    // unguided early on (when angular velocity is high), but it
    // accumulates as the die slows so by settle time the right
    // face is up. No snap at the end; physics genuinely
    // produces the result.
    let targetSlot = meshBundle.faceValues.indexOf(args.value);
    if (targetSlot < 0) targetSlot = 0;
    const targetLocalNormal = meshBundle.faceLocalNormals[targetSlot]!;

    // Convex hull collider — the polyhedron geometries are convex
    // by construction so the hull is exact. CONVEX_HULL is the
    // right shape for dynamic Havok bodies; MESH (trimesh) only
    // supports static bodies.
    const agg = new PhysicsAggregate(
      mesh,
      PhysicsShapeType.CONVEX_HULL,
      {
        mass: 0.18,
        // Low friction so when one die comes to rest on top of
        // another, contact forces + gravity slide it off; high
        // friction would let dice stack indefinitely.
        friction: 0.2,
        restitution: 0.32,
      },
      scene,
    );

    // Strong sideways throw — die crosses the tray, bounces off
    // the far wall, tumbles, settles. The X component is the
    // largest (mostly-horizontal toss); per-die variance in
    // throw speed and Z velocity is wide so a handful of dice
    // diverge in mid-air rather than tracing parallel paths
    // and stacking on top of each other when they land.
    const throwSpeed = 9 + Math.random() * 7;
    agg.body.setLinearVelocity(
      new Vector3(
        -sideX * throwSpeed,
        -1.0 - Math.random() * 2.0,
        (Math.random() - 0.5) * 5.0,
      ),
    );
    agg.body.setAngularVelocity(
      new Vector3(
        (Math.random() - 0.5) * 42,
        (Math.random() - 0.5) * 42,
        (Math.random() - 0.5) * 42,
      ),
    );

    const die: ActiveDie = { mesh, spawnedAt: Date.now(), agg };
    active.push(die);

    while (active.length > SOFT_CAP) {
      const oldest = active.shift();
      if (!oldest) break;
      fadeAndDispose(oldest);
    }

    // Watch the body until it settles (low velocity for several
    // frames running, or a hard timeout). Each frame, also apply
    // a gentle "homing" angular impulse toward face-up: cross of
    // the target face's current world-space normal with +Y is the
    // axis that, applied as torque, would rotate the die toward
    // face-up. Magnitude is tiny so the early tumble looks
    // natural — early frames have high angular velocity that
    // dominates, the bias only really takes over as energy
    // bleeds off. By settle time the die has been gently herded
    // onto the right face.
    const BIAS = 0.1;
    const worldNormal = Vector3.Zero();
    const worldLongAxis = Vector3.Zero();
    const upAxis = new Vector3(0, 1, 0);
    // Apex-rest mitigation for prism + tall trapezohedron dice.
    // Both have a single "long axis" (mesh-local +Y — the extrusion
    // direction for a prism, the apex-to-apex axis for a
    // trapezohedron). If the die settles with that axis near-
    // vertical:
    //   - on a prism, it's balancing on a cone-cap apex; no face
    //     is up.
    //   - on a tall trapezohedron (k ≥ ~7), the kite faces are
    //     nearly parallel to the long axis (apex height ≫ equator
    //     radius), so even the "correct" face-up state would put
    //     the apex very close to vertical, but in practice the die
    //     gets stuck balancing on the apex itself. The settle bias
    //     can't tip it because Cross(target-normal, +Y) is nearly
    //     parallel to the long axis when the apex is up, so the
    //     impulse spins the die around its own axis instead of
    //     toppling it. Browser testing confirmed d30 lands apex-up.
    //
    // Mitigation: when we detect "calm + upright" for a few frames,
    // flick the die laterally and reset the settle counter so the
    // bias has another chance. The kick is small (~0.6 impulse, so
    // ~3 units/s on a 0.18 kg die) — enough to topple a balanced
    // die without launching it.
    //
    // We skip this for k=5 (the standard d10): testing confirms it
    // settles with the apex tilted ~45° off vertical, so the dot
    // check would never fire. Skipping saves a per-frame
    // quaternion rotation.
    const checksApexRest =
      args.spec.kind === "prism" ||
      (args.spec.kind === "trapezohedron" && args.spec.sides >= 14);
    const localLongAxis = new Vector3(0, 1, 0);
    const APEX_UP_DOT = 0.94; // ~20° from vertical
    const APEX_REST_FRAMES = 3;
    /**
     * Apex-rest tip: applied as an *angular* impulse around a random
     * horizontal axis so the die rotates off-vertical directly. A
     * linear impulse at the CoM (the previous approach) creates no
     * torque on its own and relied on gravity tipping the CoM past
     * the apex contact — fine without damping, but the contact-Y
     * damping introduced alongside this kills the slide before
     * gravity can do the work. Direct angular impulse is robust to
     * any damping setting.
     */
    const APEX_KICK_ANG_IMPULSE = 0.35;
    let apexFrames = 0;
    const startTime = performance.now();
    await new Promise<void>((resolve) => {
      let calmFrames = 0;
      const observer = scene.onBeforeRenderObservable.add(() => {
        if (!die.agg || mesh.isDisposed()) {
          scene.onBeforeRenderObservable.remove(observer);
          resolve();
          return;
        }
        // Compute corrective torque axis in world space.
        targetLocalNormal.rotateByQuaternionToRef(
          mesh.rotationQuaternion!,
          worldNormal,
        );
        const corr = Vector3.Cross(worldNormal, upAxis);
        // Magnitude of `corr` = sin(angle off from +Y), so the
        // bias self-tapers as the die approaches face-up.
        die.agg.body.applyAngularImpulse(corr.scale(BIAS));

        // Contact-gated damping. Stands in for the Havok v2 damping
        // API (which doesn't exist). While the die centre is within
        // CONTACT_Y_THRESH of the floor, scale both linear and
        // angular velocity by the per-frame damping factor. The
        // gate excludes airborne dice and stacked dice so neither
        // gravity-driven flight nor stack-resolution dynamics get
        // interfered with — only the floor-slide phase is damped.
        if (mesh.position.y < CONTACT_Y_THRESH) {
          die.agg.body.setLinearVelocity(
            die.agg.body
              .getLinearVelocity()
              .scaleInPlace(LINEAR_DAMP_PER_FRAME),
          );
          die.agg.body.setAngularVelocity(
            die.agg.body
              .getAngularVelocity()
              .scaleInPlace(ANGULAR_DAMP_PER_FRAME),
          );
        }

        const lin = die.agg.body.getLinearVelocity().lengthSquared();
        const ang = die.agg.body.getAngularVelocity().lengthSquared();
        const linOk = lin < SETTLE_LINEAR_VEL * SETTLE_LINEAR_VEL;
        const angOk = ang < SETTLE_ANGULAR_VEL * SETTLE_ANGULAR_VEL;
        if (linOk && angOk) {
          calmFrames++;

          // Apex-rest check (prism + tall trapezohedron only).
          if (checksApexRest) {
            localLongAxis.rotateByQuaternionToRef(
              mesh.rotationQuaternion!,
              worldLongAxis,
            );
            const upDot = Math.abs(worldLongAxis.y);
            if (upDot > APEX_UP_DOT) {
              apexFrames++;
              if (apexFrames >= APEX_REST_FRAMES) {
                // Tip the die by applying an angular impulse around
                // a random horizontal axis. This rotates the
                // mesh-local long axis directly off vertical, which
                // is what a linear nudge would do indirectly via
                // gravity — except the per-frame damping now in
                // play kills any indirect path before it works.
                const a = Math.random() * Math.PI * 2;
                die.agg.body.applyAngularImpulse(
                  new Vector3(
                    Math.cos(a) * APEX_KICK_ANG_IMPULSE,
                    0,
                    Math.sin(a) * APEX_KICK_ANG_IMPULSE,
                  ),
                );
                apexFrames = 0;
                calmFrames = 0;
              }
            } else {
              apexFrames = 0;
            }
          }
        } else {
          calmFrames = 0;
          apexFrames = 0;
        }
        const elapsed = performance.now() - startTime;
        if (calmFrames >= SETTLE_FRAME_COUNT || elapsed > SETTLE_TIMEOUT_MS) {
          scene.onBeforeRenderObservable.remove(observer);
          resolve();
        }
      });
    });
  }

  function fadeAndDispose(die: ActiveDie): void {
    die.agg?.dispose();
    die.agg = null;
    const mesh = die.mesh;
    const startTime = performance.now();
    const durationMs = 500;
    const observer = scene.onBeforeRenderObservable.add(() => {
      if (mesh.isDisposed()) {
        scene.onBeforeRenderObservable.remove(observer);
        return;
      }
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
      a.agg?.dispose();
      a.agg = null;
      a.mesh.dispose();
    }
  }

  function dispose(): void {
    clear();
    disposeTrayPhysics();
    engine.stopRenderLoop();
    scene.dispose();
    engine.dispose();
  }

  function resize(): void {
    refit();
  }

  return { spawn, clear, dispose, resize };
}
