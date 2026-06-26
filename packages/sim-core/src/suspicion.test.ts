import {
  type ClearanceTier,
  LARCIN_SUSPICION_FACTOR,
  SUSPICION_BLENDED_AT,
  SUSPICION_DECAY,
  SUSPICION_MAX,
  SUSPICION_RISE_FORBIDDEN,
  SUSPICION_RISE_RUNNING,
  SUSPICION_SUSPICIOUS_AT,
  TIER_SCRUTINY,
} from '@deceive/shared';
import { describe, expect, it } from 'vitest';
import type { Clock } from './clock';
import type { Rng } from './rng';
import { stepSuspicion } from './suspicion';
import type { AgentPhase, SimDeps } from './world';
import { createWorld, spawnPlayer } from './world';

// stepSuspicion never reads clock/rng, but SimDeps must be supplied. Inert stubs keep the
// test deterministic and engine-agnostic (no Date.now / Math.random).
const deps: SimDeps = {
  clock: { now: () => 0 } as unknown as Clock,
  rng: { next: () => 0 } as unknown as Rng,
};

function setup(opts: {
  tier?: ClearanceTier;
  inForbiddenZone?: boolean;
  isRunning?: boolean;
  suspicion?: number;
  phase?: AgentPhase;
  agentId?: Parameters<typeof spawnPlayer>[5];
}) {
  const world = createWorld();
  const p = spawnPlayer(world, 'p1', 0, { x: 0, y: 0, z: 0 }, false, opts.agentId ?? 'squire');
  p.disguiseTier = opts.tier ?? 'civilian';
  p.inForbiddenZone = opts.inForbiddenZone ?? false;
  p.isRunning = opts.isRunning ?? false;
  p.suspicion = opts.suspicion ?? 0;
  p.phase = opts.phase ?? 'blended';
  return { world, p };
}

// Advance `n` ticks of `dtMs` each.
function advance(world: ReturnType<typeof setup>['world'], dtMs: number, n = 1) {
  for (let i = 0; i < n; i += 1) stepSuspicion(world, deps, dtMs);
}

describe('stepSuspicion — rise axes', () => {
  it('raises suspicion in a forbidden zone over time', () => {
    const { world, p } = setup({ inForbiddenZone: true });
    advance(world, 1000);
    expect(p.suspicion).toBeCloseTo(SUSPICION_RISE_FORBIDDEN, 5);
  });

  it('raises suspicion while running', () => {
    const { world, p } = setup({ isRunning: true });
    advance(world, 1000);
    expect(p.suspicion).toBeCloseTo(SUSPICION_RISE_RUNNING, 5);
  });

  it('raises faster when forbidden AND running together', () => {
    const both = setup({ inForbiddenZone: true, isRunning: true });
    const onlyForbidden = setup({ inForbiddenZone: true });
    advance(both.world, 1000);
    advance(onlyForbidden.world, 1000);
    expect(both.p.suspicion).toBeGreaterThan(onlyForbidden.p.suspicion);
    expect(both.p.suspicion).toBeCloseTo(
      SUSPICION_RISE_FORBIDDEN + SUSPICION_RISE_RUNNING,
      5,
    );
  });

  it('scales the rise by dtMs (half a second = half the rise)', () => {
    const { world, p } = setup({ inForbiddenZone: true });
    advance(world, 500);
    expect(p.suspicion).toBeCloseTo(SUSPICION_RISE_FORBIDDEN * 0.5, 5);
  });
});

describe('stepSuspicion — TIER_SCRUTINY', () => {
  it('a higher-tier disguise raises faster than civilian for the same condition', () => {
    const scientist = setup({ tier: 'scientist', inForbiddenZone: true });
    const civilian = setup({ tier: 'civilian', inForbiddenZone: true });
    advance(scientist.world, 1000);
    advance(civilian.world, 1000);
    expect(scientist.p.suspicion).toBeGreaterThan(civilian.p.suspicion);
    expect(scientist.p.suspicion).toBeCloseTo(
      SUSPICION_RISE_FORBIDDEN * TIER_SCRUTINY.scientist,
      5,
    );
    expect(civilian.p.suspicion).toBeCloseTo(
      SUSPICION_RISE_FORBIDDEN * TIER_SCRUTINY.civilian,
      5,
    );
  });

  it('scrutiny scales the rise but NOT the decay', () => {
    const { world, p } = setup({ tier: 'scientist', suspicion: 40 });
    advance(world, 1000); // acting normal -> flat decay regardless of tier
    expect(p.suspicion).toBeCloseTo(40 - SUSPICION_DECAY, 5);
  });
});

