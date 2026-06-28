import { describe, it, expect } from 'vitest';
import {
  EYE_HEIGHT,
  MAX_PITCH,
  clampPitch,
  firstPersonView,
  applyFirstPersonCamera,
  headingDeg,
  cardinal,
  type CameraLike,
} from './firstPersonCamera';

const ORIGIN = { x: 0, y: 0, z: 0 };

describe('clampPitch', () => {
  it('passes a value inside the range through', () => {
    expect(clampPitch(0.5)).toBeCloseTo(0.5);
  });
  it('clamps beyond the legal range both ways', () => {
    expect(clampPitch(99)).toBeCloseTo(MAX_PITCH);
    expect(clampPitch(-99)).toBeCloseTo(-MAX_PITCH);
  });
  it('treats a non-finite pitch as 0', () => {
    expect(clampPitch(Number.NaN)).toBe(0);
  });
});

describe('firstPersonView', () => {
  it('lifts the eye to eye height above the ground position', () => {
    const v = firstPersonView({ x: 3, y: 1, z: -2 }, 0, 0);
    expect(v.eye).toEqual({ x: 3, y: 1 + EYE_HEIGHT, z: -2 });
  });

  it('looks along +Z at yaw=0, pitch=0 (matches movement.ts forward)', () => {
    const v = firstPersonView(ORIGIN, 0, 0);
    expect(v.dir.x).toBeCloseTo(0);
    expect(v.dir.y).toBeCloseTo(0);
    expect(v.dir.z).toBeCloseTo(1);
  });

  it('looks along +X at yaw=pi/2 (right turn)', () => {
    const v = firstPersonView(ORIGIN, Math.PI / 2, 0);
    expect(v.dir.x).toBeCloseTo(1);
    expect(v.dir.z).toBeCloseTo(0);
  });

  it('pitch raises the look direction (+Y) and shortens the horizontal reach', () => {
    const up = firstPersonView(ORIGIN, 0, 0.5);
    expect(up.dir.y).toBeCloseTo(Math.sin(0.5));
    expect(up.dir.z).toBeCloseTo(Math.cos(0.5));
  });

  it('clamps an over-range pitch rather than tipping past vertical', () => {
    const v = firstPersonView(ORIGIN, 0, 99);
    expect(v.dir.y).toBeCloseTo(Math.sin(MAX_PITCH));
  });

  it('target is one unit along the look direction from the eye', () => {
    const v = firstPersonView(ORIGIN, 0, 0);
    expect(v.target.z - v.eye.z).toBeCloseTo(1);
  });
});

describe('applyFirstPersonCamera', () => {
  it('writes eye position + look target through the CameraLike seam', () => {
    let setTo: [number, number, number] | null = null;
    let lookedAt: [number, number, number] | null = null;
    const cam: CameraLike = {
      position: {
        set: (x, y, z) => {
          setTo = [x, y, z];
        },
      },
      lookAt: (x, y, z) => {
        lookedAt = [x, y, z];
      },
    };
    const view = applyFirstPersonCamera(cam, { x: 5, y: 0, z: 0 }, 0, 0);
    expect(setTo).toEqual([5, EYE_HEIGHT, 0]);
    expect(lookedAt).toEqual([view.target.x, view.target.y, view.target.z]);
  });
});

describe('headingDeg / cardinal', () => {
  it('reads yaw=0 as North (0 degrees)', () => {
    expect(headingDeg(0)).toBe(0);
    expect(cardinal(0)).toBe('N');
  });

  it('turning right (yaw decreasing) increases the bearing clockwise', () => {
    // input does yaw -= movementX, so a right turn makes yaw negative.
    expect(headingDeg(-Math.PI / 2)).toBe(90); // due East
    expect(cardinal(90)).toBe('E');
    expect(headingDeg(-Math.PI)).toBe(180);
    expect(cardinal(180)).toBe('S');
  });

  it('wraps into 0..359 and never returns 360', () => {
    expect(headingDeg(-2 * Math.PI)).toBe(0);
    expect(headingDeg(2 * Math.PI)).toBe(0);
  });

  it('treats a non-finite yaw as 0', () => {
    expect(headingDeg(Number.NaN)).toBe(0);
  });

  it('snaps to the nearest 8-point cardinal', () => {
    expect(cardinal(45)).toBe('NE');
    expect(cardinal(315)).toBe('NW');
    expect(cardinal(359)).toBe('N');
  });
});
