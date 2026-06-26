// Unit tests for the loading screen's PURE seams: `LOADING_TIPS` (the tip data) and `tipAt`
// (the wrapping lookup). The LoadingScreen CLASS itself is browser-only (it touches the DOM)
// and is deliberately NOT imported here — these tests stay DOM-free so they run under the Node
// gate, exactly like the rest of the suite (cf. resultsScreen.test.ts / menu.test.ts).
import { describe, expect, it } from 'vitest';
import { LOADING_TIPS, tipAt } from './LoadingScreen';

describe('LOADING_TIPS', () => {
  it('has a handful of tips', () => {
    expect(LOADING_TIPS.length).toBeGreaterThanOrEqual(6);
    expect(LOADING_TIPS.length).toBeLessThanOrEqual(10);
  });

  it('contains only non-empty strings', () => {
    for (const tip of LOADING_TIPS) {
      expect(typeof tip).toBe('string');
      expect(tip.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('tipAt', () => {
  const n = LOADING_TIPS.length;

  it('returns the first tip at index 0', () => {
    expect(tipAt(0)).toBe(LOADING_TIPS[0]);
  });

  it('returns the last tip at index n-1', () => {
    expect(tipAt(n - 1)).toBe(LOADING_TIPS[n - 1]);
  });

  it('wraps back to the first tip at index n', () => {
    expect(tipAt(n)).toBe(LOADING_TIPS[0]);
  });

  it('wraps NEGATIVE indices forward (no negative remainder)', () => {
    expect(tipAt(-1)).toBe(LOADING_TIPS[n - 1]);
    expect(tipAt(-n)).toBe(LOADING_TIPS[0]);
    expect(tipAt(-n - 1)).toBe(LOADING_TIPS[n - 1]);
  });

  it('is consistent across full wraps for any integer counter', () => {
    for (let i = -3 * n; i <= 3 * n; i += 1) {
      const expected = LOADING_TIPS[((i % n) + n) % n];
      expect(tipAt(i)).toBe(expected);
    }
  });

  it('always returns a non-empty string', () => {
    for (let i = -20; i <= 20; i += 1) {
      expect(tipAt(i).length).toBeGreaterThan(0);
    }
  });
});
