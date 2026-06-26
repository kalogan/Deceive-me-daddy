import {
  FIRE_DAMAGE,
  FIRE_RANGE,
  MAX_HEALTH,
  REVIVE_RANGE,
  REVIVE_WINDOW_MS,
} from '@deceive/shared';
import { describe, expect, it } from 'vitest';
import { FixedClock } from './clock';
import { resolveFire, reviveTeammate, stepCombat } from './combat';
import type { Rng } from './rng';
import type { PlayerState, SimDeps, Vec3 } from './world';
import { createWorld, spawnPlayer } from './world';

// Combat never reads rng; an inert stub keeps things deterministic + engine-agnostic.
function makeDeps(clock: FixedClock): SimDeps {
  return { clock, rng: { next: () => 0 } as unknown as Rng };
}

function place(
  world: ReturnType<typeof createWorld>,
  id: string,
  team: number,
  pos: Vec3,
  opts: { yaw?: number; health?: number } = {},
): PlayerState {
  const p = spawnPlayer(world, id, team, pos);
  p.yaw = opts.yaw ?? 0;
  p.health = opts.health ?? MAX_HEALTH;
  return p;
}

describe('resolveFire — hitscan + cone', () => {
  it('hits an enemy directly ahead in range (forward = +Z at yaw 0)', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    place(world, 's', 0, { x: 0, y: 0, z: 0 });
    const enemy = place(world, 'e', 1, { x: 0, y: 0, z: 10 });
    resolveFire(world, 's', makeDeps(clock));
    expect(enemy.health).toBe(MAX_HEALTH - FIRE_DAMAGE);
    expect(enemy.phase).toBe('blended');
  });

  it('does NOT hit a target behind the shooter (outside the cone)', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    place(world, 's', 0, { x: 0, y: 0, z: 0 });
    const enemy = place(world, 'e', 1, { x: 0, y: 0, z: -10 }); // behind (-Z)
    resolveFire(world, 's', makeDeps(clock));
    expect(enemy.health).toBe(MAX_HEALTH);
  });

  it('does NOT hit a target beyond FIRE_RANGE', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    place(world, 's', 0, { x: 0, y: 0, z: 0 });
    const enemy = place(world, 'e', 1, { x: 0, y: 0, z: FIRE_RANGE + 5 });
    resolveFire(world, 's', makeDeps(clock));
    expect(enemy.health).toBe(MAX_HEALTH);
  });

  it('does NOT hit a teammate ahead (no friendly fire)', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    place(world, 's', 0, { x: 0, y: 0, z: 0 });
    const mate = place(world, 'm', 0, { x: 0, y: 0, z: 10 }); // same team
    resolveFire(world, 's', makeDeps(clock));
    expect(mate.health).toBe(MAX_HEALTH);
  });

  it('hits the NEAREST in-cone enemy when two are aligned', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    place(world, 's', 0, { x: 0, y: 0, z: 0 });
    const near = place(world, 'near', 1, { x: 0, y: 0, z: 5 });
    const far = place(world, 'far', 1, { x: 0, y: 0, z: 15 });
    resolveFire(world, 's', makeDeps(clock));
    expect(near.health).toBe(MAX_HEALTH - FIRE_DAMAGE);
    expect(far.health).toBe(MAX_HEALTH);
  });

  it('downs the target when damage reaches 0 health', () => {
    const clock = new FixedClock(1000);
    const world = createWorld();
    place(world, 's', 0, { x: 0, y: 0, z: 0 });
    const enemy = place(world, 'e', 1, { x: 0, y: 0, z: 10 }, { health: FIRE_DAMAGE - 1 });
    resolveFire(world, 's', makeDeps(clock));
    expect(enemy.health).toBe(0);
    expect(enemy.phase).toBe('downed');
    expect(enemy.downedUntilMs).toBe(1000 + REVIVE_WINDOW_MS);
  });

  it('does not shoot a downed or out target again', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    place(world, 's', 0, { x: 0, y: 0, z: 0 });
    const downed = place(world, 'd', 1, { x: 0, y: 0, z: 5 }, { health: 0 });
    downed.phase = 'downed';
    downed.downedUntilMs = REVIVE_WINDOW_MS;
    const out = place(world, 'o', 1, { x: 0, y: 0, z: 8 }, { health: 0 });
    out.phase = 'out';
    resolveFire(world, 's', makeDeps(clock));
    expect(downed.health).toBe(0);
    expect(downed.phase).toBe('downed');
    expect(downed.downedUntilMs).toBe(REVIVE_WINDOW_MS); // untouched
    expect(out.phase).toBe('out');
  });

  it('is a no-op for a missing or incapacitated shooter', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    const enemy = place(world, 'e', 1, { x: 0, y: 0, z: 10 });
    expect(() => resolveFire(world, 'nobody', makeDeps(clock))).not.toThrow();
    expect(enemy.health).toBe(MAX_HEALTH);

    const shooter = place(world, 's', 0, { x: 0, y: 0, z: 0 });
    shooter.phase = 'downed';
    resolveFire(world, 's', makeDeps(clock));
    expect(enemy.health).toBe(MAX_HEALTH);
  });
});

