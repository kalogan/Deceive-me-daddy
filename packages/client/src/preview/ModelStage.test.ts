import { describe, expect, it } from 'vitest';
import {
  buildModelOptions,
  infoLine,
  speedForMode,
  WALK_SPEED,
  PROCEDURAL_OPTION_ID,
  type ModelOption,
} from './ModelStage';
import { ASSET_MODELS } from '../render/assetModels';

describe('buildModelOptions', () => {
  it('leads with the procedural option, then one per registry model', () => {
    const opts = buildModelOptions();
    expect(opts[0]?.id).toBe(PROCEDURAL_OPTION_ID);
    expect(opts[0]?.def).toBeNull();
    expect(opts.length).toBe(ASSET_MODELS.length + 1);
  });

  it('carries the asset def for each non-procedural option', () => {
    const opts = buildModelOptions();
    for (let i = 1; i < opts.length; i++) {
      expect(opts[i]?.def).not.toBeNull();
      expect(opts[i]?.id).toBe(ASSET_MODELS[i - 1]?.id);
    }
  });

  it('accepts a custom model list', () => {
    const opts = buildModelOptions([]);
    expect(opts.length).toBe(1);
    expect(opts[0]?.id).toBe(PROCEDURAL_OPTION_ID);
  });
});

describe('speedForMode', () => {
  it('feeds 0 when idle and the walk speed when walking', () => {
    expect(speedForMode(false)).toBe(0);
    expect(speedForMode(true)).toBe(WALK_SPEED);
    expect(WALK_SPEED).toBeGreaterThan(0.15);
  });
});

describe('infoLine', () => {
  it('labels the procedural option without a licence', () => {
    const opt: ModelOption = { id: PROCEDURAL_OPTION_ID, label: 'Procedural (ours)', def: null };
    expect(infoLine(opt)).toMatch(/procedural/i);
  });

  it('shows the asset name + licence + credit', () => {
    const def = ASSET_MODELS[0]!;
    const line = infoLine({ id: def.id, label: def.name, def });
    expect(line).toContain(def.name);
    expect(line).toContain(def.license);
    expect(line).toContain(def.credit);
  });
});
