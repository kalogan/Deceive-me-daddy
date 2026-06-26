// Tests for the deterministic 1v1 duel round state machine. Covers every transition:
// countdown→live on the timer, live→round_over on an elimination (+ score + correct winner),
// round_over→countdown with round increment, round_over→match_over at roundsToWin, the
// double-down tiebreak, and that scores accumulate to a full 3-round match win.
import { describe, expect, it } from 'vitest';
import { FixedClock } from './clock';
import {
  createDuel,
  duelAlivePlayers,
  DUEL_COUNTDOWN_MS,
  DUEL_ROUND_OVER_MS,
  DUEL_ROUNDS_TO_WIN,
  isEliminated,
  stepDuel,
} from './duel';
import type { Rng } from './rng';
import type { SimDeps } from './world';
import { createWorld, spawnPlayer } from './world';

function makeDeps(clock: FixedClock): SimDeps {
  return { clock, rng: { next: () => 0 } as unknown as Rng };
}

function setup() {
  const clock = new FixedClock(0);
  const deps = makeDeps(clock);
  const world = createWorld();
  const p1 = spawnPlayer(world, 'p1', 0, { x: 0, y: 0, z: 0 });
  const p2 = spawnPlayer(world, 'p2', 1, { x: 0, y: 0, z: 10 });
  const duel = createDuel('p1', 'p2', DUEL_ROUNDS_TO_WIN, clock.now());
  return { world, deps, clock, duel, p1, p2 };
}

describe('createDuel', () => {
  it('starts in countdown on round 1 with zeroed scores + a countdown timer', () => {
    const clock = new FixedClock(500);
    const duel = createDuel('a', 'b', 3, clock.now());
    expect(duel.phase).toBe('countdown');
    expect(duel.round).toBe(1);
    expect(duel.p1Id).toBe('a');
    expect(duel.p2Id).toBe('b');
    expect(duel.p1Score).toBe(0);
    expect(duel.p2Score).toBe(0);
    expect(duel.roundsToWin).toBe(3);
    expect(duel.matchWinnerId).toBe('');
    expect(duel.roundWinnerId).toBe('');
    expect(duel.phaseEndsAtMs).toBe(500 + DUEL_COUNTDOWN_MS);
  });
});

describe('isEliminated / duelAlivePlayers', () => {
  it('treats downed and out as eliminated (single life)', () => {
    const { p1 } = setup();
    p1.phase = 'blended';
    expect(isEliminated(p1)).toBe(false);
    p1.phase = 'downed';
    expect(isEliminated(p1)).toBe(true);
    p1.phase = 'out';
    expect(isEliminated(p1)).toBe(true);
  });

  it('lists only living slots, dropping missing players', () => {
    const { world, p1 } = setup();
    expect(duelAlivePlayers(world, 'p1', 'p2')).toEqual(['p1', 'p2']);
    p1.phase = 'downed';
    expect(duelAlivePlayers(world, 'p1', 'p2')).toEqual(['p2']);
    world.players.delete('p2');
    expect(duelAlivePlayers(world, 'p1', 'p2')).toEqual([]);
  });
});

describe('countdown → live', () => {
  it('goes live exactly when the countdown elapses, clearing the timer', () => {
    const { duel, world, deps, clock } = setup();
    clock.advance(DUEL_COUNTDOWN_MS - 1);
    stepDuel(duel, world, deps);
    expect(duel.phase).toBe('countdown');
    clock.advance(1);
    stepDuel(duel, world, deps);
    expect(duel.phase).toBe('live');
    expect(duel.phaseEndsAtMs).toBe(0);
  });
});

describe('live → round_over', () => {
  it('ends the round on the first elimination; the survivor scores', () => {
    const { duel, world, deps, clock, p2 } = setup();
    clock.advance(DUEL_COUNTDOWN_MS);
    stepDuel(duel, world, deps); // → live
    clock.advance(5000);
    p2.phase = 'downed'; // p2 eliminated → p1 survives
    stepDuel(duel, world, deps);
    expect(duel.phase).toBe('round_over');
    expect(duel.roundWinnerId).toBe('p1');
    expect(duel.p1Score).toBe(1);
    expect(duel.p2Score).toBe(0);
    expect(duel.phaseEndsAtMs).toBe(clock.now() + DUEL_ROUND_OVER_MS);
  });

  it('credits the OTHER survivor when p1 is the one downed', () => {
    const { duel, world, deps, clock, p1 } = setup();
    clock.advance(DUEL_COUNTDOWN_MS);
    stepDuel(duel, world, deps);
    p1.phase = 'out';
    stepDuel(duel, world, deps);
    expect(duel.roundWinnerId).toBe('p2');
    expect(duel.p2Score).toBe(1);
    expect(duel.p1Score).toBe(0);
  });

  it('double-down tiebreak: the player with more health survives', () => {
    const { duel, world, deps, clock, p1, p2 } = setup();
    clock.advance(DUEL_COUNTDOWN_MS);
    stepDuel(duel, world, deps);
    p1.phase = 'downed';
    p1.health = 10;
    p2.phase = 'downed';
    p2.health = 40; // p2 has more remaining health → p2 wins
    stepDuel(duel, world, deps);
    expect(duel.roundWinnerId).toBe('p2');
    expect(duel.p2Score).toBe(1);
  });

  it('double-down tiebreak: equal health falls back to p1', () => {
    const { duel, world, deps, clock, p1, p2 } = setup();
    clock.advance(DUEL_COUNTDOWN_MS);
    stepDuel(duel, world, deps);
    p1.phase = 'downed';
    p1.health = 0;
    p2.phase = 'downed';
    p2.health = 0;
    stepDuel(duel, world, deps);
    expect(duel.roundWinnerId).toBe('p1');
    expect(duel.p1Score).toBe(1);
  });
});

