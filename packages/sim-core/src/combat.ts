// Combat + downed/revive (Phase 2, PROJECT_BRIEF §2b). Authoritative + deterministic.
// Firing is a hitscan: a shot from the shooter along their yaw hits the nearest player in a
// forward cone within range, dealing damage. At 0 health a player is DOWNED (revivable by a
// teammate for a window, else eliminated 'out'). All server-side; the client only requests.
//
// SCAFFOLD: `resolveFire`, `reviveTeammate`, `stepCombat` are STUBS — the combat builder
// fills them against this seam.
import type { SimDeps, WorldState } from './world';

/**
 * Resolve a shot fired by `shooterId` (already hard-revealed by the fire handler). STUB.
 * Seam: from the shooter's pos along their yaw, find the nearest OTHER player (not on the
 * shooter's team, not already downed/out) within FIRE_RANGE whose direction is within the
 * forward cone (dot >= FIRE_CONE_DOT); subtract FIRE_DAMAGE from its health (clamp >=0). If
 * health hits 0, down it: phase='downed', downedUntilMs = deps.clock.now()+REVIVE_WINDOW_MS,
 * health=0. Forward at yaw is +Z rotated by yaw — reuse the movement convention (sin,cos).
 */
export function resolveFire(world: WorldState, shooterId: string, deps: SimDeps): void {
  void world;
  void shooterId;
  void deps;
}

/**
 * `reviverId` attempts to revive downed teammate `targetId`. STUB. Seam: both exist, same
 * team, target.phase==='downed', within REVIVE_RANGE → revive: phase='blended', health back
 * to MAX_HEALTH (or a partial), downedUntilMs=0. Returns whether it succeeded.
 */
export function reviveTeammate(
  world: WorldState,
  reviverId: string,
  targetId: string,
  deps: SimDeps,
): boolean {
  void world;
  void reviverId;
  void targetId;
  void deps;
  return false;
}

/**
 * Per-tick combat upkeep. STUB. Seam: any 'downed' player whose downedUntilMs has passed
 * (now >= downedUntilMs > 0) becomes 'out' (eliminated; downedUntilMs=0). Deterministic.
 */
export function stepCombat(world: WorldState, deps: SimDeps): void {
  void world;
  void deps;
}
