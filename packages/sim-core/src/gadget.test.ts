// Tests for the deployable GADGET system (PROJECT_BRIEF §2 — the agents' second active slot).
// Covers the timing/cooldown core + each kind's effect (scan reveal / frag burst / mirage
// escape), reusing existing systems' semantics, all deterministic (FixedClock, no Math.random).
import { AGENTS_BY_ID, HOLO_CRUMB_MS, REVIVE_WINDOW_MS, type AgentId } from '@deceive/shared';
import { describe, expect, it } from 'vitest';
import { triggerAbility } from './ability';
import { FixedClock } from './clock';
import { gadgetCooldownRemaining, isGadgetReady, triggerGadget } from './gadget';
import type { PlayerState, SimDeps, Vec3 } from './world';
import { createWorld, spawnPlayer } from './world';
import type { Rng } from './rng';

function makeDeps(clock: FixedClock): SimDeps {
  return { clock, rng: { next: () => 0 } as unknown as Rng };
}

function place(
  world: ReturnType<typeof createWorld>,
  id: string,
  team: number,
  pos: Vec3,
  agentId: AgentId = 'squire',
): PlayerState {
  return spawnPlayer(world, id, team, pos, false, agentId);
}

describe('triggerGadget — framework', () => {
  it('arms the cooldown from the agent catalog and returns true', () => {
    const clock = new FixedClock(0);
    const deps = makeDeps(clock);
    const world = createWorld();
    const p = place(world, 'p', 0, { x: 0, y: 0, z: 0 }, 'squire');
    clock.advance(500);
    expect(triggerGadget(world, 'p', deps)).toBe(true);
    expect(p.gadgetReadyAtMs).toBe(500 + AGENTS_BY_ID.squire.gadget.cooldownMs);
    expect(isGadgetReady(p, clock.now())).toBe(false);
  });

  it('no-ops (false) for a missing player', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    expect(triggerGadget(world, 'ghost', makeDeps(clock))).toBe(false);
  });

  it('a downed user cannot trigger', () => {
    const clock = new FixedClock(0);
    const deps = makeDeps(clock);
    const world = createWorld();
    const p = place(world, 'p', 0, { x: 0, y: 0, z: 0 }, 'chavez');
    p.phase = 'downed';
    expect(triggerGadget(world, 'p', deps)).toBe(false);
  });

  it('blocks a second use until the cooldown elapses, then allows it', () => {
    const clock = new FixedClock(0);
    const deps = makeDeps(clock);
    const world = createWorld();
    place(world, 'p', 0, { x: 0, y: 0, z: 0 }, 'larcin');
    expect(triggerGadget(world, 'p', deps)).toBe(true);
    clock.advance(AGENTS_BY_ID.larcin.gadget.cooldownMs - 1);
    expect(triggerGadget(world, 'p', deps)).toBe(false);
    clock.advance(1);
    expect(triggerGadget(world, 'p', deps)).toBe(true);
  });

  it('reports cooldown remaining, ticking to zero', () => {
    const clock = new FixedClock(0);
    const deps = makeDeps(clock);
    const world = createWorld();
    const p = place(world, 'p', 0, { x: 0, y: 0, z: 0 }, 'squire');
    triggerGadget(world, 'p', deps);
    const cd = AGENTS_BY_ID.squire.gadget.cooldownMs;
    expect(gadgetCooldownRemaining(p, clock.now())).toBe(cd);
    clock.advance(cd);
    expect(gadgetCooldownRemaining(p, clock.now())).toBe(0);
  });
});

