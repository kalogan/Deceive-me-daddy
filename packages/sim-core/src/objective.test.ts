import {
  EXTRACT_RANGE,
  INTEL_COLLECT_RANGE,
  KEY_FORGE_RANGE,
  KEY_GRAB_RANGE,
  PACKAGE_GRAB_RANGE,
  type ContentPack,
} from '@deceive/shared';
import { describe, expect, it } from 'vitest';
import { FixedClock } from './clock';
import {
  collectIntel,
  createVaultKey,
  grabPackage,
  grabVaultKey,
  loadObjective,
  stepObjective,
} from './objective';
import type { Rng } from './rng';
import type { SimDeps, Vec3, WorldState } from './world';
import { createWorld, spawnPlayer } from './world';

// The objective loop reads neither clock nor rng; inert stubs keep it deterministic.
function makeDeps(): SimDeps {
  return { clock: new FixedClock(0), rng: { next: () => 0 } as unknown as Rng };
}

// Minimal pack fixture: two intel nodes, threshold 3, package at origin, one extraction.
function makePack(): ContentPack {
  return {
    intelNodes: [
      { id: 'n1', position: [0, 0, 0], zoneId: 'z', intelValue: 2 },
      { id: 'n2', position: [10, 0, 0], zoneId: 'z', intelValue: 2 },
    ],
    objective: {
      packagePosition: [0, 0, 0],
      intelRequiredToOpenVault: 3,
      extractionPoints: [[50, 0, 50]],
    },
  } as unknown as ContentPack;
}

function loadedWorld(): WorldState {
  const world = createWorld();
  world.pack = makePack();
  loadObjective(world, world.pack);
  return world;
}

describe('collectIntel', () => {
  it('collects intel in range; rises, consumes the node, second collect fails', () => {
    const world = loadedWorld();
    const p = spawnPlayer(world, 'p', 0, { x: 0, y: 0, z: 0 });

    expect(collectIntel(world, 'p', 'n1', makeDeps())).toBe(true);
    expect(p.intel).toBe(2);
    expect(world.objective.collectedIntel.has('n1')).toBe(true);

    // Same node a second time is a no-op failure (no double-dip).
    expect(collectIntel(world, 'p', 'n1', makeDeps())).toBe(false);
    expect(p.intel).toBe(2);
  });

  it('fails out of range', () => {
    const world = loadedWorld();
    const p = spawnPlayer(world, 'p', 0, { x: INTEL_COLLECT_RANGE + 1, y: 0, z: 0 });
    expect(collectIntel(world, 'p', 'n1', makeDeps())).toBe(false);
    expect(p.intel).toBe(0);
    expect(world.objective.collectedIntel.has('n1')).toBe(false);
  });

  it('fails for a missing node, a missing player, and a downed player', () => {
    const world = loadedWorld();
    const p = spawnPlayer(world, 'p', 0, { x: 0, y: 0, z: 0 });
    expect(collectIntel(world, 'p', 'nope', makeDeps())).toBe(false);
    expect(collectIntel(world, 'ghost', 'n1', makeDeps())).toBe(false);
    p.phase = 'downed';
    expect(collectIntel(world, 'p', 'n1', makeDeps())).toBe(false);
  });

  it('flips vaultOpen once any player reaches the threshold', () => {
    const world = loadedWorld();
    const p = spawnPlayer(world, 'p', 0, { x: 0, y: 0, z: 0 });

    // First node (value 2) is below threshold 3 — vault stays shut.
    collectIntel(world, 'p', 'n1', makeDeps());
    expect(world.objective.vaultOpen).toBe(false);

    // Walk to the second node and collect: total 4 >= 3 → vault opens.
    p.pos = { x: 10, y: 0, z: 0 };
    collectIntel(world, 'p', 'n2', makeDeps());
    expect(p.intel).toBe(4);
    expect(world.objective.vaultOpen).toBe(true);
  });
});

