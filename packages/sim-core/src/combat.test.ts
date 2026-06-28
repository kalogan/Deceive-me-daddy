import {
  AGENTS_BY_ID,
  CHAVEZ_REGEN_PER_SEC,
  FIRE_DAMAGE,
  FIRE_RANGE,
  MAX_HEALTH,
  REVEAL_WINDOW_MS,
  REVIVE_RANGE,
  REVIVE_WINDOW_MS,
  type AgentId,
} from '@deceive/shared';
import { describe, expect, it } from 'vitest';
import { FixedClock } from './clock';
import { armFire, canFire, resolveFire, reviveTeammate, stepCombat } from './combat';
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
  opts: { yaw?: number; health?: number; agentId?: PlayerState['agentId'] } = {},
): PlayerState {
  const p = spawnPlayer(world, id, team, pos, false, opts.agentId ?? 'squire');
  p.yaw = opts.yaw ?? 0;
  p.health = opts.health ?? MAX_HEALTH;
  return p;
}

// The default `place` shooter is a Squire; firing now reads its per-agent weapon damage
// (data-driven), so the hitscan/cone assertions below use the Squire's own damage. (The
// global FIRE_DAMAGE constant is only the fallback when an agent has no weaponStats.)
const SQUIRE_DAMAGE = AGENTS_BY_ID.squire.weaponStats.damage;

describe('resolveFire — hitscan + cone', () => {
  it('hits an enemy directly ahead in range (forward = +Z at yaw 0)', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    place(world, 's', 0, { x: 0, y: 0, z: 0 });
    const enemy = place(world, 'e', 1, { x: 0, y: 0, z: 10 });
    resolveFire(world, 's', makeDeps(clock));
    expect(enemy.health).toBe(MAX_HEALTH - SQUIRE_DAMAGE);
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
    expect(near.health).toBe(MAX_HEALTH - SQUIRE_DAMAGE);
    expect(far.health).toBe(MAX_HEALTH);
  });

  it('downs the target when damage reaches 0 health', () => {
    const clock = new FixedClock(1000);
    const world = createWorld();
    place(world, 's', 0, { x: 0, y: 0, z: 0 });
    const enemy = place(world, 'e', 1, { x: 0, y: 0, z: 10 }, { health: SQUIRE_DAMAGE - 1 });
    resolveFire(world, 's', makeDeps(clock));
    expect(enemy.health).toBe(0);
    expect(enemy.phase).toBe('downed');
    expect(enemy.downedUntilMs).toBe(1000 + REVIVE_WINDOW_MS);
  });

  it('bumps the shooter hitSeq on a landed hit (drives the hitmarker), not downSeq', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    const shooter = place(world, 's', 0, { x: 0, y: 0, z: 0 });
    place(world, 'e', 1, { x: 0, y: 0, z: 10 }); // full health → hit, not downed
    resolveFire(world, 's', makeDeps(clock));
    expect(shooter.hitSeq).toBe(1);
    expect(shooter.downSeq).toBe(0);
  });

  it('bumps BOTH shooter hitSeq and downSeq when the shot downs the target', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    const shooter = place(world, 's', 0, { x: 0, y: 0, z: 0 });
    place(world, 'e', 1, { x: 0, y: 0, z: 10 }, { health: SQUIRE_DAMAGE - 1 });
    resolveFire(world, 's', makeDeps(clock));
    expect(shooter.hitSeq).toBe(1);
    expect(shooter.downSeq).toBe(1);
  });

  it('does NOT bump the shooter counters on a miss', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    const shooter = place(world, 's', 0, { x: 0, y: 0, z: 0 });
    place(world, 'e', 1, { x: 0, y: 0, z: -10 }); // behind → miss
    resolveFire(world, 's', makeDeps(clock));
    expect(shooter.hitSeq).toBe(0);
    expect(shooter.downSeq).toBe(0);
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

describe('resolveFire — per-agent weapon depth', () => {
  // Each agent deals ITS OWN weaponStats.damage on a clean hit.
  for (const agentId of ['squire', 'chavez', 'larcin'] as AgentId[]) {
    it(`a ${agentId} shot deals its own weapon damage`, () => {
      const clock = new FixedClock(0);
      const world = createWorld();
      place(world, 's', 0, { x: 0, y: 0, z: 0 }, { agentId });
      const enemy = place(world, 'e', 1, { x: 0, y: 0, z: 5 });
      resolveFire(world, 's', makeDeps(clock));
      expect(enemy.health).toBe(MAX_HEALTH - AGENTS_BY_ID[agentId].weaponStats.damage);
    });
  }

  it("uses the shooter's weapon RANGE (Chavez's short reach misses a Squire-range target)", () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    // Chavez range is 24; put the enemy at 26 (out for Chavez, in for a 30-range weapon).
    place(world, 's', 0, { x: 0, y: 0, z: 0 }, { agentId: 'chavez' });
    const enemy = place(world, 'e', 1, { x: 0, y: 0, z: 26 });
    expect(AGENTS_BY_ID.chavez.weaponStats.range).toBeLessThan(26);
    resolveFire(world, 's', makeDeps(clock));
    expect(enemy.health).toBe(MAX_HEALTH); // beyond Chavez's range — no hit
  });
});

