// Unit tests for the PURE match-event (banner + feed) diff. No DOM here, so it runs in the Node
// gate. The single player()/objective()/state() factories mirror the CURRENT wire shape (cf.
// audio/audioEvents.test.ts) so a schema change fails the typecheck loudly in one place.
import { describe, expect, it } from 'vitest';
import type {
  NetMatchState,
  NetObjectiveState,
  NetPlayerState,
} from '@deceive/shared';
import { deriveMatchEvents } from './matchEvents';

const LOCAL = 'local';

function player(over: Partial<NetPlayerState> = {}): NetPlayerState {
  return {
    id: LOCAL,
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
    keyCreated: false,
    keyHolderId: '',
    keyX: 0,
    keyY: 0,
    keyZ: 0,
    ...over,
  };
}

function state(
  p: Partial<NetPlayerState> = {},
  obj: Partial<NetObjectiveState> = {},
): NetMatchState {
  return {
    tick: 0,
    timeMs: 0,
    phase: 'active',
    mapId: 'facility_alpha',
    players: { [LOCAL]: player(p) },
    npcs: {},
    crumbs: {},
    objective: objective(obj),
  };
}

function diff(
  before: Partial<NetPlayerState>,
  after: Partial<NetPlayerState>,
  beforeObj: Partial<NetObjectiveState> = {},
  afterObj: Partial<NetObjectiveState> = {},
) {
  return deriveMatchEvents(state(before, beforeObj), state(after, afterObj), LOCAL);
}

describe('deriveMatchEvents — guards', () => {
  it('returns empty lists on the first frame (prev === null)', () => {
    expect(deriveMatchEvents(null, state({ intel: 5 }, { vaultOpen: true }), LOCAL)).toEqual({
      banners: [],
      feed: [],
    });
  });

  it('returns empty lists when nothing relevant changed', () => {
    expect(diff({}, {})).toEqual({ banners: [], feed: [] });
  });
});

describe('deriveMatchEvents — banners', () => {
  it('fires VAULT OPEN on the vault rising edge (+ a Vault opened feed line)', () => {
    const r = diff({}, {}, { vaultOpen: false }, { vaultOpen: true });
    expect(r.banners).toEqual(['VAULT OPEN']);
    expect(r.feed).toContain('Vault opened');
  });

  it('fires PACKAGE STOLEN when a holder appears', () => {
    const r = diff({}, {}, { packageHolderId: '' }, { packageHolderId: 'rival' });
    expect(r.banners).toEqual(['PACKAGE STOLEN']);
  });

  it('fires PACKAGE DROPPED when the holder clears', () => {
    const r = diff({}, {}, { packageHolderId: 'rival' }, { packageHolderId: '' });
    expect(r.banners).toEqual(['PACKAGE DROPPED']);
  });

  it('does not re-fire VAULT OPEN once it is already open', () => {
    expect(diff({}, {}, { vaultOpen: true }, { vaultOpen: true }).banners).toEqual([]);
  });
});

describe('deriveMatchEvents — feed (local player)', () => {
  it('Collected intel on an intel increase only', () => {
    expect(diff({ intel: 1 }, { intel: 2 }).feed).toContain('Collected intel');
    expect(diff({ intel: 2 }, { intel: 1 }).feed).not.toContain('Collected intel');
  });

  it('Picked up keycard when held tier becomes non-empty', () => {
    expect(diff({ heldKeycard: '' }, { heldKeycard: 'security' }).feed).toContain(
      'Picked up keycard',
    );
    expect(diff({ heldKeycard: 'security' }, { heldKeycard: '' }).feed).not.toContain(
      'Picked up keycard',
    );
  });

  it('Grabbed the package on the carrying rising edge', () => {
    expect(diff({ carrying: false }, { carrying: true }).feed).toContain('Grabbed the package');
  });

  it('You were revealed only from a hidden phase', () => {
    expect(diff({ phase: 'blended' }, { phase: 'revealed' }).feed).toContain('You were revealed');
    expect(diff({ phase: 'revealed' }, { phase: 'revealed' }).feed).not.toContain(
      'You were revealed',
    );
  });

  it('Downed entering downed, Revived coming back from downed', () => {
    expect(diff({ phase: 'blended' }, { phase: 'downed' }).feed).toContain('Downed');
    expect(diff({ phase: 'downed' }, { phase: 'blended' }).feed).toContain('Revived');
  });

  it('ignores changes for a missing local player (mid-join)', () => {
    const before = deriveMatchEvents(
      { ...state(), players: {} },
      state({ intel: 5 }),
      LOCAL,
    );
    expect(before.feed).toEqual([]);
  });
});
