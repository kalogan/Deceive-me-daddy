// Pure input mapping: a snapshot of held keys + look yaw -> a PlayerInput. Kept free of
// the DOM so it is unit testable in the node-env gate (PROJECT_BRIEF §4.6). The DOM
// event plumbing lives in Input.ts and feeds this.
//
// The server is authoritative (PROJECT_BRIEF §4.2): a PlayerInput is a REQUEST for a
// tick, not a movement the client applies as truth.
import type { PlayerInput } from '@deceive/shared';

/** The set of control keys we read, normalised away from raw key codes. */
export interface KeyState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  running: boolean;
  jumping: boolean;
}

export function emptyKeyState(): KeyState {
  return {
    forward: false,
    back: false,
    left: false,
    right: false,
    running: false,
    jumping: false,
  };
}

/**
 * Map held keys + the current look yaw into a normalised PlayerInput for one tick.
 *
 * Movement is expressed in the player's LOCAL frame: moveZ = forward axis (W = +1),
 * moveX = strafe axis (D = +1). A diagonal is normalised to unit length so diagonal
 * movement isn't faster than cardinal. The consumer (sim) rotates this by yaw into
 * world space — keeping the wire input frame-agnostic of the renderer.
 */
export function mapKeysToInput(keys: KeyState, yaw: number, seq: number): PlayerInput {
  let moveX = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  let moveZ = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);

  const len = Math.hypot(moveX, moveZ);
  if (len > 1) {
    moveX /= len;
    moveZ /= len;
  }

  return {
    seq,
    moveX,
    moveZ,
    yaw,
    running: keys.running && (moveX !== 0 || moveZ !== 0),
    jumping: keys.jumping,
  };
}
