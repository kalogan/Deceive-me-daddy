// The authoritative match room (slice 1.1, PROJECT_BRIEF §3/§4.2). The SERVER owns the
// game state: it holds a sim-core WorldState, steps the deterministic simulation at a
// fixed tick, accepts client INPUT messages (as REQUESTS — never trusting client
// positions), and mirrors the authoritative WorldState into a @colyseus/schema MatchState
// that Colyseus diffs + broadcasts.
//
// Determinism boundary: sim-core stays deterministic (injected Clock + Rng, explicit dt).
// The SERVER is allowed wall-clock — Colyseus' setSimulationInterval hands us the REAL
// elapsed deltaTime, which we feed into the sim's Clock + step() so sim time tracks real
// time without sim-core ever calling Date.now() itself.
import { createRequire } from 'node:module';
import type { Client } from 'colyseus';
import {
  AGENT_IDS,
  agentForJoinIndex,
  MATCH_BOT_COUNT,
  MATCH_TEAMS,
  MAX_PLAYERS,
  TICK_MS,
  TICK_RATE,
  type AgentId,
  type ClientMessage,
  type ContentPack,
  type PlayerInput,
} from '@deceive/shared';
import {
  armFire,
  canFire,
  collectIntel,
  createRng,
  createWorld,
  grabPackage,
  loadObjective,
  spawnBots,
  spawnNpcsFromPack,
  hardReveal,
  resolveFire,
  reviveTeammate,
  spawnPlayer,
  step,
  takeDisguise,
  triggerAbility,
  triggerGadget,
  type Clock,
  type Rng,
  type SimDeps,
  type Vec3,
  type WorldState,
} from '@deceive/sim-core';
import { pickMatchPack } from '../content';
import { MatchState, PlayerSchema } from '../state/MatchState';
import { syncWorldToState } from '../state/sync';
import { applyMovementInput, assignTeam } from './applyInput';

// `colyseus` is a CommonJS package with NO `exports` map, so Node's ESM loader can't see
// its named exports at runtime — `import { Room } from 'colyseus'` typechecks (the .d.ts
// declares it) but throws on boot. Load the class VALUE via createRequire; the TYPES come
// from `import type`. (Caught by the live boot smoke: green gate, dead server.)
const nodeRequire = createRequire(import.meta.url);
const { Room } = nodeRequire('colyseus') as typeof import('colyseus');

/**
 * A server-driven Clock the sim reads. Unlike sim-core's FixedClock (test/replay), this
 * is advanced by the REAL deltaTime Colyseus measured each tick, keeping sim time aligned
 * with wall time. sim-core still never touches the wall clock directly — it only sees this
 * Clock's now() and the explicit dt passed to step().
 */
class ServerClock implements Clock {
  private t = 0;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

/** Pick a spawn position from the match's pack, round-robin by join order. */
function spawnPositionFor(pack: ContentPack, joinIndex: number): Vec3 {
  const spawns = pack.spawnPoints;
  const sp = spawns[joinIndex % spawns.length];
  if (!sp) return { x: 0, y: 0, z: 0 };
  return { x: sp.position[0], y: sp.position[1], z: sp.position[2] };
}

export class MatchRoom extends Room<MatchState> {
  override maxClients = MAX_PLAYERS;

  private world!: WorldState;
  private deps!: SimDeps;
  private simClock!: ServerClock;
  private rng!: Rng;
  /** The map this match is running. Chosen once at onCreate; mirrored to state.mapId. */
  private pack!: ContentPack;
  /** Monotonic join counter, used for round-robin team assignment. */
  private joinCount = 0;

  override onCreate(options?: { seed?: number; bots?: number; mapId?: string }): void {
    this.setState(new MatchState());

    // Authoritative, deterministic world + injected clock/RNG (PROJECT_BRIEF §4.3).
    this.world = createWorld();
    this.simClock = new ServerClock();
    this.rng = createRng(options?.seed ?? 1);
    this.deps = { clock: this.simClock, rng: this.rng };

    // Choose the level for this match: an explicitly-requested mapId if valid, else a random
    // pick across the shipped maps so successive matches vary. The client reads state.mapId and
    // mounts the matching authored map, so its render always matches this authoritative world.
    this.pack = pickMatchPack(options?.mapId);
    this.state.mapId = this.pack.id;

    // Load the map: the tiered NPC crowd (Phase 2) + the heist objective (Phase 3).
    spawnNpcsFromPack(this.world, this.pack);
    loadObjective(this.world, this.pack);
    // Fill the match with AI players so it's populated/playable solo (PROJECT_BRIEF §2). The
    // count is overridable per room (options.bots) for tests/tuning — default MATCH_BOT_COUNT.
    const botCount = Number.isFinite(options?.bots) ? Math.max(0, options!.bots!) : MATCH_BOT_COUNT;
    spawnBots(this.world, this.deps, botCount);

    this.registerMessageHandlers();
    this.state.phase = 'active';

    // Fixed-tick sim loop. `deltaTime` is the REAL elapsed ms; we advance the sim clock
    // by it and step the deterministic core with it, then mirror world -> schema.
    this.setSimulationInterval((deltaTime) => this.tick(deltaTime), 1000 / TICK_RATE);
  }

  /** One authoritative simulation tick. */
  private tick(deltaTime: number): void {
    // Guard against a degenerate first/late delta; never feed a non-positive dt.
    const dtMs = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : TICK_MS;
    this.simClock.advance(dtMs);
    step(this.world, this.deps, dtMs);
    syncWorldToState(this.world, this.state);

    // Match flow: a successful extraction ends the match (the win banner is client-side).
    if (this.world.objective.winningTeam !== -1 && this.state.phase !== 'ended') {
      this.state.phase = 'ended';
    }
  }

