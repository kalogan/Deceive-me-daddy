import { describe, expect, it } from 'vitest';
import {
  SUSPICION_MAX,
  TIER_COLOR,
  type ClearanceTier,
  type ContentPack,
  type NetMatchState,
  type NetNpcState,
  type NetPlayerState,
} from '@deceive/shared';
import {
  deriveHudModel,
  isScolded,
  nearestTakeableNpc,
  suspicionMeter,
  tierName,
  zoneById,
  zoneLabel,
} from './hudModel';

function player(over: Partial<NetPlayerState> = {}): NetPlayerState {
  return {
    id: 'local',
    team: 0,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    disguiseTier: 'civilian',
    suspicion: 0,
    phase: 'blended',
    currentZoneId: '',
    ...over,
  };
}

function npc(over: Partial<NetNpcState> = {}): NetNpcState {
  return { id: 'n1', tier: 'civilian', x: 0, y: 0, z: 0, yaw: 0, ...over };
}

function state(over: Partial<NetMatchState> = {}): NetMatchState {
  return { tick: 0, timeMs: 0, phase: 'active', players: {}, npcs: {}, crumbs: {}, ...over };
}

// A minimal pack with two zones of differing required clearance.
function pack(): ContentPack {
  return {
    schemaVersion: 1,
    id: 'test',
    name: 'Test',
    theme: 'test',
    zones: [
      {
        id: 'lobby',
        name: 'Lobby',
        requiredClearance: 'civilian',
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      },
      {
        id: 'lab',
        name: 'Science Lab',
        requiredClearance: 'scientist',
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      },
    ],
    doors: [],
    npcs: [],
    keycards: [],
    socialSpots: [],
    intelNodes: [],
    objective: {
      vaultZoneId: 'lab',
      packagePosition: [0, 0, 0],
      intelRequiredToOpenVault: 1,
      extractionPoints: [[0, 0, 0]],
    },
    spawnPoints: [{ position: [0, 0, 0] }],
  } as ContentPack;
}

describe('zoneById / zoneLabel', () => {
  it('looks a zone up by id', () => {
    expect(zoneById(pack(), 'lab')?.name).toBe('Science Lab');
  });

  it('returns undefined for null pack, empty id, or no match', () => {
    expect(zoneById(null, 'lab')).toBeUndefined();
    expect(zoneById(pack(), '')).toBeUndefined();
    expect(zoneById(pack(), 'nope')).toBeUndefined();
  });

  it('labels the open area when outside all zones', () => {
    expect(zoneLabel(pack(), '')).toBe('Open area');
  });

  it('labels a known zone by its name', () => {
    expect(zoneLabel(pack(), 'lobby')).toBe('Lobby');
  });

  it('labels an unknown wire id defensively', () => {
    expect(zoneLabel(pack(), 'ghost')).toBe('Unknown zone');
  });
});

describe('isScolded', () => {
  it('is false in the open area (no zone)', () => {
    expect(isScolded(pack(), player({ currentZoneId: '' }))).toBe(false);
  });

  it('is false when the disguise can access the zone', () => {
    expect(
      isScolded(pack(), player({ currentZoneId: 'lab', disguiseTier: 'scientist' })),
    ).toBe(false);
    expect(
      isScolded(pack(), player({ currentZoneId: 'lobby', disguiseTier: 'civilian' })),
    ).toBe(false);
  });

  it('is true when the disguise tier is below the zone requirement', () => {
    expect(
      isScolded(pack(), player({ currentZoneId: 'lab', disguiseTier: 'civilian' })),
    ).toBe(true);
    expect(
      isScolded(pack(), player({ currentZoneId: 'lab', disguiseTier: 'security' })),
    ).toBe(true);
  });

  it('is false for an unknown zone id (no zone to gate)', () => {
    expect(isScolded(pack(), player({ currentZoneId: 'ghost' }))).toBe(false);
  });
});

describe('nearestTakeableNpc', () => {
  it('returns null when no npcs are in range', () => {
    const npcs = { far: npc({ id: 'far', x: 10, z: 0 }) };
    expect(nearestTakeableNpc({ x: 0, z: 0 }, npcs)).toBeNull();
  });

  it('returns null for an empty crowd', () => {
    expect(nearestTakeableNpc({ x: 0, z: 0 }, {})).toBeNull();
  });

  it('finds the single in-range npc', () => {
    const npcs = { a: npc({ id: 'a', x: 1, z: 0 }) };
    expect(nearestTakeableNpc({ x: 0, z: 0 }, npcs)?.id).toBe('a');
  });

  it('picks the NEAREST of several in-range npcs', () => {
    const npcs = {
      near: npc({ id: 'near', x: 0.5, z: 0 }),
      mid: npc({ id: 'mid', x: 1.5, z: 0 }),
    };
    expect(nearestTakeableNpc({ x: 0, z: 0 }, npcs)?.id).toBe('near');
  });

  it('ignores npcs beyond the range, keeping a nearer in-range one', () => {
    const npcs = {
      out: npc({ id: 'out', x: 5, z: 0 }),
      inRange: npc({ id: 'inRange', x: 1.9, z: 0 }),
    };
    expect(nearestTakeableNpc({ x: 0, z: 0 }, npcs)?.id).toBe('inRange');
  });

  it('measures distance on the XZ plane only (ignores y)', () => {
    const npcs = { a: npc({ id: 'a', x: 1.5, y: 100, z: 0 }) };
    expect(nearestTakeableNpc({ x: 0, z: 0 }, npcs)?.id).toBe('a');
  });

  it('respects a custom range', () => {
    const npcs = { a: npc({ id: 'a', x: 3, z: 0 }) };
    expect(nearestTakeableNpc({ x: 0, z: 0 }, npcs, 2)).toBeNull();
    expect(nearestTakeableNpc({ x: 0, z: 0 }, npcs, 4)?.id).toBe('a');
  });
});

