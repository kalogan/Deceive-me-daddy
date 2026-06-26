import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@deceive/shared';
import { spawnNpcsFromPack, stepNpcs } from './npc';
import { createRng } from './rng';
import { createWorld, type SimDeps } from './world';

// A fixed-clock SimDeps for stepNpcs. stepNpcs only reads deps.rng; clock is unused by
// movement but the type requires one, so a tiny stub keeps the test deterministic.
function makeDeps(seed: number): SimDeps {
  return {
    clock: { now: () => 0 },
    rng: createRng(seed),
  };
}

const TICK_MS = 50;

// Minimal pack shape — spawnNpcsFromPack only reads `npcs`. Cast keeps the test focused.
const pack = {
  npcs: [
    {
      id: 'civ',
      tier: 'civilian',
      homeZone: 'atrium',
      routine: { kind: 'wander', waypoints: [[1, 0, 2]] },
    },
    { id: 'guard', tier: 'security', homeZone: 'sec', routine: { kind: 'patrol', waypoints: [] } },
  ],
} as unknown as ContentPack;

describe('spawnNpcsFromPack', () => {
  it('creates one npc per def at its first waypoint, tier preserved', () => {
    const world = createWorld();
    spawnNpcsFromPack(world, pack);
    expect(world.npcs.size).toBe(2);
    expect(world.npcs.get('civ')?.tier).toBe('civilian');
    expect(world.npcs.get('civ')?.pos).toEqual({ x: 1, y: 0, z: 2 });
  });

  it('falls back to origin when a routine has no waypoints', () => {
    const world = createWorld();
    spawnNpcsFromPack(world, pack);
    expect(world.npcs.get('guard')?.pos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('sets world.pack and clears before respawning (idempotent)', () => {
    const world = createWorld();
    spawnNpcsFromPack(world, pack);
    spawnNpcsFromPack(world, pack);
    expect(world.npcs.size).toBe(2);
    expect(world.pack).toBe(pack);
  });
});

// A pack with a bounded home zone (for wander) + a multi-waypoint patrol loop.
const movePack = {
  zones: [{ id: 'atrium', bounds: { min: [-10, 0, -10], max: [10, 5, 10] } }],
  npcs: [
    // Patrol loop: a square in the +X/+Z quadrant, starting at the first corner.
    {
      id: 'patroller',
      tier: 'security',
      homeZone: 'atrium',
      routine: {
        kind: 'patrol',
        waypoints: [
          [0, 0, 0],
          [4, 0, 0],
          [4, 0, 4],
          [0, 0, 4],
        ],
      },
    },
    { id: 'sitter', tier: 'civilian', homeZone: 'atrium', routine: { kind: 'idle', waypoints: [] } },
    {
      id: 'roamer',
      tier: 'civilian',
      homeZone: 'atrium',
      routine: { kind: 'wander', waypoints: [[0, 0, 0]] },
    },
  ],
} as unknown as ContentPack;

function spawn(seed = 1): { world: ReturnType<typeof createWorld>; deps: SimDeps } {
  const world = createWorld();
  spawnNpcsFromPack(world, movePack);
  return { world, deps: makeDeps(seed) };
}

describe('stepNpcs — patrol', () => {
  it('moves toward the current waypoint and faces it', () => {
    const { world, deps } = spawn();
    const npc = world.npcs.get('patroller')!;
    // Start at wp[0]=(0,0,0), heading toward wp[1]=(4,0,0): index advances to 1 first,
    // then it walks +X. Take one step from the second waypoint onward.
    stepNpcs(world, deps, TICK_MS); // arrives at wp0 (already there) -> index -> 1
    const before = { ...npc.pos };
    stepNpcs(world, deps, TICK_MS);
    expect(npc.pos.x).toBeGreaterThan(before.x); // moved +X toward (4,0,0)
    expect(npc.pos.z).toBeCloseTo(0, 5);
    expect(npc.pos.y).toBe(0); // y untouched
    // Facing +X => atan2(dx=+, dz=0) = +pi/2.
    expect(npc.yaw).toBeCloseTo(Math.PI / 2, 3);
  });

  it('advances and wraps waypointIndex on arrival around the loop', () => {
    const { world, deps } = spawn();
    const npc = world.npcs.get('patroller')!;
    const seen = new Set<number>();
    // Run long enough to traverse the whole 4-waypoint loop and wrap back to 0.
    for (let i = 0; i < 2000; i++) {
      seen.add(npc.waypointIndex);
      stepNpcs(world, deps, TICK_MS);
    }
    // It visited every waypoint index (proves it advanced + wrapped).
    expect(seen.has(0)).toBe(true);
    expect(seen.has(1)).toBe(true);
    expect(seen.has(2)).toBe(true);
    expect(seen.has(3)).toBe(true);
  });

  it('single-waypoint work npc settles on its spot and stops', () => {
    const world = createWorld();
    spawnNpcsFromPack(
      world,
      {
        zones: movePack.zones,
        npcs: [
          {
            id: 'worker',
            tier: 'staff',
            homeZone: 'atrium',
            routine: { kind: 'work', waypoints: [[2, 0, 3]] },
          },
        ],
      } as unknown as ContentPack,
    );
    const deps = makeDeps(7);
    const npc = world.npcs.get('worker')!;
    for (let i = 0; i < 200; i++) stepNpcs(world, deps, TICK_MS);
    expect(npc.pos.x).toBeCloseTo(2, 5);
    expect(npc.pos.z).toBeCloseTo(3, 5);
    expect(npc.waypointIndex).toBe(0); // single waypoint never advances
  });
});

describe('stepNpcs — idle', () => {
  it('stays put (position unchanged) across many ticks', () => {
    const { world, deps } = spawn();
    const npc = world.npcs.get('sitter')!;
    const start = { ...npc.pos };
    for (let i = 0; i < 100; i++) stepNpcs(world, deps, TICK_MS);
    expect(npc.pos).toEqual(start);
  });
});

describe('stepNpcs — wander', () => {
  it('stays within (or steers back into) its home-zone bounds over many ticks', () => {
    const { world, deps } = spawn();
    const npc = world.npcs.get('roamer')!;
    for (let i = 0; i < 5000; i++) {
      stepNpcs(world, deps, TICK_MS);
      expect(npc.pos.x).toBeGreaterThanOrEqual(-10);
      expect(npc.pos.x).toBeLessThanOrEqual(10);
      expect(npc.pos.z).toBeGreaterThanOrEqual(-10);
      expect(npc.pos.z).toBeLessThanOrEqual(10);
      expect(npc.pos.y).toBe(0);
    }
  });

  it('actually moves (is not a stationary idle)', () => {
    const { world, deps } = spawn();
    const npc = world.npcs.get('roamer')!;
    const start = { ...npc.pos };
    for (let i = 0; i < 50; i++) stepNpcs(world, deps, TICK_MS);
    const moved = Math.hypot(npc.pos.x - start.x, npc.pos.z - start.z);
    expect(moved).toBeGreaterThan(0);
  });

  it('falls back to a box around spawn when pack/zone is missing', () => {
    const world = createWorld();
    spawnNpcsFromPack(world, movePack);
    world.pack = null; // simulate missing pack: wanderer drifts near spawn, no crash
    const deps = makeDeps(3);
    const npc = world.npcs.get('roamer')!;
    const start = { ...npc.pos };
    for (let i = 0; i < 500; i++) stepNpcs(world, deps, TICK_MS);
    // Bounded near spawn (synthetic +-3 box) and finite.
    expect(Math.abs(npc.pos.x - start.x)).toBeLessThanOrEqual(3 + 1e-6);
    expect(Math.abs(npc.pos.z - start.z)).toBeLessThanOrEqual(3 + 1e-6);
    expect(Number.isFinite(npc.pos.x)).toBe(true);
  });

  it('is deterministic: same seed + same dt sequence -> identical positions', () => {
    const a = spawn(42);
    const b = spawn(42);
    for (let i = 0; i < 300; i++) {
      stepNpcs(a.world, a.deps, TICK_MS);
      stepNpcs(b.world, b.deps, TICK_MS);
    }
    const ra = a.world.npcs.get('roamer')!;
    const rb = b.world.npcs.get('roamer')!;
    expect(ra.pos).toEqual(rb.pos);
    expect(ra.yaw).toEqual(rb.yaw);
  });

  it('different seeds diverge (rng actually drives the motion)', () => {
    const a = spawn(1);
    const b = spawn(2);
    for (let i = 0; i < 300; i++) {
      stepNpcs(a.world, a.deps, TICK_MS);
      stepNpcs(b.world, b.deps, TICK_MS);
    }
    const ra = a.world.npcs.get('roamer')!;
    const rb = b.world.npcs.get('roamer')!;
    expect(ra.pos).not.toEqual(rb.pos);
  });
});

describe('stepNpcs — yaw', () => {
  it('faces the movement direction while patrolling', () => {
    const { world, deps } = spawn();
    const npc = world.npcs.get('patroller')!;
    // Drive it onto the leg from (4,0,0)->(4,0,4): heading +Z => yaw atan2(0,+) = 0.
    let sawForwardZ = false;
    for (let i = 0; i < 400; i++) {
      const prevZ = npc.pos.z;
      stepNpcs(world, deps, TICK_MS);
      // On the +Z leg: heading toward (4,0,4), x parked at ~4, z increasing.
      if (npc.waypointIndex === 2 && npc.pos.x > 3.9 && npc.pos.z > prevZ + 1e-4) {
        expect(npc.yaw).toBeCloseTo(0, 3);
        sawForwardZ = true;
        break;
      }
    }
    expect(sawForwardZ).toBe(true);
  });
});
