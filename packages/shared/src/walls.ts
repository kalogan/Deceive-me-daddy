// Interior-wall geometry — the SINGLE SOURCE OF TRUTH shared by the renderer (which extrudes these
// segments into visible walls) and the deterministic sim (which turns them into collision boxes so
// the walls actually block movement). Keeping it here means the thing you SEE and the thing you
// BUMP INTO are derived from the exact same data + the exact same authored content pack.
//
// PURE (no Three.js, no DOM) so it unit-tests in the node gate and is safe for the engine-agnostic
// core (arch-guard). All inputs are real content-pack shapes (Vec3 tuples + zone bounds).
import type { Vec3Tuple } from './schema/contentPack';

/** A horizontal, axis-aligned wall segment on the XZ plane (height/thickness applied by consumers). */
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

/** Wall thickness (m) used to turn a segment into a collision box — matches the render thickness. */
export const WALL_THICKNESS = 0.3;
/** The player's collision radius (m) — how far walls hold you off (roughly the avatar's girth). */
export const PLAYER_RADIUS = 0.4;

/** Map themes that are OUTDOOR (no interior walls / no wall collision). Keeps render + sim in step. */
export const OUTDOOR_THEMES: ReadonlySet<string> = new Set(['beach']);

/** Whether a pack theme should get interior walls + wall collision (indoor only). */
export function themeHasInteriorWalls(theme: string): boolean {
  return !OUTDOOR_THEMES.has(theme);
}

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
 * Derive interior wall segments for a set of zones, with door-width openings. PURE. Each zone
 * becomes a perimeter ring (its bounds pulled in by `inset` so two adjacent rooms' walls don't
 * coincide), and wherever a door lies on an edge a `doorWidth` gap is punched so the doorway is an
 * actual passage. Door→edge matching uses the zone's ORIGINAL bound (not the inset one) so an
 * authored door on the true zone edge still lines up after the inset.
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
