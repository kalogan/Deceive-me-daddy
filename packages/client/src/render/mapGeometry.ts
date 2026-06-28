// Pure geometry helpers for the map renderer (MapView). Kept Three.js-free so the
// math is unit-testable in a node env without WebGL/DOM (PROJECT_BRIEF §4.6).
//
// All inputs are the REAL shared content-pack shapes (Vec3 tuples, zone bounds) so the
// preview renders the same authored data the server resolves — never a forked shape.
import type { Vec3Tuple } from '@deceive/shared';

/** Axis-aligned box derived from a zone's min/max bounds. */
export interface BoxDims {
  /** World-space centre of the box. */
  center: Vec3Tuple;
  /** Full extent (width/height/depth) along each axis — always non-negative. */
  size: Vec3Tuple;
}

/**
 * Centre + size of the box spanning `min`..`max`. Tolerant of inverted or degenerate
 * bounds (uses abs extent) so a malformed-but-schema-valid pack still renders something
 * visible rather than an inside-out or zero box.
 */
export function boundsToBox(min: Vec3Tuple, max: Vec3Tuple): BoxDims {
  const center: Vec3Tuple = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const size: Vec3Tuple = [
    Math.abs(max[0] - min[0]),
    Math.abs(max[1] - min[1]),
    Math.abs(max[2] - min[2]),
  ];
  return { center, size };
}

// Interior-wall geometry now lives in @deceive/shared (single source of truth for the renderer +
// the sim's collision). Re-exported here so existing imports (MapView, the test) keep working.
export {
  zonesToWalls,
  subtractGaps,
  DEFAULT_WALL_OPTS,
  type WallSeg,
  type WallZone,
  type WallOpts,
} from '@deceive/shared';

/**
 * A sensible spawn anchor for an NPC: its first routine waypoint if it has one, else the
 * centre of its home zone, else the origin. Keeps NPC placement data-driven so a marker
 * lands somewhere meaningful instead of stacking at (0,0,0).
 */
export function npcAnchor(
  firstWaypoint: Vec3Tuple | undefined,
  homeZoneCenter: Vec3Tuple | undefined,
): Vec3Tuple {
  if (firstWaypoint) return firstWaypoint;
  if (homeZoneCenter) return homeZoneCenter;
  return [0, 0, 0];
}
