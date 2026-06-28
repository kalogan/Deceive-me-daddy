// The authoritative world state + tick loop (PROJECT_BRIEF §3). Engine-agnostic and
// deterministic: no Three.js, no Colyseus, no wall-clock, no Math.random. The server
// owns an instance of this and steps it; clients only render snapshots of it.
//
// This is the SKELETON (Phase 0). Suspicion, detection, disguise, zones, combat, and
// the objective state machine are hooked here but filled by their Phase 2/3 slices.
import {
  type AgentId,
  type AgentPhase,
  type ClearanceTier,
  type ContentPack,
  MAX_HEALTH,
  TICK_MS,
} from '@deceive/shared';
import { stepAbility } from './ability';
import { stepGadget } from './gadget';
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
  /** Which playable agent this player picked (drives their Expertise). */
  agentId: AgentId;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  /** The clearance tier of the player's current disguise. */
  disguiseTier: ClearanceTier;
  /** Entity id whose APPEARANCE this player is wearing ('' = their own/agent look). Set to the
   * taken NPC's id by takeDisguise so the client renders the player as that specific NPC. */
  disguiseId?: string;
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
  /** Sim time (ms) until which the signature Expertise is active (0 = inactive). */
  abilityActiveUntilMs: number;
  /** Sim time (ms) at which the Expertise becomes ready again (0 = ready now). */
  abilityReadyAtMs: number;
  /** Sim time (ms) at which the deployable gadget (second active slot) is ready again
   * (0 = ready now). Mirrors abilityReadyAtMs but on the gadget's own cooldown. */
  gadgetReadyAtMs: number;
  /** Sim time (ms) before which this player may not fire again — the per-weapon fire-rate
   * gate. Set to now + weaponStats.fireCooldownMs by the authoritative fire path. */
  nextFireAtMs: number;
  /** Monotonic shot counter — bumped on every CONFIRMED shot by the fire path. The client
   * watches this on the wire and, on each increment, plays the muzzle-flash/tracer VFX and the
   * aim-recoil animation for that player (a fire EVENT signal, since fire is instantaneous). */
  fireSeq: number;
  /** Monotonic counter bumped each time THIS player's shot LANDS a damaging hit on a target. The
   * client diffs it for the local player to flash a HITMARKER (a "your shot connected" signal). */
  hitSeq: number;
  /** Monotonic counter bumped each time THIS player's shot DOWNS a target (a kill). Drives the
   * stronger "down/kill" hitmarker, distinct from a plain hit. */
  downSeq: number;
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
  // --- Vault key (objective.requiresVaultKey packs only; inert otherwise) ---
  /** True once the vault key has been forged at the terminal. */
  keyCreated: boolean;
  /** Player id carrying the vault key ('' if loose/uncreated). */
  keyHolderId: string;
  /** Authoritative vault-key world position (the forge until grabbed, then follows the holder). */
  keyPos: Vec3;
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
      keyCreated: false,
      keyHolderId: '',
      keyPos: { x: 0, y: 0, z: 0 },
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
  agentId: AgentId = 'squire',
): PlayerState {
  // Everyone starts disguised as a random Civilian (PROJECT_BRIEF §2b).
  const player: PlayerState = {
    id,
    team,
    agentId,
    pos: { ...pos },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    disguiseTier: 'civilian',
    disguiseId: '',
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
    abilityActiveUntilMs: 0,
    abilityReadyAtMs: 0,
    gadgetReadyAtMs: 0,
    nextFireAtMs: 0,
    fireSeq: 0,
    hitSeq: 0,
    downSeq: 0,
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

  // Expire any signature Expertise whose active window has lapsed (before combat/detection
  // read the cloak/invulnerable flags this tick).
  stepAbility(world, deps);
  // Gadget upkeep (mirrors stepAbility). Gadget effects are instantaneous, so this is just
  // the parity hook — the cooldown is read lazily by isGadgetReady against sim time.
  stepGadget(world, deps);

  // Bots decide their velocity/actions BEFORE the movement integration below.
  stepBots(world, deps);

  for (const p of world.players.values()) {
    if (p.phase === 'out') continue;
    // A DOWNED player is incapacitated: they don't move. Clear any residual velocity (set before
    // they were downed) so they neither COAST across the ground nor LURCH when revived — the
    // server rejects their input while downed, so vel would otherwise keep its last value.
    if (p.phase === 'downed') {
      p.vel.x = 0;
      p.vel.y = 0;
      p.vel.z = 0;
      continue;
    }
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
