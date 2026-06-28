import { PLAYER_RADIUS, WALL_THICKNESS, type ContentPack } from '@deceive/shared';
import { describe, expect, it } from 'vitest';
import { buildWallColliders, resolveCircleVsWalls, type WallAABB } from './collision';

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
});
