import { describe, expect, it } from 'vitest';
import { emptyKeyState, mapKeysToInput, type KeyState } from './mapInput';

const keys = (over: Partial<KeyState>): KeyState => ({ ...emptyKeyState(), ...over });

describe('mapKeysToInput', () => {
  it('maps cardinal keys to local axes (forward = +moveZ, right = +moveX)', () => {
    expect(mapKeysToInput(keys({ forward: true }), 0, 0).moveZ).toBe(1);
    expect(mapKeysToInput(keys({ back: true }), 0, 0).moveZ).toBe(-1);
    expect(mapKeysToInput(keys({ right: true }), 0, 0).moveX).toBe(1);
    expect(mapKeysToInput(keys({ left: true }), 0, 0).moveX).toBe(-1);
  });

  it('normalises a diagonal to unit length', () => {
    const out = mapKeysToInput(keys({ forward: true, right: true }), 0, 0);
    const len = Math.hypot(out.moveX, out.moveZ);
    expect(len).toBeCloseTo(1, 10);
    expect(out.moveX).toBeCloseTo(Math.SQRT1_2, 10);
    expect(out.moveZ).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it('cancels opposing keys to zero movement', () => {
    const out = mapKeysToInput(keys({ forward: true, back: true, left: true, right: true }), 0, 0);
    expect(out.moveX).toBe(0);
    expect(out.moveZ).toBe(0);
  });

  it('running is false when there is no movement, even with the run key held', () => {
    expect(mapKeysToInput(keys({ running: true }), 0, 0).running).toBe(false);
  });

  it('running is true only when moving with the run key held', () => {
    expect(mapKeysToInput(keys({ running: true, forward: true }), 0, 0).running).toBe(true);
  });

  it('passes yaw, seq, and jumping straight through', () => {
    const out = mapKeysToInput(keys({ jumping: true }), 1.23, 7);
    expect(out.yaw).toBe(1.23);
    expect(out.seq).toBe(7);
    expect(out.jumping).toBe(true);
  });
});
