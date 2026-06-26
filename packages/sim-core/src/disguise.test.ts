import { describe, expect, it } from 'vitest';
import { DISGUISE_TAKE_RANGE, HOLO_CRUMB_MS, type NpcRoutine } from '@deceive/shared';
import { FixedClock } from './clock';
import { stepCrumbs, takeDisguise } from './disguise';
import type { Npc } from './npc';
import { createRng } from './rng';
import { createWorld, spawnPlayer, type SimDeps, type Vec3, type WorldState } from './world';

// SimDeps backed by a FixedClock we can advance. takeDisguise/stepCrumbs read deps.clock;
// rng is unused by them but the type requires one.
function makeDeps(clock: FixedClock): SimDeps {
  return { clock, rng: createRng(1) };
}

// Drop a minimal NPC directly into the world (avoids depending on a content pack).
function addNpc(world: WorldState, id: string, tier: Npc['tier'], pos: Vec3): Npc {
  const npc: Npc = {
    id,
    tier,
    pos: { ...pos },
    yaw: 0,
    homeZone: '',
    routine: { kind: 'idle', waypoints: [] } as NpcRoutine,
    waypointIndex: 0,
  };
  world.npcs.set(id, npc);
  return npc;
}

describe('takeDisguise', () => {
  it('takes a nearby NPC look: returns true, adopts its tier, drops one OLD-tier crumb', () => {
    const clock = new FixedClock(1000);
    const world = createWorld();
    const player = spawnPlayer(world, 'p1', 0, { x: 0, y: 0, z: 0 });
    // Player starts civilian; the NPC is a scientist 1m away (within range).
    addNpc(world, 'n1', 'scientist', { x: 1, y: 0, z: 0 });

    const ok = takeDisguise(world, 'p1', 'n1', makeDeps(clock));

    expect(ok).toBe(true);
    expect(player.disguiseTier).toBe('scientist');
    expect(player.disguiseId).toBe('n1'); // wears the SPECIFIC NPC's look, not just its tier
    expect(world.crumbs.size).toBe(1);
    const crumb = [...world.crumbs.values()][0]!;
    expect(crumb.tier).toBe('civilian'); // the OLD disguise — the tell
    expect(crumb.pos).toEqual({ x: 0, y: 0, z: 0 }); // dropped at the player's spot
    expect(crumb.expiresMs).toBe(1000 + HOLO_CRUMB_MS);
  });

  it('ignores the y axis: a tall NPC within XZ range is still takeable', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    spawnPlayer(world, 'p1', 0, { x: 0, y: 0, z: 0 });
    addNpc(world, 'n1', 'staff', { x: DISGUISE_TAKE_RANGE - 0.1, y: 100, z: 0 });

    expect(takeDisguise(world, 'p1', 'n1', makeDeps(clock))).toBe(true);
  });

  it('out of range: returns false, no tier change, no crumb', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    const player = spawnPlayer(world, 'p1', 0, { x: 0, y: 0, z: 0 });
    addNpc(world, 'n1', 'security', { x: DISGUISE_TAKE_RANGE + 0.5, y: 0, z: 0 });

    const ok = takeDisguise(world, 'p1', 'n1', makeDeps(clock));

    expect(ok).toBe(false);
    expect(player.disguiseTier).toBe('civilian');
    expect(world.crumbs.size).toBe(0);
  });

  it('downed player: returns false, no crumb', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    const player = spawnPlayer(world, 'p1', 0, { x: 0, y: 0, z: 0 });
    player.phase = 'downed';
    addNpc(world, 'n1', 'staff', { x: 0.5, y: 0, z: 0 });

    expect(takeDisguise(world, 'p1', 'n1', makeDeps(clock))).toBe(false);
    expect(player.disguiseTier).toBe('civilian');
    expect(world.crumbs.size).toBe(0);
  });

  it('out player: returns false', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    const player = spawnPlayer(world, 'p1', 0, { x: 0, y: 0, z: 0 });
    player.phase = 'out';
    addNpc(world, 'n1', 'staff', { x: 0.5, y: 0, z: 0 });

    expect(takeDisguise(world, 'p1', 'n1', makeDeps(clock))).toBe(false);
  });

  it('missing npc: returns false', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    spawnPlayer(world, 'p1', 0, { x: 0, y: 0, z: 0 });

    expect(takeDisguise(world, 'p1', 'nope', makeDeps(clock))).toBe(false);
    expect(world.crumbs.size).toBe(0);
  });

  it('missing player: returns false', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    addNpc(world, 'n1', 'staff', { x: 0, y: 0, z: 0 });

    expect(takeDisguise(world, 'ghost', 'n1', makeDeps(clock))).toBe(false);
    expect(world.crumbs.size).toBe(0);
  });

  it('uses a deterministic id keyed by playerId + tick', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    spawnPlayer(world, 'p1', 0, { x: 0, y: 0, z: 0 });
    addNpc(world, 'n1', 'staff', { x: 0, y: 0, z: 0 });
    world.tick = 7;

    takeDisguise(world, 'p1', 'n1', makeDeps(clock));

    expect(world.crumbs.has('crumb:p1:7')).toBe(true);
  });
});

describe('stepCrumbs', () => {
  it('expires a crumb once the clock passes expiresMs, keeps a fresh one', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    spawnPlayer(world, 'p1', 0, { x: 0, y: 0, z: 0 });
    addNpc(world, 'n1', 'staff', { x: 0, y: 0, z: 0 });

    // Crumb A at t=0 (expires at HOLO_CRUMB_MS).
    takeDisguise(world, 'p1', 'n1', makeDeps(clock));
    // Crumb B dropped later so it outlives A.
    clock.advance(HOLO_CRUMB_MS - 1000);
    world.tick = 99;
    takeDisguise(world, 'p1', 'n1', makeDeps(clock));
    expect(world.crumbs.size).toBe(2);

    // Advance just past A's expiry but not B's.
    clock.advance(1000); // now == HOLO_CRUMB_MS
    stepCrumbs(world, makeDeps(clock));

    expect(world.crumbs.size).toBe(1);
    expect(world.crumbs.has('crumb:p1:99')).toBe(true);
  });

  it('removes nothing when no crumb has expired', () => {
    const clock = new FixedClock(0);
    const world = createWorld();
    spawnPlayer(world, 'p1', 0, { x: 0, y: 0, z: 0 });
    addNpc(world, 'n1', 'staff', { x: 0, y: 0, z: 0 });
    takeDisguise(world, 'p1', 'n1', makeDeps(clock));

    clock.advance(HOLO_CRUMB_MS - 1);
    stepCrumbs(world, makeDeps(clock));

    expect(world.crumbs.size).toBe(1);
  });
});
