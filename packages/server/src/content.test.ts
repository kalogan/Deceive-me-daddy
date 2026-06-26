// Pure-logic tests for matchmaking map selection. No room/socket is opened here.
import { describe, expect, it } from 'vitest';
import { ALL_PACKS, FACILITY_ALPHA, NEON_NIGHTCLUB, packById, pickMatchPack } from './content';

describe('content registry', () => {
  it('exposes every shipped pack with stable ids', () => {
    expect(ALL_PACKS.map((p) => p.id)).toEqual(['facility_alpha', 'neon_nightclub']);
  });

  it('looks a pack up by id, undefined for unknown', () => {
    expect(packById('facility_alpha')).toBe(FACILITY_ALPHA);
    expect(packById('neon_nightclub')).toBe(NEON_NIGHTCLUB);
    expect(packById('nope')).toBeUndefined();
  });
});

describe('pickMatchPack', () => {
  it('honours a valid requested id (lets a caller pin the map)', () => {
    expect(pickMatchPack('neon_nightclub')).toBe(NEON_NIGHTCLUB);
    expect(pickMatchPack('facility_alpha')).toBe(FACILITY_ALPHA);
  });

  it('ignores an unknown requested id and falls through to a random pick', () => {
    // rand=0 → first pack regardless, so the unknown id is what routes us here.
    expect(pickMatchPack('does_not_exist', () => 0)).toBe(ALL_PACKS[0]);
  });

  it('picks by the injected rand across the available packs', () => {
    expect(pickMatchPack(undefined, () => 0)).toBe(ALL_PACKS[0]);
    expect(pickMatchPack(undefined, () => 0.99)).toBe(ALL_PACKS[ALL_PACKS.length - 1]);
  });

  it('clamps a rand that returns 1.0 (never indexes past the end)', () => {
    expect(pickMatchPack(undefined, () => 1)).toBe(ALL_PACKS[ALL_PACKS.length - 1]);
  });
});
