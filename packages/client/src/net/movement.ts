// Pure movement integration shared by the LocalMockSource (which stands in for the
// authoritative sim until the server slice) and the client's light local prediction.
//
// IMPORTANT (PROJECT_BRIEF §4.2): this is COSMETIC on the client. The real authoritative
// integration lives in sim-core/server. We mirror its shape here only so the standalone
// scene is alive and so local prediction can nudge the local avatar between snapshots —
// it is never the source of truth.
import { RUN_SPEED, WALK_SPEED, type PlayerInput } from '@deceive/shared';
import type { Vec3 } from '../render/interpolate';

/**
 * Integrate one input over `dt` seconds from a starting position/yaw, returning the new
 * position. Movement is in the input's LOCAL frame (moveZ forward, moveX strafe) rotated
 * into world space by the input yaw — matching mapKeysToInput's contract.
 */
export function integrateMove(pos: Vec3, input: PlayerInput, dt: number): Vec3 {
  const speed = input.running ? RUN_SPEED : WALK_SPEED;

  // Rotate the local move vector by yaw into world space. Forward (+Z local) points
  // along -worldZ when yaw = 0, matching a camera looking down -Z.
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  const worldX = input.moveX * cos + input.moveZ * sin;
  const worldZ = -input.moveX * sin + input.moveZ * cos;

  return {
    x: pos.x + worldX * speed * dt,
    y: pos.y,
    z: pos.z + worldZ * speed * dt,
  };
}
