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
  MAX_HEALTH,
  TICK_MS,
} from '@deceive/shared';
import { stepBots } from './bots';
import type { Clock } from './clock';
import { stepCombat } from './combat';
import { stepKeycardPickup } from './keycard';
import { stepDetection } from './detection';
import type { Crumb } from './disguise';
import { stepCrumbs } from './disguise';
import type { Npc } from './npc';
import { stepNpcs } from './npc';
import { stepObjective } from './objective';
import type { Rng } from './rng';
import { stepSocial } from './social';
import { stepSuspicion } from './suspicion';
import { stepZones } from './zones';

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
  /** Id of the zone the player is currently inside ('' if outside all zones). */
  currentZoneId: string;
  /** True when in a zone above the disguise's clearance ("scolded"). Feeds suspicion. */
  inForbiddenZone: boolean;
  /** Behavioral tell: set from the last input's `running` flag. Feeds suspicion. */
  isRunning: boolean;
  /** Sim time (ms) until which the player is hard-revealed (0 = not revealed). */
  revealedUntilMs: number;
  /** Authoritative health, 0..MAX_HEALTH. */
  health: number;
  /** When downed, the sim time (ms) at which they become 'out' if not revived (0 = n/a). */
  downedUntilMs: number;
  /** Intel collected by this player (spent to open the vault). */
  intel: number;
  /** True if this player is currently carrying the objective package. */
  carrying: boolean;
  /** Tier of the keycard the player holds ('' if none) — augments zone access. */
  heldKeycard: ClearanceTier | '';
  /** True if this player is an AI-controlled bot (server-internal; not on the wire). */
  isBot: boolean;
}

/** The heist objective runtime state (intel → vault → package → extract). */
export interface ObjectiveState {
  vaultOpen: boolean;
  /** Player id carrying the package ('' if loose). */
  packageHolderId: string;
  /** Authoritative package world position (follows the holder, else last drop point). */
  packagePos: Vec3;
  /** Ids of intel nodes already collected (each is one-time). */
  collectedIntel: Set<string>;
  /** Winning team once a carrier extracts (-1 while live). */
  winningTeam: number;
}

export interface WorldState {
  tick: number;
  timeMs: number;
  players: Map<string, PlayerState>;
  /** The ambient tiered crowd (Phase 2). */
  npcs: Map<string, Npc>;
  /** Active Holo-Crumbs (recent disguise-theft tells), keyed by id. */
  crumbs: Map<string, Crumb>;
  /** Ids of keycards already picked up (removed from the map). */
  collectedKeycards: Set<string>;
  /** The heist objective state. */
  objective: ObjectiveState;
  /** The loaded map content the sim runs on (zones/npcs/objective). Null until loaded. */
  pack: ContentPack | null;
}

export interface SimDeps {
  clock: Clock;
  rng: Rng;
}

export function createWorld(): WorldState {
  return {
    tick: 0,
    timeMs: 0,
    players: new Map(),
    npcs: new Map(),
    crumbs: new Map(),
    collectedKeycards: new Set(),
    objective: {
      vaultOpen: false,
      packageHolderId: '',
      packagePos: { x: 0, y: 0, z: 0 },
      collectedIntel: new Set(),
      winningTeam: -1,
    },
    pack: null,
  };
}

export function spawnPlayer(
  world: WorldState,
  id: string,
  team: number,
  pos: Vec3,
  isBot = false,
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
    currentZoneId: '',
    inForbiddenZone: false,
    isRunning: false,
    revealedUntilMs: 0,
    health: MAX_HEALTH,
    downedUntilMs: 0,
    intel: 0,
    carrying: false,
    heldKeycard: '',
    isBot,
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

  // Bots decide their velocity/actions BEFORE the movement integration below.
  stepBots(world, deps);

  for (const p of world.players.values()) {
    if (p.phase === 'out') continue;
    // Movement integration (placeholder; collision + nav arrive with the map slice).
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.pos.z += p.vel.z * dt;
  }

  // The ambient crowd advances each tick (movement filled by the NPC-AI slice).
  stepNpcs(world, deps, dtMs);

  // Keycard pickup (before zones, so a just-grabbed card counts toward access this tick).
  stepKeycardPickup(world);

  // Zone membership + clearance-mismatch ("scolded") detection, then crumb expiry.
  stepZones(world);
  stepCrumbs(world, deps);

  // Suspicion reads the zone/behavioral signals set above, then social spots bleed it.
  stepSuspicion(world, deps, dtMs);
  stepSocial(world, dtMs);

  // Detection: suspicion-max blow + hard-reveal window expiry (reads suspicion/phase).
  stepDetection(world, deps);

  // Combat upkeep: downed -> out when the revive window lapses.
  stepCombat(world, deps);

  // Objective: package follows holder, drops on down, win on extract.
  stepObjective(world, deps);

  return world;
}
