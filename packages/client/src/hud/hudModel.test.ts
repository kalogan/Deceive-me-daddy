import { describe, expect, it } from 'vitest';
import {
  INTEL_COLLECT_RANGE,
  MAX_HEALTH,
  PACKAGE_GRAB_RANGE,
  REVIVE_RANGE,
  SUSPICION_MAX,
  TIER_COLOR,
  type ClearanceTier,
  type ContentPack,
  type IntelNode,
  type NetMatchState,
  type NetNpcState,
  type NetObjectiveState,
  type NetPlayerState,
} from '@deceive/shared';
import {
  deriveHudModel,
  healthBar,
  isScolded,
  nearestDownedTeammate,
  nearestInteractable,
  nearestTakeableNpc,
  objectiveStatus,
  suspicionMeter,
  tierName,
  winBanner,
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
    health: 100,
    intel: 0,
    carrying: false,
    ...over,
  };
}

function npc(over: Partial<NetNpcState> = {}): NetNpcState {
  return { id: 'n1', tier: 'civilian', x: 0, y: 0, z: 0, yaw: 0, ...over };
}

const OBJ = {
  vaultOpen: false,
  packageHolderId: '',
  packageX: 0,
  packageY: 0,
  packageZ: 0,
  winningTeam: -1,
};

function objective(over: Partial<NetObjectiveState> = {}): NetObjectiveState {
  return { ...OBJ, ...over };
}

function intelNode(over: Partial<IntelNode> = {}): IntelNode {
  return { id: 'i1', position: [0, 0, 0], zoneId: 'lobby', intelValue: 1, ...over };
}

