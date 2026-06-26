// Unit tests for the PURE waypoint target-selection + bearing. No DOM, runs in the Node gate.
// Single player()/objective()/pack() factories mirror the current wire/pack shapes.
import { describe, expect, it } from 'vitest';
import type {
  ContentPack,
  NetObjectiveState,
  NetPlayerState,
} from '@deceive/shared';
import { bearingTo, pickWaypointTarget } from './waypointModel';

function player(over: Partial<NetPlayerState> = {}): NetPlayerState {
  return {
    id: 'local',
    team: 0,
    agentId: 'squire',
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
    heldKeycard: '',
    abilityActive: false,
    abilityCooldownMs: 0,
    ...over,
  };
}

function objective(over: Partial<NetObjectiveState> = {}): NetObjectiveState {
  return {
    vaultOpen: false,
    packageHolderId: '',
    packageX: 0,
    packageY: 0,
    packageZ: 0,
    winningTeam: -1,
    ...over,
  };
}

function pack(over: Partial<ContentPack> = {}): ContentPack {
  return {
    schemaVersion: 1,
    id: 'test',
    name: 'Test',
    theme: 'facility',
    zones: [
      {
        id: 'lobby',
        name: 'Lobby',
        requiredClearance: 'civilian',
        bounds: { min: [-10, 0, -10], max: [10, 4, 10] },
      },
    ],
    doors: [],
    npcs: [],
    keycards: [],
    socialSpots: [],
    intelNodes: [
      { id: 'i1', position: [5, 0, 0], zoneId: 'lobby', intelValue: 1 },
      { id: 'i2', position: [20, 0, 0], zoneId: 'lobby', intelValue: 1 },
    ],
    objective: {
      vaultZoneId: 'lobby',
      packagePosition: [0, 0, 0],
      intelRequiredToOpenVault: 3,
      extractionPoints: [
        [0, 0, 30],
        [0, 0, -100],
      ],
    },
    spawnPoints: [{ position: [0, 0, 0] }],
    ...over,
  };
}

describe('pickWaypointTarget', () => {
  it('points at the nearest intel node when the vault is locked', () => {
    const t = pickWaypointTarget(player(), objective({ vaultOpen: false }), pack());
    expect(t?.kind).toBe('intel');
    expect(t).toMatchObject({ x: 5, z: 0 }); // i1 is nearer than i2
  });

  it('points at the package when the vault is open and the package is loose', () => {
    const t = pickWaypointTarget(
      player(),
      objective({ vaultOpen: true, packageHolderId: '', packageX: 7, packageZ: 8 }),
      pack(),
    );
    expect(t).toMatchObject({ kind: 'package', x: 7, z: 8 });
  });

  it('falls back to intel when the vault is open but the package is already held', () => {
    const t = pickWaypointTarget(
      player(),
      objective({ vaultOpen: true, packageHolderId: 'rival' }),
      pack(),
    );
    expect(t?.kind).toBe('intel');
  });

  it('points at the nearest extraction point when carrying', () => {
    const t = pickWaypointTarget(
      player({ carrying: true }),
      objective({ vaultOpen: true, packageHolderId: 'local' }),
      pack(),
    );
    expect(t).toMatchObject({ kind: 'extract', x: 0, z: 30 }); // nearer than z:-100
  });

  it('returns null when carrying but no extraction points exist', () => {
    const t = pickWaypointTarget(
      player({ carrying: true }),
      objective(),
      pack({
        objective: {
          vaultZoneId: 'lobby',
          packagePosition: [0, 0, 0],
          intelRequiredToOpenVault: 3,
          extractionPoints: [],
        },
      } as Partial<ContentPack>),
    );
    expect(t).toBeNull();
  });

  it('returns null with no pack and a locked vault (nothing to point at)', () => {
    expect(pickWaypointTarget(player(), objective(), null)).toBeNull();
  });
});

describe('bearingTo', () => {
  it('is ~0 for a target dead ahead (forward = +Z at yaw 0)', () => {
    expect(bearingTo({ x: 0, z: 0, yaw: 0 }, 0, 10)).toBeCloseTo(0);
  });

  it('is +pi/2 for a target to the right at yaw 0', () => {
    expect(bearingTo({ x: 0, z: 0, yaw: 0 }, 10, 0)).toBeCloseTo(Math.PI / 2);
  });

  it('is -pi/2 for a target to the left at yaw 0', () => {
    expect(bearingTo({ x: 0, z: 0, yaw: 0 }, -10, 0)).toBeCloseTo(-Math.PI / 2);
  });

  it('accounts for the player yaw (facing the target → 0)', () => {
    // Target is to the world-right (+X); facing yaw pi/2 looks along +X, so it is now dead ahead.
    expect(bearingTo({ x: 0, z: 0, yaw: Math.PI / 2 }, 10, 0)).toBeCloseTo(0);
  });

  it('returns 0 for a coincident target (degenerate)', () => {
    expect(bearingTo({ x: 3, z: 3, yaw: 1 }, 3, 3)).toBe(0);
  });

  it('stays within [-pi, pi]', () => {
    const b = bearingTo({ x: 0, z: 0, yaw: 3 }, 0, -10);
    expect(b).toBeGreaterThanOrEqual(-Math.PI);
    expect(b).toBeLessThanOrEqual(Math.PI);
  });
});
