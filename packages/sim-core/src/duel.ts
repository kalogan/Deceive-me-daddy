// The 1v1 stealth-duel round state machine (the "Quick" duel format). PURE + DETERMINISTIC:
// no Date.now / Math.random — all time comes from `deps.clock.now()`. This module ONLY computes
// the next DuelState from (current state, world, deps); it performs NO side effects. The SERVER
// (DuelRoom) detects phase CHANGES (prev.phase vs next.phase) to fire side effects — the actual
// player/NPC RESET on a new round, match-end bookkeeping, etc.
//
// Lifecycle (mirrors NetDuelState.phase):
//   waiting    → (room-driven) the room creates the duel once TWO humans have joined.
//   countdown  → live        when now >= phaseEndsAtMs (the round opens; phaseEndsAtMs cleared).
//   live       → round_over  when exactly ONE of the two players is still alive; the survivor
//                             scores and roundWinnerId is set.
//   round_over → match_over  when now >= phaseEndsAtMs AND a player has reached roundsToWin.
//   round_over → countdown   otherwise when now >= phaseEndsAtMs (next round; round += 1).
//   match_over → (terminal)  the room drives exit.
//
// Single life: a player is ELIMINATED the moment phase === 'downed' || 'out' (a down == out in
// duel — no revive). The round ends on the first elimination, so "exactly one alive" is the
// authoritative round-end test.
import type { DuelPhase } from '@deceive/shared';
import type { PlayerState, SimDeps, WorldState } from './world';

/** Round wins needed to take the match — the "Quick" duel format. */
export const DUEL_ROUNDS_TO_WIN = 3;
/** Countdown phase length (ms) before a round goes live. */
export const DUEL_COUNTDOWN_MS = 3000;
/** Pause (ms) after a round ends before the next countdown / match end. */
export const DUEL_ROUND_OVER_MS = 3500;

/** The authoritative duel round/score state. Mirrors NetDuelState field-for-field. */
export interface DuelState {
  phase: DuelPhase;
  /** Round wins needed to take the match. */
  roundsToWin: number;
  /** Current round number, 1-based. */
  round: number;
  /** Player slot 1: id + round-wins. */
  p1Id: string;
  p1Score: number;
  /** Player slot 2: id + round-wins. */
  p2Id: string;
  p2Score: number;
  /** Id of the player who won the LAST round ('' until a round ends, cleared on the next round). */
  roundWinnerId: string;
  /** Id of the player who won the MATCH ('' until phase === 'match_over'). */
  matchWinnerId: string;
  /** Sim time (ms) at which the current TIMED phase advances; 0 when not on a timer
   * (live until a kill / match_over). */
  phaseEndsAtMs: number;
}

/**
 * True if `player` is out of the round. Single-life duel: a DOWN is terminal (treated as out),
 * so a downed OR out player counts as eliminated. A missing player (left mid-round) is also
 * considered eliminated by callers via `duelAlivePlayers`.
 */
export function isEliminated(player: PlayerState): boolean {
  return player.phase === 'downed' || player.phase === 'out';
}

/**
 * The ids of the two duel slots that are still alive this tick. A slot whose player is missing
 * from the world (e.g. left) or eliminated is dropped. Used to detect the round-ending state
 * (exactly one alive) deterministically.
 */
export function duelAlivePlayers(world: WorldState, p1Id: string, p2Id: string): string[] {
  const alive: string[] = [];
  for (const id of [p1Id, p2Id]) {
    const p = world.players.get(id);
    if (p && !isEliminated(p)) alive.push(id);
  }
  return alive;
}

/**
 * Create a fresh duel for two players. Starts in 'countdown' on round 1 with zeroed scores; the
 * round goes live once `phaseEndsAtMs` (now + DUEL_COUNTDOWN_MS) passes.
 */
export function createDuel(
  p1Id: string,
  p2Id: string,
  roundsToWin: number,
  now: number,
): DuelState {
  return {
    phase: 'countdown',
    roundsToWin,
    round: 1,
    p1Id,
    p1Score: 0,
    p2Id,
    p2Score: 0,
    roundWinnerId: '',
    matchWinnerId: '',
    phaseEndsAtMs: now + DUEL_COUNTDOWN_MS,
  };
}

/** The score a given slot currently holds. */
function scoreFor(duel: DuelState, id: string): number {
  if (id === duel.p1Id) return duel.p1Score;
  if (id === duel.p2Id) return duel.p2Score;
  return 0;
}

/**
 * Pick the deterministic winner when BOTH duel players are eliminated on the same tick (a trade).
 * Tiebreak: the player with more remaining HEALTH survives; if equal (or a player is missing),
 * fall back to p1. Documented + deterministic so replays agree.
 */
function tiebreakWinner(world: WorldState, duel: DuelState): string {
  const p1 = world.players.get(duel.p1Id);
  const p2 = world.players.get(duel.p2Id);
  const h1 = p1 ? p1.health : -1;
  const h2 = p2 ? p2.health : -1;
  if (h2 > h1) return duel.p2Id;
  return duel.p1Id;
}

/**
 * Advance the duel state machine by one tick. PURE: reads `deps.clock.now()` and the two
 * players' phases from `world`; returns the NEXT DuelState (mutated in place + returned). Does
 * NOT touch players/NPCs — the room observes phase changes and performs resets/side effects.
 */
export function stepDuel(duel: DuelState, world: WorldState, deps: SimDeps): DuelState {
  const now = deps.clock.now();

  switch (duel.phase) {
    case 'countdown': {
      // Open the round once the countdown elapses; live is open-ended (no timer) until a kill.
      if (now >= duel.phaseEndsAtMs) {
        duel.phase = 'live';
        duel.phaseEndsAtMs = 0;
      }
      return duel;
    }

    case 'live': {
      const alive = duelAlivePlayers(world, duel.p1Id, duel.p2Id);
      if (alive.length <= 1) {
        // Round ends on the first elimination. Survivor scores. If BOTH went down on this tick
        // (a trade, alive.length === 0), break the tie deterministically (more health, else p1).
        const winnerId = alive.length === 1 ? alive[0]! : tiebreakWinner(world, duel);
        duel.roundWinnerId = winnerId;
        if (winnerId === duel.p1Id) duel.p1Score += 1;
        else if (winnerId === duel.p2Id) duel.p2Score += 1;
        duel.phase = 'round_over';
        duel.phaseEndsAtMs = now + DUEL_ROUND_OVER_MS;
      }
      return duel;
    }

    case 'round_over': {
      if (now < duel.phaseEndsAtMs) return duel;
      // The pause elapsed: either the match is decided, or we roll into the next round.
      if (scoreFor(duel, duel.roundWinnerId) >= duel.roundsToWin) {
        duel.matchWinnerId = duel.roundWinnerId;
        duel.phase = 'match_over';
        duel.phaseEndsAtMs = 0;
      } else {
        duel.round += 1;
        duel.roundWinnerId = '';
        duel.phase = 'countdown';
        duel.phaseEndsAtMs = now + DUEL_COUNTDOWN_MS;
      }
      return duel;
    }

    // waiting / match_over: no automatic transition — the room drives entry/exit.
    default:
      return duel;
  }
}