function state(over: Partial<NetMatchState> = {}): NetMatchState {
  return {
    tick: 0,
    timeMs: 0,
    phase: 'active',
    players: {},
    npcs: {},
    crumbs: {},
    objective: { ...OBJ },
    ...over,
  };
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

describe('healthBar', () => {
  it('derives pct as health / MAX_HEALTH', () => {
    expect(healthBar(player({ health: MAX_HEALTH })).pct).toBe(1);
    expect(healthBar(player({ health: MAX_HEALTH / 2 })).pct).toBe(0.5);
    expect(healthBar(player({ health: 0 })).pct).toBe(0);
  });

  it('clamps pct into 0..1 for out-of-range wire values', () => {
    expect(healthBar(player({ health: -20 })).pct).toBe(0);
    expect(healthBar(player({ health: MAX_HEALTH * 2 })).pct).toBe(1);
  });

  it('bands the level green→amber→red at the 60% / 30% thresholds', () => {
    expect(healthBar(player({ health: MAX_HEALTH })).level).toBe('ok');
    expect(healthBar(player({ health: MAX_HEALTH * 0.6 })).level).toBe('ok');
    expect(healthBar(player({ health: MAX_HEALTH * 0.59 })).level).toBe('hurt');
    expect(healthBar(player({ health: MAX_HEALTH * 0.3 })).level).toBe('hurt');
    expect(healthBar(player({ health: MAX_HEALTH * 0.29 })).level).toBe('critical');
    expect(healthBar(player({ health: 0 })).level).toBe('critical');
  });

  it('lifts the downed / out phases into a clear status callout', () => {
    expect(healthBar(player({ phase: 'blended' })).status).toBe('');
    expect(healthBar(player({ phase: 'suspicious' })).status).toBe('');
    expect(healthBar(player({ phase: 'revealed' })).status).toBe('');
    expect(healthBar(player({ phase: 'downed', health: 0 })).status).toBe('DOWNED');
    expect(healthBar(player({ phase: 'out', health: 0 })).status).toBe('ELIMINATED');
  });
});

describe('nearestDownedTeammate', () => {
  const local = { id: 'local', team: 0, x: 0, z: 0 };

  it('returns null when there are no other players', () => {
    expect(nearestDownedTeammate(local, {})).toBeNull();
  });

  it('finds a downed same-team ally in range', () => {
    const players = {
      ally: player({ id: 'ally', team: 0, phase: 'downed', x: 1, z: 0 }),
    };
    expect(nearestDownedTeammate(local, players)?.id).toBe('ally');
  });

  it('ignores a downed ally on a different team', () => {
    const players = {
      foe: player({ id: 'foe', team: 1, phase: 'downed', x: 1, z: 0 }),
    };
    expect(nearestDownedTeammate(local, players)).toBeNull();
  });

  it('ignores a same-team ally who is not downed (alive or already out)', () => {
    const players = {
      alive: player({ id: 'alive', team: 0, phase: 'blended', x: 1, z: 0 }),
      out: player({ id: 'out', team: 0, phase: 'out', x: 1.2, z: 0 }),
    };
    expect(nearestDownedTeammate(local, players)).toBeNull();
  });

  it('ignores a downed ally beyond revive range', () => {
    const players = {
      ally: player({ id: 'ally', team: 0, phase: 'downed', x: REVIVE_RANGE + 1, z: 0 }),
    };
    expect(nearestDownedTeammate(local, players)).toBeNull();
  });

  it('never targets the local player itself even if marked downed', () => {
    const players = {
      local: player({ id: 'local', team: 0, phase: 'downed', x: 0, z: 0 }),
    };
    expect(nearestDownedTeammate(local, players)).toBeNull();
  });

  it('picks the NEAREST of several downed teammates', () => {
    const players = {
      near: player({ id: 'near', team: 0, phase: 'downed', x: 0.5, z: 0 }),
      far: player({ id: 'far', team: 0, phase: 'downed', x: 2.0, z: 0 }),
    };
    expect(nearestDownedTeammate(local, players)?.id).toBe('near');
  });

  it('measures distance on the XZ plane only (ignores y)', () => {
    const players = {
      ally: player({ id: 'ally', team: 0, phase: 'downed', x: 1, y: 100, z: 0 }),
    };
    expect(nearestDownedTeammate(local, players)?.id).toBe('ally');
  });

  it('respects a custom range', () => {
    const players = {
      ally: player({ id: 'ally', team: 0, phase: 'downed', x: 4, z: 0 }),
    };
    expect(nearestDownedTeammate(local, players, 3)).toBeNull();
    expect(nearestDownedTeammate(local, players, 5)?.id).toBe('ally');
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

  it('derives the local health bar and surfaces a downed teammate in revive reach', () => {
    const s = state({
      players: {
        local: player({ id: 'local', team: 0, health: MAX_HEALTH * 0.4, x: 0, z: 0 }),
        ally: player({ id: 'ally', team: 0, phase: 'downed', health: 0, x: 1, z: 0 }),
        foe: player({ id: 'foe', team: 1, phase: 'downed', health: 0, x: 1, z: 0 }),
      },
    });
    const m = deriveHudModel(s, 'local', pack(), colorOf);
    expect(m.health.pct).toBeCloseTo(0.4);
    expect(m.health.level).toBe('hurt');
    expect(m.health.status).toBe('');
    expect(m.reviveTargetId).toBe('ally');
  });

  it('reports the local player downed status and no revive target when none in reach', () => {
    const s = state({
      players: { local: player({ phase: 'downed', health: 0 }) },
    });
    const m = deriveHudModel(s, 'local', pack(), colorOf);
    expect(m.health.status).toBe('DOWNED');
    expect(m.reviveTargetId).toBeNull();
  });
});

describe('objectiveStatus', () => {
  it('reflects the local intel + required-from-pack + vault + carrying', () => {
    const s = objectiveStatus(
      player({ intel: 2, carrying: true }),
      objective({ vaultOpen: true }),
      pack(),
    );
    expect(s.intel).toBe(2);
    expect(s.intelRequired).toBe(1); // pack().objective.intelRequiredToOpenVault
    expect(s.vaultOpen).toBe(true);
    expect(s.carrying).toBe(true);
  });

  it('reports 0 required when no pack is loaded (show count without denominator)', () => {
    const s = objectiveStatus(player({ intel: 3 }), objective(), null);
    expect(s.intelRequired).toBe(0);
    expect(s.intel).toBe(3);
    expect(s.vaultOpen).toBe(false);
    expect(s.carrying).toBe(false);
  });
});

describe('nearestInteractable', () => {
  it('returns null with no nodes and a closed vault', () => {
    expect(nearestInteractable({ x: 0, z: 0 }, objective(), [])).toBeNull();
  });

  it('offers the nearest in-range intel node', () => {
    const nodes = [
      intelNode({ id: 'far', position: [1.5, 0, 0] }),
      intelNode({ id: 'near', position: [0.5, 0, 0] }),
    ];
    const r = nearestInteractable({ x: 0, z: 0 }, objective(), nodes);
    expect(r).toEqual({ kind: 'intel', targetId: 'near', label: 'Collect intel' });
  });

  it('ignores intel nodes beyond INTEL_COLLECT_RANGE', () => {
    const nodes = [intelNode({ id: 'out', position: [INTEL_COLLECT_RANGE + 1, 0, 0] })];
    expect(nearestInteractable({ x: 0, z: 0 }, objective(), nodes)).toBeNull();
  });

  it('measures intel distance on the XZ plane only (ignores y)', () => {
    const nodes = [intelNode({ id: 'a', position: [1, 100, 0] })];
    expect(nearestInteractable({ x: 0, z: 0 }, objective(), nodes)?.targetId).toBe('a');
  });

  it('offers the package when the vault is open, it is loose, and in grab range', () => {
    const obj = objective({ vaultOpen: true, packageHolderId: '', packageX: 1, packageZ: 0 });
    const r = nearestInteractable({ x: 0, z: 0 }, obj, []);
    expect(r).toEqual({ kind: 'package', targetId: 'package', label: 'Grab package' });
  });

  it('does NOT offer the package while the vault is closed', () => {
    const obj = objective({ vaultOpen: false, packageHolderId: '', packageX: 0, packageZ: 0 });
    expect(nearestInteractable({ x: 0, z: 0 }, obj, [])).toBeNull();
  });

  it('does NOT offer the package once someone is holding it', () => {
    const obj = objective({ vaultOpen: true, packageHolderId: 'rival', packageX: 0, packageZ: 0 });
    expect(nearestInteractable({ x: 0, z: 0 }, obj, [])).toBeNull();
  });

  it('does NOT offer the package beyond PACKAGE_GRAB_RANGE', () => {
    const obj = objective({
      vaultOpen: true,
      packageHolderId: '',
      packageX: PACKAGE_GRAB_RANGE + 1,
      packageZ: 0,
    });
    expect(nearestInteractable({ x: 0, z: 0 }, obj, [])).toBeNull();
  });

  it('prefers the package over a co-located intel node (higher-value gated action)', () => {
    const obj = objective({ vaultOpen: true, packageHolderId: '', packageX: 0.2, packageZ: 0 });
    const nodes = [intelNode({ id: 'near', position: [0.1, 0, 0] })];
    expect(nearestInteractable({ x: 0, z: 0 }, obj, nodes)?.kind).toBe('package');
  });

  it('falls back to intel when the package is out of grab range', () => {
    const obj = objective({
      vaultOpen: true,
      packageHolderId: '',
      packageX: PACKAGE_GRAB_RANGE + 2,
      packageZ: 0,
    });
    const nodes = [intelNode({ id: 'near', position: [0.5, 0, 0] })];
    expect(nearestInteractable({ x: 0, z: 0 }, obj, nodes)?.targetId).toBe('near');
  });
});

describe('winBanner', () => {
  it('is hidden while the match is live (winningTeam === -1)', () => {
    const b = winBanner(objective({ winningTeam: -1 }), 0);
    expect(b.show).toBe(false);
    expect(b.text).toBe('');
    expect(b.localWon).toBe(false);
  });

  it('announces a rival team extraction without claiming the local win', () => {
    const b = winBanner(objective({ winningTeam: 2 }), 0);
    expect(b.show).toBe(true);
    expect(b.localWon).toBe(false);
    expect(b.text).toContain('TEAM 2');
    expect(b.text).toContain('VICTORY');
  });

  it('flags the local team win and notes it in the banner text', () => {
    const b = winBanner(objective({ winningTeam: 1 }), 1);
    expect(b.show).toBe(true);
    expect(b.localWon).toBe(true);
    expect(b.text).toContain('TEAM 1');
    expect(b.text).toContain('YOUR TEAM');
  });
});

describe('deriveHudModel — objective / interact / win', () => {
  const colorOf = (t: ClearanceTier): string => TIER_COLOR[t];

  it('surfaces the objective row, the in-range interact label, and a live (hidden) banner', () => {
    const p = pack();
    p.intelNodes = [{ id: 'term', position: [0.5, 0, 0], zoneId: 'lobby', intelValue: 1 }];
    const s = state({
      players: { local: player({ x: 0, z: 0, intel: 1, carrying: false }) },
      // Vault open but the package is far away, so the in-range INTEL node is the offer.
      objective: objective({ vaultOpen: true, packageX: 50, packageZ: 50 }),
    });
    const m = deriveHudModel(s, 'local', p, colorOf);
    expect(m.objective).toEqual({
      intel: 1,
      intelRequired: 1,
      vaultOpen: true,
      carrying: false,
    });
    expect(m.interactLabel).toBe('Collect intel');
    expect(m.win.show).toBe(false);
  });

  it('shows the package grab label and a local-win banner when applicable', () => {
    const s = state({
      players: { local: player({ team: 0, x: 0, z: 0, carrying: false }) },
      objective: objective({ vaultOpen: true, packageHolderId: '', packageX: 0.5, packageZ: 0 }),
    });
    const m = deriveHudModel(s, 'local', pack(), colorOf);
    expect(m.interactLabel).toBe('Grab package');

    const won = deriveHudModel(
      state({
        players: { local: player({ team: 0 }) },
        objective: objective({ winningTeam: 0 }),
      }),
      'local',
      pack(),
      colorOf,
    );
    expect(won.win.show).toBe(true);
    expect(won.win.localWon).toBe(true);
  });

  it('has no interact label when nothing is in reach', () => {
    const s = state({ players: { local: player({ x: 50, z: 50 }) } });
    expect(deriveHudModel(s, 'local', pack(), colorOf).interactLabel).toBeNull();
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
