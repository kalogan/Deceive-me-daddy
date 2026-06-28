// A FULLY-SIMULATED offline StateSource. Unlike LocalMockSource (movement-only stand-in), this
// runs the REAL deterministic sim-core loop — the same step() + interaction functions the
// Colyseus server runs — so solo "Quick Play vs bots" and the Tutorial are genuinely playable
// with NO server: intel, disguise, suspicion, combat, the objective, and the vault key all work.
//
// Production-truthful (PREVIEW_HARNESS / PROJECT_BRIEF §4.5): it produces the SAME NetMatchState
// the server broadcasts via the SAME world->net field mapping the server's sync.ts uses (mirrored
// here because the client can't import the server). It is the authority offline, exactly as the
// server is online — the renderer/HUD code is identical for both.
import {
  abilityCooldownRemaining,
  armFire,
  canFire,
  castKindForTarget,
  castProgress,
  createRng,
  createWorld,
  gadgetCooldownRemaining,
  hardReveal,
  inputSpeed,
  inputToWorldVelocity,
  isAbilityActive,
  loadObjective,
  resolveFire,
  reviveTeammate,
  spawnBots,
  spawnNpcsFromPack,
  spawnPlayer,
  startCast,
  step,
  triggerAbility,
  triggerGadget,
  type Clock,
  type PlayerState,
  type SimDeps,
  type WorldState,
} from '@deceive/sim-core';
import {
  AGENT_IDS,
  TICK_MS,
  type AgentId,
  type ContentPack,
  type NetCrumbState,
  type NetMatchState,
  type NetNpcState,
  type NetObjectiveState,
  type NetPlayerState,
  type PlayerInput,
} from '@deceive/shared';
import type { StateSource } from './StateSource';

/** How many bot opponents the offline sim spawns (kept light so solo reads clearly). */
const SOLO_BOT_COUNT = 3;
/** A fixed seed so an offline session is deterministic (no wall-clock/Math.random in the loop). */
const SOLO_SEED = 1337;

/** Map one sim player to its network-visible shape — mirrors the server's syncPlayer (sync.ts). */
function toNetPlayer(p: PlayerState, timeMs: number): NetPlayerState {
  return {
    id: p.id,
    team: p.team,
    agentId: p.agentId,
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z,
    yaw: p.yaw,
    disguiseTier: p.disguiseTier,
    disguiseId: p.disguiseId ?? '',
    suspicion: p.suspicion,
    phase: p.phase,
    currentZoneId: p.currentZoneId,
    health: p.health,
    intel: p.intel,
    carrying: p.carrying,
    heldKeycard: p.heldKeycard,
    abilityActive: isAbilityActive(p, timeMs),
    abilityCooldownMs: Math.min(65535, Math.round(abilityCooldownRemaining(p, timeMs))),
    gadgetCooldownMs: Math.min(65535, Math.round(gadgetCooldownRemaining(p, timeMs))),
    fireSeq: p.fireSeq % 65536,
    hitSeq: p.hitSeq % 65536,
    downSeq: p.downSeq % 65536,
    castKind: p.cast ? p.cast.kind : '',
    castProgress: castProgress(p, timeMs),
  };
}

/** Build the broadcast NetMatchState from the authoritative world — mirrors syncWorldToState. */
function worldToNetState(world: WorldState, mapId: string): NetMatchState {
  const players: Record<string, NetPlayerState> = {};
  for (const [id, p] of world.players) players[id] = toNetPlayer(p, world.timeMs);

  const npcs: Record<string, NetNpcState> = {};
  for (const [id, n] of world.npcs) {
    npcs[id] = { id: n.id, tier: n.tier, x: n.pos.x, y: n.pos.y, z: n.pos.z, yaw: n.yaw };
  }

  const crumbs: Record<string, NetCrumbState> = {};
  for (const [id, c] of world.crumbs) {
    crumbs[id] = { id: c.id, x: c.pos.x, y: c.pos.y, z: c.pos.z, tier: c.tier, expiresMs: c.expiresMs };
  }

  const o = world.objective;
  const objective: NetObjectiveState = {
    vaultOpen: o.vaultOpen,
    packageHolderId: o.packageHolderId,
    packageX: o.packagePos.x,
    packageY: o.packagePos.y,
    packageZ: o.packagePos.z,
    winningTeam: o.winningTeam,
    keyCreated: o.keyCreated,
    keyHolderId: o.keyHolderId,
    keyX: o.keyPos.x,
    keyY: o.keyPos.y,
    keyZ: o.keyPos.z,
  };

  return { tick: world.tick, timeMs: world.timeMs, phase: 'active', mapId, players, npcs, crumbs, objective };
}

