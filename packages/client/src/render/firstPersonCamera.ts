// First-person camera rig — the SHARED math the live game (main.ts) and the preview's
// First-Person stage both mount, so the preview is production-truthful (PREVIEW_HARNESS.md:
// reuse, never fork). Pure + Three-free so it unit-tests in the node-env gate; the only
// side-effectful piece (applyFirstPersonCamera) writes through a tiny CameraLike interface,
// so it needs no real WebGL camera to exercise.
//
// Frame convention (matches sim-core movement.ts): forward at yaw θ is (sin θ, 0, cos θ).
// PITCH is COSMETIC ONLY (Director decision) — it tilts the VIEW up/down but never goes on
// the wire and never feeds aim; the server's hitscan stays planar from yaw. So nothing here
// touches the authoritative contract.

/** Plain XYZ — avoids importing THREE into the pure path. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Camera eye height above the player's ground position, in metres (~average human eye). */
export const EYE_HEIGHT = 1.62;

/** Pitch clamp (radians) — ~80° up/down so you can never roll the view past vertical. */
export const MAX_PITCH = 1.4;

/** Clamp a raw accumulated pitch to the legal look range. */
export function clampPitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return 0;
  return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
}

/** The eye point + look target + unit look direction for a first-person view. */
export interface FirstPersonView {
  /** Camera position: the player's ground position lifted to eye height. */
  eye: Vec3;
  /** A point one metre along the look direction — feed straight to camera.lookAt. */
  target: Vec3;
  /** Unit look direction (yaw + pitch applied). */
  dir: Vec3;
}

/**
 * Resolve the first-person eye + look target from the player's ground position, look `yaw`,
 * and cosmetic `pitch`. PURE. Forward at (yaw=0, pitch=0) is +Z (matching movement.ts), look
 * up is +pitch (+Y). `pitch` is clamped defensively so a caller passing a raw accumulator
 * can't tip the view over.
 */
export function firstPersonView(
  pos: Vec3,
  yaw: number,
  pitch: number,
  eyeHeight: number = EYE_HEIGHT,
): FirstPersonView {
  const p = clampPitch(pitch);
  const cp = Math.cos(p);
  const eye: Vec3 = { x: pos.x, y: pos.y + eyeHeight, z: pos.z };
  const dir: Vec3 = { x: Math.sin(yaw) * cp, y: Math.sin(p), z: Math.cos(yaw) * cp };
  const target: Vec3 = { x: eye.x + dir.x, y: eye.y + dir.y, z: eye.z + dir.z };
  return { eye, target, dir };
}

/** The minimal camera surface applyFirstPersonCamera writes — a real THREE camera satisfies it. */
export interface CameraLike {
  position: { set(x: number, y: number, z: number): void };
  lookAt(x: number, y: number, z: number): void;
}

/**
 * Position + aim a camera in first person. Thin side-effectful wrapper over firstPersonView —
 * keeps the math in one tested place. Returns the resolved view so callers can reuse the eye/
 * dir (e.g. to lock a viewmodel in front of the camera) without recomputing.
 */
export function applyFirstPersonCamera(
  camera: CameraLike,
  pos: Vec3,
  yaw: number,
  pitch: number,
  eyeHeight: number = EYE_HEIGHT,
): FirstPersonView {
  const view = firstPersonView(pos, yaw, pitch, eyeHeight);
  camera.position.set(view.eye.x, view.eye.y, view.eye.z);
  camera.lookAt(view.target.x, view.target.y, view.target.z);
  return view;
}

/** 8-point compass letters, clockwise from North. */
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/**
 * Compass bearing (0..359°) for a look `yaw`. PURE + display-only — drives the HUD compass,
 * not gameplay. yaw=0 reads as North (0°); turning RIGHT (the input decreases yaw) increases
 * the bearing clockwise, like a real compass.
 */
export function headingDeg(yaw: number): number {
  if (!Number.isFinite(yaw)) return 0;
  let deg = (-yaw * 180) / Math.PI;
  deg %= 360;
  if (deg < 0) deg += 360;
  // `% 360` can yield -0 for exact multiples of a full turn; `+ 0` normalises it to +0.
  return (Math.round(deg) % 360) + 0;
}

/** The 8-point cardinal letter (N/NE/E/…) nearest a compass bearing in degrees. */
export function cardinal(deg: number): string {
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return CARDINALS[idx]!;
}
