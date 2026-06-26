// The authoritative 1v1 STEALTH DUEL room (Quick format). Mirrors MatchRoom's wiring — a
// deterministic sim-core WorldState stepped at a fixed tick, client INPUT messages applied as
// authoritative REQUESTS, the world mirrored into a @colyseus/schema MatchState — but runs the
// duel game mode instead of the heist:
//   - maxClients = 2, human-only. The room waits in duel phase 'waiting' until TWO humans join.
//   - Keeps the NPC crowd + disguises (the stealth hunt) but loads NO heist objective.
//   - Round-based single life: a short countdown, then live; the first elimination ends the round
//     and the SURVIVOR scores; a brief pause, reset, next round. First to 3 round wins takes it.
//
// The round LOGIC lives in sim-core's deterministic stepDuel (pure). THIS room owns the SIDE
// EFFECTS: it detects phase changes (round_over→countdown) to RESET both players for the next
// round, and handles forfeit on a mid-match leave.
import { createRequire } from 'node:module';
import type { Client } from 'colyseus';
import {
  agentForJoinIndex,
  TICK_MS,
  TICK_RATE,
  type AgentId,
  type ContentPack,
  type PlayerInput,
} from '@deceive/shared';
import {
  armFire,
  canFire,
  createDuel,
  createRng,
  createWorld,
  DUEL_ROUNDS_TO_WIN,
  hardReveal,
  resolveFire,
  spawnNpcsFromPack,
  spawnPlayer,
  step,
  stepDuel,
  takeDisguise,
  triggerAbility,
  triggerGadget,
  type Clock,
  type DuelState,
  type Rng,
  type SimDeps,
  type Vec3,
  type WorldState,
} from '@deceive/sim-core';
import { pickMatchPack } from '../content';
import { MatchState, PlayerSchema } from '../state/MatchState';
import { syncDuelToState, syncWorldToState } from '../state/sync';
import { applyMovementInput } from './applyInput';
import { isValidAgentId, isValidInput } from './MatchRoom';

// `colyseus` is CommonJS with no `exports` map — load the Room class VALUE via createRequire
// (a named ESM import typechecks but throws at runtime). See MatchRoom.ts for the full note.
const nodeRequire = createRequire(import.meta.url);
const { Room } = nodeRequire('colyseus') as typeof import('colyseus');

/** Server-driven Clock advanced by Colyseus' measured deltaTime each tick (see MatchRoom). */
class ServerClock implements Clock {
  private t = 0;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

/** A duel slot — its session/agent + the spawn it should reset to each round. */
interface DuelSlot {
  sessionId: string;
  agentId: AgentId;
  team: number;
  /** Spawn-point index in the pack (0 for p1, the OPPOSITE end for p2). */
  spawnIndex: number;
}

/** Resolve a spawn-point index in the pack to a world position (clamped to the pack's points). */
function spawnPositionFor(pack: ContentPack, spawnIndex: number): Vec3 {
  const spawns = pack.spawnPoints;
  const sp = spawns[spawnIndex % spawns.length];
  if (!sp) return { x: 0, y: 0, z: 0 };
  return { x: sp.position[0], y: sp.position[1], z: sp.position[2] };
}

export class DuelRoom extends Room<MatchState> {
  override maxClients = 2;

  private world!: WorldState;
  private deps!: SimDeps;
  private simClock!: ServerClock;
  private rng!: Rng;
  private pack!: ContentPack;
  private joinCount = 0;

  /** The two duel slots (p1 = first join, p2 = second). Null until that slot is filled. */
  private p1: DuelSlot | null = null;
  private p2: DuelSlot | null = null;
  /** The deterministic duel state — created once BOTH humans have joined; null while waiting. */
  private duel: DuelState | null = null;

  override onCreate(options?: { seed?: number; mapId?: string }): void {
    this.setState(new MatchState());

    this.world = createWorld();
    this.simClock = new ServerClock();
    this.rng = createRng(options?.seed ?? 1);
    this.deps = { clock: this.simClock, rng: this.rng };

    // Pick the level + spawn ONLY the stealth crowd. NO heist objective in a duel.
    this.pack = pickMatchPack(options?.mapId);
    this.state.mapId = this.pack.id;
    spawnNpcsFromPack(this.world, this.pack);

    // Duel mode: start in the 'waiting' lobby (no duel yet) until two humans arrive.
    this.state.mode = 'duel';
    this.state.phase = 'active';
    syncDuelToState(null, this.state);

    this.registerMessageHandlers();

    // Run the sim loop immediately so the crowd animates while we wait for the second player.
    this.setSimulationInterval((deltaTime) => this.tick(deltaTime), 1000 / TICK_RATE);
  }

  /** One authoritative simulation tick: advance sim, step world, then the duel state machine. */
  private tick(deltaTime: number): void {
    const dtMs = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : TICK_MS;
    this.simClock.advance(dtMs);
    step(this.world, this.deps, dtMs);
    syncWorldToState(this.world, this.state);

    // Drive the round state machine once a duel exists (both humans joined). Detect the
    // round_over→countdown transition to RESET both players for the new round.
    if (this.duel) {
      const prevPhase = this.duel.phase;
      stepDuel(this.duel, this.world, this.deps);
      if (prevPhase === 'round_over' && this.duel.phase === 'countdown') {
        this.resetForNewRound();
      }
    }
    syncDuelToState(this.duel, this.state);
  }

