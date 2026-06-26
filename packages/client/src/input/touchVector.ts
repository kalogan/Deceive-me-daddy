// Pure joystick math: a thumb offset (dx, dy in pixels from the stick centre) + the stick
// radius -> a normalised movement reading. DOM-free so it's unit-testable in the node gate
// (PROJECT_BRIEF §4.6); the touch event plumbing lives in TouchControls.ts and feeds this.
//
// Screen axes: +dx is right, +dy is DOWN. The movement frame (mapInput.ts) is moveX = strafe
// (right = +1), moveZ = forward (+1) — so pushing the stick UP (negative dy) is forward.

/** A normalised reading of the movement stick. */
export interface JoystickReading {
  /** Strafe axis, -1..1 (right = +1). Maps straight to PlayerInput.moveX. */
  moveX: number;
  /** Forward axis, -1..1 (up = +1). Maps straight to PlayerInput.moveZ. */
  moveZ: number;
  /** Push magnitude 0..1 (clamped). */
  magnitude: number;
  /** True once pushed past the run threshold — push the stick to the rim to sprint. */
  running: boolean;
}

const ZERO: JoystickReading = { moveX: 0, moveZ: 0, magnitude: 0, running: false };

/** Below this push fraction the stick reads as centred (dead zone) — avoids drift. */
export const TOUCH_DEADZONE = 0.18;
/** At/above this push fraction the player runs. */
export const TOUCH_RUN_AT = 0.85;

/**
 * Convert a thumb offset (dx, dy px from centre) + stick `radius` into a JoystickReading.
 * Clamps the magnitude to the rim (so dragging past the edge caps at full speed), applies a
 * dead zone near centre, and flips the screen-down Y into forward-up. Degenerate radius → ZERO.
 */
export function joystickVector(dx: number, dy: number, radius: number): JoystickReading {
  if (!(radius > 0)) return ZERO;

  let nx = dx / radius;
  let nz = -dy / radius; // screen-down -> forward-up
  let mag = Math.hypot(nx, nz);

  if (mag <= TOUCH_DEADZONE) return ZERO;
  if (mag > 1) {
    nx /= mag;
    nz /= mag;
    mag = 1;
  }

  return { moveX: nx, moveZ: nz, magnitude: mag, running: mag >= TOUCH_RUN_AT };
}