describe('grabPackage', () => {
  it('only grabs when vault open + in range + no holder; sets carrying', () => {
    const world = loadedWorld();
    const p = spawnPlayer(world, 'p', 0, { x: 0, y: 0, z: 0 });

    // Vault closed → cannot grab.
    expect(grabPackage(world, 'p', makeDeps())).toBe(false);
    expect(p.carrying).toBe(false);

    world.objective.vaultOpen = true;
    expect(grabPackage(world, 'p', makeDeps())).toBe(true);
    expect(world.objective.packageHolderId).toBe('p');
    expect(p.carrying).toBe(true);

    // Already held → another grab fails.
    const q = spawnPlayer(world, 'q', 1, { x: 0, y: 0, z: 0 });
    expect(grabPackage(world, 'q', makeDeps())).toBe(false);
    expect(q.carrying).toBe(false);
  });

  it('fails out of range', () => {
    const world = loadedWorld();
    world.objective.vaultOpen = true;
    spawnPlayer(world, 'p', 0, { x: PACKAGE_GRAB_RANGE + 1, y: 0, z: 0 });
    expect(grabPackage(world, 'p', makeDeps())).toBe(false);
    expect(world.objective.packageHolderId).toBe('');
  });
});

describe('stepObjective', () => {
  function readyCarrier(world: WorldState, id: string, team: number, pos: Vec3) {
    world.objective.vaultOpen = true;
    const p = spawnPlayer(world, id, team, pos);
    grabPackage(world, id, makeDeps());
    return p;
  }

  it('packagePos follows the holder', () => {
    const world = loadedWorld();
    const p = readyCarrier(world, 'p', 0, { x: 0, y: 0, z: 0 });
    p.pos = { x: 7, y: 1, z: -4 };
    stepObjective(world, makeDeps());
    expect(world.objective.packagePos).toEqual({ x: 7, y: 1, z: -4 });
  });

  it('a downed holder drops it: holder cleared, package left where they fell', () => {
    const world = loadedWorld();
    const p = readyCarrier(world, 'p', 0, { x: 0, y: 0, z: 0 });
    p.pos = { x: 8, y: 0, z: 8 };
    stepObjective(world, makeDeps()); // sync pos to drop point first
    p.phase = 'downed';
    stepObjective(world, makeDeps());

    expect(world.objective.packageHolderId).toBe('');
    expect(p.carrying).toBe(false);
    expect(world.objective.packagePos).toEqual({ x: 8, y: 0, z: 8 });
  });

  it('a carrier within an extraction point wins for their team; not before', () => {
    const world = loadedWorld();
    const p = readyCarrier(world, 'p', 2, { x: 0, y: 0, z: 0 });

    // Far from extraction → no win.
    stepObjective(world, makeDeps());
    expect(world.objective.winningTeam).toBe(-1);

    // Within EXTRACT_RANGE of the extraction point (50,0,50) → win for team 2.
    p.pos = { x: 50 + EXTRACT_RANGE - 0.5, y: 0, z: 50 };
    stepObjective(world, makeDeps());
    expect(world.objective.winningTeam).toBe(2);
  });

  it('does nothing when there is no holder', () => {
    const world = loadedWorld();
    expect(() => stepObjective(world, makeDeps())).not.toThrow();
    expect(world.objective.winningTeam).toBe(-1);
  });
});

// --- Vault key (objective.requiresVaultKey packs) ---------------------------------------------

// A key pack: intel threshold 3, a forge at the origin, extraction far away.
function makeKeyPack(): ContentPack {
  return {
    intelNodes: [{ id: 'n1', position: [0, 0, 0], zoneId: 'z', intelValue: 3 }],
    objective: {
      packagePosition: [99, 0, 99],
      intelRequiredToOpenVault: 3,
      extractionPoints: [[50, 0, 50]],
      requiresVaultKey: true,
      keyForgePosition: [0, 0, 0],
    },
  } as unknown as ContentPack;
}

function loadedKeyWorld(): WorldState {
  const world = createWorld();
  world.pack = makeKeyPack();
  loadObjective(world, world.pack);
  return world;
}

