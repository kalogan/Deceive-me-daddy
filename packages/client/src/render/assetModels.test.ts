import { describe, expect, it } from 'vitest';
import { ASSET_MODELS, assetModelById } from './assetModels';

describe('ASSET_MODELS registry', () => {
  it('is non-empty', () => {
    expect(ASSET_MODELS.length).toBeGreaterThan(0);
  });

  it('has unique ids', () => {
    const ids = ASSET_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every entry a url + a license', () => {
    for (const m of ASSET_MODELS) {
      expect(m.url).toMatch(/\.(glb|gltf)$/);
      expect(m.license.length).toBeGreaterThan(0);
      expect(m.credit.length).toBeGreaterThan(0);
    }
  });

  it('includes the RobotExpressive CC0 demo with the served url + clip names', () => {
    const robot = assetModelById('robot-expressive');
    expect(robot).toBeDefined();
    expect(robot?.url).toBe('/models/RobotExpressive.glb');
    expect(robot?.license).toBe('CC0');
    expect(robot?.idleClip).toBe('Idle');
    expect(robot?.walkClip).toBe('Walking');
  });
});

describe('assetModelById', () => {
  it('returns the matching def on a hit', () => {
    const first = ASSET_MODELS[0];
    expect(first).toBeDefined();
    expect(assetModelById(first!.id)).toBe(first);
  });

  it('returns undefined on a miss', () => {
    expect(assetModelById('no-such-model')).toBeUndefined();
  });
});
