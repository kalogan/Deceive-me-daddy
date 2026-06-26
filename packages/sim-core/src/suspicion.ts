// The two-axis suspicion meter (Phase 2, PROJECT_BRIEF §2b). Authoritative + deterministic.
// Suspicion rises from (1) clearance mismatch (`inForbiddenZone`) and (2) behavioral tells
// (currently `isRunning`), scaled by the per-tier scrutiny floor (higher disguises draw
// more eyes); it bleeds off when acting normal. Crossing thresholds flips the player's
// phase between 'blended' and 'suspicious' (never overriding 'revealed'/'downed'/'out' —
// those are owned by detection/combat).
//
// SCAFFOLD: `stepSuspicion` is a STUB — the suspicion builder fills it against this seam.
import type { SimDeps, WorldState } from './world';

/**
 * Advance every player's suspicion meter one tick and update 'blended'<->'suspicious'.
 * STUB — filled by the suspicion builder. Determinism: no Math.random/Date.now; use dtMs.
 * Use SUSPICION_* constants + TIER_SCRUTINY from @deceive/shared; clamp to [0, SUSPICION_MAX].
 */
export function stepSuspicion(world: WorldState, deps: SimDeps, dtMs: number): void {
  void world;
  void deps;
  void dtMs;
}
