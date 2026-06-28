import { describe, expect, it } from 'vitest';
import { boundsToBox, npcAnchor, subtractGaps, zonesToWalls } from './mapGeometry';

describe('boundsToBox', () => {
  it('computes centre + size for a simple box', () => {
    const { center, size } = boundsToBox([-30, 0, -30], [30, 8, 0]);
    expect(center).toEqual([0, 4, -15]);
    expect(size).toEqual([60, 8, 30]);
  });

  it('returns non-negative size for inverted bounds', () => {
    const { center, size } = boundsToBox([10, 10, 10], [0, 0, 0]);
    expect(size).toEqual([10, 10, 10]);
    expect(center).toEqual([5, 5, 5]);
  });

  it('yields a zero-size box for degenerate bounds', () => {
    const { size } = boundsToBox([5, 5, 5], [5, 5, 5]);
    expect(size).toEqual([0, 0, 0]);
  });
});

describe('npcAnchor', () => {
  it('prefers the first routine waypoint', () => {
    expect(npcAnchor([1, 2, 3], [9, 9, 9])).toEqual([1, 2, 3]);
  });

  it('falls back to the home-zone centre when there is no waypoint', () => {
    expect(npcAnchor(undefined, [9, 9, 9])).toEqual([9, 9, 9]);
  });

  it('falls back to the origin when nothing is known', () => {
    expect(npcAnchor(undefined, undefined)).toEqual([0, 0, 0]);
  });
});

describe('subtractGaps', () => {
  it('returns the whole interval when there are no gaps', () => {
    expect(subtractGaps(0, 10, [])).toEqual([[0, 10]]);
  });

  it('punches a single mid gap into two sub-segments', () => {
    expect(subtractGaps(0, 10, [[4, 6]])).toEqual([[0, 4], [6, 10]]);
  });

  it('clamps a gap that runs off the start', () => {
    expect(subtractGaps(0, 10, [[-5, 3]])).toEqual([[3, 10]]);
  });

  it('returns nothing when a gap covers the whole interval', () => {
    expect(subtractGaps(0, 10, [[-1, 11]])).toEqual([]);
  });

  it('merges overlapping gaps', () => {
    expect(subtractGaps(0, 10, [[2, 5], [4, 7]])).toEqual([[0, 2], [7, 10]]);
  });

  it('returns [] for a degenerate interval', () => {
    expect(subtractGaps(5, 5, [])).toEqual([]);
  });
});

describe('zonesToWalls', () => {
  const opts = { inset: 0.2, doorWidth: 2, edgeTolerance: 1, minSegment: 0.5 };

  it('rings a single zone with four wall segments (no doors)', () => {
    const walls = zonesToWalls([{ bounds: { min: [0, 0, 0], max: [10, 8, 10] } }], [], opts);
    expect(walls).toHaveLength(4);
    // Every segment is axis-aligned (either constant x or constant z).
    for (const w of walls) {
      expect(w.x1 === w.x2 || w.z1 === w.z2).toBe(true);
    }
  });

  it('insets the ring inward from the zone bounds', () => {
    const [first] = zonesToWalls([{ bounds: { min: [0, 0, 0], max: [10, 8, 10] } }], [], opts);
    // The south edge sits at z = minZ + inset = 0.2, spanning x 0.2..9.8.
    const minX = Math.min(...walls4(opts).map((w) => Math.min(w.x1, w.x2)));
    expect(minX).toBeCloseTo(0.2);
    expect(first).toBeDefined();
  });

  it('punches a door opening, splitting that edge into two', () => {
    // A door on the south edge (z≈0) at x=5 should split the south wall into two pieces.
    const walls = zonesToWalls(
      [{ bounds: { min: [0, 0, 0], max: [10, 8, 10] } }],
      [{ position: [5, 0, 0] }],
      opts,
    );
    const southPieces = walls.filter((w) => w.z1 === 0.2 && w.z2 === 0.2);
    expect(southPieces).toHaveLength(2); // wall on each side of the doorway
    // The opening (x 4..6) is absent from both pieces.
    const left = southPieces.find((w) => Math.min(w.x1, w.x2) < 4)!;
    const right = southPieces.find((w) => Math.max(w.x1, w.x2) > 6)!;
    expect(Math.max(left.x1, left.x2)).toBeCloseTo(4);
    expect(Math.min(right.x1, right.x2)).toBeCloseTo(6);
  });

  it('skips a zone too small to hold an inset ring', () => {
    expect(zonesToWalls([{ bounds: { min: [0, 0, 0], max: [0.3, 8, 0.3] } }], [], opts)).toEqual([]);
  });
});

function walls4(opts: { inset: number; doorWidth: number; edgeTolerance: number; minSegment: number }) {
  return zonesToWalls([{ bounds: { min: [0, 0, 0], max: [10, 8, 10] } }], [], opts);
}
