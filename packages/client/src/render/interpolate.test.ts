import { describe, expect, it } from 'vitest';
import { angleDelta, lerp, lerpAngle, lerpVec3, smoothingFactor } from './interpolate';

describe('lerp', () => {
  it('interpolates linearly between a and b', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(2, 4, 0)).toBe(2);
    expect(lerp(2, 4, 1)).toBe(4);
  });

  it('clamps t to [0,1]', () => {
    expect(lerp(0, 10, -1)).toBe(0);
    expect(lerp(0, 10, 2)).toBe(10);
  });
});

describe('lerpVec3', () => {
  it('lerps each component and returns out', () => {
    const out = { x: 0, y: 0, z: 0 };
    const r = lerpVec3(out, { x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: 6 }, 0.5);
    expect(r).toBe(out);
    expect(out).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe('angleDelta', () => {
  it('returns the shortest signed difference', () => {
    expect(angleDelta(0, 1)).toBeCloseTo(1, 10);
    expect(angleDelta(1, 0)).toBeCloseTo(-1, 10);
  });

  it('wraps the result into (-pi, pi]', () => {
    // Crossing the seam: from just below pi to just above -pi is a small +step.
    const d = angleDelta(Math.PI - 0.1, -Math.PI + 0.1);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeCloseTo(0.2, 10);

    for (const a of [-7, -3, 0, 2, 5, 9]) {
      for (const b of [-6, -1, 0.5, 4, 8]) {
        const r = angleDelta(a, b);
        expect(r).toBeGreaterThan(-Math.PI - 1e-9);
        expect(r).toBeLessThanOrEqual(Math.PI + 1e-9);
      }
    }
  });
});

describe('lerpAngle', () => {
  it('takes the shortest arc across the wrap seam', () => {
    // From near +pi to near -pi the short way crosses pi (stays large-magnitude),
    // not back through 0.
    const a = Math.PI - 0.1;
    const b = -Math.PI + 0.1;
    const mid = lerpAngle(a, b, 0.5);
    // Shortest arc midpoint sits just past pi, i.e. magnitude ~pi, not near 0.
    expect(Math.abs(mid)).toBeGreaterThan(3);
  });

  it('endpoints land on a and (wrapped) b', () => {
    expect(lerpAngle(0.3, 1.2, 0)).toBeCloseTo(0.3, 10);
    expect(lerpAngle(0.3, 1.2, 1)).toBeCloseTo(1.2, 10);
  });
});

describe('smoothingFactor', () => {
  it('is 0 for non-positive dt', () => {
    expect(smoothingFactor(0.5, 0)).toBe(0);
    expect(smoothingFactor(0.5, -1)).toBe(0);
  });

  it('is monotonic increasing in dt and stays within [0,1)', () => {
    let last = 0;
    for (const dt of [1 / 240, 1 / 120, 1 / 60, 1 / 30, 1 / 10]) {
      const f = smoothingFactor(0.5, dt);
      expect(f).toBeGreaterThan(last);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      last = f;
    }
  });

  it('closes more of the gap with a higher rate at fixed dt', () => {
    expect(smoothingFactor(0.9, 1 / 60)).toBeGreaterThan(smoothingFactor(0.3, 1 / 60));
  });
});
