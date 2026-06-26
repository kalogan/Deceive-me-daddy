// THE canonical movement convention (PROJECT_BRIEF §4.2/§4.3). Lives in the deterministic
// core so the authoritative server AND the client's local prediction share ONE definition
// and can never diverge. (They diverged once — the server treated inputs as world-frame
// while the client treated them as camera-local — which would rubber-band on wiring. This
// helper is the single source of truth that prevents that.)
import { RUN_SPEED, WALK_SPEED } from '@deceive/shared';

export interface PlanarVelocity {
  x: number;
  z: number;
}

/** Speed for a movement input: running is faster (and a suspicious act, scored elsewhere). */
export function inputSpeed(running: boolean): number {
  return running ? RUN_SPEED : WALK_SPEED;
}

/**
 * Convert a movement input into a world-space planar velocity.
 *
 * `moveX`/`moveZ` are in the player's LOCAL (camera) frame: moveZ = forward, moveX =
 * strafe-right. The vector is sanitized (NaN/Infinity -> 0), clamped to magnitude 1 (no
 * diagonal or over-stick speed boost), rotated by `yaw` into world space, then scaled to
 * `speed`. Forward (moveZ=1) points along +Z at yaw=0, and along +X at yaw=pi/2.
 */
export function inputToWorldVelocity(
  moveX: number,
  moveZ: number,
  yaw: number,
  speed: number,
): PlanarVelocity {
  const rawX = Number.isFinite(moveX) ? moveX : 0;
  const rawZ = Number.isFinite(moveZ) ? moveZ : 0;

  const mag = Math.hypot(rawX, rawZ);
  if (mag <= 1e-6) return { x: 0, z: 0 };

  const clamp = Math.min(mag, 1) / mag; // clamp magnitude into [0,1]
  const lx = rawX * clamp;
  const lz = rawZ * clamp;

  const y = Number.isFinite(yaw) ? yaw : 0;
  const sin = Math.sin(y);
  const cos = Math.cos(y);
  // local -> world rotation (matches the client camera convention).
  const wx = lx * cos + lz * sin;
  const wz = -lx * sin + lz * cos;

  return { x: wx * speed, z: wz * speed };
}
