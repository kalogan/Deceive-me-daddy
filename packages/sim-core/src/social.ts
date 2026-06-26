// Social interactions (Phase 2/3, PROJECT_BRIEF §2b). Standing at a social-interaction spot
// that MATCHES your disguise tier (a staff member watering plants, a guard at a post) reads
// as legitimate and bleeds your suspicion faster — the signature "act natural" tool.
// Authoritative + deterministic.
import { SOCIAL_BLEED, SOCIAL_RANGE } from '@deceive/shared';
import type { WorldState } from './world';

/** Squared XZ-plane distance between a player position and a spot position [x, y, z]. */
function distSqXZ(px: number, pz: number, spot: readonly [number, number, number]): number {
  const dx = px - spot[0];
  const dz = pz - spot[2];
  return dx * dx + dz * dz;
}

/**
 * Bleed extra suspicion from any alive player standing within SOCIAL_RANGE (XZ distance) of a
 * social spot whose `tier` equals the player's `disguiseTier`. For each such player, subtract
 * SOCIAL_BLEED * (dtMs/1000) from `player.suspicion`, clamped at 0. A single matching spot in
 * range is enough — multiples don't stack. A mismatched-tier spot grants no bleed.
 * Runs AFTER stepSuspicion, so the net effect at a matching spot is a downward pull.
 * Deterministic; no Math.random/Date.now.
 */
export function stepSocial(world: WorldState, dtMs: number): void {
  const pack = world.pack;
  if (!pack) return;
  // socialSpots is schema-defaulted to [] for validated packs, but test/cast fixtures may
  // omit it — treat a missing list as empty rather than throwing.
  const spots = pack.socialSpots;
  if (!spots || spots.length === 0) return;

  const dt = dtMs / 1000;
  const rangeSq = SOCIAL_RANGE * SOCIAL_RANGE;

  for (const player of world.players.values()) {
    if (player.phase === 'downed' || player.phase === 'out') continue;

    let atMatchingSpot = false;
    for (const spot of spots) {
      if (spot.tier !== player.disguiseTier) continue;
      if (distSqXZ(player.pos.x, player.pos.z, spot.position) <= rangeSq) {
        atMatchingSpot = true;
        break;
      }
    }
    if (!atMatchingSpot) continue;

    player.suspicion = Math.max(0, player.suspicion - SOCIAL_BLEED * dt);
  }
}
