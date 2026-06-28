// Wall collision — turns the SHARED interior-wall segments (the same ones the renderer draws) into
// axis-aligned collision boxes and resolves the player/bots against them, so walls block MOVEMENT,
// not just vision. Deterministic + pure (no wall-clock/RNG): the collider set is derived from the
// content pack on load and resolution is plain AABB math, so the server, the offline sim, and the
// client's local prediction all agree (no rubber-banding through walls).
import {
  PLAYER_RADIUS,
  WALL_THICKNESS,
  themeHasInteriorWalls,
  zonesToWalls,
  type ContentPack,
} from '@deceive/shared';

/** An axis-aligned wall footprint on the XZ plane (the box the player slides against). */
export interface WallAABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Build the wall colliders for a pack: the SAME segments the renderer extrudes, each thickened to
 * WALL_THICKNESS into a footprint box. Empty for outdoor themes (no interior walls there), so the
 * beach stays open and never traps you behind an invisible wall.
 */
export function buildWallColliders(pack: ContentPack): WallAABB[] {
  if (!themeHasInteriorWalls(pack.theme)) return [];
  const zones = pack.zones ?? [];
  const doors = pack.doors ?? [];
  if (zones.length === 0) return [];
  const half = WALL_THICKNESS / 2;
  return zonesToWalls(zones, doors).map((s) => {
    const horizontal = s.z1 === s.z2;
    return horizontal
      ? { minX: Math.min(s.x1, s.x2), maxX: Math.max(s.x1, s.x2), minZ: s.z1 - half, maxZ: s.z1 + half }
      : { minX: s.x1 - half, maxX: s.x1 + half, minZ: Math.min(s.z1, s.z2), maxZ: Math.max(s.z1, s.z2) };
  });
}

/**
 * Resolve a circle of radius `r` at (x,z) out of the wall set, returning the corrected position.
 * PURE. Discrete push-out along the axis of LEAST penetration (so you slide along a wall instead of
 * sticking), with a couple of passes so a corner between two walls settles. A point outside every
 * inflated box is returned unchanged.
 */
export function resolveCircleVsWalls(
  x: number,
  z: number,
  r: number,
  walls: readonly WallAABB[],
): { x: number; z: number } {
  let px = x;
  let pz = z;
  // Two passes: resolving against one wall can nudge the point into a neighbour at a corner.
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    for (const w of walls) {
      const minX = w.minX - r;
      const maxX = w.maxX + r;
      const minZ = w.minZ - r;
      const maxZ = w.maxZ + r;
      if (px <= minX || px >= maxX || pz <= minZ || pz >= maxZ) continue; // outside this inflated box

      // Penetration depth to exit via each of the four edges; push out the cheapest one.
      const left = px - minX;
      const right = maxX - px;
      const top = pz - minZ;
      const bottom = maxZ - pz;
      const m = Math.min(left, right, top, bottom);
      if (m === left) px = minX;
      else if (m === right) px = maxX;
      else if (m === top) pz = minZ;
      else pz = maxZ;
      moved = true;
    }
    if (!moved) break;
  }
  return { x: px, z: pz };
}

/** The player collision radius re-exported for callers (sim step) that don't import shared directly. */
export { PLAYER_RADIUS };
