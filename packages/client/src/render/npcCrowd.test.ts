import { describe, expect, it } from 'vitest';
import type { NetMatchState, NetNpcState } from '@deceive/shared';
import { easeNpcToward, npcIds, seedNpcRender } from './npcCrowd';

function npc(over: Partial<NetNpcState> = {}): NetNpcState {
  return { id: 'n1', tier: 'civilian', x: 0, y: 0, z: 0, yaw: 0, ...over };
}

function emptyState(npcs: Record<string, NetNpcState> = {}): NetMatchState {
  return {
    tick: 0,
    timeMs: 0,
    phase: 'active',
    players: {},
    npcs,
    crumbs: {},
    objective: {
      vaultOpen: false,
      packageHolderId: '',
      packageX: 0,
      packageY: 0,
      packageZ: 0,
      winningTeam: -1,
    },
  };
}

describe('seedNpcRender', () => {
  it('anchors the render pose exactly on the snapshot, tier uncoloured', () => {
    const s = seedNpcRender(npc({ x: 3, y: 1, z: -2, yaw: 0.5, tier: 'security' }));
    expect(s.render).toEqual({ x: 3, y: 1, z: -2 });
    expect(s.renderYaw).toBe(0.5);
    // tier starts empty so the first colorByTier always applies (matches WorldView).
    expect(s.tier).toBe('');
  });
});

describe('easeNpcToward', () => {
  it('moves the render pose toward the snapshot without overshooting', () => {
    const s = seedNpcRender(npc({ x: 0, z: 0 }));
    easeNpcToward(s, npc({ x: 10, z: 0 }), 0.92, 1 / 60);
    expect(s.render.x).toBeGreaterThan(0);
    expect(s.render.x).toBeLessThan(10);
    expect(s.render.z).toBe(0);
  });

  it('is a no-op when already at the snapshot', () => {
    const s = seedNpcRender(npc({ x: 5, z: 5, yaw: 1 }));
    easeNpcToward(s, npc({ x: 5, z: 5, yaw: 1 }), 0.92, 1 / 60);
    expect(s.render).toEqual({ x: 5, y: 0, z: 5 });
    expect(s.renderYaw).toBeCloseTo(1);
  });

  it('eases the yaw along the shortest arc (wraps past pi)', () => {
    const s = seedNpcRender(npc({ yaw: 3.0 }));
    // Target just past -pi; shortest arc is forward (increasing), not all the way back.
    easeNpcToward(s, npc({ yaw: -3.0 }), 0.92, 1 / 60);
    expect(s.renderYaw).toBeGreaterThan(3.0);
  });

  it('converges to the snapshot under repeated steps', () => {
    const s = seedNpcRender(npc({ x: 0, z: 0 }));
    for (let i = 0; i < 240; i++) easeNpcToward(s, npc({ x: 7, z: -4 }), 0.92, 1 / 60);
    expect(s.render.x).toBeCloseTo(7, 2);
    expect(s.render.z).toBeCloseTo(-4, 2);
  });
});

describe('npcIds', () => {
  it('returns the empty list for a crowd-less snapshot (offline mock)', () => {
    expect(npcIds(emptyState())).toEqual([]);
  });

  it('lists every npc id present in the snapshot', () => {
    const state = emptyState({
      a: npc({ id: 'a' }),
      b: npc({ id: 'b', tier: 'staff' }),
    });
    expect(npcIds(state).sort()).toEqual(['a', 'b']);
  });
});
