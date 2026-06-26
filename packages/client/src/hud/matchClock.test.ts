// Unit tests for the PURE match-clock formatter. No DOM, runs in the Node gate.
import { describe, expect, it } from 'vitest';
import { formatMatchClock } from './matchClock';

describe('formatMatchClock', () => {
  it('formats whole minutes and seconds as MM:SS', () => {
    expect(formatMatchClock(0)).toBe('00:00');
    expect(formatMatchClock(5_000)).toBe('00:05');
    expect(formatMatchClock(65_000)).toBe('01:05');
    expect(formatMatchClock(125_000)).toBe('02:05');
  });

  it('floors sub-second remainders', () => {
    expect(formatMatchClock(9_999)).toBe('00:09');
    expect(formatMatchClock(59_999)).toBe('00:59');
  });

  it('does not cap minutes at 99 for a long match', () => {
    expect(formatMatchClock(6_000_000)).toBe('100:00');
  });

  it('clamps negative / non-finite inputs to 00:00', () => {
    expect(formatMatchClock(-1)).toBe('00:00');
    expect(formatMatchClock(Number.NaN)).toBe('00:00');
    expect(formatMatchClock(Number.POSITIVE_INFINITY)).toBe('00:00');
  });
});
