// Combat + downed/revive (Phase 2, PROJECT_BRIEF §2b). Authoritative + deterministic.
// Firing is a hitscan: a shot from the shooter along their yaw hits the nearest player in a
// forward cone within range, dealing damage. At 0 health a player is DOWNED (revivable by a
// teammate for a window, else eliminated 'out'). All server-side; the client only requests.
import {
  AGENTS_BY_ID,
  CHAVEZ_REGEN_PER_SEC,
  FIRE_CONE_DOT,
  FIRE_DAMAGE,
  FIRE_RANGE,
  MAX_HEALTH,
  REVIVE_RANGE,
  REVIVE_WINDOW_MS,
  TICK_MS,
} from '@deceive/shared';
import { isCloaked, isInvulnerable } from './ability';
import { hardReveal } from './detection';
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
 * True if `player` may fire at sim time `now` — the per-weapon fire-rate gate. The fire path
 * (server) calls this BEFORE resolving a shot and, on a pass, arms `nextFireAtMs` via
 * `armFire`. Authoritative source of truth for rate of fire (the client FireGate is a
 * cosmetic input throttle only).
 */
export function canFire(player: PlayerState, now: number): boolean {
  if (isIncapacitated(player)) return false;
  return now >= player.nextFireAtMs;
}

/**
 * Arm the player's fire-rate gate after a shot: they may not fire again until
 * now + their weapon's fireCooldownMs (data-driven per agent; falls back to a default gap if
 * the weapon stat is ever missing).
 */
export function armFire(player: PlayerState, now: number): void {
  const weapon = AGENTS_BY_ID[player.agentId]?.weaponStats;
  const cooldownMs = weapon?.fireCooldownMs ?? FIRE_RATE_FALLBACK_MS;
  player.nextFireAtMs = now + cooldownMs;
}

/** Fallback fire-rate gap (ms) if an agent's weaponStats are ever missing. */
const FIRE_RATE_FALLBACK_MS = 250;

/**
 * Resolve a shot fired by `shooterId` (already hard-revealed by the fire handler). From the
 * shooter's pos along their yaw (forward = (sin,cos) on XZ — the movement convention), find
 * the NEAREST OTHER player that is on a different team, not downed/out, within the shooter's
 * weapon RANGE, and inside the forward cone (dot(forward, unit dir-to-target) >= FIRE_CONE_DOT).
 * Subtract the shooter's weapon DAMAGE from its health (clamp >=0); at 0 health, DOWN it
 * (phase='downed', health=0, downedUntilMs = now + REVIVE_WINDOW_MS). One shot hits at most one
 * target. Damage + range are per-agent (AGENTS_BY_ID[...].weaponStats), so each agent shoots
 * differently; the global FIRE_DAMAGE/FIRE_RANGE constants are the fallback if ever missing.
 * (The fire-RATE is enforced separately/authoritatively by the fire path via canFire/armFire.)
 */
export function resolveFire(world: WorldState, shooterId: string, deps: SimDeps): void {
  const shooter = world.players.get(shooterId);
  if (!shooter || isIncapacitated(shooter)) return;

  const now = deps.clock.now();
  // Per-agent weapon depth (data-driven): the shooter's own damage/range. Fall back to the
  // global constants if the weapon stat is ever missing, so an unknown agent still shoots.
  const weapon = AGENTS_BY_ID[shooter.agentId]?.weaponStats;
  const damage = weapon?.damage ?? FIRE_DAMAGE;
  const range = weapon?.range ?? FIRE_RANGE;
  const fwdX = Math.sin(shooter.yaw);
  const fwdZ = Math.cos(shooter.yaw);
  const rangeSq = range * range;

  let target: PlayerState | null = null;
  let targetDistSq = Infinity;

  for (const p of world.players.values()) {
    if (p === shooter) continue;
    if (p.team === shooter.team) continue; // no friendly fire
    if (isIncapacitated(p)) continue;
    // Untargetable while protected by an Expertise: Chavez's Hard Boiled (invulnerable) or
    // Larcin's Adieu (cloaked — can't be seen or hit).
    if (isInvulnerable(p, now) || isCloaked(p, now)) continue;

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

  target.health = Math.max(0, target.health - damage);
  // A landed, damaging hit — bump the shooter's hit counter so their client flashes a hitmarker.
  shooter.hitSeq += 1;

  // Squire's "Sixth Sense" passive: a Squire that gets hit instinctively traces the source —
  // their assailant's cover is blown to EVERYONE. The shooter is already hard-revealed by the
  // fire handler, but only briefly; refreshing the window here keeps the trace live and makes
  // the intent explicit. We reveal on any landed hit (damage applied), down or not.
  if (target.agentId === 'squire') {
    hardReveal(world, shooterId, deps);
  }

  if (target.health === 0) {
    target.phase = 'downed';
    target.downedUntilMs = deps.clock.now() + REVIVE_WINDOW_MS;
    // The shot DOWNED the target — bump the shooter's down counter for the stronger kill hitmarker.
    shooter.downSeq += 1;
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
 * Per-tick combat upkeep. Two jobs, both deterministic (time via deps.clock; the heal rate
 * scales by the explicit `dtMs`, defaulting to one fixed tick so the existing call site in
 * step() needs no change):
 *  1. Any 'downed' player whose revive window has lapsed (now >= downedUntilMs > 0) becomes
 *     'out' (eliminated; downedUntilMs=0).
 *  2. Chavez's "Tough Luck" passive: while a living Chavez is below MAX_HEALTH he steadily
 *     regenerates CHAVEZ_REGEN_PER_SEC health per second, clamped at MAX_HEALTH. This is a
 *     flat trickle with NO damage-delay tracking — so it needs no new PlayerState field. Only
 *     applies to actionable (not downed/out) players, so a downed Chavez can't self-revive.
 */
export function stepCombat(world: WorldState, deps: SimDeps, dtMs: number = TICK_MS): void {
  const now = deps.clock.now();
  const dt = dtMs / 1000;
  for (const p of world.players.values()) {
    if (p.phase === 'downed' && p.downedUntilMs > 0 && now >= p.downedUntilMs) {
      p.phase = 'out';
      p.downedUntilMs = 0;
    }

    // Chavez self-heal: alive (not downed/out) and hurt → trickle health back, clamped.
    if (
      p.agentId === 'chavez' &&
      p.phase !== 'downed' &&
      p.phase !== 'out' &&
      p.health < MAX_HEALTH
    ) {
      p.health = Math.min(MAX_HEALTH, p.health + CHAVEZ_REGEN_PER_SEC * dt);
    }
  }
}
