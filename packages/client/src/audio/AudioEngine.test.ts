// Unit tests for the PURE theme→ambient-bed seam. AudioEngine itself is browser-only (it touches
// AudioContext/window), so we test ONLY the pure exported helpers here — never the class — so this
// runs in the Node gate. `ambientForTheme` is the single source of truth the game uses to pick the
// in-match soundtrack; `SOUNDTRACKS` is the plain data that drives the preview's music player.
import { describe, expect, it } from 'vitest';
import { ambientForTheme, SOUNDTRACKS, type AmbientVariant } from './AudioEngine';

describe('ambientForTheme', () => {
  it('maps nightclub → club', () => {
    expect(ambientForTheme('nightclub')).toBe('club');
  });

  it('maps beach → beach', () => {
    expect(ambientForTheme('beach')).toBe('beach');
  });

  it('maps research_facility → match', () => {
    expect(ambientForTheme('research_facility')).toBe('match');
  });

  it('falls back to match for any unknown theme', () => {
    expect(ambientForTheme('')).toBe('match');
    expect(ambientForTheme('totally_unknown_theme')).toBe('match');
    expect(ambientForTheme('NightClub')).toBe('match'); // case-sensitive, not a known key
  });
});

describe('SOUNDTRACKS', () => {
  it('labels every bed the preview can audition', () => {
    const variants = SOUNDTRACKS.map((s) => s.variant);
    // Must cover the front-of-game bed + every in-match bed at minimum.
    expect(variants).toEqual(
      expect.arrayContaining<AmbientVariant>(['menu', 'match', 'club', 'beach']),
    );
  });

  it('has a non-empty label for each entry and no duplicate variants', () => {
    for (const { label } of SOUNDTRACKS) expect(label.length).toBeGreaterThan(0);
    const variants = SOUNDTRACKS.map((s) => s.variant);
    expect(new Set(variants).size).toBe(variants.length);
  });

  it('only references beds ambientForTheme can also produce (the seam stays consistent)', () => {
    // Every theme target must appear as an auditionable soundtrack.
    const variants = new Set(SOUNDTRACKS.map((s) => s.variant));
    for (const theme of ['nightclub', 'beach', 'research_facility', 'unknown']) {
      expect(variants.has(ambientForTheme(theme))).toBe(true);
    }
  });
});
