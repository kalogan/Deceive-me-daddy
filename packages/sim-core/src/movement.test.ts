import { describe, expect, it } from 'vitest';
import { RUN_SPEED, WALK_SPEED } from '@deceive/shared';
import { inputSpeed, inputToWorldVelocity } from './movement';

describe('inputSpeed', () => {
  it('returns RUN_SPEED when running, else WALK_SPEED', () => {
    expect(inputSpeed(true)).toBe(RUN_SPEED);
    expect(inputSpeed(false)).toBe(WALK_SPEED);
  });
});

describe('inputToWorldVelocity', () => {
  it('forward at yaw=0 goes +Z at the given speed', () => {
    const v = inputToWorldVelocity(0, 1, 0, WALK_SPEED);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(WALK_SPEED, 6);
  });

  it('forward at yaw=pi/2 goes +X (local->world rotation)', () => {
    const v = inputToWorldVelocity(0, 1, Math.PI / 2, WALK_SPEED);
    expect(v.x).toBeCloseTo(WALK_SPEED, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it('strafe-right (moveX=1) at yaw=0 goes -X (screen-right under the behind-avatar camera)', () => {
    const v = inputToWorldVelocity(1, 0, 0, WALK_SPEED);
    expect(v.x).toBeCloseTo(-WALK_SPEED, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it('clamps diagonal magnitude so it is never faster than speed', () => {
    const v = inputToWorldVelocity(1, 1, 0, WALK_SPEED);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(WALK_SPEED, 6);
  });

  it('clamps an over-reported stick to speed', () => {
    const v = inputToWorldVelocity(100, 0, 0, WALK_SPEED);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(WALK_SPEED, 6);
  });

  it('preserves sub-unit magnitude (half stick = half speed)', () => {
    const v = inputToWorldVelocity(0, 0.5, 0, WALK_SPEED);
    expect(v.z).toBeCloseTo(WALK_SPEED * 0.5, 6);
  });

  it('returns zero velocity for no input', () => {
    expect(inputToWorldVelocity(0, 0, 1.23, WALK_SPEED)).toEqual({ x: 0, z: 0 });
  });

  it('sanitizes non-finite input to zero (hostile-client defense)', () => {
    expect(inputToWorldVelocity(Number.NaN, Number.POSITIVE_INFINITY, 0, WALK_SPEED)).toEqual({
      x: 0,
      z: 0,
    });
  });

  it('treats a non-finite yaw as 0 rather than producing NaN', () => {
    const v = inputToWorldVelocity(0, 1, Number.NaN, RUN_SPEED);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(RUN_SPEED, 6);
  });
});
