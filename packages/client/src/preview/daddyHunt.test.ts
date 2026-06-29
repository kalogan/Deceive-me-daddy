import { describe, expect, it } from 'vitest';
import {
  QUESTIONS,
  clueForQuestion,
  clueSequence,
  formatCountdown,
  generateRoster,
  makeRng,
  matchesAll,
  remainingSuspects,
} from './daddyHunt';

describe('generateRoster', () => {
  it('produces exactly one dad', () => {
    const roster = generateRoster(16, makeRng(42));
    expect(roster.filter((s) => s.isDad)).toHaveLength(1);
    expect(roster).toHaveLength(16);
  });

  it('makes the dad the UNIQUE full match — all clues narrow to exactly him', () => {
    for (const seed of [1, 7, 42, 99, 1234, 65535]) {
      const roster = generateRoster(18, makeRng(seed));
      const dad = roster.find((s) => s.isDad)!;
      const allClues = clueSequence(dad);
      const matches = roster.filter((s) => matchesAll(s, allClues));
      expect(matches).toHaveLength(1);
      expect(matches[0]!.isDad).toBe(true);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = generateRoster(12, makeRng(2024));
    const b = generateRoster(12, makeRng(2024));
    expect(a).toEqual(b);
  });
});

describe('clueSequence', () => {
  it('mixes appearance + behavior and the dad satisfies all of them', () => {
    const roster = generateRoster(16, makeRng(5));
    const dad = roster.find((s) => s.isDad)!;
    const clues = clueSequence(dad);
    expect(clues.map((c) => c.kind)).toEqual(['appearance', 'behavior', 'appearance']);
    expect(clues.every((c) => c.test(dad))).toBe(true);
  });
});

describe('remainingSuspects', () => {
  it('monotonically narrows (or holds) as clues are added, ending at 1', () => {
    const roster = generateRoster(20, makeRng(808));
    const dad = roster.find((s) => s.isDad)!;
    const clues = clueSequence(dad);
    let prev = roster.length;
    for (let n = 0; n <= clues.length; n++) {
      const left = remainingSuspects(roster, clues.slice(0, n));
      expect(left).toBeLessThanOrEqual(prev);
      prev = left;
    }
    expect(remainingSuspects(roster, clues)).toBe(1);
  });
});

describe('formatCountdown', () => {
  it('formats M:SS and clamps at zero', () => {
    expect(formatCountdown(120_000)).toBe('2:00');
    expect(formatCountdown(95_000)).toBe('1:35');
    expect(formatCountdown(5_000)).toBe('0:05');
    expect(formatCountdown(-1000)).toBe('0:00');
  });
});

describe('clueForQuestion (pick-a-question interrogation)', () => {
  it('every question maps to a clue in the dad sequence', () => {
    const roster = generateRoster(12, makeRng(7));
    const clues = clueSequence(roster.find((s) => s.isDad)!);
    for (const q of QUESTIONS) {
      const clue = clueForQuestion(clues, q.id);
      expect(clue).toBeDefined();
      expect(clue!.id).toBe(q.id);
    }
  });

  it('returns undefined for a category not in the sequence', () => {
    expect(clueForQuestion([], 'coat')).toBeUndefined();
  });
});