describe('deriveHudModel', () => {
  const colorOf = (t: ClearanceTier): string => TIER_COLOR[t];

  it('is absent (hidden) when the local player is not in the snapshot', () => {
    const m = deriveHudModel(state(), 'local', pack(), colorOf);
    expect(m.present).toBe(false);
  });

  it('derives tier, color, zone name and no warning when accessing legitimately', () => {
    const s = state({
      players: { local: player({ currentZoneId: 'lobby', disguiseTier: 'civilian' }) },
    });
    const m = deriveHudModel(s, 'local', pack(), colorOf);
    expect(m.present).toBe(true);
    expect(m.tier).toBe('civilian');
    expect(m.tierColor).toBe(TIER_COLOR.civilian);
    expect(m.zoneName).toBe('Lobby');
    expect(m.scolded).toBe(false);
    expect(m.takeTargetId).toBeNull();
    expect(m.takeTargetTier).toBeNull();
  });

  it('flags scolded in a restricted zone and reports the in-range take target', () => {
    const s = state({
      players: { local: player({ x: 0, z: 0, currentZoneId: 'lab', disguiseTier: 'civilian' }) },
      npcs: { guard: npc({ id: 'guard', tier: 'security', x: 1, z: 0 }) },
    });
    const m = deriveHudModel(s, 'local', pack(), colorOf);
    expect(m.scolded).toBe(true);
    expect(m.zoneName).toBe('Science Lab');
    expect(m.takeTargetId).toBe('guard');
    expect(m.takeTargetTier).toBe('security');
  });

  it('reports the open area when outside all zones', () => {
    const s = state({ players: { local: player({ currentZoneId: '' }) } });
    expect(deriveHudModel(s, 'local', pack(), colorOf).zoneName).toBe('Open area');
  });

  it('derives the readable tier label and the suspicion meter for the local player', () => {
    const s = state({
      players: {
        local: player({ disguiseTier: 'security', suspicion: SUSPICION_MAX, phase: 'suspicious' }),
      },
    });
    const m = deriveHudModel(s, 'local', pack(), colorOf);
    expect(m.tierLabel).toBe('Security');
    expect(m.suspicion.pct).toBe(1);
    expect(m.suspicion.level).toBe('high');
    expect(m.suspicion.label).toBe('SUSPICIOUS');
  });
});

describe('tierName', () => {
  it('capitalises each tier into its display label', () => {
    expect(tierName('civilian')).toBe('Civilian');
    expect(tierName('staff')).toBe('Staff');
    expect(tierName('security')).toBe('Security');
    expect(tierName('scientist')).toBe('Scientist');
  });

  it('returns empty string defensively for an empty tier', () => {
    expect(tierName('' as ClearanceTier)).toBe('');
  });
});

describe('suspicionMeter', () => {
  it('derives pct as suspicion / SUSPICION_MAX', () => {
    expect(suspicionMeter(player({ suspicion: 0 })).pct).toBe(0);
    expect(suspicionMeter(player({ suspicion: SUSPICION_MAX / 2 })).pct).toBe(0.5);
    expect(suspicionMeter(player({ suspicion: SUSPICION_MAX })).pct).toBe(1);
  });

  it('clamps pct into 0..1 for out-of-range wire values', () => {
    expect(suspicionMeter(player({ suspicion: -10 })).pct).toBe(0);
    expect(suspicionMeter(player({ suspicion: SUSPICION_MAX * 2 })).pct).toBe(1);
  });

  it('bands the level at the 40% / 75% thresholds', () => {
    expect(suspicionMeter(player({ suspicion: SUSPICION_MAX * 0.2 })).level).toBe('low');
    expect(suspicionMeter(player({ suspicion: SUSPICION_MAX * 0.39 })).level).toBe('low');
    expect(suspicionMeter(player({ suspicion: SUSPICION_MAX * 0.4 })).level).toBe('mid');
    expect(suspicionMeter(player({ suspicion: SUSPICION_MAX * 0.74 })).level).toBe('mid');
    expect(suspicionMeter(player({ suspicion: SUSPICION_MAX * 0.75 })).level).toBe('high');
    expect(suspicionMeter(player({ suspicion: SUSPICION_MAX })).level).toBe('high');
  });

  it('labels the meter from the server-owned phase', () => {
    expect(suspicionMeter(player({ phase: 'blended' })).label).toBe('Hidden');
    expect(suspicionMeter(player({ phase: 'suspicious' })).label).toBe('SUSPICIOUS');
    expect(suspicionMeter(player({ phase: 'revealed' })).label).toBe('REVEALED');
    expect(suspicionMeter(player({ phase: 'downed' })).label).toBe('DOWNED');
    expect(suspicionMeter(player({ phase: 'out' })).label).toBe('OUT');
  });
});
