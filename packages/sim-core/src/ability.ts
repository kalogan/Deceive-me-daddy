// Signature Expertises (PROJECT_BRIEF §2 — the agents slice). Each playable agent has ONE
// active "Expertise" that, when triggered, runs for a window then goes on cooldown. All
// authoritative + deterministic (time via deps.clock; no Math.random / Date.now).
//
// The THREE Expertises map onto three existing systems, so this module owns only the timing
// framework + the per-agent EFFECT PREDICATES; the systems read those predicates:
//   - Larcin "Adieu"          → isCloaked      → combat skips them, detection skips them,
//                                                 the client hides/dims them.
//   - Chavez "Hard Boiled"    → isInvulnerable → combat skips them (no damage).
//   - Squire "Eyes on the Prize" → (no sim effect) → the client highlights nearby objectives
//                                                     while abilityActive (recon, render-only).
import { AGENTS_BY_ID } from '@deceive/shared';
import type { PlayerState, SimDeps, WorldState } from './world';

/** A player can act/trigger an Expertise only while up (not downed/eliminated). */
function isActionable(p: PlayerState): boolean {
  return p.phase !== 'downed' && p.phase !== 'out';
}

/** True while the player's Expertise is currently active. */
export function isAbilityActive(p: PlayerState, now: number): boolean {
  return p.abilityActiveUntilMs > now;
}

/** Ms until the Expertise is ready again (0 = ready now). */
export function abilityCooldownRemaining(p: PlayerState, now: number): number {
  return Math.max(0, p.abilityReadyAtMs - now);
}

/** True if the Expertise can be triggered right now (actionable + off cooldown). */
export function isAbilityReady(p: PlayerState, now: number): boolean {
  return isActionable(p) && now >= p.abilityReadyAtMs;
}

/** Larcin's Adieu: cloaked — unseen by rivals, untargetable, undetectable — while active. */
export function isCloaked(p: PlayerState, now: number): boolean {
  return p.agentId === 'larcin' && isAbilityActive(p, now);
}

/** Chavez's Hard Boiled: invulnerable — takes no damage — while active. */
export function isInvulnerable(p: PlayerState, now: number): boolean {
  return p.agentId === 'chavez' && isAbilityActive(p, now);
}

/**
 * Trigger `playerId`'s signature Expertise. No-op (returns false) if the player is missing,
 * not actionable, or still on cooldown. On success: arms the active window
 * (now + abilityDurationMs) and the cooldown (ready at now + abilityCooldownMs), and returns
 * true. Durations/cooldowns come from the agent's catalog entry (data-driven).
 */
export function triggerAbility(world: WorldState, playerId: string, deps: SimDeps): boolean {
  const player = world.players.get(playerId);
  if (!player) return false;
  const now = deps.clock.now();
  if (!isAbilityReady(player, now)) return false;

  const agent = AGENTS_BY_ID[player.agentId];
  player.abilityActiveUntilMs = now + agent.abilityDurationMs;
  player.abilityReadyAtMs = now + agent.abilityCooldownMs;
  return true;
}

/**
 * End any active Expertise on `player` immediately (e.g. firing/grabbing breaks Adieu's
 * cloak). Leaves the cooldown untouched — the ability still has to recharge. Idempotent.
 */
export function endAbility(player: PlayerState): void {
  player.abilityActiveUntilMs = 0;
}

/**
 * Per-tick Expertise upkeep: expire any active window that has lapsed (now >= until). The
 * cooldown timer (abilityReadyAtMs) is read lazily by isAbilityReady, so nothing to do for
 * it here. Deterministic.
 */
export function stepAbility(world: WorldState, deps: SimDeps): void {
  const now = deps.clock.now();
  for (const p of world.players.values()) {
    if (p.abilityActiveUntilMs > 0 && now >= p.abilityActiveUntilMs) {
      p.abilityActiveUntilMs = 0;
    }
  }
}
