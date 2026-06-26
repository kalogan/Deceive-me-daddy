// The seam between the renderer and the authoritative state (PROJECT_BRIEF §3).
//
// The client never owns truth: it RENDERS a NetMatchState and SENDS PlayerInput requests.
// StateSource abstracts WHERE that state comes from. This slice ships LocalMockSource so
// the scene runs standalone with no server; the live-wiring slice (1.x) drops in a
// ColyseusSource implementing the SAME interface — main.ts / WorldView don't change.
import {
  TICK_MS,
  type ClearanceTier,
  type NetMatchState,
  type NetPlayerState,
  type PlayerInput,
} from '@deceive/shared';
import { integrateMove } from './movement';

export interface StateSource {
  /**
   * The id of the player THIS client controls (for camera follow + local prediction).
   * For an offline source this is known at construction; for a NET source it is only
   * known AFTER the room is joined (it is the server-assigned sessionId), so it is NOT
   * readonly — a net source assigns it inside its async connect(). Read it only once
   * connect() (if any) has resolved.
   */
  localPlayerId: string;
  /**
   * Latest authoritative snapshot to render. Cheap to call every frame. A net source that
   * has not yet received its first broadcast returns an EMPTY snapshot
   * ({ tick:0, timeMs:0, phase:'lobby', players:{} }) so the renderer is safe pre-connect.
   */
  getState(): NetMatchState;
  /** Send the local player's input for a tick. A request only — server validates. */
  sendInput(input: PlayerInput): void;
  /** Advance the source's own clock (mock sim). A real net source ignores dt. */
  update(dtMs: number): void;
}

interface MockBot {
  id: string;
  /** Heading the bot wanders along (radians), re-rolled periodically. */
  heading: number;
  /** Ms until the bot picks a new heading. */
  turnIn: number;
  running: boolean;
}

const TIERS: ClearanceTier[] = ['civilian', 'staff', 'security', 'scientist'];

/**
 * A standalone, server-less StateSource. Integrates the local player's sent inputs and
 * walks a handful of mock bots (one per disguise tier) so the greybox scene is ALIVE
 * without a server. This is a stand-in for the authoritative sim, NOT a forked data
 * shape — it produces the real NetMatchState the server will broadcast (PROJECT_BRIEF
 * §4.5), so the renderer is exercised against production-truthful state.
 */
export class LocalMockSource implements StateSource {
  readonly localPlayerId = 'local';

  private readonly state: NetMatchState;
  private readonly bots: MockBot[] = [];
  /** The most recent input we were asked to send; applied on each mock tick. */
  private pendingInput: PlayerInput | null = null;
  private accumMs = 0;

  constructor() {
    const players: Record<string, NetPlayerState> = {};

    players[this.localPlayerId] = {
      id: this.localPlayerId,
      team: 0,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      disguiseTier: 'civilian',
      suspicion: 0,
      phase: 'blended',
    };

    // One bot per tier, fanned out around spawn, each on its own team.
    TIERS.forEach((tier, i) => {
      const id = `bot-${tier}`;
      const angle = (i / TIERS.length) * Math.PI * 2;
      const radius = 6;
      players[id] = {
        id,
        team: i + 1,
        x: Math.cos(angle) * radius,
        y: 0,
        z: Math.sin(angle) * radius,
        yaw: angle,
        disguiseTier: tier,
        suspicion: 0,
        phase: 'blended',
      };
      this.bots.push({ id, heading: angle, turnIn: 1500 + i * 400, running: i % 2 === 0 });
    });

    this.state = { tick: 0, timeMs: 0, phase: 'active', players };
  }

  getState(): NetMatchState {
    return this.state;
  }

  sendInput(input: PlayerInput): void {
    this.pendingInput = input;
  }

  update(dtMs: number): void {
    this.accumMs += dtMs;
    // Step the mock sim at the shared tick rate so bot/local motion is frame-independent.
    while (this.accumMs >= TICK_MS) {
      this.accumMs -= TICK_MS;
      this.step(TICK_MS / 1000);
      this.state.tick += 1;
      this.state.timeMs += TICK_MS;
    }
  }

  private step(dt: number): void {
    // Authoritatively integrate the local player's latest input (mock authority).
    const local = this.state.players[this.localPlayerId];
    if (local && this.pendingInput) {
      const next = integrateMove(local, this.pendingInput, dt);
      local.x = next.x;
      local.z = next.z;
      local.yaw = this.pendingInput.yaw;
    }

    // Wander the bots. They turn occasionally and amble within a soft boundary.
    for (const bot of this.bots) {
      const p = this.state.players[bot.id];
      if (!p) continue;

      bot.turnIn -= dt * 1000;
      if (bot.turnIn <= 0) {
        // Deterministic-ish wander without Math.random in the hot path is fine for a
        // cosmetic mock; vary heading by position so bots don't lock-step.
        bot.heading += Math.sin(p.x * 0.7 + p.z * 1.3 + this.state.tick * 0.11) * 1.2;
        bot.turnIn = 1200 + ((this.state.tick * 37) % 1600);
        bot.running = (this.state.tick & 3) === 0;
      }

      // Steer back toward the origin if they wander too far.
      const dist = Math.hypot(p.x, p.z);
      if (dist > 14) bot.heading = Math.atan2(-p.z, -p.x);

      const input: PlayerInput = {
        seq: this.state.tick,
        moveX: 0,
        moveZ: 1,
        yaw: bot.heading,
        running: bot.running,
        jumping: false,
      };
      const next = integrateMove(p, input, dt);
      p.x = next.x;
      p.z = next.z;
      p.yaw = bot.heading;
    }
  }
}
