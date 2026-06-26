// PURE, DOM-free model for the OBJECTIVE WAYPOINT — the directional indicator that points the
// local player at whatever they should do NEXT in the heist loop. This module owns only the
// decision of WHICH world position to point at (and a bearing helper); the screen-space arrow
// render lives in Waypoint.ts (the DOM component, not imported by any test).
//
// Authority (PROJECT_BRIEF §3/§4.2): reads only the snapshot + the authored pack. No truth.
import type {
  ContentPack,
  NetObjectiveState,
  NetPlayerState,
  Vec3Tuple,
} from '@deceive/shared';

/** A chosen waypoint target: a world position plus a short label + kind for the HUD. */
export interface WaypointTarget {
  kind: 'intel' | 'package' | 'extract';
  /** World X/Z to point the player toward. */
  x: number;
  z: number;
  /** Short label for the arrow, e.g. 'Intel' / 'Package' / 'Extract'. */
  label: string;
}

/** Squared XZ distance — avoids a sqrt for nearest-of comparisons. */
function distSqXZ(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/** Nearest position (by XZ) from a list, relative to (px, pz), or null if the list is empty. */
function nearest(px: number, pz: number, points: readonly Vec3Tuple[]): Vec3Tuple | null {
  let best: Vec3Tuple | null = null;
  let bestSq = Infinity;
  for (const p of points) {
    const d = distSqXZ(px, pz, p[0], p[2]);
    if (d < bestSq) {
      bestSq = d;
      best = p;
    }
  }
  return best;
}

/**
 * Pick the world position the waypoint should point at, following the heist loop. PURE.
 *
 * Priority (matches the objective gating in PROJECT_BRIEF §2):
 *   1. Local player is CARRYING the package → the nearest EXTRACTION point (get out!).
 *   2. Vault OPEN and the package is LOOSE (no holder) → the package world position (grab it).
 *   3. Otherwise (vault still locked, or package already held by someone else) → the nearest
 *      INTEL node (gather intel to open the vault).
 *
 * Returns null when there's nothing meaningful to point at (no pack, or the only candidate
 * class is empty — e.g. no intel nodes authored and the vault isn't open yet).
 */
export function pickWaypointTarget(
  player: NetPlayerState,
  objective: NetObjectiveState,
  pack: ContentPack | null,
): WaypointTarget | null {
  // 1) Carrying → nearest extraction point.
  if (player.carrying) {
    const ep = pack ? nearest(player.x, player.z, pack.objective.extractionPoints) : null;
    if (ep) return { kind: 'extract', x: ep[0], z: ep[2], label: 'Extract' };
    return null;
  }

  // 2) Vault open + package loose → the package itself.
  if (objective.vaultOpen && objective.packageHolderId === '') {
    return { kind: 'package', x: objective.packageX, z: objective.packageZ, label: 'Package' };
  }

  // 3) Otherwise → nearest intel node.
  if (pack) {
    const node = nearest(
      player.x,
      player.z,
      pack.intelNodes.map((n) => n.position),
    );
    if (node) return { kind: 'intel', x: node[0], z: node[2], label: 'Intel' };
  }

  return null;
}

/**
 * The signed bearing (radians) from the player's facing to a target, in [-π, π]. PURE.
 *
 * Yaw convention matches the avatar's: forward at yaw θ is (sin θ, 0, cos θ) (see
 * integrateMove / the camera follow in main.ts). 0 means "dead ahead", +π/2 means the target
 * is to the player's RIGHT, -π/2 to the LEFT, ±π directly behind. The DOM arrow rotates by
 * this so it always points where the player must turn. Returns 0 when the target coincides
 * with the player (degenerate — no meaningful direction).
 */
export function bearingTo(
  player: { x: number; z: number; yaw: number },
  targetX: number,
  targetZ: number,
): number {
  const dx = targetX - player.x;
  const dz = targetZ - player.z;
  if (dx === 0 && dz === 0) return 0;
  // World heading of the target (same convention as forward = (sin, cos)).
  const targetHeading = Math.atan2(dx, dz);
  let rel = targetHeading - player.yaw;
  // Normalise into [-π, π].
  while (rel > Math.PI) rel -= 2 * Math.PI;
  while (rel < -Math.PI) rel += 2 * Math.PI;
  return rel;
}