export class LocalSimSource implements StateSource {
  readonly localPlayerId = 'local';

  private readonly world: WorldState;
  private readonly deps: SimDeps;
  private readonly mapId: string;
  private pendingInput: PlayerInput | null = null;
  private accumMs = 0;
  private cached: NetMatchState;

  /**
   * @param pack the validated content pack to simulate (the tutorial level, or a chosen/random map).
   * @param agentId the local player's agent (from the menu).
   * @param botCount opponents to spawn (defaults to SOLO_BOT_COUNT; the tutorial may pass fewer).
   */
  constructor(pack: ContentPack, agentId: AgentId = AGENT_IDS[0], botCount = SOLO_BOT_COUNT) {
    this.mapId = pack.id;
    this.world = createWorld();
    this.world.pack = pack;
    // A clock that simply reads sim time — step() advances world.timeMs in lockstep, exactly as
    // the server advances its ServerClock alongside step().
    const clock: Clock = { now: () => this.world.timeMs };
    this.deps = { clock, rng: createRng(SOLO_SEED) };

    loadObjective(this.world, pack);
    spawnNpcsFromPack(this.world, pack);
    spawnBots(this.world, this.deps, botCount);

    const spawn = pack.spawnPoints[0]?.position ?? [0, 0, 0];
    spawnPlayer(this.world, this.localPlayerId, 0, { x: spawn[0], y: spawn[1], z: spawn[2] }, false, agentId);

    this.cached = worldToNetState(this.world, this.mapId);
  }

  getState(): NetMatchState {
    return this.cached;
  }

  sendInput(input: PlayerInput): void {
    this.pendingInput = input;
  }

  update(dtMs: number): void {
    // Fixed-timestep accumulator so the deterministic sim advances in TICK_MS steps regardless of
    // render framerate (clamped so a backgrounded tab doesn't fast-forward a huge burst of ticks).
    this.accumMs += Math.min(dtMs, 250);
    while (this.accumMs >= TICK_MS) {
      this.accumMs -= TICK_MS;
      this.applyLocalInput();
      step(this.world, this.deps, TICK_MS);
    }
    this.cached = worldToNetState(this.world, this.mapId);
  }

  /** Apply the latest input to the local player AUTHORITATIVELY (mirrors the server's applyInput). */
  private applyLocalInput(): void {
    const input = this.pendingInput;
    if (!input) return;
    const player = this.world.players.get(this.localPlayerId);
    if (!player || player.phase === 'downed' || player.phase === 'out') return;
    const vel = inputToWorldVelocity(input.moveX, input.moveZ, input.yaw, inputSpeed(input.running));
    player.vel.x = vel.x;
    player.vel.z = vel.z;
    if (Number.isFinite(input.yaw)) player.yaw = input.yaw;
    player.isRunning = input.running === true;
    player.wantsJump = input.jumping === true;
  }

  takeDisguise(targetNpcId: string): void {
    startCast(this.world, this.localPlayerId, 'disguise', targetNpcId, this.deps);
  }

  fire(): void {
    const player = this.world.players.get(this.localPlayerId);
    if (!player) return;
    const now = this.deps.clock.now();
    if (!canFire(player, now)) return;
    armFire(player, now);
    hardReveal(this.world, this.localPlayerId, this.deps);
    resolveFire(this.world, this.localPlayerId, this.deps);
  }

  revive(targetPlayerId: string): void {
    reviveTeammate(this.world, this.localPlayerId, targetPlayerId, this.deps);
  }

  interact(targetId: string): void {
    startCast(this.world, this.localPlayerId, castKindForTarget(targetId), targetId, this.deps);
  }

  useAbility(): void {
    triggerAbility(this.world, this.localPlayerId, this.deps);
  }

  useGadget(): void {
    triggerGadget(this.world, this.localPlayerId, this.deps);
  }
}
