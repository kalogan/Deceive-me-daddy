import {
  REVEAL_WINDOW_MS,
  SUSPICION_BLENDED_AT,
  SUSPICION_MAX,
  SUSPICION_SUSPICIOUS_AT,
} from '@deceive/shared';
import { describe, expect, it } from 'vitest';
import { FixedClock } from './clock';
import { hardReveal, stepDetection } from './detection';
import type { Rng } from './rng';
import type { AgentPhase, SimDeps } from './world';
import { createWorld, spawnPlayer } from './world';

// detection never reads rng; an inert stub keeps things deterministic + engine-agnostic.
function makeDeps(clock: FixedClock): SimDeps {
  return { clock, rng: { next: () => 0 } as unknown as Rng };
}

function setup(opts: { suspicion?: number; phase?: AgentPhase; revealedUntilMs?: number } = {}) {
  const clock = new FixedClock(0);
  const deps = makeDeps(clock);
  const world = createWorld();
  const p = spawnPlayer(world, 'p1', 0, { x: 0, y: 0, z: 0 });
  p.suspicion = opts.suspicion ?? 0;
  p.phase = opts.phase ?? 'blended';
  p.revealedUntilMs = opts.revealedUntilMs ?? 0;
  return { world, deps, clock, p };
}

describe('hardReveal', () => {
  it("sets phase 'revealed' + window = now + REVEAL_WINDOW_MS", () => {
    const { world, deps, clock, p } = setup();
    clock.advance(1234);
    hardReveal(world, 'p1', deps);
    expect(p.phase).toBe('revealed');
    expect(p.revealedUntilMs).toBe(1234 + REVEAL_WINDOW_MS);
  });

  it('refreshing extends the window from the current time', () => {
    const { world, deps, clock, p } = setup();
    hardReveal(world, 'p1', deps);
    expect(p.revealedUntilMs).toBe(REVEAL_WINDOW_MS);
    clock.advance(3000);
    hardReveal(world, 'p1', deps);
    expect(p.phase).toBe('revealed');
    expect(p.revealedUntilMs).toBe(3000 + REVEAL_WINDOW_MS);
  });

  it("does not affect a 'downed' player", () => {
    const { world, deps, p } = setup({ phase: 'downed' });
    hardReveal(world, 'p1', deps);
    expect(p.phase).toBe('downed');
    expect(p.revealedUntilMs).toBe(0);
  });

  it("does not affect an 'out' player", () => {
    const { world, deps, p } = setup({ phase: 'out' });
    hardReveal(world, 'p1', deps);
    expect(p.phase).toBe('out');
    expect(p.revealedUntilMs).toBe(0);
  });

  it('is a no-op for a missing player', () => {
    const { world, deps } = setup();
    expect(() => hardReveal(world, 'nobody', deps)).not.toThrow();
    expect(world.players.has('nobody')).toBe(false);
  });
});

describe('stepDetection — slow-burn blow', () => {
  it('reveals a player whose suspicion is at MAX', () => {
    const { world, deps, p } = setup({ suspicion: SUSPICION_MAX, phase: 'suspicious' });
    stepDetection(world, deps);
    expect(p.phase).toBe('revealed');
    expect(p.revealedUntilMs).toBe(REVEAL_WINDOW_MS);
  });

  it('does NOT reveal a player below MAX', () => {
    const { world, deps, p } = setup({ suspicion: SUSPICION_MAX - 1, phase: 'suspicious' });
    stepDetection(world, deps);
    expect(p.phase).toBe('suspicious');
    expect(p.revealedUntilMs).toBe(0);
  });
});

describe('stepDetection — window expiry + revert', () => {
  it('stays revealed before the window lapses', () => {
    const { world, deps, clock } = setup();
    hardReveal(world, 'p1', deps);
    const p = world.players.get('p1')!;
    clock.advance(REVEAL_WINDOW_MS - 1);
    stepDetection(world, deps);
    expect(p.phase).toBe('revealed');
    expect(p.revealedUntilMs).toBe(REVEAL_WINDOW_MS);
  });

  it("reverts to 'suspicious' when suspicion is still high", () => {
    const { world, deps, clock } = setup({ suspicion: SUSPICION_SUSPICIOUS_AT });
    hardReveal(world, 'p1', deps);
    const p = world.players.get('p1')!;
    clock.advance(REVEAL_WINDOW_MS);
    stepDetection(world, deps);
    expect(p.phase).toBe('suspicious');
    expect(p.revealedUntilMs).toBe(0);
  });

  it("reverts to 'blended' when suspicion is low", () => {
    const { world, deps, clock } = setup({ suspicion: SUSPICION_BLENDED_AT });
    hardReveal(world, 'p1', deps);
    const p = world.players.get('p1')!;
    clock.advance(REVEAL_WINDOW_MS);
    stepDetection(world, deps);
    expect(p.phase).toBe('blended');
    expect(p.revealedUntilMs).toBe(0);
  });

  it('a player still at MAX suspicion re-reveals after a lapse', () => {
    const { world, deps, clock } = setup({ suspicion: SUSPICION_MAX });
    hardReveal(world, 'p1', deps);
    const p = world.players.get('p1')!;
    const firstWindow = p.revealedUntilMs;
    clock.advance(REVEAL_WINDOW_MS);
    // This tick clears the lapsed window (reverting to 'suspicious' since still maxed)...
    stepDetection(world, deps);
    expect(p.phase).toBe('suspicious');
    expect(p.revealedUntilMs).toBe(0);
    // ...and the very next tick re-reveals, since suspicion is still at MAX (intended).
    stepDetection(world, deps);
    expect(p.phase).toBe('revealed');
    expect(p.revealedUntilMs).toBe(clock.now() + REVEAL_WINDOW_MS);
    expect(p.revealedUntilMs).toBeGreaterThan(firstWindow);
  });
});

describe('stepDetection — downed/out untouched', () => {
  it("never alters a 'downed' player even at MAX suspicion", () => {
    const { world, deps, p } = setup({ phase: 'downed', suspicion: SUSPICION_MAX });
    stepDetection(world, deps);
    expect(p.phase).toBe('downed');
    expect(p.revealedUntilMs).toBe(0);
  });

  it("never alters an 'out' player even with an expired window", () => {
    const { world, deps, clock, p } = setup({
      phase: 'out',
      suspicion: SUSPICION_MAX,
      revealedUntilMs: 5,
    });
    clock.advance(1000);
    stepDetection(world, deps);
    expect(p.phase).toBe('out');
    expect(p.revealedUntilMs).toBe(5);
  });
});
