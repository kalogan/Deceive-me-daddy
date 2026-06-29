import { ContentPackSchema } from '@deceive/shared';
import { describe, expect, it } from 'vitest';
import { FixedClock } from './clock';
import { loadObjective } from './objective';
import { createRng } from './rng';
import { createWorld, spawnPlayer, step, type SimDeps, type WorldState } from './world';

// Two stacked rooms joined by a stair ascending along +x across x:8..18. Intel sits UPSTAIRS, so a
// bot starting on the ground floor must find the stair, climb it, then walk to the intel.
const RAW = {
  schemaVersion: 1,
  id: 'bot-floors',
  name: 'Bot Floors',
  theme: 'research_facility',
  floorHeight: 4,
  zones: [
    { id: 'ground', name: 'Ground', requiredClearance: 'civilian', bounds: { min: [0, 0, 0], max: [20, 4, 20] }, floor: 0 },
    { id: 'upper', name: 'Upper', requiredClearance: 'civilian', bounds: { min: [0, 4, 0], max: [20, 8, 20] }, floor: 1 },
  ],
  // Staircase against the WEST edge (x:0..10, a 4m-wide flight in z), so the upper landing leads
  // EAST onto solid floor — you don't have to cross the open stairwell to reach the far side.
  connectors: [
    { id: 'stair', kind: 'stair', fromFloor: 0, toFloor: 1, footprint: { min: [0, 8], max: [10, 12] }, axis: 'x', ascendToward: 'max' },
  ],
  intelNodes: [{ id: 'i1', position: [18, 4, 10], zoneId: 'upper', intelValue: 1 }],
  objective: {
    vaultZoneId: 'upper',
    packagePosition: [18, 4, 10],
    intelRequiredToOpenVault: 1,
    extractionPoints: [[1, 0, 1]],
    requiresVaultKey: false,
  },
  spawnPoints: [{ position: [3, 0, 2], team: 0 }],
};

function world(): { world: WorldState; deps: SimDeps } {
  const w = createWorld();
  w.pack = ContentPackSchema.parse(RAW);
  loadObjective(w, w.pack);
  return { world: w, deps: { clock: new FixedClock(0), rng: createRng(3) } };
}

describe('bot multi-floor navigation', () => {
  it('a bot climbs the stair to reach intel on the upper floor and collects it', () => {
    const { world: w, deps } = world();
    const bot = spawnPlayer(w, 'bot-0', 0, { x: 3, y: 0, z: 2 }, true); // ground floor, not under the node
    expect(bot.floor).toBe(0);

    let climbed = false;
    for (let i = 0; i < 600; i += 1) {
      step(w, deps);
      if (bot.floor === 1) climbed = true;
      if (w.objective.collectedIntel.has('i1')) break;
    }

    expect(climbed).toBe(true); // it actually went upstairs
    expect(w.objective.collectedIntel.has('i1')).toBe(true); // and reached + collected the intel
  });
});
