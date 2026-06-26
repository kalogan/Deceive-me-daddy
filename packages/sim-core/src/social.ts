// Social interactions (Phase 2/3, PROJECT_BRIEF §2b). Standing at a social-interaction spot
// that MATCHES your disguise tier (a staff member watering plants, a guard at a post) reads
// as legitimate and bleeds your suspicion faster — the signature "act natural" tool.
// Authoritative + deterministic.
//
// SCAFFOLD: `stepSocial` is a STUB — the social builder fills it against this seam.
import type { WorldState } from './world';

/**
 * Bleed extra suspicion from any alive player standing within SOCIAL_RANGE of a social spot
 * whose `tier` equals the player's `disguiseTier`. STUB — filled by the social builder.
 * Seam: for each alive player, if such a matching spot is in range, subtract
 * SOCIAL_BLEED * (dtMs/1000) from `player.suspicion`, clamped at 0. Reads pack.socialSpots.
 * Runs AFTER stepSuspicion, so the net effect at a matching spot is a downward pull.
 * Deterministic; no Math.random/Date.now.
 */
export function stepSocial(world: WorldState, dtMs: number): void {
  void world;
  void dtMs;
}
