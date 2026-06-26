import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@deceive/shared';
import { spawnNpcsFromPack } from './npc';
import { createWorld } from './world';

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
