import { RUN_SPEED, WALK_SPEED, type PlayerInput } from '@deceive/shared';
import { describe, expect, it } from 'vitest';
import { integrateMove } from './movement';

const input = (over: Partial<PlayerInput>): PlayerInput => ({
  seq: 0,
  moveX: 0,
  moveZ: 0,
  yaw: 0,
  running: false,
  jumping: false,
  ...over,
});

const ORIGIN = { x: 0, y: 0, z: 0 };

describe('integrateMove', () => {
  it('moves forward (moveZ=+1) along the Z axis at yaw 0', () => {
    const next = integrateMove(ORIGIN, input({ moveZ: 1 }), 1);
    expect(next.z).toBeCloseTo(WALK_SPEED, 6);
    expect(next.x).toBeCloseTo(0, 6);
    expect(next.y).toBe(0);
  });

  it('strafes right (moveX=+1) along +X at yaw 0', () => {
    const next = integrateMove(ORIGIN, input({ moveX: 1 }), 1);
    expect(next.x).toBeCloseTo(WALK_SPEED, 6);
    expect(next.z).toBeCloseTo(0, 6);
  });

  it('uses RUN_SPEED when running', () => {
    const next = integrateMove(ORIGIN, input({ moveZ: 1, running: true }), 1);
    expect(next.z).toBeCloseTo(RUN_SPEED, 6);
    expect(RUN_SPEED).toBeGreaterThan(WALK_SPEED);
  });

  it('rotates the local move vector by yaw into world space', () => {
    // Facing yaw = +pi/2: local forward rotates 90deg, putting world motion on +X.
    const next = integrateMove(ORIGIN, input({ moveZ: 1, yaw: Math.PI / 2 }), 1);
    expect(next.x).toBeCloseTo(WALK_SPEED, 6);
    expect(next.z).toBeCloseTo(0, 6);
  });

  it('scales by dt', () => {
    const next = integrateMove(ORIGIN, input({ moveZ: 1 }), 0.5);
    expect(next.z).toBeCloseTo(WALK_SPEED * 0.5, 6);
  });
});
