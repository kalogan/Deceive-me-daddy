import { describe, expect, it } from 'vitest';
import type { ContentPack } from '@deceive/shared';
import { stepZones, zoneAt } from './zones';
import { createWorld, spawnPlayer } from './world';

// Minimal pack — stepZones only reads `zones`. Cast keeps the test focused on bounds + tiers.
// `lobby` is a civilian zone; `lab` is a scientist zone that OVERLAPS lobby on the right edge;
// `vault` (security) is authored with min>max to exercise bounds normalisation.
const pack = {
  zones: [
    {
      id: 'lobby',
      name: 'Lobby',
      requiredClearance: 'civilian',
      bounds: { min: [0, 0, 0], max: [10, 5, 10] },
    },
    {
      id: 'lab',
      name: 'Lab',
      requiredClearance: 'scientist',
      bounds: { min: [8, 0, 0], max: [18, 5, 10] },
    },
    {
      id: 'vault',
      name: 'Vault',
      requiredClearance: 'security',
      // Authored backwards (min>max) on purpose; covers [20..30] x [20..30].
      bounds: { min: [30, 5, 30], max: [20, 0, 20] },
    },
  ],
} as unknown as ContentPack;

function makeWorld(pos: { x: number; y: number; z: number }, tier: string) {
  const world = createWorld();
  world.pack = pack;
  const p = spawnPlayer(world, 'p1', 0, pos);
  p.disguiseTier = tier as never;
  return world;
}

describe('zoneAt', () => {
  it('returns the zone whose XZ bounds contain the point (Y ignored)', () => {
    const zone = zoneAt({ x: 2, y: 999, z: 2 }, pack.zones);
    expect(zone?.id).toBe('lobby');
  });

  it('returns undefined when outside every zone', () => {
    expect(zoneAt({ x: -5, y: 0, z: -5 }, pack.zones)).toBeUndefined();
  });

  it('normalises bounds authored with min>max', () => {
    expect(zoneAt({ x: 25, y: 0, z: 25 }, pack.zones)?.id).toBe('vault');
  });

  it('picks the most restrictive zone when several overlap a point', () => {
    // x=9,z=5 is inside BOTH lobby (civilian) and lab (scientist) — lab binds.
    expect(zoneAt({ x: 9, y: 0, z: 5 }, pack.zones)?.id).toBe('lab');
  });
});

describe('stepZones', () => {
  it('sets currentZoneId for a player inside a zone', () => {
    const world = makeWorld({ x: 2, y: 0, z: 2 }, 'civilian');
    stepZones(world);
    expect(world.players.get('p1')?.currentZoneId).toBe('lobby');
  });

  it("sets currentZoneId='' for a player outside all zones", () => {
    const world = makeWorld({ x: -100, y: 0, z: -100 }, 'civilian');
    stepZones(world);
    expect(world.players.get('p1')?.currentZoneId).toBe('');
    expect(world.players.get('p1')?.inForbiddenZone).toBe(false);
  });

  it('flags a civilian in a scientist zone as forbidden ("scolded")', () => {
    const world = makeWorld({ x: 14, y: 0, z: 5 }, 'civilian');
    stepZones(world);
    expect(world.players.get('p1')?.currentZoneId).toBe('lab');
    expect(world.players.get('p1')?.inForbiddenZone).toBe(true);
  });

  it('does not flag a scientist in a scientist zone', () => {
    const world = makeWorld({ x: 14, y: 0, z: 5 }, 'scientist');
    stepZones(world);
    expect(world.players.get('p1')?.currentZoneId).toBe('lab');
    expect(world.players.get('p1')?.inForbiddenZone).toBe(false);
  });

  it('does not flag a civilian in a civilian zone', () => {
    const world = makeWorld({ x: 2, y: 0, z: 2 }, 'civilian');
    stepZones(world);
    expect(world.players.get('p1')?.inForbiddenZone).toBe(false);
  });

  it('uses the most restrictive overlapping zone for the clearance check', () => {
    // Overlap point: civilian disguise inside lobby+lab → lab (scientist) binds → forbidden.
    const world = makeWorld({ x: 9, y: 0, z: 5 }, 'civilian');
    stepZones(world);
    expect(world.players.get('p1')?.currentZoneId).toBe('lab');
    expect(world.players.get('p1')?.inForbiddenZone).toBe(true);
  });

  it('clears membership for all players when pack is null', () => {
    const world = createWorld();
    world.pack = null;
    const p = spawnPlayer(world, 'p1', 0, { x: 2, y: 0, z: 2 });
    p.currentZoneId = 'stale';
    p.inForbiddenZone = true;
    stepZones(world);
    expect(world.players.get('p1')?.currentZoneId).toBe('');
    expect(world.players.get('p1')?.inForbiddenZone).toBe(false);
  });
});
