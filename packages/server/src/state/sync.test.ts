// Pure-logic tests (PROJECT_BRIEF §4.6) for world -> schema sync. NO Colyseus room /
// socket — we construct a MatchState directly and assert the mirror matches the sim
// WorldState. Synchronous + clean-exit.
import { describe, expect, it } from 'vitest';
import { createWorld, spawnPlayer, type WorldState } from '@deceive/sim-core';
import { MatchState } from './MatchState';
import { syncWorldToState } from './sync';

function seededWorld(): WorldState {
  const world = createWorld();
  spawnPlayer(world, 'a', 0, { x: 1, y: 2, z: 3 });
  spawnPlayer(world, 'b', 1, { x: -4, y: 0, z: 5 });
  return world;
}

describe('syncWorldToState', () => {
  it('copies tick + timeMs from the world', () => {
    const world = seededWorld();
    world.tick = 7;
    world.timeMs = 1234;
    const state = new MatchState();
    syncWorldToState(world, state);
    expect(state.tick).toBe(7);
    expect(state.timeMs).toBe(1234);
  });

  it('mirrors each player field-for-field', () => {
    const world = seededWorld();
    const a = world.players.get('a')!;
    a.yaw = 0.7;
    a.suspicion = 42;
    a.phase = 'suspicious';
    a.disguiseTier = 'security';

    const state = new MatchState();
    syncWorldToState(world, state);

    const sa = state.players.get('a')!;
    expect(sa.id).toBe('a');
    expect(sa.team).toBe(0);
    expect(sa.x).toBe(1);
    expect(sa.y).toBe(2);
    expect(sa.z).toBe(3);
    expect(sa.yaw).toBeCloseTo(0.7, 6);
    expect(sa.suspicion).toBe(42);
    expect(sa.phase).toBe('suspicious');
    expect(sa.disguiseTier).toBe('security');
  });

  it('creates schema entries for new players and reuses them across syncs', () => {
    const world = seededWorld();
    const state = new MatchState();
    syncWorldToState(world, state);
    const firstRef = state.players.get('a');
    expect(state.players.size).toBe(2);

    // Move a player in the sim, re-sync: same schema instance, updated values.
    world.players.get('a')!.pos.x = 99;
    syncWorldToState(world, state);
    expect(state.players.get('a')).toBe(firstRef);
    expect(state.players.get('a')!.x).toBe(99);
  });

  it('mirrors the gadget cooldown remaining (clamped to the uint16 wire field)', () => {
    const world = seededWorld();
    const a = world.players.get('a')!;
    world.timeMs = 1000;
    a.gadgetReadyAtMs = 6000; // 5000ms remaining at timeMs 1000
    const state = new MatchState();
    syncWorldToState(world, state);
    expect(state.players.get('a')!.gadgetCooldownMs).toBe(5000);

    // Ready (no cooldown) → 0.
    const b = world.players.get('b')!;
    b.gadgetReadyAtMs = 0;
    syncWorldToState(world, state);
    expect(state.players.get('b')!.gadgetCooldownMs).toBe(0);
  });

  it('prunes schema players whose sim player left', () => {
    const world = seededWorld();
    const state = new MatchState();
    syncWorldToState(world, state);
    expect(state.players.size).toBe(2);

    world.players.delete('b');
    syncWorldToState(world, state);
    expect(state.players.size).toBe(1);
    expect(state.players.has('b')).toBe(false);
    expect(state.players.has('a')).toBe(true);
  });
});
