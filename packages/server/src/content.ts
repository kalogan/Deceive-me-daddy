// Server-side content loading (Phase 2). Loads every shipped map pack and selects one per
// match at room creation. Validated with the SAME ContentPackSchema the preview harness uses —
// same bytes, same validate, different source.
import { ContentPackSchema, type ContentPack } from '@deceive/shared';
import rawFacilityAlpha from '../../content/packs/facility_alpha.json';
import rawNeonNightclub from '../../content/packs/neon_nightclub.json';
import rawManhattanBeach from '../../content/packs/manhattan_beach.json';
import rawSandboxTestRange from '../../content/packs/sandbox_testrange.json';

export const FACILITY_ALPHA: ContentPack = ContentPackSchema.parse(rawFacilityAlpha);
export const NEON_NIGHTCLUB: ContentPack = ContentPackSchema.parse(rawNeonNightclub);
export const MANHATTAN_BEACH: ContentPack = ContentPackSchema.parse(rawManhattanBeach);
/** A prop-testing arena. SELECTABLE by id (the level picker offers it) but kept OUT of the random
 *  matchmaking rotation below — a test map should never surprise a Quick Play / Random match. */
export const SANDBOX_TEST_RANGE: ContentPack = ContentPackSchema.parse(rawSandboxTestRange);

/** The RANDOM matchmaking rotation: the real shipped levels, in a stable order. Excludes the
 *  Sandbox test range (which is reachable only by an explicit map request). */
export const ALL_PACKS: readonly ContentPack[] = [FACILITY_ALPHA, NEON_NIGHTCLUB, MANHATTAN_BEACH];

/** Every pack a caller may PIN by id (the rotation + the explicitly-selectable Sandbox). */
export const SELECTABLE_PACKS: readonly ContentPack[] = [...ALL_PACKS, SANDBOX_TEST_RANGE];

/** Look up a pack by id (e.g. an explicitly-requested map), or undefined if unknown. Searches the
 *  selectable set, so the Sandbox is pinnable by id even though it is not in the random rotation. */
export function packById(id: string): ContentPack | undefined {
  return SELECTABLE_PACKS.find((p) => p.id === id);
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