describe('scan gadget (Squire)', () => {
  it('hard-reveals nearby ENEMIES but not self / teammates / out-of-range', () => {
    const clock = new FixedClock(1000);
    const deps = makeDeps(clock);
    const world = createWorld();
    const g = AGENTS_BY_ID.squire.gadget; // radius 14, magnitude 4000
    const user = place(world, 'u', 0, { x: 0, y: 0, z: 0 }, 'squire');
    const enemyNear = place(world, 'en', 1, { x: 0, y: 0, z: 5 }, 'chavez');
    const enemyFar = place(world, 'ef', 1, { x: 0, y: 0, z: g.radius + 5 }, 'chavez');
    const mate = place(world, 'm', 0, { x: 0, y: 0, z: 5 }, 'larcin');

    expect(triggerGadget(world, 'u', deps)).toBe(true);

    expect(enemyNear.phase).toBe('revealed');
    expect(enemyNear.revealedUntilMs).toBe(1000 + g.magnitude);
    expect(enemyFar.phase).toBe('blended'); // out of radius — untouched
    expect(enemyFar.revealedUntilMs).toBe(0);
    expect(mate.phase).toBe('blended'); // same team — untouched
    expect(user.phase).toBe('blended'); // self — untouched
  });
});

describe('frag gadget (Chavez)', () => {
  it('damages nearby enemies and downs them at 0 health', () => {
    const clock = new FixedClock(2000);
    const deps = makeDeps(clock);
    const world = createWorld();
    const g = AGENTS_BY_ID.chavez.gadget; // radius 6, magnitude 45
    place(world, 'u', 0, { x: 0, y: 0, z: 0 }, 'chavez');
    const hurt = place(world, 'h', 1, { x: 0, y: 0, z: 3 }, 'squire');
    const downer = place(world, 'd', 1, { x: 0, y: 0, z: 4 }, 'squire');
    downer.health = g.magnitude - 5; // drops to 0
    const far = place(world, 'f', 1, { x: 0, y: 0, z: g.radius + 3 }, 'squire');

    expect(triggerGadget(world, 'u', deps)).toBe(true);

    expect(hurt.health).toBe(100 - g.magnitude);
    expect(hurt.phase).toBe('blended');
    expect(downer.health).toBe(0);
    expect(downer.phase).toBe('downed');
    expect(downer.downedUntilMs).toBe(2000 + REVIVE_WINDOW_MS);
    expect(far.health).toBe(100); // out of radius — unhurt
  });

  it('skips invulnerable / cloaked targets', () => {
    const clock = new FixedClock(0);
    const deps = makeDeps(clock);
    const world = createWorld();
    place(world, 'u', 0, { x: 0, y: 0, z: 0 }, 'chavez');
    const invuln = place(world, 'iv', 1, { x: 0, y: 0, z: 2 }, 'chavez');
    const cloaked = place(world, 'cl', 2, { x: 0, y: 0, z: 3 }, 'larcin');
    triggerAbility(world, 'iv', deps); // Chavez Hard Boiled → invulnerable
    triggerAbility(world, 'cl', deps); // Larcin Adieu → cloaked

    expect(triggerGadget(world, 'u', deps)).toBe(true);

    expect(invuln.health).toBe(100); // protected — skipped
    expect(cloaked.health).toBe(100); // cloaked — skipped
  });
});

describe('mirage gadget (Larcin)', () => {
  it('drops a Holo-Crumb at the user, zeroes suspicion, and re-blends', () => {
    const clock = new FixedClock(3000);
    const deps = makeDeps(clock);
    const world = createWorld();
    world.tick = 7;
    const user = place(world, 'u', 0, { x: 2, y: 0, z: -1 }, 'larcin');
    user.disguiseTier = 'security';
    user.suspicion = 80;
    user.phase = 'revealed';
    user.revealedUntilMs = 9999;

    expect(triggerGadget(world, 'u', deps)).toBe(true);

    // The decoy crumb at the user's spot, tagged with their CURRENT tier.
    const crumb = world.crumbs.get('gadget:u:7');
    expect(crumb).toBeDefined();
    expect(crumb!.pos).toEqual({ x: 2, y: 0, z: -1 });
    expect(crumb!.tier).toBe('security');
    expect(crumb!.expiresMs).toBe(3000 + HOLO_CRUMB_MS);

    // The user instantly slipped back into the crowd.
    expect(user.suspicion).toBe(0);
    expect(user.phase).toBe('blended');
    expect(user.revealedUntilMs).toBe(0);
  });
});