describe('vault key', () => {
  it('intel does NOT auto-open the vault in a key pack', () => {
    const world = loadedKeyWorld();
    spawnPlayer(world, 'p', 0, { x: 0, y: 0, z: 0 });
    expect(collectIntel(world, 'p', 'n1', makeDeps())).toBe(true);
    expect(world.objective.vaultOpen).toBe(false); // must forge the key, not auto-open
  });

  it('createVaultKey needs enough intel + range, then forges + opens the vault', () => {
    const world = loadedKeyWorld();
    const p = spawnPlayer(world, 'p', 0, { x: 0, y: 0, z: 0 });

    // Not enough intel yet.
    expect(createVaultKey(world, 'p', makeDeps())).toBe(false);
    collectIntel(world, 'p', 'n1', makeDeps());
    expect(p.intel).toBe(3);

    // Out of range fails.
    p.pos = { x: KEY_FORGE_RANGE + 1, y: 0, z: 0 };
    expect(createVaultKey(world, 'p', makeDeps())).toBe(false);

    // In range with intel forges the key + opens the vault.
    p.pos = { x: 0, y: 0, z: 0 };
    expect(createVaultKey(world, 'p', makeDeps())).toBe(true);
    expect(world.objective.keyCreated).toBe(true);
    expect(world.objective.vaultOpen).toBe(true);
    expect(world.objective.keyHolderId).toBe('');

    // Can't forge twice.
    expect(createVaultKey(world, 'p', makeDeps())).toBe(false);
  });

  it('grabVaultKey picks up the forged key (carry + reveal); package grab is disabled', () => {
    const world = loadedKeyWorld();
    const p = spawnPlayer(world, 'p', 0, { x: 0, y: 0, z: 0 });
    collectIntel(world, 'p', 'n1', makeDeps());
    createVaultKey(world, 'p', makeDeps());

    // Package is disabled in a key pack even though the vault reads open.
    expect(grabPackage(world, 'p', makeDeps())).toBe(false);

    // Out of range can't grab; in range carries the key.
    p.pos = { x: KEY_GRAB_RANGE + 1, y: 0, z: 0 };
    expect(grabVaultKey(world, 'p', makeDeps())).toBe(false);
    p.pos = { x: 0, y: 0, z: 0 };
    expect(grabVaultKey(world, 'p', makeDeps())).toBe(true);
    expect(world.objective.keyHolderId).toBe('p');
    expect(p.carrying).toBe(true);
    expect(p.phase).toBe('revealed'); // grabbing the prize blows cover
  });

  it('carrying the key to an extraction point wins; a downed holder drops it', () => {
    const world = loadedKeyWorld();
    const p = spawnPlayer(world, 'p', 2, { x: 0, y: 0, z: 0 });
    collectIntel(world, 'p', 'n1', makeDeps());
    createVaultKey(world, 'p', makeDeps());
    grabVaultKey(world, 'p', makeDeps());

    // Key follows the holder.
    p.pos = { x: 10, y: 0, z: 10 };
    stepObjective(world, makeDeps());
    expect(world.objective.keyPos).toEqual({ x: 10, y: 0, z: 10 });

    // Downed → dropped where they fell (keyPos stays at 10,0,10).
    p.phase = 'downed';
    stepObjective(world, makeDeps());
    expect(world.objective.keyHolderId).toBe('');
    expect(p.carrying).toBe(false);
    expect(world.objective.keyPos).toEqual({ x: 10, y: 0, z: 10 });

    // Re-grab at the drop point, then reach extraction → win for the holder's team.
    p.phase = 'blended';
    p.pos = { x: 10, y: 0, z: 10 };
    expect(grabVaultKey(world, 'p', makeDeps())).toBe(true);
    p.pos = { x: 50, y: 0, z: 50 };
    stepObjective(world, makeDeps());
    expect(world.objective.winningTeam).toBe(2);
  });

  it('createVaultKey / grabVaultKey are inert in a standard (non-key) pack', () => {
    const world = loadedWorld();
    spawnPlayer(world, 'p', 0, { x: 0, y: 0, z: 0 });
    expect(createVaultKey(world, 'p', makeDeps())).toBe(false);
    expect(grabVaultKey(world, 'p', makeDeps())).toBe(false);
  });
});
