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

  it('serves every model url out of /models/ (so it resolves from public/ in dev + dist)', () => {
    for (const m of ASSET_MODELS) {
      expect(m.url.startsWith('/models/')).toBe(true);
    }
  });

  it('includes the Fox with its named idle/walk clips', () => {
    const fox = assetModelById('fox');
    expect(fox).toBeDefined();
    expect(fox?.url).toBe('/models/Fox.glb');
    expect(fox?.idleClip).toBe('Survey');
    expect(fox?.walkClip).toBe('Walk');
  });

  it('includes the two Cesium CC-BY humanoids (single-clip, clips fall back)', () => {
    for (const id of ['cesium-man', 'rigged-figure']) {
      const m = assetModelById(id);
      expect(m).toBeDefined();
      expect(m?.license).toBe('CC-BY 4.0');
      // No named idle/walk — the loader falls back to the model's first clip.
      expect(m?.idleClip).toBeUndefined();
      expect(m?.walkClip).toBeUndefined();
    }
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
