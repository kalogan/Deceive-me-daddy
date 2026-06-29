// Pure-logic tests for matchmaking map selection. No room/socket is opened here.
import { describe, expect, it } from 'vitest';
import {
  ALL_PACKS,
  FACILITY_ALPHA,
  NEON_NIGHTCLUB,
  SANDBOX_TEST_RANGE,
  SELECTABLE_PACKS,
  packById,
  pickMatchPack,
} from './content';

describe('content registry', () => {
  it('exposes every shipped pack with stable ids', () => {
    expect(ALL_PACKS.map((p) => p.id)).toEqual([
      'facility_alpha',
      'vertex_spire',
      'neon_nightclub',
      'manhattan_beach',
      'train_station',
      'shopping_mall',
    ]);
  });

  it('keeps the sandbox test range OUT of the random rotation but selectable', () => {
    expect(ALL_PACKS).not.toContain(SANDBOX_TEST_RANGE);
    expect(SELECTABLE_PACKS).toContain(SANDBOX_TEST_RANGE);
  });

  it('looks a pack up by id, undefined for unknown', () => {
    expect(packById('facility_alpha')).toBe(FACILITY_ALPHA);
    expect(packById('neon_nightclub')).toBe(NEON_NIGHTCLUB);
    expect(packById('train_station')?.id).toBe('train_station');
    expect(packById('shopping_mall')?.id).toBe('shopping_mall');
    expect(packById('sandbox_testrange')).toBe(SANDBOX_TEST_RANGE);
    expect(packById('nope')).toBeUndefined();
  });
});

describe('pickMatchPack', () => {
  it('honours a valid requested id (lets a caller pin the map)', () => {
    expect(pickMatchPack('neon_nightclub')).toBe(NEON_NIGHTCLUB);
    expect(pickMatchPack('facility_alpha')).toBe(FACILITY_ALPHA);
  });

  it('lets a caller pin the sandbox by id even though it is not in the random rotation', () => {
    expect(pickMatchPack('sandbox_testrange')).toBe(SANDBOX_TEST_RANGE);
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
