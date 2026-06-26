// Unit tests for the PURE audio-event derivation (no DOM / no AudioContext touched here, so it
// runs cleanly in the Node gate). Fixtures mirror the CURRENT NetMatchState/NetPlayerState shape
// (see hud/hudModel.test.ts) so a schema change that drops a field fails the typecheck loudly.
import { describe, expect, it } from 'vitest';
import type {
  NetMatchState,
  NetObjectiveState,
  NetPlayerState,
} from '@deceive/shared';
import { deriveAudioEvents, type SfxKind } from './audioEvents';

const LOCAL = 'local';

/** A fully-populated local player; override only the fields a test cares about. */
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

const OBJ: NetObjectiveState = {
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

/** A snapshot containing exactly the local player (plus optional objective overrides). */
function state(p: Partial<NetPlayerState> = {}, obj: Partial<NetObjectiveState> = {}): NetMatchState {
  return {
    tick: 0,
    timeMs: 0,
    phase: 'active',
    players: { [LOCAL]: player(p) },
    npcs: {},
    crumbs: {},
    objective: objective(obj),
  };
}

/** Convenience: diff two local-player overrides (same objective) and return the events. */
function diff(
  before: Partial<NetPlayerState>,
  after: Partial<NetPlayerState>,
  beforeObj: Partial<NetObjectiveState> = {},
  afterObj: Partial<NetObjectiveState> = {},
): SfxKind[] {
  return deriveAudioEvents(state(before, beforeObj), state(after, afterObj), LOCAL);
}

describe('deriveAudioEvents — guards', () => {
  it('returns [] on the first frame (prev === null), even when state looks eventful', () => {
    expect(deriveAudioEvents(null, state({ phase: 'revealed', intel: 5 }), LOCAL)).toEqual([]);
  });

  it('returns [] when nothing the local player cares about changed', () => {
    expect(diff({}, {})).toEqual([]);
  });

  it('returns [] when the local player is missing from a snapshot', () => {
    const empty: NetMatchState = {
      tick: 0,
      timeMs: 0,
      phase: 'active',
      players: {},
      npcs: {},
      crumbs: {},
      objective: objective(),
    };
    expect(deriveAudioEvents(empty, state({}), LOCAL)).toEqual([]);
    expect(deriveAudioEvents(state({}), empty, LOCAL)).toEqual([]);
  });

  it('ignores changes to OTHER players (this is the local soundtrack)', () => {
    const before: NetMatchState = {
      ...state({}),
      players: { [LOCAL]: player(), other: player({ id: 'other', phase: 'blended' }) },
    };
    const after: NetMatchState = {
      ...state({}),
      players: { [LOCAL]: player(), other: player({ id: 'other', phase: 'revealed', health: 10 }) },
    };
    expect(deriveAudioEvents(before, after, LOCAL)).toEqual([]);
  });
});

describe('deriveAudioEvents — reveal', () => {
  it('fires reveal when going blended → revealed', () => {
    expect(diff({ phase: 'blended' }, { phase: 'revealed' })).toEqual(['reveal']);
  });

  it('fires reveal when going suspicious → revealed', () => {
    expect(diff({ phase: 'suspicious' }, { phase: 'revealed' })).toEqual(['reveal']);
  });

  it('does NOT fire reveal when already revealed (no re-alarm)', () => {
    expect(diff({ phase: 'revealed' }, { phase: 'revealed' })).toEqual([]);
  });
});

describe('deriveAudioEvents — hit', () => {
  it('fires hit when health decreased', () => {
    expect(diff({ health: 100 }, { health: 80 })).toEqual(['hit']);
  });

  it('does NOT fire hit when health is unchanged or increased (heal)', () => {
    expect(diff({ health: 80 }, { health: 80 })).toEqual([]);
    expect(diff({ health: 80 }, { health: 100 })).toEqual([]);
  });
});

describe('deriveAudioEvents — downed', () => {
  it('fires downed when entering the downed phase', () => {
    expect(diff({ phase: 'revealed' }, { phase: 'downed' })).toEqual(['downed']);
  });

  it('does NOT re-fire downed while staying downed', () => {
    expect(diff({ phase: 'downed' }, { phase: 'downed' })).toEqual([]);
  });
});

describe('deriveAudioEvents — revive', () => {
  it('fires revive when downed → blended', () => {
    expect(diff({ phase: 'downed' }, { phase: 'blended' })).toEqual(['revive']);
  });

  it('fires revive when out → blended', () => {
    expect(diff({ phase: 'out' }, { phase: 'blended' })).toEqual(['revive']);
  });

  it('does NOT fire revive for a normal blended → blended', () => {
    expect(diff({ phase: 'blended' }, { phase: 'blended' })).toEqual([]);
  });
});

describe('deriveAudioEvents — disguise', () => {
  it('fires disguise when the tier changes', () => {
    expect(diff({ disguiseTier: 'civilian' }, { disguiseTier: 'security' })).toEqual(['disguise']);
  });

  it('does NOT fire disguise when the tier is unchanged', () => {
    expect(diff({ disguiseTier: 'security' }, { disguiseTier: 'security' })).toEqual([]);
  });
});

describe('deriveAudioEvents — keycard', () => {
  it('fires keycard when a non-empty card is acquired', () => {
    expect(diff({ heldKeycard: '' }, { heldKeycard: 'security' })).toEqual(['keycard']);
  });

  it('does NOT fire keycard when a card is dropped (changed to empty)', () => {
    expect(diff({ heldKeycard: 'security' }, { heldKeycard: '' })).toEqual([]);
  });

  it('does NOT fire keycard when the held card is unchanged', () => {
    expect(diff({ heldKeycard: 'scientist' }, { heldKeycard: 'scientist' })).toEqual([]);
  });
});

describe('deriveAudioEvents — intel', () => {
  it('fires intel when the count increases', () => {
    expect(diff({ intel: 1 }, { intel: 2 })).toEqual(['intel']);
  });

  it('does NOT fire intel when the count is unchanged or spent (decreases)', () => {
    expect(diff({ intel: 2 }, { intel: 2 })).toEqual([]);
    expect(diff({ intel: 2 }, { intel: 0 })).toEqual([]);
  });
});

describe('deriveAudioEvents — ability', () => {
  it('fires ability on the rising edge (false → true)', () => {
    expect(diff({ abilityActive: false }, { abilityActive: true })).toEqual(['ability']);
  });

  it('does NOT fire ability on the falling edge or while held active', () => {
    expect(diff({ abilityActive: true }, { abilityActive: false })).toEqual([]);
    expect(diff({ abilityActive: true }, { abilityActive: true })).toEqual([]);
  });
});

describe('deriveAudioEvents — objective', () => {
  it('fires vaultOpen when the vault opens (false → true)', () => {
    expect(diff({}, {}, { vaultOpen: false }, { vaultOpen: true })).toEqual(['vaultOpen']);
  });

  it('does NOT re-fire vaultOpen while it stays open', () => {
    expect(diff({}, {}, { vaultOpen: true }, { vaultOpen: true })).toEqual([]);
  });

  it('fires win when winningTeam flips from -1 to a real team', () => {
    expect(diff({}, {}, { winningTeam: -1 }, { winningTeam: 0 })).toEqual(['win']);
    expect(diff({}, {}, { winningTeam: -1 }, { winningTeam: 3 })).toEqual(['win']);
  });

  it('does NOT re-fire win once a team has already won', () => {
    expect(diff({}, {}, { winningTeam: 1 }, { winningTeam: 1 })).toEqual([]);
  });
});

describe('deriveAudioEvents — combined', () => {
  it('emits multiple events in the documented order when several change at once', () => {
    // Cover blown AND took damage AND grabbed intel AND vault popped AND a team won — all in one
    // diff. Order is: reveal, hit, intel (player diffs) then vaultOpen, win (objective diffs).
    const events = diff(
      { phase: 'suspicious', health: 100, intel: 0 },
      { phase: 'revealed', health: 60, intel: 1 },
      { vaultOpen: false, winningTeam: -1 },
      { vaultOpen: true, winningTeam: 0 },
    );
    expect(events).toEqual(['reveal', 'hit', 'intel', 'vaultOpen', 'win']);
  });

  it('fires both downed and hit when going down takes the killing damage', () => {
    expect(diff({ phase: 'revealed', health: 20 }, { phase: 'downed', health: 0 })).toEqual([
      'hit',
      'downed',
    ]);
  });
});
