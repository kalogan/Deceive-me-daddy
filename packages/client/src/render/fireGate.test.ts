import { describe, expect, it } from 'vitest';
import { FIRE_COOLDOWN_MS, FireGate } from './fireGate';

describe('FireGate', () => {
  it('admits the first fire', () => {
    const gate = new FireGate(250);
    expect(gate.tryFire(0)).toBe(true);
  });

  it('blocks a second fire within the cooldown (held button is not a firehose)', () => {
    const gate = new FireGate(250);
    expect(gate.tryFire(1000)).toBe(true);
    expect(gate.tryFire(1100)).toBe(false);
    expect(gate.tryFire(1249)).toBe(false);
  });

  it('admits again once the cooldown has fully elapsed', () => {
    const gate = new FireGate(250);
    expect(gate.tryFire(1000)).toBe(true);
    expect(gate.tryFire(1250)).toBe(true);
  });

  it('arms the cooldown from the last ADMITTED fire, not from rejected attempts', () => {
    const gate = new FireGate(250);
    expect(gate.tryFire(0)).toBe(true);
    expect(gate.tryFire(100)).toBe(false); // rejected, must not reset the clock
    expect(gate.tryFire(200)).toBe(false); // still within 250 of the admitted fire at 0
    expect(gate.tryFire(250)).toBe(true);
  });

  it('defaults to the shared cooldown constant', () => {
    const gate = new FireGate();
    expect(gate.tryFire(0)).toBe(true);
    expect(gate.tryFire(FIRE_COOLDOWN_MS - 1)).toBe(false);
    expect(gate.tryFire(FIRE_COOLDOWN_MS)).toBe(true);
  });
});