  override onJoin(client: Client, options?: { agent?: unknown }): void {
    const joinIndex = this.joinCount;
    const team = assignTeam(joinIndex, MATCH_TEAMS);
    // Honour the agent the player picked in the start menu (sent as a join option) IF it's a
    // valid AgentId; otherwise fall back to the round-robin-by-join-order default. The client
    // is untrusted, so we validate against the canonical AGENT_IDS rather than trusting the
    // string (PROJECT_BRIEF §4.2 — the server makes no assumption the client is well-behaved).
    const requested = options?.agent;
    const agentId: AgentId = isValidAgentId(requested) ? requested : agentForJoinIndex(joinIndex);
    this.joinCount += 1;

    // Spawn into the authoritative sim at a pack spawn point. The schema mirror is created
    // on the next sync, but we add it eagerly so the joiner exists in state immediately.
    spawnPlayer(
      this.world,
      client.sessionId,
      team,
      spawnPositionFor(this.pack, joinIndex),
      false,
      agentId,
    );

    const schema = new PlayerSchema();
    schema.id = client.sessionId;
    schema.team = team;
    schema.agentId = agentId;
    this.state.players.set(client.sessionId, schema);
  }

  override onLeave(client: Client): void {
    this.world.players.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  private registerMessageHandlers(): void {
    // Movement input — a REQUEST only. We apply it AUTHORITATIVELY: derive a clamped
    // velocity + yaw; the client's reported position is ignored entirely.
    this.onMessage('input', (client: Client, input: PlayerInput) => {
      const player = this.world.players.get(client.sessionId);
      if (!player) return;
      if (player.phase === 'out' || player.phase === 'downed') return;
      if (!isValidInput(input)) return;
      applyMovementInput(player, input);
    });

    // The remaining ClientMessage intents are wired as no-op stubs here so the contract
    // is complete; their authority lands in later slices (disguise/zones/combat/etc.).
    this.onMessage('take_disguise', (client: Client, msg: { targetNpcId: string }) => {
      // Authoritative: the server checks range + validity; the client only requests.
      if (!msg || typeof msg.targetNpcId !== 'string') return;
      takeDisguise(this.world, client.sessionId, msg.targetNpcId, this.deps);
    });
    this.onMessage('interact', (client: Client, msg: { targetId: string }) => {
      if (!msg || typeof msg.targetId !== 'string') return;
      // Context-resolved by target: 'package' grabs the package; otherwise it's an intel
      // node id. (Extraction is automatic in stepObjective when a carrier reaches a point.)
      if (msg.targetId === 'package') {
        grabPackage(this.world, client.sessionId, this.deps);
      } else {
        collectIntel(this.world, client.sessionId, msg.targetId, this.deps);
      }
    });
    this.onMessage('ability', (client: Client) => {
      // Trigger the player's signature Expertise — the server knows their agent + validates
      // readiness/cooldown authoritatively. A request only.
      triggerAbility(this.world, client.sessionId, this.deps);
    });
    this.onMessage('use_gadget', (client: Client) => {
      // Trigger the player's deployable gadget (second active slot) — the server knows their
      // agent + validates readiness/cooldown + applies the effect. A request only.
      triggerGadget(this.world, client.sessionId, this.deps);
    });
    this.onMessage('fire', (client: Client) => {
      // AUTHORITATIVE per-weapon fire-rate gate: reject a shot that arrives before the
      // shooter's weapon has recovered (data-driven weaponStats.fireCooldownMs), so the heavy
      // weapon is actually slower regardless of what the client requests. On a pass, arm the
      // next-fire time, then blow cover (hard reveal) + resolve the shot (damage/down).
      const player = this.world.players.get(client.sessionId);
      if (!player) return;
      const now = this.simClock.now();
      if (!canFire(player, now)) return;
      armFire(player, now);
      hardReveal(this.world, client.sessionId, this.deps);
      resolveFire(this.world, client.sessionId, this.deps);
    });
    this.onMessage('revive', (client: Client, msg: { targetPlayerId: string }) => {
      if (!msg || typeof msg.targetPlayerId !== 'string') return;
      reviveTeammate(this.world, client.sessionId, msg.targetPlayerId, this.deps);
    });
  }
}

/**
 * Validate a client-sent PlayerInput shape before trusting any field. Defends the
 * authoritative loop against malformed/hostile payloads (the server makes no assumption
 * the client is well-behaved — PROJECT_BRIEF §4.2).
 */
export function isValidInput(input: unknown): input is PlayerInput {
  if (typeof input !== 'object' || input === null) return false;
  const i = input as Record<string, unknown>;
  return (
    typeof i.seq === 'number' &&
    typeof i.moveX === 'number' &&
    typeof i.moveZ === 'number' &&
    typeof i.yaw === 'number' &&
    typeof i.running === 'boolean' &&
    typeof i.jumping === 'boolean'
  );
}

/**
 * Narrow an untrusted join-option value to a playable AgentId. Used by onJoin to decide
 * whether to honour the menu's agent pick or fall back to the round-robin default — the
 * client could send anything, so we only accept one of the canonical AGENT_IDS.
 */
export function isValidAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && (AGENT_IDS as readonly string[]).includes(value);
}

// Re-export the union type so future slices that add handlers have it at hand.
export type { ClientMessage };
