import { describe, expect, it } from 'vitest';
import { PROP_MODELS, propInfoLine, propModelById } from './propModels';

describe('PROP_MODELS registry', () => {
  it('is non-empty', () => {
    expect(PROP_MODELS.length).toBeGreaterThan(0);
  });

  it('has unique ids', () => {
    const ids = PROP_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('serves every prop out of /props/ with a glb/gltf url + a credited licence', () => {
    for (const m of PROP_MODELS) {
      expect(m.url.startsWith('/props/')).toBe(true);
      expect(m.url).toMatch(/\.(glb|gltf)$/);
      expect(m.license.length).toBeGreaterThan(0);
      expect(m.credit.length).toBeGreaterThan(0);
    }
  });

  it('only ships redistributable licences (CC0 / CC-BY)', () => {
    for (const m of PROP_MODELS) {
      expect(/CC0|CC-BY/i.test(m.license)).toBe(true);
    }
  });
});

describe('propModelById', () => {
  it('returns the matching def on a hit', () => {
    const first = PROP_MODELS[0];
    expect(first).toBeDefined();
    expect(propModelById(first!.id)).toBe(first);
  });

  it('returns undefined on a miss', () => {
    expect(propModelById('no-such-prop')).toBeUndefined();
  });
});

describe('propInfoLine', () => {
  it('joins name, licence + credit for the inspector', () => {
    const def = PROP_MODELS[0]!;
    const line = propInfoLine(def);
    expect(line).toContain(def.name);
    expect(line).toContain(def.license);
    expect(line).toContain(def.credit);
  });
});
