import { describe, expect, it } from 'vitest';
import type { AgentPhase } from '@deceive/shared';
import { isRevealed, isSuspicious, revealMarkerStyle } from './revealStyle';

const ALL_PHASES: AgentPhase[] = ['blended', 'suspicious', 'revealed', 'downed', 'out'];

describe('isRevealed', () => {
  it('is true only for the hard-reveal phase', () => {
    expect(isRevealed('revealed')).toBe(true);
    for (const p of ALL_PHASES.filter((x) => x !== 'revealed')) {
      expect(isRevealed(p)).toBe(false);
    }
  });
});

describe('isSuspicious', () => {
  it('is true only for the suspicious phase', () => {
    expect(isSuspicious('suspicious')).toBe(true);
    for (const p of ALL_PHASES.filter((x) => x !== 'suspicious')) {
      expect(isSuspicious(p)).toBe(false);
    }
  });
});

describe('revealMarkerStyle', () => {
  it('shows a bright red, hot marker when revealed', () => {
    const s = revealMarkerStyle('revealed');
    expect(s.visible).toBe(true);
    expect(s.color).toBe(0xff1a1a);
    expect(s.intensity).toBe(1);
  });

  it('shows a subtler amber marker when suspicious', () => {
    const s = revealMarkerStyle('suspicious');
    expect(s.visible).toBe(true);
    expect(s.color).toBe(0xffb020);
    expect(s.intensity).toBeLessThan(revealMarkerStyle('revealed').intensity);
  });

  it('hides the marker for every non-flagged phase (avatar reverts to tier color)', () => {
    for (const p of ['blended', 'downed', 'out'] as AgentPhase[]) {
      const s = revealMarkerStyle(p);
      expect(s.visible).toBe(false);
      expect(s.intensity).toBe(0);
    }
  });

  it('is red hotter than amber so revealed reads first at distance', () => {
    expect(revealMarkerStyle('revealed').intensity).toBeGreaterThan(
      revealMarkerStyle('suspicious').intensity,
    );
  });
});
