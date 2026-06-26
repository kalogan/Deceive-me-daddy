import { describe, expect, it } from 'vitest';
import { joystickVector, TOUCH_DEADZONE, TOUCH_RUN_AT } from './touchVector';

const R = 60;

describe('joystickVector', () => {
  it('reads centre (and within the dead zone) as no movement', () => {
    expect(joystickVector(0, 0, R)).toEqual({ moveX: 0, moveZ: 0, magnitude: 0, running: false });
    const tiny = TOUCH_DEADZONE * R * 0.5;
    expect(joystickVector(tiny, 0, R).magnitude).toBe(0);
  });

  it('pushing UP (screen -dy) is forward (+moveZ)', () => {
    const r = joystickVector(0, -R * 0.5, R);
    expect(r.moveZ).toBeCloseTo(0.5, 6);
    expect(r.moveX).toBeCloseTo(0, 6);
  });

  it('pushing DOWN is backward (-moveZ)', () => {
    expect(joystickVector(0, R * 0.5, R).moveZ).toBeCloseTo(-0.5, 6);
  });

  it('pushing RIGHT is strafe-right (+moveX)', () => {
    const r = joystickVector(R * 0.5, 0, R);
    expect(r.moveX).toBeCloseTo(0.5, 6);
    expect(r.moveZ).toBeCloseTo(0, 6);
  });

  it('clamps a past-the-rim drag to unit magnitude', () => {
    const r = joystickVector(R * 3, 0, R);
    expect(r.magnitude).toBeCloseTo(1, 6);
    expect(Math.hypot(r.moveX, r.moveZ)).toBeCloseTo(1, 6);
    expect(r.moveX).toBeCloseTo(1, 6);
  });

  it('flags running only past the run threshold', () => {
    expect(joystickVector(0, -R * (TOUCH_RUN_AT - 0.1), R).running).toBe(false);
    expect(joystickVector(0, -R * (TOUCH_RUN_AT + 0.1), R).running).toBe(true);
  });

  it('returns zero for a degenerate radius', () => {
    expect(joystickVector(10, 10, 0)).toEqual({ moveX: 0, moveZ: 0, magnitude: 0, running: false });
  });
});
