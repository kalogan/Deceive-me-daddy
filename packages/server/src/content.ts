// Server-side content loading (Phase 2). Loads every shipped map pack and selects one per
// match at room creation. Validated with the SAME ContentPackSchema the preview harness uses —
// same bytes, same validate, different source.
import { ContentPackSchema, type ContentPack } from '@deceive/shared';
import rawFacilityAlpha from '../../content/packs/facility_alpha.json';
import rawNeonNightclub from '../../content/packs/neon_nightclub.json';
import rawManhattanBeach from '../../content/packs/manhattan_beach.json';

export const FACILITY_ALPHA: ContentPack = ContentPackSchema.parse(rawFacilityAlpha);
export const NEON_NIGHTCLUB: ContentPack = ContentPackSchema.parse(rawNeonNightclub);
export const MANHATTAN_BEACH: ContentPack = ContentPackSchema.parse(rawManhattanBeach);

/** Every playable map, in a stable order. Matchmaking picks one of these per room. */
export const ALL_PACKS: readonly ContentPack[] = [FACILITY_ALPHA, NEON_NIGHTCLUB, MANHATTAN_BEACH];

/** Look up a pack by id (e.g. an explicitly-requested map), or undefined if unknown. */
export function packById(id: string): ContentPack | undefined {
  return ALL_PACKS.find((p) => p.id === id);
}

/**
 * Pick the map for a fresh match. If `requestedId` names a known pack, use it (lets tests /
 * callers pin a map); otherwise choose one at random so successive matches vary across the
 * available levels. `rand` defaults to Math.random (map choice is a one-off room-setup decision,
 * NOT part of the deterministic tick loop, so it needn't go through the sim RNG).
 */
export function pickMatchPack(requestedId?: string, rand: () => number = Math.random): ContentPack {
  if (requestedId) {
    const found = packById(requestedId);
    if (found) return found;
  }
  const i = Math.floor(rand() * ALL_PACKS.length);
  return ALL_PACKS[Math.min(i, ALL_PACKS.length - 1)] ?? FACILITY_ALPHA;
}
