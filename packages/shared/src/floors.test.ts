import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLOOR_HEIGHT,
  connectorGroundY,
  floorBaseY,
  floorOfY,
  pointInFootprint,
} from './floors';
import type { Connector } from './schema/contentPack';

describe('floorBaseY / floorOfY', () => {
  it('places floors at floor * height', () => {
    expect(floorBaseY(0)).toBe(0);
    expect(floorBaseY(1)).toBe(DEFAULT_FLOOR_HEIGHT);
    expect(floorBaseY(2, 5)).toBe(10);
  });

  it('maps a Y back to the nearest floor (never below 0)', () => {
    expect(floorOfY(0)).toBe(0);
    expect(floorOfY(DEFAULT_FLOOR_HEIGHT - 0.1)).toBe(1); // rounds up near the slab
    expect(floorOfY(DEFAULT_FLOOR_HEIGHT)).toBe(1);
    expect(floorOfY(-3)).toBe(0);
  });
});

describe('pointInFootprint', () => {
  const fp = { min: [0, 0] as [number, number], max: [10, 4] as [number, number] };
  it('is inclusive inside, false outside', () => {
    expect(pointInFootprint(5, 2, fp)).toBe(true);
    expect(pointInFootprint(0, 0, fp)).toBe(true);
    expect(pointInFootprint(11, 2, fp)).toBe(false);
    expect(pointInFootprint(5, 5, fp)).toBe(false);
  });
});

describe('connectorGroundY', () => {
  // A ramp from floor 0 to floor 1, ascending along +x across x:0..10.
  const ramp: Connector = {
    id: 'r1',
    kind: 'ramp',
    fromFloor: 0,
    toFloor: 1,
    footprint: { min: [0, 0], max: [10, 4] },
    axis: 'x',
    ascendToward: 'max',
  };

  it('returns null when the point is off the connector', () => {
    expect(connectorGroundY(ramp, 20, 2)).toBeNull();
  });

  it('interpolates linearly from the low end to the high end', () => {
    expect(connectorGroundY(ramp, 0, 2)).toBeCloseTo(0); // low end → floor 0
    expect(connectorGroundY(ramp, 10, 2)).toBeCloseTo(DEFAULT_FLOOR_HEIGHT); // high end → floor 1
    expect(connectorGroundY(ramp, 5, 2)).toBeCloseTo(DEFAULT_FLOOR_HEIGHT / 2); // midpoint
  });

  it('respects ascendToward: min (slope reversed)', () => {
    const rev: Connector = { ...ramp, ascendToward: 'min' };
    expect(connectorGroundY(rev, 0, 2)).toBeCloseTo(DEFAULT_FLOOR_HEIGHT); // low x is now the HIGH end
    expect(connectorGroundY(rev, 10, 2)).toBeCloseTo(0);
  });

  it('a vent reads the same geometry (kind only changes feel)', () => {
    const vent: Connector = { ...ramp, kind: 'vent' };
    expect(connectorGroundY(vent, 5, 2)).toBeCloseTo(DEFAULT_FLOOR_HEIGHT / 2);
  });
});