  override onJoin(client: Client, options?: { agent?: unknown }): void {
    const joinIndex = this.joinCount;
    this.joinCount += 1;

    const requested = options?.agent;
    const agentId: AgentId = isValidAgentId(requested) ? requested : agentForJoinIndex(joinIndex);
    // p1 spawns at the first point, p2 at the OPPOSITE end so they don't start face-to-face.
    const isP1 = this.p1 === null;
    const team = isP1 ? 0 : 1;
    const spawnIndex = isP1 ? 0 : this.pack.spawnPoints.length - 1;
    const slot: DuelSlot = { sessionId: client.sessionId, agentId, team, spawnIndex };
    if (isP1) this.p1 = slot;
    else this.p2 = slot;

    spawnPlayer(
      this.world,
      client.sessionId,
      team,
      spawnPositionFor(this.pack, spawnIndex),
      false,
      agentId,
    );

    const schema = new PlayerSchema();
    schema.id = client.sessionId;
    schema.team = team;
    schema.agentId = agentId;
    this.state.players.set(client.sessionId, schema);

    // Start the match the moment the SECOND human joins (human-only, no bots).
    if (this.p1 && this.p2 && !this.duel) {
      this.duel = createDuel(this.p1.sessionId, this.p2.sessionId, DUEL_ROUNDS_TO_WIN, this.simClock.now());
      // Place both at their (opposite) spawns + full reset, so round 1 starts clean.
      this.resetPlayer(this.p1);
      this.resetPlayer(this.p2);
      syncDuelToState(this.duel, this.state);
    }
  }

  override onLeave(client: Client): void {
    const leaving = this.slotFor(client.sessionId);
    this.world.players.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    if (this.p1?.sessionId === client.sessionId) this.p1 = null;
    if (this.p2?.sessionId === client.sessionId) this.p2 = null;

    if (!this.duel) {
      // Still waiting (or the leaver was never in a duel): just free the slot.
      syncDuelToState(this.duel, this.state);
      return;
    }
    if (this.duel.phase === 'match_over') {
      syncDuelToState(this.duel, this.state);
      return;
    }
    // Mid-match drop → the REMAINING player wins by forfeit.
    const remaining = leaving === this.p1 ? this.p2 : this.p1;
    const survivor = this.p1 ?? this.p2; // whichever slot is still filled
    const winnerId = (remaining ?? survivor)?.sessionId ?? '';
    this.duel.matchWinnerId = winnerId;
    this.duel.roundWinnerId = winnerId;
    this.duel.phase = 'match_over';
    this.duel.phaseEndsAtMs = 0;
    syncDuelToState(this.duel, this.state);
  }

  /** Reset BOTH duel players to opposite spawns + full health for a new round. */
  private resetForNewRound(): void {
    if (this.p1) this.resetPlayer(this.p1);
    if (this.p2) this.resetPlayer(this.p2);
  }

  /**
   * Reset one player for a fresh round: respawn at their (opposite) spawn, full health, blended
   * with a fresh civilian disguise, suspicion/reveal/combat timers cleared. Deterministic — re-runs
   * spawnPlayer, which sets the canonical fresh PlayerState (civilian disguise, phase 'blended').
   */
  private resetPlayer(slot: DuelSlot): void {
    spawnPlayer(
      this.world,
      slot.sessionId,
      slot.team,
      spawnPositionFor(this.pack, slot.spawnIndex),
      false,
      slot.agentId,
    );
  }

  private slotFor(sessionId: string): DuelSlot | null {
    if (this.p1?.sessionId === sessionId) return this.p1;
    if (this.p2?.sessionId === sessionId) return this.p2;
    return null;
  }

  private registerMessageHandlers(): void {
    this.onMessage('input', (client: Client, input: PlayerInput) => {
      const player = this.world.players.get(client.sessionId);
      if (!player) return;
      if (player.phase === 'out' || player.phase === 'downed') return;
      if (!isValidInput(input)) return;
      applyMovementInput(player, input);
    });

    this.onMessage('take_disguise', (client: Client, msg: { targetNpcId: string }) => {
      if (!msg || typeof msg.targetNpcId !== 'string') return;
      takeDisguise(this.world, client.sessionId, msg.targetNpcId, this.deps);
    });

    this.onMessage('ability', (client: Client) => {
      triggerAbility(this.world, client.sessionId, this.deps);
    });

    this.onMessage('use_gadget', (client: Client) => {
      triggerGadget(this.world, client.sessionId, this.deps);
    });

    this.onMessage('fire', (client: Client) => {
      const player = this.world.players.get(client.sessionId);
      if (!player) return;
      const now = this.simClock.now();
      if (!canFire(player, now)) return;
      armFire(player, now);
      player.fireSeq += 1;
      hardReveal(this.world, client.sessionId, this.deps);
      resolveFire(this.world, client.sessionId, this.deps);
    });

    // Single-life duel: a down is terminal (the round ends on it), so revive is a no-op here.
    this.onMessage('revive', () => {
      /* no-op in duel — no revive in single life */
    });
    // No heist objective in a duel: interact (intel/package) is intentionally unhandled.
  }
}
