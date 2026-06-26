import { describe, expect, it } from 'vitest';
import { clamp01, easeOutCubic, fadeOut, lifeProgress, pulse01 } from './combatFx';

describe('clamp01', () => {
  it('clamps into [0,1]', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(2)).toBe(1);
  });
});

describe('lifeProgress', () => {
  it('is 0 at the start, 1 at the end, clamped beyond', () => {
    expect(lifeProgress(0, 1)).toBe(0);
    expect(lifeProgress(0.5, 1)).toBe(0.5);
    expect(lifeProgress(1, 1)).toBe(1);
    expect(lifeProgress(5, 1)).toBe(1);
  });

  it('guards a non-positive lifetime by reporting finished', () => {
    expect(lifeProgress(0, 0)).toBe(1);
    expect(lifeProgress(0, -1)).toBe(1);
  });
});

describe('easeOutCubic', () => {
  it('pins the endpoints and stays monotonic with a fast start', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    // ease-out: well past halfway by the midpoint
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(0.25)).toBeLessThan(easeOutCubic(0.75));
  });

  it('clamps out-of-range input', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe('pulse01', () => {
  it('rises to a peak at the middle then falls', () => {
    expect(pulse01(0)).toBe(0);
    expect(pulse01(0.5)).toBe(1);
    expect(pulse01(1)).toBe(0);
  });
});

describe('fadeOut', () => {
  it('starts full and eases to zero', () => {
    expect(fadeOut(0)).toBe(1);
    expect(fadeOut(1)).toBe(0);
    expect(fadeOut(0.5)).toBeGreaterThan(0);
    expect(fadeOut(0.5)).toBeLessThan(1);
  });
});
