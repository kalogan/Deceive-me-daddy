// Disguise acquisition + Holo-Crumbs (Phase 2, PROJECT_BRIEF §2b). A player takes the look
// of a nearby NPC (their cover then matches that NPC's tier), leaving a Holo-Crumb tell at
// the theft spot for a short window. Engine-agnostic + deterministic.
//
// SCAFFOLD: `takeDisguise` + `stepCrumbs` are STUBS — the disguise builder fills them.
import type { ClearanceTier } from '@deceive/shared';
import type { Vec3, WorldState } from './world';
import type { SimDeps } from './world';

/** A Holo-Crumb: the tell dropped where a disguise was stolen. */
export interface Crumb {
  id: string;
  pos: Vec3;
  tier: ClearanceTier;
  /** Sim time (ms) at which this crumb expires. */
  expiresMs: number;
}

/**
 * Attempt to take the disguise of NPC `targetNpcId` for player `playerId`. STUB — filled
 * by the disguise builder. The seam: if the player exists, isn't out/downed, and the NPC is
 * within DISGUISE_TAKE_RANGE, set the player's `disguiseTier` to the NPC's tier and drop a
 * Crumb at the player's position (tier = the OLD disguise) expiring in HOLO_CRUMB_MS.
 * Returns whether the take succeeded. Use `deps.clock.now()` for the expiry timestamp.
 */
export function takeDisguise(
  world: WorldState,
  playerId: string,
  targetNpcId: string,
  deps: SimDeps,
): boolean {
  void world;
  void playerId;
  void targetNpcId;
  void deps;
  return false;
}

/** Expire Holo-Crumbs whose `expiresMs` has passed. STUB — filled by the disguise builder. */
export function stepCrumbs(world: WorldState, deps: SimDeps): void {
  void world;
  void deps;
}
