// Unit tests for the duel overlay's PURE seams: duelScoreboard (you/rival resolution), duelBanner
// (per-phase banner selection), and countdownSeconds (the countdown math). The DuelHud CLASS is
// browser-only (it touches the DOM) and is deliberately NOT imported here — these tests stay
// DOM-free so they run under the Node gate, like the rest of the suite.
import { describe, expect, it } from 'vitest';
import type { NetDuelState } from '@deceive/shared';
import { countdownSeconds, duelBanner, duelScoreboard } from './DuelHud';

/** A duel-state factory with sensible defaults; override per case. */
function duel(over: Partial<NetDuelState> = {}): NetDuelState {
  return {
    phase: 'live',
    roundsToWin: 3,
    round: 1,
    p1Id: 'p1',
    p1Score: 0,
    p2Id: 'p2',
    p2Score: 0,
    roundWinnerId: '',
    matchWinnerId: '',
    phaseEndsAtMs: 0,
    ...over,
  };
}

describe('duelScoreboard', () => {
  it('maps your/rival scores when you are p1', () => {
    const d = duel({ p1Score: 2, p2Score: 1 });
    expect(duelScoreboard(d, 'p1')).toEqual({ yourScore: 2, rivalScore: 1 });
  });

  it('maps your/rival scores when you are p2 (swapped)', () => {
    const d = duel({ p1Score: 2, p2Score: 1 });
    expect(duelScoreboard(d, 'p2')).toEqual({ yourScore: 1, rivalScore: 2 });
  });

  it('falls back to the p1 perspective for an unseated/empty local id', () => {
    const d = duel({ p1Score: 3, p2Score: 0 });
    expect(duelScoreboard(d, '')).toEqual({ yourScore: 3, rivalScore: 0 });
  });
});

describe('countdownSeconds', () => {
  it('rounds remaining time UP to whole seconds', () => {
    expect(countdownSeconds(10_000, 7_600)).toBe(3); // 2.4s remaining → 3
    expect(countdownSeconds(10_000, 9_001)).toBe(1); // 0.999s remaining → 1
  });

  it('clamps a passed deadline to 0', () => {
    expect(countdownSeconds(10_000, 10_000)).toBe(0);
    expect(countdownSeconds(10_000, 12_000)).toBe(0);
  });

  it('treats a 0 (inactive) deadline as 0', () => {
    expect(countdownSeconds(0, 5_000)).toBe(0);
  });
});

describe('duelBanner', () => {
  it("shows the waiting lobby in 'waiting'", () => {
    const b = duelBanner(duel({ phase: 'waiting' }), 'p1', 0);
    expect(b.kind).toBe('waiting');
    expect(b.text).toMatch(/WAITING/i);
  });

  it("shows the counting number in 'countdown', GO! at the deadline", () => {
    const d = duel({ phase: 'countdown', round: 2, phaseEndsAtMs: 5_000 });
    const counting = duelBanner(d, 'p1', 2_500);
    expect(counting.kind).toBe('countdown');
    expect(counting.text).toBe('3'); // 2.5s remaining → 3
    expect(counting.sub).toBe('ROUND 2');

    const go = duelBanner(d, 'p1', 5_000);
    expect(go.kind).toBe('countdown');
    expect(go.text).toBe('GO!');
  });

  it("shows no banner in 'live' (scoreboard only)", () => {
    expect(duelBanner(duel({ phase: 'live' }), 'p1', 0).kind).toBe('none');
  });

  it("shows ROUND WON when the local player won the round, with the running score", () => {
    const d = duel({ phase: 'round_over', roundWinnerId: 'p1', p1Score: 1, p2Score: 0 });
    const b = duelBanner(d, 'p1', 0);
    expect(b.kind).toBe('round_won');
    expect(b.text).toBe('ROUND WON');
    expect(b.sub).toBe('1 — 0');
  });

  it('shows ROUND LOST when the rival won the round (resolved from p2 perspective)', () => {
    const d = duel({ phase: 'round_over', roundWinnerId: 'p1', p1Score: 1, p2Score: 0 });
    const b = duelBanner(d, 'p2', 0); // local is p2, who lost
    expect(b.kind).toBe('round_lost');
    expect(b.text).toBe('ROUND LOST');
    expect(b.sub).toBe('0 — 1'); // your(p2) — rival(p1)
  });

  it("shows VICTORY in 'match_over' when the local player won the match", () => {
    const d = duel({ phase: 'match_over', matchWinnerId: 'p1', p1Score: 3, p2Score: 1 });
    const b = duelBanner(d, 'p1', 0);
    expect(b.kind).toBe('victory');
    expect(b.text).toBe('VICTORY');
    expect(b.sub).toContain('3 — 1');
  });

  it("shows DEFEAT in 'match_over' when the rival won the match", () => {
    const d = duel({ phase: 'match_over', matchWinnerId: 'p1', p1Score: 3, p2Score: 1 });
    const b = duelBanner(d, 'p2', 0); // local is p2, who lost
    expect(b.kind).toBe('defeat');
    expect(b.text).toBe('DEFEAT');
    expect(b.sub).toContain('1 — 3'); // your(p2) — rival(p1)
  });
});
