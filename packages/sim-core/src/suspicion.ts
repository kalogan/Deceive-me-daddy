// The two-axis suspicion meter (Phase 2, PROJECT_BRIEF §2b). Authoritative + deterministic.
// Suspicion rises from (1) clearance mismatch (`inForbiddenZone`) and (2) behavioral tells
// (currently `isRunning`), scaled by the per-tier scrutiny floor (higher disguises draw
// more eyes); it bleeds off when acting normal. Crossing thresholds flips the player's
// phase between 'blended' and 'suspicious' (never overriding 'revealed'/'downed'/'out' —
// those are owned by detection/combat).
//
// SCAFFOLD: `stepSuspicion` is a STUB — the suspicion builder fills it against this seam.
import {
  SUSPICION_BLENDED_AT,
  SUSPICION_DECAY,
  SUSPICION_MAX,
  SUSPICION_RISE_FORBIDDEN,
  SUSPICION_RISE_RUNNING,
  SUSPICION_SUSPICIOUS_AT,
  TIER_SCRUTINY,
} from '@deceive/shared';
import type { SimDeps, WorldState } from './world';

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * Advance every player's suspicion meter one tick and update 'blended'<->'suspicious'.
 *
 * Rise is driven by the two axes: clearance mismatch (`inForbiddenZone`, set by zones) and
 * behavioral tells (`isRunning`). Each contributing rate is summed, then the whole RISE is
 * scaled by `TIER_SCRUTINY[disguiseTier]` — rarer/higher disguises draw more eyes, so they
 * accrue suspicion faster for the same behavior. When nothing is suspicious this tick the
 * meter instead DECAYS at a flat `SUSPICION_DECAY`/sec, bleeding back toward 0.
 *
 * Phase hysteresis flips only between 'blended' and 'suspicious' (two thresholds so the meter
 * doesn't chatter at a single line); 'revealed'/'downed'/'out' are owned by detection/combat
 * and never touched here. Deterministic: no wall-clock, no Math.random — only `dtMs`.
 */
export function stepSuspicion(world: WorldState, _deps: SimDeps, dtMs: number): void {
  const dt = dtMs / 1000;

  for (const p of world.players.values()) {
    // Eliminated players carry no suspicion bookkeeping.
    if (p.phase === 'downed' || p.phase === 'out') continue;

    // Sum the per-second rise from both axes, then scale by the tier scrutiny floor.
    let rise = 0;
    if (p.inForbiddenZone) rise += SUSPICION_RISE_FORBIDDEN;
    if (p.isRunning) rise += SUSPICION_RISE_RUNNING;
    rise *= TIER_SCRUTINY[p.disguiseTier];

    // Rise when there's a tell this tick; otherwise bleed off toward 0.
    const rate = rise > 0 ? rise : -SUSPICION_DECAY;
    p.suspicion = clamp(p.suspicion + rate * dt, 0, SUSPICION_MAX);

    // Two-threshold hysteresis; only the blended<->suspicious pair is ours to flip.
    if (p.phase === 'blended' && p.suspicion >= SUSPICION_SUSPICIOUS_AT) {
      p.phase = 'suspicious';
    } else if (p.phase === 'suspicious' && p.suspicion <= SUSPICION_BLENDED_AT) {
      p.phase = 'blended';
    }
  }
}
