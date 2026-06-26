// Unit tests for the PURE reflected-schema -> NetMatchState mapping (slice 1.3).
//
// No socket / no real server is opened here (zombie-gate hazard, PROJECT_BRIEF §B): we
// drive `toNetMatchState` with plain objects shaped like the colyseus.js reflection. The
// `players` field is any ITERABLE of player-like objects (array here; a MapSchema's
// `.values()` at runtime), which `toNetMatchState` keys into a Record by id.
import { describe, expect, it } from 'vitest';
import { toNetMatchState, type RawPlayer } from './ColyseusSource';

const fullPlayer = (over: Partial<RawPlayer> = {}): RawPlayer => ({
  id: 'p1',
  team: 2,
  x: 1,
  y: 0,
  z: -3,
  yaw: 1.5,
  disguiseTier: 'security',
  suspicion: 42,
  phase: 'suspicious',
  ...over,
});

describe('toNetMatchState', () => {
  it('maps every field of a fully-populated state through unchanged', () => {
    const out = toNetMatchState({
      tick: 17,
      timeMs: 1234,
      phase: 'active',
      players: [fullPlayer()],
    });

    expect(out).toEqual({
      tick: 17,
      timeMs: 1234,
      phase: 'active',
      players: {
        p1: {
          id: 'p1',
          team: 2,
          x: 1,
          y: 0,
          z: -3,
          yaw: 1.5,
          disguiseTier: 'security',
          suspicion: 42,
          phase: 'suspicious',
        },
      },
      npcs: {},
    });
  });

  it('keys the players iterable into a record by id', () => {
    const out = toNetMatchState({
      tick: 1,
      timeMs: 0,
      phase: 'active',
      players: [fullPlayer({ id: 'a' }), fullPlayer({ id: 'b', team: 3 })],
    });

    expect(Object.keys(out.players).sort()).toEqual(['a', 'b']);
    expect(out.players.a?.id).toBe('a');
    expect(out.players.b?.team).toBe(3);
  });

  it('consumes any iterable (e.g. a MapSchema.values() generator), not just arrays', () => {
    function* gen(): Generator<RawPlayer> {
      yield fullPlayer({ id: 'g1' });
      yield fullPlayer({ id: 'g2' });
    }
    const out = toNetMatchState({ tick: 0, timeMs: 0, phase: 'active', players: gen() });
    expect(Object.keys(out.players).sort()).toEqual(['g1', 'g2']);
  });

  it('fills sparse player fields with safe defaults (renderer never sees undefined)', () => {
    const out = toNetMatchState({ players: [{ id: 'only-id' }] });
    expect(out.players['only-id']).toEqual({
      id: 'only-id',
      team: 0,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      disguiseTier: 'civilian',
      suspicion: 0,
      phase: 'blended',
    });
  });

  it('skips entries without an id (a partial pre-spawn reflection)', () => {
    const out = toNetMatchState({ players: [{ x: 5 }, fullPlayer({ id: 'kept' })] });
    expect(Object.keys(out.players)).toEqual(['kept']);
  });

  it('defaults a fully-empty state to a renderable lobby snapshot', () => {
    expect(toNetMatchState({})).toEqual({
      tick: 0,
      timeMs: 0,
      phase: 'lobby',
      players: {},
      npcs: {},
    });
  });

  it('tolerates null/undefined input and a null players container', () => {
    const empty = { tick: 0, timeMs: 0, phase: 'lobby' as const, players: {}, npcs: {} };
    expect(toNetMatchState(null)).toEqual(empty);
    expect(toNetMatchState(undefined)).toEqual(empty);
    expect(toNetMatchState({ phase: 'active', players: null })).toEqual({
      tick: 0,
      timeMs: 0,
      phase: 'active',
      players: {},
      npcs: {},
    });
  });

  it('maps the npc crowd into a record by id with tier + position defaults', () => {
    const out = toNetMatchState({
      players: [],
      npcs: [
        { id: 'n1', tier: 'staff', x: 1, y: 0, z: 2, yaw: 0.5 },
        { id: 'n2' }, // sparse: defaults applied
        { x: 9 }, // no id: skipped
      ],
    });
    expect(Object.keys(out.npcs).sort()).toEqual(['n1', 'n2']);
    expect(out.npcs.n1).toEqual({ id: 'n1', tier: 'staff', x: 1, y: 0, z: 2, yaw: 0.5 });
    expect(out.npcs.n2).toEqual({ id: 'n2', tier: 'civilian', x: 0, y: 0, z: 0, yaw: 0 });
  });
});
