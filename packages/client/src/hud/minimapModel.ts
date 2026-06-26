// PURE, DOM-free model for the corner MINIMAP / radar overlay.
//
// The minimap is a top-down 2D view of the match. This module owns only the MATH: it
// computes the world bounds the map should span (from the static content pack) and projects
// a world (x, z) position into minimap pixel coordinates. The side-effectful canvas draw
// lives in Minimap.ts (the DOM component, not imported by any test).
//
// Authority (PROJECT_BRIEF §3/§4.2): this only READS the authored pack + the latest snapshot
// to decide WHERE to paint dots. It owns no gameplay truth. Kept Three.js / DOM free so the
// projection is unit-testable under the Node gate (mirrors hud/hudModel.ts).
import type { ContentPack, Vec3Tuple } from '@deceive/shared';

/** A rectangular world extent on the XZ plane (metres). The minimap spans exactly this. */
export interface WorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A point in minimap pixel space (origin top-left, +x right, +y down). */
export interface MiniPoint {
  x: number;
  y: number;
}

/** Padding (metres) added around the pack's marker extent so dots near the edge aren't clipped. */
const BOUNDS_PADDING = 6;
/** Fallback half-extent (metres) when a pack has no usable markers — a sane square around origin. */
const FALLBACK_HALF = 40;

/**
 * Compute the world bounds the minimap should span from a content pack, by taking the
 * axis-aligned extent of every static marker we care about (zone bounds, the package start,
 * the extraction points, the intel nodes, the spawn points) and padding it. PURE.
 *
 * A null pack — or one with no usable coordinates — yields a sane square centred on the
 * origin (so the minimap still renders the local player against a neutral grid). The returned
 * box is always non-degenerate (min strictly < max on both axes) so the projection below can
 * divide by its span without a zero-divide.
 */
export function packWorldBounds(pack: ContentPack | null): WorldBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const include = (x: number, z: number): void => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };
  const includeVec = (v: Vec3Tuple): void => include(v[0], v[2]);

  if (pack) {
    for (const z of pack.zones) {
      include(z.bounds.min[0], z.bounds.min[2]);
      include(z.bounds.max[0], z.bounds.max[2]);
    }
    for (const node of pack.intelNodes) includeVec(node.position);
    for (const ep of pack.objective.extractionPoints) includeVec(ep);
    for (const sp of pack.spawnPoints) includeVec(sp.position);
    includeVec(pack.objective.packagePosition);
  }

  // No usable markers → a neutral square around the origin.
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || minX > maxX) {
    return { minX: -FALLBACK_HALF, maxX: FALLBACK_HALF, minZ: -FALLBACK_HALF, maxZ: FALLBACK_HALF };
  }

  minX -= BOUNDS_PADDING;
  maxX += BOUNDS_PADDING;
  minZ -= BOUNDS_PADDING;
  maxZ += BOUNDS_PADDING;

  // Guarantee a non-degenerate box on BOTH axes (a single-point pack would collapse one span).
  if (maxX - minX < 1) {
    minX -= FALLBACK_HALF;
    maxX += FALLBACK_HALF;
  }
  if (maxZ - minZ < 1) {
    minZ -= FALLBACK_HALF;
    maxZ += FALLBACK_HALF;
  }

  return { minX, maxX, minZ, maxZ };
}

/**
 * Project a world (x, z) position into minimap pixel coordinates for a square minimap of side
 * `size` (pixels). PURE.
 *
 * The world box is fit into the square preserving ASPECT (the larger world span maps to the
 * full `size`; the shorter axis is centred with letterboxing) so the map never stretches. The
 * world +Z axis maps DOWNWARD in screen space (top-down north-up), matching the third-person
 * convention where forward is +Z. The result is NOT clamped — callers that draw off-map markers
 * (e.g. far extraction points) can clamp to the edge themselves.
 */
export function projectToMinimap(
  worldX: number,
  worldZ: number,
  bounds: WorldBounds,
  size: number,
): MiniPoint {
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  // Uniform scale (px per metre) from the LARGER span, so the map fits without stretching.
  const span = Math.max(spanX, spanZ);
  const scale = span > 0 ? size / span : 1;

  // Centre the shorter axis: half the leftover pixels become a margin.
  const offX = (size - spanX * scale) / 2;
  const offZ = (size - spanZ * scale) / 2;

  return {
    x: offX + (worldX - bounds.minX) * scale,
    y: offZ + (worldZ - bounds.minZ) * scale,
  };
}

/** Clamp a minimap point to stay within the `[0, size]` square (for edge-pinned markers). */
export function clampToMinimap(p: MiniPoint, size: number): MiniPoint {
  return {
    x: Math.max(0, Math.min(size, p.x)),
    y: Math.max(0, Math.min(size, p.y)),
  };
}
