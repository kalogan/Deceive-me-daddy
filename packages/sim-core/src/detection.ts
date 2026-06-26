// Detection + hard-reveal (Phase 2, PROJECT_BRIEF §2b). Authoritative + deterministic.
// Two ways cover breaks: the suspicion meter MAXING OUT (slow burn), or a HARD REVEAL — an
// instant cover-blow from firing a weapon or grabbing the objective. A revealed player is
// flagged ('revealed' phase) to everyone for REVEAL_WINDOW_MS, then reverts.
//
// SCAFFOLD: `stepDetection` + `hardReveal` are STUBS — the detection builder fills them.
import { REVEAL_WINDOW_MS, SUSPICION_MAX, SUSPICION_SUSPICIOUS_AT } from '@deceive/shared';
import type { PlayerState, SimDeps, WorldState } from './world';

/**
 * The single reveal effect, shared by `hardReveal` and the slow-burn blow in
 * `stepDetection` so the cover-blow logic lives in exactly one place. Flags the player
 * as 'revealed' and (re)arms the reveal window from the current sim time — calling it
 * again simply extends the window. Caller guarantees the player is reveal-eligible
 * (not 'downed'/'out').
 */
function applyReveal(player: PlayerState, deps: SimDeps): void {
  player.phase = 'revealed';
  player.revealedUntilMs = deps.clock.now() + REVEAL_WINDOW_MS;
}

/** A player is reveal-eligible unless they're already out of the round ('downed'/'out'). */
function isRevealEligible(player: PlayerState): boolean {
  return player.phase !== 'downed' && player.phase !== 'out';
}

/**
 * Force a player into hard-revealed state right now (cover blown — firing a weapon or
 * grabbing the objective). If the player is missing or already 'downed'/'out', it's a
 * no-op. Otherwise sets phase='revealed' and arms revealedUntilMs = now + REVEAL_WINDOW_MS.
 * Idempotent/refreshing: calling it again extends the window from the current time.
 */
export function hardReveal(world: WorldState, playerId: string, deps: SimDeps): void {
  const player = world.players.get(playerId);
  if (!player || !isRevealEligible(player)) return;
  applyReveal(player, deps);
}

/**
 * Per-tick detection. For each player (skipping 'downed'/'out'):
 * - SLOW-BURN BLOW: suspicion >= SUSPICION_MAX and not already revealed → hard-reveal
 *   them (same effect as `hardReveal`, via `applyReveal`).
 * - WINDOW EXPIRY: if 'revealed' and the window has lapsed (now >= revealedUntilMs > 0),
 *   clear it (revealedUntilMs=0) and revert phase to 'suspicious' if suspicion is still
 *   high (>= SUSPICION_SUSPICIOUS_AT), else 'blended'. A still-maxed player re-reveals on
 *   the next tick — intended.
 * Deterministic: time via deps.clock, no Math.random / Date.now.
 */
export function stepDetection(world: WorldState, deps: SimDeps): void {
  const now = deps.clock.now();
  for (const player of world.players.values()) {
    if (!isRevealEligible(player)) continue;

    if (player.phase !== 'revealed') {
      if (player.suspicion >= SUSPICION_MAX) applyReveal(player, deps);
      continue;
    }

    // phase === 'revealed': check whether the reveal window has lapsed.
    if (player.revealedUntilMs > 0 && now >= player.revealedUntilMs) {
      player.revealedUntilMs = 0;
      player.phase = player.suspicion >= SUSPICION_SUSPICIOUS_AT ? 'suspicious' : 'blended';
    }
  }
}
