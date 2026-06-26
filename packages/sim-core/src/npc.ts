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
 * Advance the crowd one tick. STUB — filled by the NPC-AI builder with per-routine
 * movement (patrol along waypoints, wander, idle, work) using the injected deps for any
 * randomness. Must stay deterministic (no Math.random / Date.now).
 */
export function stepNpcs(world: WorldState, deps: SimDeps, dtMs: number): void {
  void world;
  void deps;
  void dtMs;
}