describe("stepSuspicion — Larcin 'Merci beaucoup!' passive", () => {
  it("scales Larcin's suspicion RISE down vs another agent under the same input", () => {
    const larcin = setup({ agentId: 'larcin', inForbiddenZone: true });
    const squire = setup({ agentId: 'squire', inForbiddenZone: true });
    advance(larcin.world, 1000);
    advance(squire.world, 1000);
    expect(larcin.p.suspicion).toBeLessThan(squire.p.suspicion);
    // Larcin's rise is exactly the squire's, scaled by the factor.
    expect(larcin.p.suspicion).toBeCloseTo(
      SUSPICION_RISE_FORBIDDEN * LARCIN_SUSPICION_FACTOR,
      5,
    );
    expect(squire.p.suspicion).toBeCloseTo(SUSPICION_RISE_FORBIDDEN, 5);
  });

  it("does NOT scale Larcin's DECAY (factor touches only the rise)", () => {
    const { world, p } = setup({ agentId: 'larcin', suspicion: 50 });
    advance(world, 1000); // acting normal -> flat decay, same as any agent
    expect(p.suspicion).toBeCloseTo(50 - SUSPICION_DECAY, 5);
  });
});

describe('stepSuspicion — decay + clamps', () => {
  it('acting normal decays suspicion toward 0', () => {
    const { world, p } = setup({ suspicion: 50 });
    advance(world, 1000);
    expect(p.suspicion).toBeCloseTo(50 - SUSPICION_DECAY, 5);
  });

  it('clamps decay at 0 (never negative)', () => {
    const { world, p } = setup({ suspicion: 5 });
    advance(world, 1000); // would go to 5 - 12 = -7
    expect(p.suspicion).toBe(0);
  });

  it('clamps rise at SUSPICION_MAX', () => {
    const { world, p } = setup({ tier: 'scientist', inForbiddenZone: true, isRunning: true });
    advance(world, 1000, 100); // far more than enough to saturate
    expect(p.suspicion).toBe(SUSPICION_MAX);
  });
});

describe('stepSuspicion — phase hysteresis', () => {
  it('flips blended -> suspicious at/above the high threshold', () => {
    const { world, p } = setup({
      phase: 'blended',
      suspicion: SUSPICION_SUSPICIOUS_AT - SUSPICION_RISE_FORBIDDEN * 0.5,
      inForbiddenZone: true,
    });
    advance(world, 1000); // rises across the threshold
    expect(p.suspicion).toBeGreaterThanOrEqual(SUSPICION_SUSPICIOUS_AT);
    expect(p.phase).toBe('suspicious');
  });

  it('does NOT flip to suspicious while below the high threshold', () => {
    const { world, p } = setup({ phase: 'blended', suspicion: 10, isRunning: true });
    advance(world, 1000); // 10 + 8 = 18, still below 50
    expect(p.suspicion).toBeLessThan(SUSPICION_SUSPICIOUS_AT);
    expect(p.phase).toBe('blended');
  });

  it('returns suspicious -> blended at/below the low threshold', () => {
    const { world, p } = setup({ phase: 'suspicious', suspicion: SUSPICION_BLENDED_AT + 5 });
    advance(world, 1000); // decays below the low threshold
    expect(p.suspicion).toBeLessThanOrEqual(SUSPICION_BLENDED_AT);
    expect(p.phase).toBe('blended');
  });

  it('stays suspicious between the two thresholds (no chatter)', () => {
    const mid = (SUSPICION_SUSPICIOUS_AT + SUSPICION_BLENDED_AT) / 2;
    const { world, p } = setup({ phase: 'suspicious', suspicion: mid });
    advance(world, 100); // tiny decay, stays in the dead band
    expect(p.suspicion).toBeGreaterThan(SUSPICION_BLENDED_AT);
    expect(p.suspicion).toBeLessThan(SUSPICION_SUSPICIOUS_AT);
    expect(p.phase).toBe('suspicious');
  });

  it("never changes a 'revealed' player's phase", () => {
    const { world, p } = setup({ phase: 'revealed', inForbiddenZone: true, suspicion: 90 });
    advance(world, 1000);
    expect(p.phase).toBe('revealed');
    // Meter still tracks, but the phase is owned by detection/combat.
    expect(p.suspicion).toBeGreaterThan(90);
  });

  it("never touches a 'downed' player (no suspicion bookkeeping)", () => {
    const { world, p } = setup({ phase: 'downed', inForbiddenZone: true, suspicion: 30 });
    advance(world, 1000);
    expect(p.phase).toBe('downed');
    expect(p.suspicion).toBe(30); // skipped entirely
  });

  it("never touches an 'out' player", () => {
    const { world, p } = setup({ phase: 'out', isRunning: true, suspicion: 30 });
    advance(world, 1000);
    expect(p.phase).toBe('out');
    expect(p.suspicion).toBe(30);
  });
});
