import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@deceive/shared';
import { GAME_MAP_ID, selectGameMap } from './loadMap';

// Minimal stand-ins; selectGameMap only reads `id`, so we don't need full packs.
function pack(id: string): ContentPack {
  return { id } as unknown as ContentPack;
}

describe('selectGameMap', () => {
  it('prefers the server map id when present', () => {
    const packs = [pack('other'), pack(GAME_MAP_ID)];
    expect(selectGameMap(packs)?.id).toBe(GAME_MAP_ID);
  });

  it('falls back to the first pack when the preferred id is absent', () => {
    const packs = [pack('alpha'), pack('beta')];
    expect(selectGameMap(packs)?.id).toBe('alpha');
  });

  it('honours an explicit id override', () => {
    const packs = [pack('alpha'), pack('beta')];
    expect(selectGameMap(packs, 'beta')?.id).toBe('beta');
  });

  it('returns null when there are no packs', () => {
    expect(selectGameMap([])).toBeNull();
  });
});
