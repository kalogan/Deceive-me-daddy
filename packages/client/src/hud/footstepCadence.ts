// PURE, DOM-free helper for FOOTSTEP timing. main.ts measures the local player's planar
// speed each frame; this decides the interval between footstep ticks (faster when running)
// and whether a step is due, so the audio doesn't spam every frame. No audio / DOM here —
// just the cadence math, unit-tested in the gate.

/** Below this planar speed (m/s) the player is considered standing still — no footsteps. */
const MIN_SPEED = 0.4;
/** Seconds between steps at a slow walk (just above MIN_SPEED). */
const SLOW_INTERVAL = 0.55;
/** Seconds between steps at a full run — the floor of the interval (steps never get faster). */
const FAST_INTERVAL = 0.28;
/** Speed (m/s) at or above which we use FAST_INTERVAL (a full sprint). */
const FAST_SPEED = 6;

/**
 * The seconds between footsteps for a given planar speed. PURE.
 *
 * Returns Infinity below MIN_SPEED (standing still → no steps). Between MIN_SPEED and
 * FAST_SPEED the interval eases linearly from SLOW_INTERVAL down to FAST_INTERVAL; at/above
 * FAST_SPEED it stays at FAST_INTERVAL. So a faster player steps more often, but never below
 * the floor (which would buzz).
 */
export function footstepInterval(speed: number): number {
  if (!(speed >= MIN_SPEED)) return Infinity; // also catches NaN / negative.
  const t = Math.min(1, (speed - MIN_SPEED) / (FAST_SPEED - MIN_SPEED));
  return SLOW_INTERVAL + (FAST_INTERVAL - SLOW_INTERVAL) * t;
}

/**
 * Decide whether a footstep is DUE this frame, given the seconds elapsed since the last step
 * and the current planar speed. PURE.
 *
 * Returns true once `sinceLastStep` has reached the speed-derived interval (and the player is
 * actually moving). The caller resets its accumulator to 0 on a true result. Standing still
 * (interval Infinity) never fires.
 */
export function footstepDue(sinceLastStep: number, speed: number): boolean {
  const interval = footstepInterval(speed);
  return Number.isFinite(interval) && sinceLastStep >= interval;
}
