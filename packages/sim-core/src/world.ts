// The authoritative world state + tick loop (PROJECT_BRIEF §3). Engine-agnostic and
// deterministic: no Three.js, no Colyseus, no wall-clock, no Math.random. The server
// owns an instance of this and steps it; clients only render snapshots of it.
//
// This is the SKELETON (Phase 0). Suspicion, detection, disguise, zones, combat, and
// the objective state machine are hooked here but filled by their Phase 2/3 slices.
import {
  type AgentPhase,
  type ClearanceTier,
  type ContentPack,
  TICK_MS,
} from '@deceive/shared';
import type { Clock } from './clock';
import type { Npc } from './npc';
import { stepNpcs } from './npc';
import type { Rng } from './rng';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type { AgentPhase };

export interface PlayerState {
  id: string;
  team: number;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  /** The clearance tier of the player's current disguise. */
  disguiseTier: ClearanceTier;
  /** 0..SUSPICION_MAX, authoritative. */
  suspicion: number;
  phase: AgentPhase;
}

export interface WorldState {
  tick: number;
  timeMs: number;
  players: Map<string, PlayerState>;
  /** The ambient tiered crowd (Phase 2). */
  npcs: Map<string, Npc>;
  /** The loaded map content the sim runs on (zones/npcs/objective). Null until loaded. */
  pack: ContentPack | null;
}

export interface SimDeps {
  clock: Clock;
  rng: Rng;
}

export function createWorld(): WorldState {
  return { tick: 0, timeMs: 0, players: new Map(), npcs: new Map(), pack: null };
}

export function spawnPlayer(
  world: WorldState,
  id: string,
  team: number,
  pos: Vec3,
): PlayerState {
  // Everyone starts disguised as a random Civilian (PROJECT_BRIEF §2b).
  const player: PlayerState = {
    id,
    team,
    pos: { ...pos },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    disguiseTier: 'civilian',
    suspicion: 0,
    phase: 'blended',
  };
  world.players.set(id, player);
  return player;
}

/**
 * Advance the simulation by one fixed tick. Pure with respect to (world, deps): the
 * same starting state + inputs always produce the same result. Returns `world` mutated
 * in place for the server's hot loop.
 */
export function step(world: WorldState, deps: SimDeps, dtMs: number = TICK_MS): WorldState {
  world.tick += 1;
  world.timeMs += dtMs;
  const dt = dtMs / 1000;

  for (const p of world.players.values()) {
    if (p.phase === 'out') continue;
    // Movement integration (placeholder; collision + nav arrive with the map slice).
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.pos.z += p.vel.z * dt;
  }

  // The ambient crowd advances each tick (movement filled by the NPC-AI slice).
  stepNpcs(world, deps, dtMs);

  // Further hooks filled by later Phase 2 slices: stepZones, stepSuspicion,
  // stepDetection, stepObjective — each its own module, ordered here.

  return world;
}
