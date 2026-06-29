import { PLAYER_RADIUS, WALL_THICKNESS, type ContentPack } from '@deceive/shared';
import { describe, expect, it } from 'vitest';
import {
  buildWallColliders,
  resolveCircleVsWalls,
  segmentHitsWalls,
  segmentIntersectsAABB,
  type WallAABB,
} from './collision';

// A single wall box spanning x:-5..5 at z=0 (thickness applied), to push circles around.
const WALL: WallAABB = { minX: -5, maxX: 5, minZ: -WALL_THICKNESS / 2, maxZ: WALL_THICKNESS / 2 };

describe('resolveCircleVsWalls', () => {
  it('leaves a point well clear of every wall unchanged', () => {
    const r = resolveCircleVsWalls(0, 10, PLAYER_RADIUS, [WALL]);
    expect(r).toEqual({ x: 0, z: 10 });
  });

  it('pushes a circle out to the +Z face when it overlaps from above', () => {
    // Approaching from +Z, stopping just short: z must end at maxZ + radius.
    const r = resolveCircleVsWalls(0, 0.1, PLAYER_RADIUS, [WALL]);
    expect(r.z).toBeCloseTo(WALL.maxZ + PLAYER_RADIUS);
    expect(r.x).toBe(0); // slid along X only on the Z axis push... X untouched here
  });

  it('pushes out to the -Z face when overlapping from below', () => {
    const r = resolveCircleVsWalls(0, -0.1, PLAYER_RADIUS, [WALL]);
    expect(r.z).toBeCloseTo(WALL.minZ - PLAYER_RADIUS);
  });

  it('slides along the wall (only the shallow axis is corrected)', () => {
    // Inside the box but much deeper on Z than X near the +X end → pushes out the +X side,
    // keeping Z (you slide along the wall toward the gap).
    const nearEnd = WALL.maxX - 0.05;
    const r = resolveCircleVsWalls(nearEnd, 0, PLAYER_RADIUS, [WALL]);
    expect(r.x).toBeCloseTo(WALL.maxX + PLAYER_RADIUS);
    expect(r.z).toBe(0);
  });

  it('returns the point unchanged when there are no walls', () => {
    expect(resolveCircleVsWalls(1, 2, PLAYER_RADIUS, [])).toEqual({ x: 1, z: 2 });
  });
});

function pack(theme: string): ContentPack {
  return {
    theme,
    zones: [{ bounds: { min: [0, 0, 0], max: [10, 8, 10] } }],
    doors: [],
  } as unknown as ContentPack;
}

describe('buildWallColliders', () => {
  it('builds colliders for an indoor theme (a ringed zone → four walls)', () => {
    const walls = buildWallColliders(pack('research_facility'));
    expect(walls).toHaveLength(4);
    // Each collider has positive extent on at least one axis.
    for (const w of walls) {
      expect(w.maxX - w.minX).toBeGreaterThanOrEqual(0);
      expect(w.maxZ - w.minZ).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns no colliders for an outdoor (beach) theme', () => {
    expect(buildWallColliders(pack('beach'))).toEqual([]);
  });

  it('stamps each collider with its zone floor (and bespoke walls default to 0)', () => {
    const p = pack('research_facility');
    (p as unknown as { zones: { bounds: unknown; floor?: number }[] }).zones = [
      { bounds: { min: [0, 0, 0], max: [10, 8, 10] }, floor: 0 },
      { bounds: { min: [0, 4, 20], max: [10, 12, 30] }, floor: 1 },
    ];
    (p as unknown as { walls: { x1: number; z1: number; x2: number; z2: number; floor?: number }[] }).walls = [
      { x1: 2, z1: 25, x2: 8, z2: 25, floor: 1 },
    ];
    const walls = buildWallColliders(p);
    expect(walls.some((w) => w.floor === 0)).toBe(true);
    expect(walls.some((w) => w.floor === 1)).toBe(true);
    expect(walls.at(-1)?.floor).toBe(1); // the bespoke wall kept its authored floor
  });

  it('appends bespoke pack.walls on top of the auto-derived zone walls', () => {
    const base = buildWallColliders(pack('research_facility'));
    const p = pack('research_facility');
    (p as unknown as { walls: { x1: number; z1: number; x2: number; z2: number }[] }).walls = [
      { x1: 2, z1: 5, x2: 8, z2: 5 }, // a horizontal divider mid-room
    ];
    const withBespoke = buildWallColliders(p);
    expect(withBespoke).toHaveLength(base.length + 1);
    const extra = withBespoke.at(-1);
    expect(extra?.minX).toBeCloseTo(2);
    expect(extra?.maxX).toBeCloseTo(8);
  });
});

describe('segmentIntersectsAABB', () => {
  const box: WallAABB = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };

  it('detects a segment passing straight through the box', () => {
    expect(segmentIntersectsAABB(-5, 0, 5, 0, box)).toBe(true);
  });

  it('returns false for a segment that misses entirely', () => {
    expect(segmentIntersectsAABB(-5, 5, 5, 5, box)).toBe(false);
  });

  it('returns false for a segment that stops short of the box', () => {
    expect(segmentIntersectsAABB(-5, 0, -2, 0, box)).toBe(false);
  });

  it('padding catches a near-miss that would graze the player radius', () => {
    expect(segmentIntersectsAABB(-5, 1.3, 5, 1.3, box)).toBe(false);
    expect(segmentIntersectsAABB(-5, 1.3, 5, 1.3, box, 0.5)).toBe(true);
  });
});

describe('segmentHitsWalls', () => {
  it('is true when a wall stands between the points, false in the clear', () => {
    const wall: WallAABB = { minX: -3, maxX: 3, minZ: -0.15, maxZ: 0.15 };
    expect(segmentHitsWalls(0, -5, 0, 5, [wall])).toBe(true); // crosses the wall
    expect(segmentHitsWalls(-5, -5, -5, 5, [wall])).toBe(false); // off to the side
  });
});
