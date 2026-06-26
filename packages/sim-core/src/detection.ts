// Detection + hard-reveal (Phase 2, PROJECT_BRIEF §2b). Authoritative + deterministic.
// Two ways cover breaks: the suspicion meter MAXING OUT (slow burn), or a HARD REVEAL — an
// instant cover-blow from firing a weapon or grabbing the objective. A revealed player is
// flagged ('revealed' phase) to everyone for REVEAL_WINDOW_MS, then reverts.
//
// SCAFFOLD: `stepDetection` + `hardReveal` are STUBS — the detection builder fills them.
import type { SimDeps, WorldState } from './world';

/**
 * Force a player into hard-revealed state right now (cover blown). STUB — filled by the
 * detection builder. The seam: if the player exists and isn't 'downed'/'out', set
 * phase='revealed' and revealedUntilMs = deps.clock.now() + REVEAL_WINDOW_MS.
 */
export function hardReveal(world: WorldState, playerId: string, deps: SimDeps): void {
  void world;
  void playerId;
  void deps;
}

/**
 * Per-tick detection. STUB — filled by the detection builder. The seam:
 * - if suspicion >= SUSPICION_MAX → trigger a hard reveal (slow-burn blow).
 * - if a player is 'revealed' and now >= revealedUntilMs → the window lapsed: clear it
 *   (revealedUntilMs=0) and revert phase to 'suspicious' or 'blended' per current suspicion.
 * Never touches 'downed'/'out'. Deterministic: time via deps.clock, no Math.random.
 */
export function stepDetection(world: WorldState, deps: SimDeps): void {
  void world;
  void deps;
}
