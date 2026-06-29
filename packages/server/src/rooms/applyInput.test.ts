// Pure-logic tests (PROJECT_BRIEF §4.6) for authoritative input application + team
// assignment. NO Colyseus room / socket is opened here — these are synchronous and exit
// cleanly (avoids the "zombie-gate" hang).
import { describe, expect, it } from 'vitest';
import { MATCH_TEAMS, RUN_SPEED, WALK_SPEED, type PlayerInput } from '@deceive/shared';
import type { PlayerState } from '@deceive/sim-core';
import { applyMovementInput, assignTeam } from './applyInput';

function makePlayer(): PlayerState {
  return {
    id: 'p1',
    team: 0,
    agentId: 'squire',
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    disguiseTier: 'civilian',
    suspicion: 0,
    phase: 'blended',
    currentZoneId: '',
    floor: 0,
    inForbiddenZone: false,
    isRunning: false,
    revealedUntilMs: 0,
    health: 100,
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
    isBot: false,
    cast: null,
    wantsJump: false,
  };
}

function input(over: Partial<PlayerInput> = {}): PlayerInput {
  return { seq: 1, moveX: 0, moveZ: 0, yaw: 0, running: false, jumping: false, ...over };
}

const speed = (p: PlayerState): number => Math.hypot(p.vel.x, p.vel.z);

describe('applyMovementInput', () => {
  it('walks at WALK_SPEED along a single axis', () => {
    const p = makePlayer();
    applyMovementInput(p, input({ moveZ: 1 }));
    expect(p.vel.z).toBeCloseTo(WALK_SPEED, 6);
    expect(p.vel.x).toBeCloseTo(0, 6);
  });

  it('rotates forward input by yaw into world space (matches client prediction)', () => {
    // Regression guard: forward (moveZ=1) while FACING +X (yaw=pi/2) must move +X, not +Z.
    // The original server ignored yaw for movement, which would rubber-band against the
    // client's camera-relative prediction once wired (PROJECT_BRIEF §3/§4.2).
    const p = makePlayer();
    applyMovementInput(p, input({ moveZ: 1, yaw: Math.PI / 2 }));
    expect(p.vel.x).toBeCloseTo(WALK_SPEED, 6);
    expect(p.vel.z).toBeCloseTo(0, 6);
  });

  it('runs at RUN_SPEED when running', () => {
    const p = makePlayer();
    applyMovementInput(p, input({ moveX: 1, running: true }));
    // Strafe-right is world -X under the behind-avatar camera; magnitude is RUN_SPEED.
    expect(p.vel.x).toBeCloseTo(-RUN_SPEED, 6);
  });

  it('clamps diagonal speed to WALK_SPEED (no diagonal speed boost)', () => {
    const p = makePlayer();
    applyMovementInput(p, input({ moveX: 1, moveZ: 1 }));
    expect(speed(p)).toBeCloseTo(WALK_SPEED, 6);
  });

  it('clamps an over-reported stick magnitude to WALK_SPEED', () => {
    const p = makePlayer();
    applyMovementInput(p, input({ moveX: 100, moveZ: 0 }));
    expect(p.vel.x).toBeCloseTo(-WALK_SPEED, 6);
  });

  it('scales sub-unit input proportionally (half stick = half speed)', () => {
    const p = makePlayer();
    applyMovementInput(p, input({ moveZ: 0.5 }));
    expect(p.vel.z).toBeCloseTo(WALK_SPEED * 0.5, 6);
  });

  it('zeroes velocity on no input', () => {
    const p = makePlayer();
    p.vel = { x: 5, y: 0, z: 5 };
    applyMovementInput(p, input());
    expect(p.vel.x).toBe(0);
    expect(p.vel.z).toBe(0);
  });

  it('applies authoritative yaw and never reads client position', () => {
    const p = makePlayer();
    applyMovementInput(p, input({ yaw: 1.23 }));
    expect(p.yaw).toBeCloseTo(1.23, 6);
    // PlayerInput carries no position fields, so position is untouched here.
    expect(p.pos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('ignores non-finite move/yaw values (hostile client defense)', () => {
    const p = makePlayer();
    p.yaw = 0.5;
    applyMovementInput(p, input({ moveX: NaN, moveZ: Infinity, yaw: NaN }));
    expect(p.vel.x).toBe(0);
    expect(p.vel.z).toBe(0);
    expect(p.yaw).toBe(0.5); // unchanged
  });

  it('leaves Y velocity untouched (jump/gravity is a later slice)', () => {
    const p = makePlayer();
    p.vel.y = 9;
    applyMovementInput(p, input({ moveX: 1 }));
    expect(p.vel.y).toBe(9);
  });
});

describe('assignTeam', () => {
  it('round-robins across MATCH_TEAMS', () => {
    const teams = Array.from({ length: MATCH_TEAMS * 2 }, (_, i) => assignTeam(i, MATCH_TEAMS));
    expect(teams.slice(0, MATCH_TEAMS)).toEqual([0, 1, 2, 3]);
    expect(teams.slice(MATCH_TEAMS)).toEqual([0, 1, 2, 3]);
  });

  it('balances: each team gets one of the first MATCH_TEAMS joiners', () => {
    const counts = new Array(MATCH_TEAMS).fill(0);
    for (let i = 0; i < MATCH_TEAMS; i++) counts[assignTeam(i, MATCH_TEAMS)] += 1;
    expect(counts.every((c) => c === 1)).toBe(true);
  });
});
