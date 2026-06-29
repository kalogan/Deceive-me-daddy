import { describe, expect, it } from 'vitest';
import { daddyTutorialProgress, type DaddyRoundView } from './daddyTutorial';

const base: DaddyRoundView = {
  cluesKnown: 2,
  questionsAsked: 0,
  remaining: 16,
  crowdSize: 16,
  status: 'playing',
};

describe('daddyTutorialProgress', () => {
  it('orients first (you start with clues), interrogate is the active beat', () => {
    const p = daddyTutorialProgress(base);
    expect(p.steps[0]?.done).toBe(true); // read clues — done from the start
    expect(p.steps.map((s) => s.id)).toEqual(['orient', 'interrogate', 'narrow', 'confirm']);
    expect(p.activeIndex).toBe(1); // interrogate
    expect(p.allDone).toBe(false);
  });

  it('ticks interrogate once a question is asked', () => {
    const p = daddyTutorialProgress({ ...base, questionsAsked: 1 });
    expect(p.steps[1]?.done).toBe(true);
    expect(p.activeIndex).toBe(2); // narrow
  });

  it('ticks narrow only when down to the prime suspects (and actually reduced)', () => {
    expect(daddyTutorialProgress({ ...base, questionsAsked: 1, remaining: 3 }).steps[2]?.done).toBe(true);
    // Not narrowed if still the whole crowd, even if crowd happens to be small.
    expect(daddyTutorialProgress({ ...base, remaining: 3, crowdSize: 3 }).steps[2]?.done).toBe(false);
  });

  it('completes when the round is won', () => {
    const p = daddyTutorialProgress({ ...base, questionsAsked: 1, remaining: 1, status: 'won' });
    expect(p.steps[3]?.done).toBe(true);
    expect(p.allDone).toBe(true);
    expect(p.activeIndex).toBe(p.steps.length);
  });
});
