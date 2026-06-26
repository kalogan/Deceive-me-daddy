// Local-prediction movement for the client: integrates an input over dt from a starting
// position. Used by LocalMockSource (stand-in sim until the live server) and the client's
// light local prediction.
//
// IMPORTANT (PROJECT_BRIEF §4.2): this is COSMETIC on the client; it is never the source
// of truth. It reuses the SAME `inputToWorldVelocity` the authoritative server uses, so
// prediction and authority share one movement convention and don't rubber-band.
import type { PlayerInput } from '@deceive/shared';
import { inputSpeed, inputToWorldVelocity } from '@deceive/sim-core';
import type { Vec3 } from '../render/interpolate';

/**
 * Integrate one input over `dt` seconds from a starting position, returning the new
 * position. Movement is in the input's LOCAL frame (moveZ forward, moveX strafe) rotated
 * into world space by yaw — forward (moveZ=1) goes +Z at yaw=0 — matching the server.
 */
export function integrateMove(pos: Vec3, input: PlayerInput, dt: number): Vec3 {
  const vel = inputToWorldVelocity(input.moveX, input.moveZ, input.yaw, inputSpeed(input.running));
  return {
    x: pos.x + vel.x * dt,
    y: pos.y,
    z: pos.z + vel.z * dt,
  };
}
