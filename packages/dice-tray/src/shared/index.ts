/**
 * The dice-tray plugin contributes only client-side rendering — no
 * traits, events, or commands of its own. It subscribes to
 * `@vtt/resolution/RollResolved` on the client bus and renders a
 * Babylon.js 3D tray when one arrives.
 *
 * This file is the public shared entry; nothing to export today, but
 * kept so the package layout matches every other plugin (the scaffold
 * pattern from `design/scaffold-mapping.md`).
 */
export {};
