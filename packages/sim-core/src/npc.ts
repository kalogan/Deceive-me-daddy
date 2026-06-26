// The ambient tiered NPC crowd (Phase 2). Engine-agnostic + deterministic, like the rest
// of sim-core. NPCs are the bodies players blend in among; their per-tier routines are what
// make "act natural" meaningful (PROJECT_BRIEF §2b).
//
// SCAFFOLD: spawnNpcsFromPack creates the crowd from a content pack. `stepNpcs` is a STUB
// here — the NPC-AI builder fills in routine/patrol movement against this fixed seam.
import type { ClearanceTier, ContentPack, NpcRoutine } from '@deceive/shared';
import type { SimDeps, Vec3, WorldState } from './world';

export interface Npc {
  id: string;
  tier: ClearanceTier;
  pos: Vec3;
  yaw: number;
  homeZone: string;
  routine: NpcRoutine;
  /** Index into routine.waypoints the NPC is currently heading toward. */
  waypointIndex: number;
  /**
   * Wander state (movement-only; not synced). A unit-ish heading on XZ the NPC drifts
   * along, plus the time remaining (ms) before it re-rolls the heading. Lazily seeded on
   * the first wander tick so a freshly-spawned crowd needs no extra setup. Optional so the
   * frozen spawn shape (id/tier/pos/yaw/homeZone/routine/waypointIndex) is untouched.
   */
  wanderDirX?: number;
  wanderDirZ?: number;
  wanderTimerMs?: number;
  /** Anchor (XZ) for the no-pack fallback box, latched on the first wander tick. */
  wanderAnchorX?: number;
  wanderAnchorZ?: number;
}

/**
 * NPC walk pace (m/s). Deliberately slower than a player's WALK_SPEED (3.0) so a moving
 * player can weave through the crowd rather than being out-paced by it — the crowd is a
 * texture to blend into, not a current to fight. Tune for density/feel in the harness.
 */
const NPC_SPEED = 1.4;

/** Arrival epsilon (m): within this of a waypoint the NPC is "there" and advances. */
const WAYPOINT_EPSILON = 0.15;

/** How often (ms) a wanderer re-rolls its heading — a relaxed, ambient drift. */
const WANDER_REROLL_MS = 2000;

/** Slow ambient yaw drift for idlers (rad/s) — a faint "looking around" life sign. */
const IDLE_YAW_DRIFT = 0.2;

/** A bounded volume on the XZ plane (y ignored for movement). */
interface XZBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Look up the npc's home-zone bounds in the loaded pack, if any. */
function homeZoneBounds(world: WorldState, npc: Npc): XZBounds | undefined {
  const zone = world.pack?.zones.find((z) => z.id === npc.homeZone);
  if (!zone) return undefined;
  const [minX, , minZ] = zone.bounds.min;
  const [maxX, , maxZ] = zone.bounds.max;
  return {
    minX: Math.min(minX, maxX),
    maxX: Math.max(minX, maxX),
    minZ: Math.min(minZ, maxZ),
    maxZ: Math.max(minZ, maxZ),
  };
}

/**
 * Move `npc.pos` toward `(tx, tz)` by up to `maxStep` metres on XZ, facing the direction
 * of travel. Returns true if it arrived (within WAYPOINT_EPSILON) this step.
 */
function stepToward(npc: Npc, tx: number, tz: number, maxStep: number): boolean {
  const dx = tx - npc.pos.x;
  const dz = tz - npc.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= WAYPOINT_EPSILON) {
    npc.pos.x = tx;
    npc.pos.z = tz;
    return true;
  }
  // Face the heading even on the final clamped step (atan2 of the world-frame delta).
  npc.yaw = Math.atan2(dx, dz);
  if (dist <= maxStep) {
    npc.pos.x = tx;
    npc.pos.z = tz;
    return true;
  }
  npc.pos.x += (dx / dist) * maxStep;
  npc.pos.z += (dz / dist) * maxStep;
  return false;
}

/** Materialize the crowd from a content pack's npc defs at their first waypoint. */
export function spawnNpcsFromPack(world: WorldState, pack: ContentPack): void {
  world.pack = pack;
  world.npcs.clear();
  for (const def of pack.npcs) {
    const first = def.routine.waypoints[0];
    const pos: Vec3 = first
      ? { x: first[0], y: first[1], z: first[2] }
      : { x: 0, y: 0, z: 0 };
    world.npcs.set(def.id, {
      id: def.id,
      tier: def.tier,
      pos,
      yaw: 0,
      homeZone: def.homeZone,
      routine: def.routine,
      waypointIndex: 0,
    });
  }
}

/**
 * Patrol/work: walk toward the current waypoint; on arrival advance the index, wrapping
 * the loop. `work` shares the logic — its waypoint list is just usually short. With zero
 * waypoints there's nowhere to go (idle in place); with one, walk to it then sit on it.
 */
