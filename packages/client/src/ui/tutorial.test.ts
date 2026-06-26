// Unit tests for the tutorial's PURE seam: the DOM-free step source (`TUTORIAL_STEPS`) and the
// clamping `stepAt` accessor. The Tutorial CLASS itself is browser-only (it touches the DOM) and
// is deliberately NOT imported here — these tests stay DOM-free so they run under the Node gate,
// exactly like the rest of the suite (cf. resultsScreen.test.ts / menu.test.ts).
import { describe, expect, it } from 'vitest';
import { TUTORIAL_STEPS, stepAt } from './Tutorial';

describe('TUTORIAL_STEPS', () => {
  it('has the expected number of steps (6–8)', () => {
    expect(TUTORIAL_STEPS.length).toBe(8);
    expect(TUTORIAL_STEPS.length).toBeGreaterThanOrEqual(6);
    expect(TUTORIAL_STEPS.length).toBeLessThanOrEqual(8);
  });

  it('every step has a non-empty title and body', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.body.trim().length).toBeGreaterThan(0);
    }
  });

  it('opens with the goal and ends on a sign-off', () => {
    expect(stepAt(0).title).toBe('WELCOME, AGENT');
    expect(stepAt(TUTORIAL_STEPS.length - 1).title).toBe('GOOD LUCK');
  });

  it('contains plain text only (no HTML markup that could inject)', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.title).not.toMatch(/[<>]/);
      expect(step.body).not.toMatch(/[<>]/);
    }
  });
});

describe('stepAt', () => {
  it('returns the step at an in-range index', () => {
    expect(stepAt(0)).toBe(TUTORIAL_STEPS[0]);
    expect(stepAt(1)).toBe(TUTORIAL_STEPS[1]);
    expect(stepAt(TUTORIAL_STEPS.length - 1)).toBe(TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1]);
  });

  it('clamps a below-range index to the FIRST step (no wrap)', () => {
    expect(stepAt(-1)).toBe(TUTORIAL_STEPS[0]);
    expect(stepAt(-100)).toBe(TUTORIAL_STEPS[0]);
  });

  it('clamps an above-range index to the LAST step (no wrap)', () => {
    const last = TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1];
    expect(stepAt(TUTORIAL_STEPS.length)).toBe(last);
    expect(stepAt(TUTORIAL_STEPS.length + 50)).toBe(last);
  });

  it('always returns a valid step shape across a wide index sweep', () => {
    for (let i = -5; i < TUTORIAL_STEPS.length + 5; i += 1) {
      const step = stepAt(i);
      expect(typeof step.title).toBe('string');
      expect(typeof step.body).toBe('string');
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });
});
