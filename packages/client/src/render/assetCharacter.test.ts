import { describe, expect, it } from 'vitest';
import {
  ASSET_DEFAULT_HEIGHT,
  ASSET_WALK_THRESHOLD,
  fitScale,
  pickClip,
} from './assetCharacter';

describe('fitScale', () => {
  it('scales a model up/down to the target height', () => {
    expect(fitScale(2, 1)).toBeCloseTo(0.5);
    expect(fitScale(0.5, 1)).toBeCloseTo(2);
  });

  it('defaults the target to the avatar height', () => {
    expect(fitScale(ASSET_DEFAULT_HEIGHT)).toBeCloseTo(1);
  });

  it('returns 1 for a degenerate / empty bounding box (no divide-by-zero)', () => {
    expect(fitScale(0, 1.8)).toBe(1);
    expect(fitScale(-3, 1.8)).toBe(1);
    expect(fitScale(2, 0)).toBe(1);
  });
});

describe('pickClip', () => {
  const def = { idleClip: 'Idle', walkClip: 'Walking' };

  it('plays the walk clip above the speed threshold', () => {
    expect(pickClip(['Idle', 'Walking'], ASSET_WALK_THRESHOLD + 1, def)).toBe('Walking');
  });

  it('plays the idle clip at/below the speed threshold', () => {
    expect(pickClip(['Idle', 'Walking'], 0, def)).toBe('Idle');
    expect(pickClip(['Idle', 'Walking'], ASSET_WALK_THRESHOLD, def)).toBe('Idle');
  });

  it('falls back to the first clip when the named clip is absent', () => {
    expect(pickClip(['Dance', 'Jump'], 5, def)).toBe('Dance');
    expect(pickClip(['Dance', 'Jump'], 0, def)).toBe('Dance');
  });

  it('falls back from a missing walk clip to the idle clip', () => {
    expect(pickClip(['Idle', 'Run'], 5, { idleClip: 'Idle', walkClip: 'Walking' })).toBe('Idle');
  });

  it('returns null when the model has no clips (mixer no-op)', () => {
    expect(pickClip([], 5, def)).toBeNull();
    expect(pickClip([], 0, def)).toBeNull();
  });

  it('tolerates a def with no clip names by using the first clip', () => {
    expect(pickClip(['A', 'B'], 5, {})).toBe('A');
    expect(pickClip(['A', 'B'], 0, {})).toBe('A');
  });
});
