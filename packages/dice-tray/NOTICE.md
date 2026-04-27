# Third-party attributions

## @3d-dice/dice-box

The `@vtt/dice-tray` plugin is **inspired by and incorporates assets from**
[`@3d-dice/dice-box`](https://github.com/3d-dice/dice-box) by Frank Ali
(MIT licensed). dice-box pioneered the approach of running a 3D dice
simulation in the browser as a transparent overlay; this plugin
follows the same shape (a tray surface, predetermined visual results
driven by an external authoritative roll) and ports a subset of
dice-box's mesh + texture assets.

### Vendored assets

The following files in `assets/dice-box/` are copied verbatim from
dice-box's `public/assets/dice-box/themes/default/`:

- `default.json` — Babylon-format mesh data for d4/d6/d8/d10/d12/d20/d100
  including per-die-type collider meshes and the `colliderFaceMap`
  (face-id → die-value lookup) that lets us land dice showing the
  authoritative face.
- `diffuse-light.png` — diffuse texture atlas with face numerals.
- `normal.png` — normal map for surface detail.
- `specular.jpg` — specular highlight map.
- `LICENSE` — dice-box's MIT license, retained alongside its assets.

### Code inspiration (not copy)

The face-rotation precomputation in `src/client/scene.ts` is derived
from the algorithmic approach in dice-box's
`src/components/Dice.js#getRollResult` — read the collider mesh's
triangles, look up each face-id's value via `colliderFaceMap`, then
compute mesh-local face normals. dice-box uses these normals to
*detect* the face value after physics settles; we use them in
reverse — given a target value, compute the rotation that aligns
that face with world-up. The implementation was authored from
scratch following the same data flow.

### License

dice-box is MIT licensed (see `assets/dice-box/LICENSE`). All
re-distribution conditions (preserving the copyright notice and
license text alongside the vendored assets) are satisfied.
