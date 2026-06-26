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
import { Room, type Client } from 'colyseus';
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
  spawnPlayer,
  step,
  type Clock,
  type Rng,
  type SimDeps,
  type Vec3,
  type WorldState,
} from '@deceive/sim-core';
import { MatchState, PlayerSchema } from '../state/MatchState';
import { syncWorldToState } from '../state/sync';
import { applyMovementInput, assignTeam } from './applyInput';

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

/** Default spawn point until the map slice provides per-team spawn data. */
function defaultSpawn(): Vec3 {
  return { x: 0, y: 0, z: 0 };
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

    // Spawn into the authoritative sim. The schema mirror is created on the next sync,
    // but we add it eagerly so the joiner exists in state immediately.
    spawnPlayer(this.world, client.sessionId, team, defaultSpawn());

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
    this.onMessage('take_disguise', (_client: Client, _msg: { targetNpcId: string }) => {
      // TODO(slice 2.2): take-disguise interaction + Holo-Crumb tell.
    });
    this.onMessage('interact', (_client: Client, _msg: { targetId: string }) => {
      // TODO(slice 2.3/2.4/3.1): door / intel / social spot / package interaction.
    });
    this.onMessage('use_gadget', (_client: Client, _msg: { gadget: GadgetKind }) => {
      // TODO(slice 3.3): signature gadget use.
    });
    this.onMessage('fire', (_client: Client) => {
      // TODO(slice 2.5/2.6): fire -> hard reveal + combat resolution.
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
