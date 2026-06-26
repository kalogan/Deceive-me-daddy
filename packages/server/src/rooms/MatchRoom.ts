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
  MATCH_TEAMS,
  MAX_PLAYERS,
  TICK_MS,
  TICK_RATE,
  type ClientMessage,
  type GadgetKind,
  type PlayerInput,
} from '@deceive/shared';
import {
  createRng,
  createWorld,
  spawnNpcsFromPack,
  hardReveal,
  spawnPlayer,
  step,
  takeDisguise,
  type Clock,
  type Rng,
  type SimDeps,
  type Vec3,
  type WorldState,
} from '@deceive/sim-core';
import { FACILITY_ALPHA } from '../content';
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

/** Pick a spawn position from the loaded pack, round-robin by join order. */
function spawnPositionFor(joinIndex: number): Vec3 {
  const spawns = FACILITY_ALPHA.spawnPoints;
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
  /** Monotonic join counter, used for round-robin team assignment. */
  private joinCount = 0;

  override onCreate(options?: { seed?: number }): void {
    this.setState(new MatchState());

    // Authoritative, deterministic world + injected clock/RNG (PROJECT_BRIEF §4.3).
    this.world = createWorld();
    this.simClock = new ServerClock();
    this.rng = createRng(options?.seed ?? 1);
    this.deps = { clock: this.simClock, rng: this.rng };

    // Load the map: spawns the tiered NPC crowd players blend into (Phase 2).
    spawnNpcsFromPack(this.world, FACILITY_ALPHA);

    this.registerMessageHandlers();

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
  }

  override onJoin(client: Client): void {
    const team = assignTeam(this.joinCount, MATCH_TEAMS);
    this.joinCount += 1;

    // Spawn into the authoritative sim at a pack spawn point. The schema mirror is created
    // on the next sync, but we add it eagerly so the joiner exists in state immediately.
    spawnPlayer(this.world, client.sessionId, team, spawnPositionFor(this.joinCount - 1));

    const schema = new PlayerSchema();
    schema.id = client.sessionId;
    schema.team = team;
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
    this.onMessage('interact', (_client: Client, _msg: { targetId: string }) => {
      // TODO(slice 2.3/2.4/3.1): door / intel / social spot / package interaction.
    });
    this.onMessage('use_gadget', (_client: Client, _msg: { gadget: GadgetKind }) => {
      // TODO(slice 3.3): signature gadget use.
    });
    this.onMessage('fire', (client: Client) => {
      // Firing instantly blows cover (hard reveal). Combat damage lands in a later slice.
      hardReveal(this.world, client.sessionId, this.deps);
    });
    this.onMessage('revive', (_client: Client, _msg: { targetPlayerId: string }) => {
      // TODO(slice 2.6): downed -> revive window.
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

// Re-export the union type so future slices that add handlers have it at hand.
export type { ClientMessage };
