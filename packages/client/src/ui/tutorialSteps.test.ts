import { describe, expect, it } from 'vitest';
import type { NetMatchState, NetObjectiveState, NetPlayerState } from '@deceive/shared';
import { tutorialProgress } from './tutorialSteps';

function obj(over: Partial<NetObjectiveState> = {}): NetObjectiveState {
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

function state(p: Partial<NetPlayerState>, o: Partial<NetObjectiveState> = {}): NetMatchState {
  return {
    tick: 0,
    timeMs: 0,
    phase: 'active',
    mapId: 'tutorial_grounds',
    players: { local: player(p) },
    npcs: {},
    crumbs: {},
    objective: obj(o),
  };
}

describe('tutorialProgress', () => {
  it('starts with all steps incomplete at index 0', () => {
    const r = tutorialProgress(state({}), 'local', 2);
    expect(r.steps).toHaveLength(6);
    expect(r.steps.every((s) => !s.done)).toBe(true);
    expect(r.activeIndex).toBe(0);
    expect(r.allDone).toBe(false);
  });

  it('marks intel done once enough is gathered', () => {
    expect(tutorialProgress(state({ intel: 1 }), 'local', 2).steps[0]!.done).toBe(false);
    expect(tutorialProgress(state({ intel: 2 }), 'local', 2).steps[0]!.done).toBe(true);
  });

  it('marks costume done when no longer civilian', () => {
    expect(tutorialProgress(state({ disguiseTier: 'security' }), 'local', 2).steps[1]!.done).toBe(true);
  });

  it('marks the shoot step done after firing (fireSeq > 0)', () => {
    expect(tutorialProgress(state({ fireSeq: 1 }), 'local', 2).steps[2]!.done).toBe(true);
  });

  it('tracks the forge → grab → extract beats from the objective', () => {
    expect(tutorialProgress(state({}, { keyCreated: true }), 'local', 2).steps[3]!.done).toBe(true);
    expect(tutorialProgress(state({}, { keyCreated: true, keyHolderId: 'local' }), 'local', 2).steps[4]!.done).toBe(true);
    expect(tutorialProgress(state({ team: 0 }, { winningTeam: 0 }), 'local', 2).steps[5]!.done).toBe(true);
  });

  it('advances the active index to the first unfinished step', () => {
    const r = tutorialProgress(state({ intel: 2, disguiseTier: 'security' }), 'local', 2);
    expect(r.activeIndex).toBe(2); // intel + disguise done → shoot is next
  });

  it('reports allDone when every beat is complete', () => {
    const r = tutorialProgress(
      state(
        { intel: 2, disguiseTier: 'security', fireSeq: 3, team: 0 },
        { keyCreated: true, keyHolderId: 'local', winningTeam: 0 },
      ),
      'local',
      2,
    );
    expect(r.allDone).toBe(true);
    expect(r.activeIndex).toBe(6);
  });

  it('handles a missing local player (pre-spawn) as all-incomplete', () => {
    const r = tutorialProgress(state({}), 'ghost', 2);
    expect(r.allDone).toBe(false);
    expect(r.activeIndex).toBe(0);
  });
});
