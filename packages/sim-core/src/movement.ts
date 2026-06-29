// THE canonical movement convention (PROJECT_BRIEF §4.2/§4.3). Lives in the deterministic
// core so the authoritative server AND the client's local prediction share ONE definition
// and can never diverge. (They diverged once — the server treated inputs as world-frame
// while the client treated them as camera-local — which would rubber-band on wiring. This
// helper is the single source of truth that prevents that.)
import {
  DEFAULT_FLOOR_HEIGHT,
  RUN_SPEED,
  WALK_SPEED,
  connectorGroundY,
  floorBaseY,
  type Connector,
} from '@deceive/shared';

export interface PlanarVelocity {
  x: number;
  z: number;
}

export interface GroundInfo {
  /** Walkable Y at the queried point. */
  groundY: number;
  /** True when the point sits on a connector (stairs/ramp/vent), i.e. mid-transition. */
  onConnector: boolean;
}

/**
 * The walkable ground height at (x,z) for an actor currently on `floor` — the multi-floor
 * replacement for the old flat `y < 0 → 0` clamp. PURE + deterministic so the server, the offline
 * sim, and the client's local prediction all agree on where the ground is. If the point lies on a
 * connector that touches this floor, the ground is the connector's interpolated slope height (so you
 * ride up/down stairs/ramps); otherwise it's the floor's flat slab. Only connectors that touch
 * `floor` are considered, so a stairwell elsewhere in the building can't teleport you.
 */
export function groundHeightAt(
  x: number,
  z: number,
  floor: number,
  connectors: readonly Connector[],
  floorHeight: number = DEFAULT_FLOOR_HEIGHT,
): GroundInfo {
  for (const c of connectors) {
    if (c.fromFloor !== floor && c.toFloor !== floor) continue; // not reachable from this floor
    const y = connectorGroundY(c, x, z, floorHeight);
    if (y !== null) return { groundY: y, onConnector: true };
  }
  return { groundY: floorBaseY(floor, floorHeight), onConnector: false };
}

/** Max vertical metres a walker may RISE in one tick onto a connector — so stepping onto the side of
 * a ramp eases you up the slope over a few ticks instead of teleporting to mid-ramp height. */
export const MAX_CLIMB_PER_TICK = 0.35;

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
 *
 * Strafe handedness: the third-person camera sits BEHIND the avatar looking along its
 * forward, so SCREEN-right is world -X at yaw=0. Strafe-right (moveX=1) therefore maps to
 * world -X — the strafe basis is negated vs a naive rotation (a naive +X strafed you LEFT).
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
  // local -> world rotation, with the strafe basis NEGATED so screen-right (moveX=1) goes the
  // right way under the behind-the-avatar camera (see the handedness note above).
  const wx = -lx * cos + lz * sin;
  const wz = lx * sin + lz * cos;

  return { x: wx * speed, z: wz * speed };
}