function stepWaypoints(npc: Npc, maxStep: number): void {
  const wps = npc.routine.waypoints;
  if (wps.length === 0) return;

  // Keep the index sane even if content authored an out-of-range start.
  if (npc.waypointIndex < 0 || npc.waypointIndex >= wps.length) {
    npc.waypointIndex = ((npc.waypointIndex % wps.length) + wps.length) % wps.length;
  }
  const target = wps[npc.waypointIndex];
  if (!target) return;
  const arrived = stepToward(npc, target[0], target[2], maxStep);
  if (arrived && wps.length > 1) {
    npc.waypointIndex = (npc.waypointIndex + 1) % wps.length;
  }
}

/**
 * Wander: drift within the home-zone bounds, re-rolling a heading every WANDER_REROLL_MS
 * via deps.rng (deterministic). If the next step would leave the bounds, reflect the
 * heading so the NPC steers back inside. With no pack/zone, drift gently around spawn
 * using a small synthetic box so it still moves but never strays far.
 */
function stepWander(npc: Npc, deps: SimDeps, dtMs: number, bounds: XZBounds | undefined): void {
  // Latch a spawn anchor once so the no-pack fallback box stays put rather than drifting
  // with the NPC (a per-tick "current pos +-3" box would let it walk off to infinity).
  if (npc.wanderAnchorX === undefined || npc.wanderAnchorZ === undefined) {
    npc.wanderAnchorX = npc.pos.x;
    npc.wanderAnchorZ = npc.pos.z;
  }
  const box: XZBounds = bounds ?? {
    minX: npc.wanderAnchorX - 3,
    maxX: npc.wanderAnchorX + 3,
    minZ: npc.wanderAnchorZ - 3,
    maxZ: npc.wanderAnchorZ + 3,
  };

  // Lazily seed heading + timer on the first wander tick (deterministic via rng).
  if (
    npc.wanderTimerMs === undefined ||
    npc.wanderDirX === undefined ||
    npc.wanderDirZ === undefined
  ) {
    rollWanderHeading(npc, deps);
    npc.wanderTimerMs = deps.rng.int(WANDER_REROLL_MS);
  }

  npc.wanderTimerMs -= dtMs;
  if (npc.wanderTimerMs <= 0) {
    rollWanderHeading(npc, deps);
    npc.wanderTimerMs += WANDER_REROLL_MS;
    if (npc.wanderTimerMs <= 0) npc.wanderTimerMs = WANDER_REROLL_MS;
  }

  const step = NPC_SPEED * (dtMs / 1000);
  let nextX = npc.pos.x + (npc.wanderDirX ?? 0) * step;
  let nextZ = npc.pos.z + (npc.wanderDirZ ?? 0) * step;

  // Reflect off the bounds so the NPC turns back inside rather than escaping.
  if (nextX < box.minX || nextX > box.maxX) {
    npc.wanderDirX = -(npc.wanderDirX ?? 0);
    nextX = npc.pos.x + (npc.wanderDirX ?? 0) * step;
  }
  if (nextZ < box.minZ || nextZ > box.maxZ) {
    npc.wanderDirZ = -(npc.wanderDirZ ?? 0);
    nextZ = npc.pos.z + (npc.wanderDirZ ?? 0) * step;
  }

  // Final clamp guards corners + any pre-existing out-of-bounds spawn.
  npc.pos.x = Math.min(box.maxX, Math.max(box.minX, nextX));
  npc.pos.z = Math.min(box.maxZ, Math.max(box.minZ, nextZ));

  if ((npc.wanderDirX ?? 0) !== 0 || (npc.wanderDirZ ?? 0) !== 0) {
    npc.yaw = Math.atan2(npc.wanderDirX ?? 0, npc.wanderDirZ ?? 0);
  }
}

/** Pick a fresh unit heading on XZ from a random angle (deterministic via deps.rng). */
function rollWanderHeading(npc: Npc, deps: SimDeps): void {
  const angle = deps.rng.next() * Math.PI * 2;
  npc.wanderDirX = Math.sin(angle);
  npc.wanderDirZ = Math.cos(angle);
}

/**
 * Advance the crowd one tick. Per-NPC, dispatch on routine kind: patrol/work walk their
 * waypoint loops, wander drifts inside the home zone, idle holds with a faint yaw drift.
 * Deterministic: all randomness via deps.rng, all timing via dtMs — same seed + same dt
 * sequence reproduces identical motion (PROJECT_BRIEF §4.3).
 */
export function stepNpcs(world: WorldState, deps: SimDeps, dtMs: number): void {
  const maxStep = NPC_SPEED * (dtMs / 1000);

  for (const npc of world.npcs.values()) {
    switch (npc.routine.kind) {
      case 'patrol':
      case 'work':
        stepWaypoints(npc, maxStep);
        break;
      case 'wander':
        stepWander(npc, deps, dtMs, homeZoneBounds(world, npc));
        break;
      case 'idle':
        npc.yaw += IDLE_YAW_DRIFT * (dtMs / 1000);
        break;
    }
  }
}
