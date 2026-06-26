import { describe, expect, it } from 'vitest';
import type { AgentPhase } from '@deceive/shared';
import { downedBodyStyle } from './downedStyle';

describe('downedBodyStyle', () => {
  it('renders live phases upright + fully opaque + full brightness', () => {
    for (const phase of ['blended', 'suspicious', 'revealed'] as AgentPhase[]) {
      const s = downedBodyStyle(phase);
      expect(s.visible).toBe(true);
      expect(s.opacity).toBe(1);
      expect(s.roll).toBe(0);
      expect(s.brightness).toBe(1);
    }
  });

  it('dims a downed player and lays the body flat so an ally can find it', () => {
    const s = downedBodyStyle('downed');
    expect(s.visible).toBe(true);
    expect(s.roll).toBeCloseTo(Math.PI / 2);
    expect(s.opacity).toBeLessThan(1);
    expect(s.brightness).toBeLessThan(1);
  });

  it('ghosts an eliminated player (still shown, but the faintest + darkest)', () => {
    const out = downedBodyStyle('out');
    const downed = downedBodyStyle('downed');
    expect(out.visible).toBe(true);
    expect(out.roll).toBeCloseTo(Math.PI / 2);
    expect(out.opacity).toBeLessThan(downed.opacity);
    expect(out.brightness).toBeLessThanOrEqual(downed.brightness);
  });
});
