import { describe, expect, it } from 'vitest';
import { boundsToBox, npcAnchor } from './mapGeometry';

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
