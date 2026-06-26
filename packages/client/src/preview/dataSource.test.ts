import { describe, expect, it, vi } from 'vitest';
import { loadPacksFromRecord } from './dataSource';
// The REAL on-disk pack — proves the seam validates the same bytes the server resolves.
import realPack from '../../../content/packs/facility_alpha.json';
import secondPack from '../../../content/packs/neon_nightclub.json';

describe('loadPacksFromRecord', () => {
  it('passes a real, schema-valid pack through', () => {
    const out = loadPacksFromRecord({ 'facility_alpha.json': realPack });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('facility_alpha');
  });

  it('skips an invalid artifact instead of throwing (fail-soft per pack)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = loadPacksFromRecord({ 'broken.json': { schemaVersion: 1, id: 'x' } });
    expect(out).toHaveLength(0);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('returns ONLY the valid packs from a mixed record (never blanks the gallery)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = loadPacksFromRecord({
      'good.json': realPack,
      'bad.json': { not: 'a pack' },
      'alsoBad.json': null,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('facility_alpha');
    spy.mockRestore();
  });

  it('sorts valid packs by id for a stable picker order', () => {
    const a = { ...realPack, id: 'aaa' };
    const z = { ...realPack, id: 'zzz' };
    const out = loadPacksFromRecord({ 'z.json': z, 'a.json': a });
    expect(out.map((p) => p.id)).toEqual(['aaa', 'zzz']);
  });

  it('handles an empty record without error', () => {
    expect(loadPacksFromRecord({})).toEqual([]);
  });

  it('loads BOTH real on-disk packs so the picker offers a choice', () => {
    const out = loadPacksFromRecord({
      'facility_alpha.json': realPack,
      'neon_nightclub.json': secondPack,
    });
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.id)).toEqual(['facility_alpha', 'neon_nightclub']);
  });
});
