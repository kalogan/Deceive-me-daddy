import { ContentPackSchema, DEFAULT_FLOOR_HEIGHT } from '@deceive/shared';
import { describe, expect, it } from 'vitest';
import { FixedClock } from './clock';
import { createRng } from './rng';
import { createWorld, spawnPlayer, step, type SimDeps, type WorldState } from './world';

// A tiny two-floor map: a ground room and an upper room (smaller footprint) stacked, joined by a
// stair that ascends along +x across x:8..18 on the ground floor.
const RAW = {
  schemaVersion: 1,
  id: 'floors-test',
  name: 'Floors Test',
  theme: 'research_facility',
  floorHeight: DEFAULT_FLOOR_HEIGHT,
  zones: [
    { id: 'ground', name: 'Ground', requiredClearance: 'civilian', bounds: { min: [0, 0, 0], max: [20, 4, 20] }, floor: 0 },
    { id: 'upper', name: 'Upper', requiredClearance: 'security', bounds: { min: [0, 4, 0], max: [10, 8, 20] }, floor: 1 },
  ],
  connectors: [
    { id: 'stair', kind: 'stair', fromFloor: 0, toFloor: 1, footprint: { min: [8, 0], max: [18, 20] }, axis: 'x', ascendToward: 'max' },
  ],
  objective: {
    vaultZoneId: 'upper',
    packagePosition: [5, 4, 10],
    intelRequiredToOpenVault: 1,
    extractionPoints: [[1, 0, 1]],
    requiresVaultKey: false,
  },
  spawnPoints: [{ position: [8, 0, 10], team: 0 }],
};

function world(): { world: WorldState; deps: SimDeps } {
  const w = createWorld();
  w.pack = ContentPackSchema.parse(RAW);
  return { world: w, deps: { clock: new FixedClock(0), rng: createRng(1) } };
}

describe('multi-floor movement', () => {
  it('walking up the stair raises Y and commits to floor 1', () => {
    const { world: w, deps } = world();
    const p = spawnPlayer(w, 'p', 0, { x: 8, y: 0, z: 10 }); // bottom of the stair
    expect(p.floor).toBe(0);
    p.vel.x = 4; // walk toward +x, up the slope

    for (let i = 0; i < 80; i += 1) step(w, deps);

    expect(p.floor).toBe(1);
    expect(p.pos.y).toBeCloseTo(DEFAULT_FLOOR_HEIGHT, 1); // standing on the upper slab
  });

  it('does not change floors without using a connector (flat walk stays on floor 0)', () => {
    const { world: w, deps } = world();
    const p = spawnPlayer(w, 'p', 0, { x: 2, y: 0, z: 2 }); // away from the stair footprint
    p.vel.z = 4; // walk along z on the ground floor

    for (let i = 0; i < 40; i += 1) step(w, deps);

    expect(p.floor).toBe(0);
    expect(p.pos.y).toBeCloseTo(0, 3);
  });

  it('zone membership is floor-aware (the upper zone only binds an actor on floor 1)', () => {
    const { world: w, deps } = world();
    // A player standing under the upper room's XZ but on the ground floor is in 'ground', not 'upper'.
    const p = spawnPlayer(w, 'p', 0, { x: 5, y: 0, z: 10 });
    step(w, deps);
    expect(p.currentZoneId).toBe('ground');

    // Force them onto floor 1 at the same XZ → now bound by 'upper' (and scolded: civilian in a
    // security zone).
    p.floor = 1;
    p.pos.y = DEFAULT_FLOOR_HEIGHT;
    step(w, deps);
    expect(p.currentZoneId).toBe('upper');
    expect(p.inForbiddenZone).toBe(true);
  });
});
