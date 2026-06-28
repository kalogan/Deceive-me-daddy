// Game-scene map loading. Reuses the SEAM (loadAllPacks in src/preview/dataSource), which
// globs packages/content + validates with the REAL ContentPackSchema — the same bytes the
// server resolves (PROJECT_BRIEF §8 / §4.5). We import only the data SEAM here, never the
// preview SHELL (PreviewApp / its CSS), so nothing preview-only leaks into the game bundle.
//
// The server runs facility_alpha; mounting the same authored pack via MapView means the
// static map geometry the player walks through MATCHES the authoritative world.
import type { ContentPack } from '@deceive/shared';
import { loadAllPacks } from '../preview/dataSource';

/** The pack id the live server runs. Falls back to the first available pack if absent. */
export const GAME_MAP_ID = 'facility_alpha';

/** The onboarding tutorial level — launched by the splash 'Tutorial' button (solo, offline). */
export const TUTORIAL_MAP_ID = 'tutorial_grounds';

/** Map ids kept OUT of the player-facing Level picker + the random rotation (tutorial only — the
 *  Sandbox stays pinnable as before). */
export const HIDDEN_MAP_IDS: ReadonlySet<string> = new Set([TUTORIAL_MAP_ID]);

/** The packs offered in the Level picker / random play (excludes the hidden tutorial level). */
export function playablePacks(packs: ContentPack[]): ContentPack[] {
  return packs.filter((p) => !HIDDEN_MAP_IDS.has(p.id));
}

/**
 * Pick the pack to mount in the game scene from a list of validated packs. PURE so the
 * selection is unit-testable without Vite/DOM: prefers the id the server runs, else the
 * first pack, else null when none are available (caller renders the bare scene).
 */
export function selectGameMap(
  packs: ContentPack[],
  id: string = GAME_MAP_ID,
): ContentPack | null {
  return packs.find((p) => p.id === id) ?? packs[0] ?? null;
}

/** Load + select the game map via the production-truthful seam (Vite-only glob). */
export function loadGameMap(): ContentPack | null {
  return selectGameMap(loadAllPacks());
}

/** Load EVERY validated authored pack (the maps available to play). Vite-only glob. */
export function loadGameMaps(): ContentPack[] {
  return loadAllPacks();
}
