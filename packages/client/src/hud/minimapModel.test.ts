// Unit tests for the PURE minimap projection math (no DOM / canvas touched here, so it runs in
// the Node gate). The single `pack(...)` factory builds a minimal ContentPack — a field added in
// parallel is a one-line fixup here.
import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@deceive/shared';
import {
  clampToMinimap,
  packWorldBounds,
  projectToMinimap,
} from './minimapModel';

/** A minimal valid-enough ContentPack for bounds tests; override only the fields a test reads. */
function pack(over: Partial<ContentPack> = {}): ContentPack {
  return {
    schemaVersion: 1,
    id: 'test',
    name: 'Test',
    theme: 'facility',
    zones: [
      {
        id: 'lobby',
        name: 'Lobby',
        requiredClearance: 'civilian',
        bounds: { min: [-10, 0, -10], max: [10, 4, 10] },
      },
    ],
    doors: [],
    npcs: [],
    keycards: [],
    socialSpots: [],
    intelNodes: [],
    objective: {
      vaultZoneId: 'lobby',
      packagePosition: [0, 0, 0],
      intelRequiredToOpenVault: 3,
      extractionPoints: [[0, 0, 0]],
    },
    spawnPoints: [{ position: [0, 0, 0] }],
    ...over,
  };
}

describe('packWorldBounds', () => {
  it('returns a sane centred square for a null pack', () => {
    const b = packWorldBounds(null);
    expect(b.minX).toBeLessThan(0);
    expect(b.maxX).toBeGreaterThan(0);
    expect(b.minZ).toBeLessThan(0);
    expect(b.maxZ).toBeGreaterThan(0);
  });

  it('spans the zone extent plus padding', () => {
    const b = packWorldBounds(pack());
    // zone is [-10,10] on both axes; padding expands it outward.
    expect(b.minX).toBeLessThan(-10);
    expect(b.maxX).toBeGreaterThan(10);
    expect(b.minZ).toBeLessThan(-10);
    expect(b.maxZ).toBeGreaterThan(10);
  });

  it('includes intel nodes + extraction points beyond the zones', () => {
    const b = packWorldBounds(
      pack({
        intelNodes: [{ id: 'i1', position: [50, 0, 0], zoneId: 'lobby', intelValue: 1 }],
        objective: {
          vaultZoneId: 'lobby',
          packagePosition: [0, 0, -40],
          intelRequiredToOpenVault: 3,
          extractionPoints: [[0, 0, 60]],
        },
      }),
    );
    expect(b.maxX).toBeGreaterThanOrEqual(50);
    expect(b.maxZ).toBeGreaterThanOrEqual(60);
    expect(b.minZ).toBeLessThanOrEqual(-40);
  });

  it('never returns a degenerate (zero-span) box even for a single-point pack', () => {
    const b = packWorldBounds(
      pack({
        zones: [
          {
            id: 'p',
            name: 'P',
            requiredClearance: 'civilian',
            bounds: { min: [5, 0, 5], max: [5, 0, 5] },
          },
        ],
        intelNodes: [],
        objective: {
          vaultZoneId: 'p',
          packagePosition: [5, 0, 5],
          intelRequiredToOpenVault: 1,
          extractionPoints: [[5, 0, 5]],
        },
        spawnPoints: [{ position: [5, 0, 5] }],
      }),
    );
    expect(b.maxX).toBeGreaterThan(b.minX);
    expect(b.maxZ).toBeGreaterThan(b.minZ);
  });
});

describe('projectToMinimap', () => {
  const bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

  it('maps the box centre to the minimap centre', () => {
    const p = projectToMinimap(0, 0, bounds, 100);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(50);
  });

  it('maps min corner to (0,0) and max corner to (size,size) for a square box', () => {
    expect(projectToMinimap(-10, -10, bounds, 100)).toEqual({ x: 0, y: 0 });
    expect(projectToMinimap(10, 10, bounds, 100)).toEqual({ x: 100, y: 100 });
  });

  it('maps +Z downward (top-down north-up)', () => {
    const near = projectToMinimap(0, -10, bounds, 100);
    const far = projectToMinimap(0, 10, bounds, 100);
    expect(far.y).toBeGreaterThan(near.y);
  });

  it('preserves aspect by letterboxing the shorter axis', () => {
    // Wide box: X span 40, Z span 20. The larger (X) maps to full size; Z is centred.
    const wide = { minX: -20, maxX: 20, minZ: -10, maxZ: 10 };
    const centre = projectToMinimap(0, 0, wide, 100);
    expect(centre.x).toBeCloseTo(50);
    expect(centre.y).toBeCloseTo(50);
    // X edges hit 0 and 100; Z edges are inset (letterboxed), not at 0/100.
    expect(projectToMinimap(-20, 0, wide, 100).x).toBeCloseTo(0);
    expect(projectToMinimap(0, -10, wide, 100).y).toBeGreaterThan(0);
    expect(projectToMinimap(0, 10, wide, 100).y).toBeLessThan(100);
  });
});

describe('clampToMinimap', () => {
  it('pins out-of-range points to the square edges', () => {
    expect(clampToMinimap({ x: -5, y: 130 }, 100)).toEqual({ x: 0, y: 100 });
    expect(clampToMinimap({ x: 40, y: 60 }, 100)).toEqual({ x: 40, y: 60 });
  });
});
