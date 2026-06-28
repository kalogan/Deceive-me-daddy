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

/** A horizontal, axis-aligned wall segment on the XZ plane (height is applied at render time). */
export interface WallSeg {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** Minimal zone shape the wall builder needs (a subset of the shared Zone). */
export interface WallZone {
  bounds: { min: Vec3Tuple; max: Vec3Tuple };
}

/** Tunables for zonesToWalls — all in metres. */
export interface WallOpts {
  /** Pull each zone's wall ring inward by this much so adjacent zones' walls never z-fight. */
  inset: number;
  /** Width of the opening punched where a door sits on a wall edge. */
  doorWidth: number;
  /** How close a door must be to an edge (perpendicular distance) to count as "on" it. */
  edgeTolerance: number;
  /** Drop sub-segments shorter than this (a door at a corner can leave a sliver). */
  minSegment: number;
}

export const DEFAULT_WALL_OPTS: WallOpts = {
  inset: 0.2,
  doorWidth: 2.6,
  edgeTolerance: 1.5,
  minSegment: 0.5,
};

/**
 * Subtract a set of [lo,hi] gaps from a single [a,b] interval, returning the remaining
 * sub-intervals (left→right). PURE. Gaps may overlap / sit outside [a,b]; they're clamped and
 * merged. Used to punch door openings out of a wall edge.
 */
export function subtractGaps(a: number, b: number, gaps: [number, number][]): [number, number][] {
  if (b <= a) return [];
  // Clamp + keep only gaps that actually intersect [a,b], then sort by start.
  const clamped = gaps
    .map(([lo, hi]) => [Math.max(a, Math.min(lo, hi)), Math.min(b, Math.max(lo, hi))] as [number, number])
    .filter(([lo, hi]) => hi > lo)
    .sort((g1, g2) => g1[0] - g2[0]);

  const out: [number, number][] = [];
  let cursor = a;
  for (const [lo, hi] of clamped) {
    if (lo > cursor) out.push([cursor, lo]);
    cursor = Math.max(cursor, hi);
  }
  if (cursor < b) out.push([cursor, b]);
  return out;
}

/**
 * Derive interior wall segments for a set of zones, with door-width openings. PURE (no Three) so
 * it's unit-testable. Each zone becomes a perimeter ring (its bounds pulled in by `inset` so two
 * adjacent rooms' walls don't coincide), and wherever a door lies on an edge a `doorWidth` gap is
 * punched so the doorway is an actual passage. Returns axis-aligned XZ segments; the renderer
 * extrudes them to wall height and merges them.
 *
 * Door→edge matching uses the zone's ORIGINAL bound (not the inset one) so an authored door on the
 * true zone edge still lines up after the inset.
 */
export function zonesToWalls(
  zones: readonly WallZone[],
  doors: readonly { position: Vec3Tuple }[],
  opts: WallOpts = DEFAULT_WALL_OPTS,
): WallSeg[] {
  const { inset, doorWidth, edgeTolerance, minSegment } = opts;
  const out: WallSeg[] = [];
  const hw = doorWidth / 2;

  for (const zone of zones) {
    const [oMinX, , oMinZ] = zone.bounds.min;
    const [oMaxX, , oMaxZ] = zone.bounds.max;
    // Inset ring (skip degenerate zones too small to hold a ring).
    const minX = Math.min(oMinX, oMaxX) + inset;
    const maxX = Math.max(oMinX, oMaxX) - inset;
    const minZ = Math.min(oMinZ, oMaxZ) + inset;
    const maxZ = Math.max(oMinZ, oMaxZ) - inset;
    if (maxX - minX < minSegment || maxZ - minZ < minSegment) continue;

    // Gaps along the X axis for a horizontal edge at original z = `oz`.
    const xGapsForZ = (oz: number): [number, number][] =>
      doors
        .filter((d) => Math.abs(d.position[2] - oz) <= edgeTolerance && d.position[0] >= minX - edgeTolerance && d.position[0] <= maxX + edgeTolerance)
        .map((d) => [d.position[0] - hw, d.position[0] + hw] as [number, number]);
    // Gaps along the Z axis for a vertical edge at original x = `ox`.
    const zGapsForX = (ox: number): [number, number][] =>
      doors
        .filter((d) => Math.abs(d.position[0] - ox) <= edgeTolerance && d.position[2] >= minZ - edgeTolerance && d.position[2] <= maxZ + edgeTolerance)
        .map((d) => [d.position[2] - hw, d.position[2] + hw] as [number, number]);

    // South + North edges (constant z), split across X by their door gaps.
    for (const [x1, x2] of subtractGaps(minX, maxX, xGapsForZ(oMinZ))) out.push({ x1, z1: minZ, x2, z2: minZ });
    for (const [x1, x2] of subtractGaps(minX, maxX, xGapsForZ(oMaxZ))) out.push({ x1, z1: maxZ, x2, z2: maxZ });
    // West + East edges (constant x), split across Z by their door gaps.
    for (const [z1, z2] of subtractGaps(minZ, maxZ, zGapsForX(oMinX))) out.push({ x1: minX, z1, x2: minX, z2 });
    for (const [z1, z2] of subtractGaps(minZ, maxZ, zGapsForX(oMaxX))) out.push({ x1: maxX, z1, x2: maxX, z2 });
  }
  return out;
}

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