describe('round_over → countdown', () => {
  it('rolls into the next round (round += 1, winner cleared, fresh countdown)', () => {
    const { duel, world, deps, clock, p2 } = setup();
    clock.advance(DUEL_COUNTDOWN_MS);
    stepDuel(duel, world, deps); // live
    p2.phase = 'downed';
    stepDuel(duel, world, deps); // round_over
    expect(duel.round).toBe(1);
    clock.advance(DUEL_ROUND_OVER_MS);
    stepDuel(duel, world, deps);
    expect(duel.phase).toBe('countdown');
    expect(duel.round).toBe(2);
    expect(duel.roundWinnerId).toBe('');
    expect(duel.phaseEndsAtMs).toBe(clock.now() + DUEL_COUNTDOWN_MS);
  });

  it('does not advance before the round_over pause elapses', () => {
    const { duel, world, deps, clock, p2 } = setup();
    clock.advance(DUEL_COUNTDOWN_MS);
    stepDuel(duel, world, deps);
    p2.phase = 'downed';
    stepDuel(duel, world, deps);
    clock.advance(DUEL_ROUND_OVER_MS - 1);
    stepDuel(duel, world, deps);
    expect(duel.phase).toBe('round_over');
  });
});

describe('round_over → match_over', () => {
  it('ends the match when the round winner has reached roundsToWin', () => {
    const { duel, world, deps, clock, p2 } = setup();
    // Pre-load p1 to one win short of the match.
    duel.p1Score = DUEL_ROUNDS_TO_WIN - 1;
    clock.advance(DUEL_COUNTDOWN_MS);
    stepDuel(duel, world, deps); // live
    p2.phase = 'downed'; // p1 wins the deciding round
    stepDuel(duel, world, deps); // round_over, p1Score === roundsToWin
    expect(duel.p1Score).toBe(DUEL_ROUNDS_TO_WIN);
    clock.advance(DUEL_ROUND_OVER_MS);
    stepDuel(duel, world, deps);
    expect(duel.phase).toBe('match_over');
    expect(duel.matchWinnerId).toBe('p1');
    expect(duel.phaseEndsAtMs).toBe(0);
  });

  it('is terminal: no further transition from match_over', () => {
    const { duel, world, deps, clock } = setup();
    duel.phase = 'match_over';
    duel.matchWinnerId = 'p1';
    clock.advance(100000);
    stepDuel(duel, world, deps);
    expect(duel.phase).toBe('match_over');
    expect(duel.matchWinnerId).toBe('p1');
  });
});

describe('waiting', () => {
  it('does not auto-transition (the room drives entry)', () => {
    const { duel, world, deps, clock } = setup();
    duel.phase = 'waiting';
    clock.advance(100000);
    stepDuel(duel, world, deps);
    expect(duel.phase).toBe('waiting');
  });
});

describe('full match: scores accumulate to a 3-round win', () => {
  it('p1 wins rounds 1,2,3 and takes the match', () => {
    const { duel, world, deps, clock, p1, p2 } = setup();

    function reset(): void {
      p1.phase = 'blended';
      p1.health = 100;
      p2.phase = 'blended';
      p2.health = 100;
    }

    function playRoundP1Wins(): void {
      // countdown → live
      clock.advance(DUEL_COUNTDOWN_MS);
      stepDuel(duel, world, deps);
      expect(duel.phase).toBe('live');
      // p1 eliminates p2
      p2.phase = 'downed';
      stepDuel(duel, world, deps);
      expect(duel.phase).toBe('round_over');
    }

    // Round 1
    playRoundP1Wins();
    expect(duel.p1Score).toBe(1);
    clock.advance(DUEL_ROUND_OVER_MS);
    stepDuel(duel, world, deps);
    expect(duel.phase).toBe('countdown');
    expect(duel.round).toBe(2);
    reset();

    // Round 2
    playRoundP1Wins();
    expect(duel.p1Score).toBe(2);
    clock.advance(DUEL_ROUND_OVER_MS);
    stepDuel(duel, world, deps);
    expect(duel.phase).toBe('countdown');
    expect(duel.round).toBe(3);
    reset();

    // Round 3 — deciding
    playRoundP1Wins();
    expect(duel.p1Score).toBe(3);
    clock.advance(DUEL_ROUND_OVER_MS);
    stepDuel(duel, world, deps);
    expect(duel.phase).toBe('match_over');
    expect(duel.matchWinnerId).toBe('p1');
    expect(duel.p2Score).toBe(0);
  });
});