describe('fire-rate gate — canFire / armFire', () => {
  it('rejects a second shot before the weapon fireCooldownMs, allows it after', () => {
    const clock = new FixedClock(0);
    const shooter = (() => {
      const world = createWorld();
      return place(world, 's', 0, { x: 0, y: 0, z: 0 }, { agentId: 'chavez' });
    })();
    const cd = AGENTS_BY_ID.chavez.weaponStats.fireCooldownMs;
    // First shot is allowed; arming sets the next-fire time.
    expect(canFire(shooter, clock.now())).toBe(true);
    armFire(shooter, clock.now());
    expect(shooter.nextFireAtMs).toBe(cd);
    // A shot one tick later (still within the cooldown) is rejected...
    clock.advance(cd - 1);
    expect(canFire(shooter, clock.now())).toBe(false);
    // ...and allowed once the cooldown elapses.
    clock.advance(1);
    expect(canFire(shooter, clock.now())).toBe(true);
  });

  it('a downed shooter cannot fire', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    const shooter = place(world, 's', 0, { x: 0, y: 0, z: 0 });
    shooter.phase = 'downed';
    expect(canFire(shooter, clock.now())).toBe(false);
  });
});

describe("resolveFire — Squire 'Sixth Sense' passive", () => {
  it('hard-reveals the SHOOTER to everyone when a Squire target is hit', () => {
    const clock = new FixedClock(1000);
    const world = createWorld();
    // Shooter is a non-Squire (chavez) so its reveal is purely the passive's doing.
    const shooter = place(world, 's', 0, { x: 0, y: 0, z: 0 }, { agentId: 'chavez' });
    const squire = place(world, 'e', 1, { x: 0, y: 0, z: 10 }, { agentId: 'squire' });
    resolveFire(world, 's', makeDeps(clock));
    // The Squire took damage...
    expect(squire.health).toBe(MAX_HEALTH - FIRE_DAMAGE);
    // ...and traced its assailant: the shooter is now revealed for the reveal window.
    expect(shooter.phase).toBe('revealed');
    expect(shooter.revealedUntilMs).toBe(1000 + REVEAL_WINDOW_MS);
  });

  it('does NOT reveal the shooter when the hit target is not a Squire', () => {
    const clock = new FixedClock(1000);
    const world = createWorld();
    const shooter = place(world, 's', 0, { x: 0, y: 0, z: 0 }, { agentId: 'chavez' });
    const larcin = place(world, 'e', 1, { x: 0, y: 0, z: 10 }, { agentId: 'larcin' });
    resolveFire(world, 's', makeDeps(clock));
    expect(larcin.health).toBe(MAX_HEALTH - FIRE_DAMAGE);
    expect(shooter.phase).toBe('blended'); // untouched — no Sixth Sense trace
    expect(shooter.revealedUntilMs).toBe(0);
  });
});

describe("stepCombat — Chavez 'Tough Luck' regen", () => {
  it('regenerates a hurt living Chavez over time, scaled by dt', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    const chavez = place(world, 'c', 0, { x: 0, y: 0, z: 0 }, { agentId: 'chavez', health: 50 });
    stepCombat(world, makeDeps(clock), 1000); // one second
    expect(chavez.health).toBeCloseTo(50 + CHAVEZ_REGEN_PER_SEC, 5);
  });

  it('clamps regen at MAX_HEALTH (never overheals)', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    const chavez = place(world, 'c', 0, { x: 0, y: 0, z: 0 }, {
      agentId: 'chavez',
      health: MAX_HEALTH - 1,
    });
    stepCombat(world, makeDeps(clock), 1000); // a full second would add ~8, but clamps
    expect(chavez.health).toBe(MAX_HEALTH);
  });

  it('does NOT regen a downed Chavez (no self-revive)', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    const chavez = place(world, 'c', 0, { x: 0, y: 0, z: 0 }, { agentId: 'chavez', health: 0 });
    chavez.phase = 'downed';
    chavez.downedUntilMs = REVIVE_WINDOW_MS;
    stepCombat(world, makeDeps(clock), 1000);
    expect(chavez.health).toBe(0);
    expect(chavez.phase).toBe('downed');
  });

  it('does NOT regen a non-Chavez agent', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    const squire = place(world, 's', 0, { x: 0, y: 0, z: 0 }, { agentId: 'squire', health: 50 });
    stepCombat(world, makeDeps(clock), 1000);
    expect(squire.health).toBe(50); // unchanged
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
