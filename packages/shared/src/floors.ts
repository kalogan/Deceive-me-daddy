// Floor / verticality geometry — the SINGLE SOURCE OF TRUTH for "how high is the floor here?",
// shared by the deterministic sim (player/bot movement + floor membership) and the renderer (slab
// heights + stair geometry). PURE (no Three.js, no DOM): plain math on content-pack shapes, so the
// server, the offline sim, and the client all agree on where the ground is.
import type { Connector, Footprint } from './schema/contentPack';

/** Default metres between floor slabs when a pack doesn't specify `floorHeight`. */
export const DEFAULT_FLOOR_HEIGHT = 4;

/** Base (walkable) height of floor `n`. Floor 0 = ground (y 0). */
export function floorBaseY(floor: number, floorHeight: number = DEFAULT_FLOOR_HEIGHT): number {
  return floor * floorHeight;
}

/** Which floor a given world Y belongs to (nearest slab, never below 0). */
export function floorOfY(y: number, floorHeight: number = DEFAULT_FLOOR_HEIGHT): number {
  if (floorHeight <= 0) return 0;
  return Math.max(0, Math.round(y / floorHeight));
}

/** Is the XZ point inside this footprint rectangle (inclusive)? PURE. */
export function pointInFootprint(x: number, z: number, fp: Footprint): boolean {
  const [minX, minZ] = fp.min;
  const [maxX, maxZ] = fp.max;
  return x >= Math.min(minX, maxX) && x <= Math.max(minX, maxX) && z >= Math.min(minZ, maxZ) && z <= Math.max(minZ, maxZ);
}

/**
 * The walkable height ON a connector at (x,z), or null if the point is outside its footprint. PURE.
 * Interpolates linearly along the connector's `axis` between the lower and upper floor's base height;
 * `ascendToward` says which end of that axis is the HIGH end. Used both to ride a player/bot up a
 * ramp and to render the slope — so what you walk on and what you see are the same line.
 */
export function connectorGroundY(
  c: Connector,
  x: number,
  z: number,
  floorHeight: number = DEFAULT_FLOOR_HEIGHT,
): number | null {
  if (!pointInFootprint(x, z, c.footprint)) return null;
  const [minX, minZ] = c.footprint.min;
  const [maxX, maxZ] = c.footprint.max;
  const lo = c.axis === 'x' ? Math.min(minX, maxX) : Math.min(minZ, maxZ);
  const hi = c.axis === 'x' ? Math.max(maxX, minX) : Math.max(maxZ, minZ);
  const coord = c.axis === 'x' ? x : z;
  const span = hi - lo;
  // Progress 0..1 from the LOW-floor end to the HIGH-floor end of the slope.
  let p = span > 1e-6 ? (coord - lo) / span : 0;
  if (c.ascendToward === 'min') p = 1 - p;
  p = Math.max(0, Math.min(1, p));
  const yLow = floorBaseY(Math.min(c.fromFloor, c.toFloor), floorHeight);
  const yHigh = floorBaseY(Math.max(c.fromFloor, c.toFloor), floorHeight);
  return yLow + p * (yHigh - yLow);
}
