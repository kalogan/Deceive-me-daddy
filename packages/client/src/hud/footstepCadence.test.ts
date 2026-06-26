// Unit tests for the PURE footstep cadence. No audio / DOM, runs in the Node gate.
import { describe, expect, it } from 'vitest';
import { footstepDue, footstepInterval } from './footstepCadence';

describe('footstepInterval', () => {
  it('is Infinity below the move threshold (standing still → no steps)', () => {
    expect(footstepInterval(0)).toBe(Infinity);
    expect(footstepInterval(0.2)).toBe(Infinity);
  });

  it('shrinks as speed rises (faster → more frequent steps)', () => {
    const walk = footstepInterval(1);
    const jog = footstepInterval(3);
    const run = footstepInterval(6);
    expect(walk).toBeGreaterThan(jog);
    expect(jog).toBeGreaterThan(run);
  });

  it('floors at the fast interval for very high speeds (never buzzes)', () => {
    expect(footstepInterval(6)).toBeCloseTo(footstepInterval(20));
  });

  it('returns Infinity for NaN / negative speed', () => {
    expect(footstepInterval(Number.NaN)).toBe(Infinity);
    expect(footstepInterval(-5)).toBe(Infinity);
  });
});

describe('footstepDue', () => {
  it('is false while standing still, regardless of elapsed time', () => {
    expect(footstepDue(10, 0)).toBe(false);
  });

  it('fires once the elapsed time reaches the speed-derived interval', () => {
    const interval = footstepInterval(3);
    expect(footstepDue(interval - 0.01, 3)).toBe(false);
    expect(footstepDue(interval + 0.01, 3)).toBe(true);
  });
});