describe('reviveTeammate', () => {
  function downedWorld() {
    const world = createWorld();
    const reviver = place(world, 'r', 0, { x: 0, y: 0, z: 0 });
    const target = place(world, 't', 0, { x: 0, y: 0, z: 1 }, { health: 0 });
    target.phase = 'downed';
    target.downedUntilMs = REVIVE_WINDOW_MS;
    return { world, reviver, target };
  }

  it('revives a same-team downed teammate in range', () => {
    const clock = new FixedClock(0);
    const { world, target } = downedWorld();
    const ok = reviveTeammate(world, 'r', 't', makeDeps(clock));
    expect(ok).toBe(true);
    expect(target.phase).toBe('blended');
    expect(target.health).toBe(MAX_HEALTH);
    expect(target.downedUntilMs).toBe(0);
  });

  it('fails on the wrong team', () => {
    const clock = new FixedClock(0);
    const { world, reviver, target } = downedWorld();
    reviver.team = 1;
    const ok = reviveTeammate(world, 'r', 't', makeDeps(clock));
    expect(ok).toBe(false);
    expect(target.phase).toBe('downed');
  });

  it('fails when the target is too far', () => {
    const clock = new FixedClock(0);
    const { world, target } = downedWorld();
    target.pos.z = REVIVE_RANGE + 1;
    const ok = reviveTeammate(world, 'r', 't', makeDeps(clock));
    expect(ok).toBe(false);
    expect(target.phase).toBe('downed');
  });

  it('fails when the target is not downed', () => {
    const clock = new FixedClock(0);
    const { world, target } = downedWorld();
    target.phase = 'blended';
    const ok = reviveTeammate(world, 'r', 't', makeDeps(clock));
    expect(ok).toBe(false);
  });

  it('fails for a missing reviver or target', () => {
    const clock = new FixedClock(0);
    const { world } = downedWorld();
    expect(reviveTeammate(world, 'nobody', 't', makeDeps(clock))).toBe(false);
    expect(reviveTeammate(world, 'r', 'nobody', makeDeps(clock))).toBe(false);
  });

  it('fails when the reviver is itself downed/out', () => {
    const clock = new FixedClock(0);
    const { world, reviver } = downedWorld();
    reviver.phase = 'downed';
    expect(reviveTeammate(world, 'r', 't', makeDeps(clock))).toBe(false);
  });
});

describe('stepCombat — downed -> out', () => {
  it('eliminates a downed player once the revive window has lapsed', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    const p = place(world, 'p', 0, { x: 0, y: 0, z: 0 }, { health: 0 });
    p.phase = 'downed';
    p.downedUntilMs = REVIVE_WINDOW_MS;
    clock.advance(REVIVE_WINDOW_MS);
    stepCombat(world, makeDeps(clock));
    expect(p.phase).toBe('out');
    expect(p.downedUntilMs).toBe(0);
  });

  it('leaves a downed player downed before the deadline', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    const p = place(world, 'p', 0, { x: 0, y: 0, z: 0 }, { health: 0 });
    p.phase = 'downed';
    p.downedUntilMs = REVIVE_WINDOW_MS;
    clock.advance(REVIVE_WINDOW_MS - 1);
    stepCombat(world, makeDeps(clock));
    expect(p.phase).toBe('downed');
    expect(p.downedUntilMs).toBe(REVIVE_WINDOW_MS);
  });
});
