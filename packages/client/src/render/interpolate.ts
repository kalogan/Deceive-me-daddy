// Pure interpolation math for the renderer. Kept free of Three.js / DOM so it is unit
// testable in the node-env gate (PROJECT_BRIEF §4.6) and reusable by WorldView.
//
// Authority note (PROJECT_BRIEF §3/§4.2): the server is authoritative for every
// player's true position. These helpers only smooth the COSMETIC presentation of that
// authoritative state — remote players are eased toward their latest snapshot, and the
// local player is nudged by light prediction. Neither is ever treated as truth.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Standard scalar lerp. t is clamped to [0,1]. */
export function lerp(a: number, b: number, t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return a + (b - a) * c;
}

/** Component-wise lerp, writing into `out` to avoid allocations in the render loop. */
export function lerpVec3(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  out.x = lerp(a.x, b.x, t);
  out.y = lerp(a.y, b.y, t);
  out.z = lerp(a.z, b.z, t);
  return out;
}

/** Shortest signed angular difference b-a, wrapped to (-pi, pi]. */
export function angleDelta(a: number, b: number): number {
  const TWO_PI = Math.PI * 2;
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d <= -Math.PI) d += TWO_PI;
  return d;
}

/** Lerp between two angles along the shortest arc (radians). */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * (t < 0 ? 0 : t > 1 ? 1 : t);
}

/**
 * Frame-rate-independent smoothing factor for an exponential approach.
 * `rate` is the fraction of the gap closed per second (higher = snappier). `dt` is the
 * frame delta in seconds. Returns a t suitable for lerp/lerpVec3/lerpAngle.
 *
 * Using 1 - (1-rate)^(dt*60) normalises `rate` to a per-(1/60s)-frame feel so the smooth
 * keeps the same character regardless of the actual frame rate.
 */
export function smoothingFactor(rate: number, dt: number): number {
  const r = rate < 0 ? 0 : rate > 1 ? 1 : rate;
  if (dt <= 0) return 0;
  return 1 - Math.pow(1 - r, dt * 60);
}
