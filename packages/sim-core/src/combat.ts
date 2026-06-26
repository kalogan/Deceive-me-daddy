// Combat + downed/revive (Phase 2, PROJECT_BRIEF §2b). Authoritative + deterministic.
// Firing is a hitscan: a shot from the shooter along their yaw hits the nearest player in a
// forward cone within range, dealing damage. At 0 health a player is DOWNED (revivable by a
// teammate for a window, else eliminated 'out'). All server-side; the client only requests.
import {
  FIRE_CONE_DOT,
  FIRE_DAMAGE,
  FIRE_RANGE,
  MAX_HEALTH,
  REVIVE_RANGE,
  REVIVE_WINDOW_MS,
} from '@deceive/shared';
import type { PlayerState, SimDeps, WorldState } from './world';

/** A player is incapacitated (can neither act nor be targeted) when downed or eliminated. */
function isIncapacitated(p: PlayerState): boolean {
  return p.phase === 'downed' || p.phase === 'out';
}

/** Squared XZ (ground-plane) distance between two players — cheap for range comparisons. */
function xzDistSq(a: PlayerState, b: PlayerState): number {
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  return dx * dx + dz * dz;
}

/**
 * Resolve a shot fired by `shooterId` (already hard-revealed by the fire handler). From the
 * shooter's pos along their yaw (forward = (sin,cos) on XZ — the movement convention), find
 * the NEAREST OTHER player that is on a different team, not downed/out, within FIRE_RANGE, and
 * inside the forward cone (dot(forward, unit dir-to-target) >= FIRE_CONE_DOT). Subtract
 * FIRE_DAMAGE from its health (clamp >=0); at 0 health, DOWN it (phase='downed', health=0,
 * downedUntilMs = now + REVIVE_WINDOW_MS). One shot hits at most one target.
 */
export function resolveFire(world: WorldState, shooterId: string, deps: SimDeps): void {
  const shooter = world.players.get(shooterId);
  if (!shooter || isIncapacitated(shooter)) return;

  const fwdX = Math.sin(shooter.yaw);
  const fwdZ = Math.cos(shooter.yaw);
  const rangeSq = FIRE_RANGE * FIRE_RANGE;

  let target: PlayerState | null = null;
  let targetDistSq = Infinity;

  for (const p of world.players.values()) {
    if (p === shooter) continue;
    if (p.team === shooter.team) continue; // no friendly fire
    if (isIncapacitated(p)) continue;

    const dx = p.pos.x - shooter.pos.x;
    const dz = p.pos.z - shooter.pos.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > rangeSq) continue; // out of range
    if (distSq === 0) continue; // exactly on top of the shooter — no defined direction

    const dist = Math.sqrt(distSq);
    const dot = (fwdX * dx + fwdZ * dz) / dist; // dot with the unit dir-to-target
    if (dot < FIRE_CONE_DOT) continue; // outside the forward cone

    if (distSq < targetDistSq) {
      target = p;
      targetDistSq = distSq;
    }
  }

  if (!target) return;

  target.health = Math.max(0, target.health - FIRE_DAMAGE);
  if (target.health === 0) {
    target.phase = 'downed';
    target.downedUntilMs = deps.clock.now() + REVIVE_WINDOW_MS;
  }
}

/**
 * `reviverId` attempts to revive downed teammate `targetId`. Succeeds when both exist, the
 * reviver is not downed/out, the target is 'downed', they share a team, and the target is
 * within REVIVE_RANGE (XZ) → revive: phase='blended', health=MAX_HEALTH, downedUntilMs=0.
 */
export function reviveTeammate(
  world: WorldState,
  reviverId: string,
  targetId: string,
  deps: SimDeps,
): boolean {
  void deps;
  if (reviverId === targetId) return false;
  const reviver = world.players.get(reviverId);
  const target = world.players.get(targetId);
  if (!reviver || !target) return false;
  if (isIncapacitated(reviver)) return false;
  if (target.phase !== 'downed') return false;
  if (reviver.team !== target.team) return false;
  if (xzDistSq(reviver, target) > REVIVE_RANGE * REVIVE_RANGE) return false;

  target.phase = 'blended';
  target.health = MAX_HEALTH;
  target.downedUntilMs = 0;
  return true;
}

/**
 * Per-tick combat upkeep. Any 'downed' player whose revive window has lapsed
 * (now >= downedUntilMs > 0) becomes 'out' (eliminated; downedUntilMs=0). Deterministic.
 */
export function stepCombat(world: WorldState, deps: SimDeps): void {
  const now = deps.clock.now();
  for (const p of world.players.values()) {
    if (p.phase === 'downed' && p.downedUntilMs > 0 && now >= p.downedUntilMs) {
      p.phase = 'out';
      p.downedUntilMs = 0;
    }
  }
}
