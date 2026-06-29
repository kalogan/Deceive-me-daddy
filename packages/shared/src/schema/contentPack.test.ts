import { describe, expect, it } from 'vitest';
import { canAccess } from '../clearance';
import { type ContentPack, ContentPackSchema } from './contentPack';

// Golden fixture: a minimal-but-complete valid pack. If a schema change breaks this,
// it's a signal to ship a migration (PROJECT_BRIEF §4.4).
const GOLDEN: ContentPack = {
  schemaVersion: 1,
  id: 'golden',
  name: 'Golden Test Facility',
  theme: 'test',
  zones: [
    {
      id: 'lobby',
      name: 'Lobby',
      requiredClearance: 'civilian',
      bounds: { min: [-10, 0, -10], max: [10, 5, 10] },
    },
    {
      id: 'vault',
      name: 'Vault',
      requiredClearance: 'scientist',
      bounds: { min: [10, 0, 10], max: [20, 5, 20] },
    },
  ],
  doors: [
    {
      id: 'vault-door',
      position: [10, 0, 10],
      connects: ['lobby', 'vault'],
      requiredClearance: 'scientist',
      keycardColor: 'scientist',
      intelToUnlock: 3,
    },
  ],
  npcs: [
    {
      id: 'npc-1',
      tier: 'staff',
      homeZone: 'lobby',
      routine: { kind: 'wander', waypoints: [[0, 0, 0]] },
    },
  ],
  keycards: [{ id: 'card-sci', color: 'scientist', position: [5, 0, 5] }],
  socialSpots: [{ id: 'plant-1', tier: 'staff', action: 'water_plants', position: [1, 0, 1] }],
  intelNodes: [{ id: 'terminal-1', position: [2, 0, 2], zoneId: 'lobby', intelValue: 1 }],
  objective: {
    vaultZoneId: 'vault',
    packagePosition: [15, 0, 15],
    intelRequiredToOpenVault: 3,
    extractionPoints: [[-9, 0, -9]],
    requiresVaultKey: false,
  },
  spawnPoints: [{ position: [0, 0, 0], team: 0 }],
  props: [{ id: 'p1', prop: 'kenney-van', position: [3, 0, 3], rotationY: 0.5, scale: 1 }],
  walls: [{ x1: -10, z1: 0, x2: 10, z2: 0 }],
};

describe('ContentPackSchema', () => {
  it('accepts the golden fixture', () => {
    const result = ContentPackSchema.safeParse(GOLDEN);
    expect(result.success).toBe(true);
  });

  it('defaults objective.requiresVaultKey to false (existing packs unchanged)', () => {
    const parsed = ContentPackSchema.parse(GOLDEN);
    expect(parsed.objective.requiresVaultKey).toBe(false);
    expect(parsed.objective.keyForgePosition).toBeUndefined();
  });

  it('accepts a vault-key objective (requiresVaultKey + keyForgePosition)', () => {
    const withKey = {
      ...GOLDEN,
      objective: { ...GOLDEN.objective, requiresVaultKey: true, keyForgePosition: [4, 0, 4] },
    };
    const parsed = ContentPackSchema.parse(withKey);
    expect(parsed.objective.requiresVaultKey).toBe(true);
    expect(parsed.objective.keyForgePosition).toEqual([4, 0, 4]);
  });

  it('applies array defaults for omitted optional collections', () => {
    const minimal = {
      schemaVersion: 1,
      id: 'm',
      name: 'Minimal',
      theme: 'test',
      zones: [GOLDEN.zones[0]],
      objective: GOLDEN.objective,
      spawnPoints: GOLDEN.spawnPoints,
    };
    const result = ContentPackSchema.parse(minimal);
    expect(result.doors).toEqual([]);
    expect(result.npcs).toEqual([]);
    expect(result.props).toEqual([]);
  });

  it('defaults a prop placement’s rotation + scale', () => {
    const withProp = {
      ...GOLDEN,
      props: [{ id: 'p', prop: 'toy-car', position: [1, 0, 1] }],
    };
    const parsed = ContentPackSchema.parse(withProp);
    expect(parsed.props[0]).toMatchObject({ rotationY: 0, scale: 1 });
  });

  it('rejects a prop placement with a non-positive scale', () => {
    const bad = {
      ...GOLDEN,
      props: [{ id: 'p', prop: 'toy-car', position: [1, 0, 1], scale: 0 }],
    };
    expect(ContentPackSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown clearance tier', () => {
    const bad = { ...GOLDEN, zones: [{ ...GOLDEN.zones[0], requiredClearance: 'president' }] };
    expect(ContentPackSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a pack with no spawn points', () => {
    const bad = { ...GOLDEN, spawnPoints: [] };
    expect(ContentPackSchema.safeParse(bad).success).toBe(false);
  });
});

describe('canAccess', () => {
  it('grants access when worn tier meets or exceeds the requirement', () => {
    expect(canAccess('scientist', 'civilian')).toBe(true);
    expect(canAccess('security', 'security')).toBe(true);
  });

  it('denies access when worn tier is below the requirement', () => {
    expect(canAccess('civilian', 'scientist')).toBe(false);
    expect(canAccess('staff', 'security')).toBe(false);
  });
});
