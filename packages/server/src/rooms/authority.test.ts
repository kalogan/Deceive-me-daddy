// Pure-logic tests (PROJECT_BRIEF §4.6) for the server-authoritative pipeline WITHOUT a
// Colyseus room: input validation + the apply-input -> sim-step -> world-mirror path.
// Synchronous + clean-exit (no socket).
import { describe, expect, it } from 'vitest';
import { TICK_MS, WALK_SPEED, type PlayerInput } from '@deceive/shared';
import {
  createRng,
  createWorld,
  FixedClock,
  spawnPlayer,
  step,
  type SimDeps,
} from '@deceive/sim-core';
import { MatchState } from '../state/MatchState';
import { syncWorldToState } from '../state/sync';
import { applyMovementInput } from './applyInput';
import { isValidInput } from './MatchRoom';

function input(over: Partial<PlayerInput> = {}): PlayerInput {
  return { seq: 1, moveX: 0, moveZ: 0, yaw: 0, running: false, jumping: false, ...over };
}

describe('isValidInput', () => {
  it('accepts a well-formed PlayerInput', () => {
    expect(isValidInput(input({ moveX: 0.5 }))).toBe(true);
  });

  it('rejects non-objects and null', () => {
    expect(isValidInput(null)).toBe(false);
    expect(isValidInput(42)).toBe(false);
    expect(isValidInput('input')).toBe(false);
  });

  it('rejects payloads missing or mistyping fields', () => {
    expect(isValidInput({ moveX: 1, moveZ: 0, yaw: 0, running: false, jumping: false })).toBe(
      false,
    ); // no seq
    expect(
      isValidInput({ seq: 1, moveX: '1', moveZ: 0, yaw: 0, running: false, jumping: false }),
    ).toBe(false); // moveX wrong type
    expect(
      isValidInput({ seq: 1, moveX: 1, moveZ: 0, yaw: 0, running: 'no', jumping: false }),
    ).toBe(false); // running wrong type
  });
});

describe('authoritative input -> sim step -> state mirror', () => {
  it('integrates position from the server-derived velocity (client position never used)', () => {
    const world = createWorld();
    const deps: SimDeps = { clock: new FixedClock(), rng: createRng(1) };
    spawnPlayer(world, 'p', 0, { x: 0, y: 0, z: 0 });
    const p = world.players.get('p')!;

    // Client REQUESTS forward movement; server applies clamped velocity.
    applyMovementInput(p, input({ moveZ: 1 }));
    expect(p.vel.z).toBeCloseTo(WALK_SPEED, 6);

    // Server steps the deterministic sim one tick: position advances by vel * dt.
    step(world, deps, TICK_MS);
    const expectedZ = WALK_SPEED * (TICK_MS / 1000);
    expect(p.pos.z).toBeCloseTo(expectedZ, 6);

    // The broadcast mirror reflects the authoritative position.
    const state = new MatchState();
    syncWorldToState(world, state);
    expect(state.players.get('p')!.z).toBeCloseTo(expectedZ, 6);
    expect(state.tick).toBe(1);
  });
});
