// "Deceive Me Daddy" — PURE coached-tutorial step model (no DOM/THREE), mirroring the production
// tutorial's live checklist. Each beat completes from the current round VIEW (the same numbers the
// Case File shows), so the coach ticks a beat the instant the player does it. The DaddyStage renders
// this. See docs/EXPANSION_DECEIVE_ME_DADDY.md.

/** A read-only snapshot of the live round, enough to drive the coached checklist. */
export interface DaddyRoundView {
  /** How many clues the player currently knows. */
  cluesKnown: number;
  /** How many bystanders the player has interrogated this round. */
  questionsAsked: number;
  /** Suspects still matching every known clue (the "X left" readout). */
  remaining: number;
  /** Total crowd size. */
  crowdSize: number;
  /** Round outcome. */
  status: 'playing' | 'won' | 'lost';
}

/** Down to this many (or fewer) suspects counts as "narrowed to the prime suspects". */
export const NARROW_THRESHOLD = 3;

export interface DaddyTutorialStep {
  id: 'orient' | 'interrogate' | 'narrow' | 'confirm';
  label: string;
  hint: string;
  done: boolean;
}

export interface DaddyTutorialProgress {
  steps: DaddyTutorialStep[];
  /** First not-yet-done step, or steps.length when all complete. */
  activeIndex: number;
  allDone: boolean;
}

/**
 * Derive the coached checklist from the live round view. PURE. The four beats introduce, in order,
 * the things the mode is about: the clues + clock, interrogation, narrowing, and the final guess.
 */
export function daddyTutorialProgress(v: DaddyRoundView): DaddyTutorialProgress {
  const done = {
    // You begin with a clue or two — this beat orients you to the Case File + the departure clock.
    orient: v.cluesKnown >= 1,
    // Asked at least one bystander a question (pick-a-question interrogation).
    interrogate: v.questionsAsked >= 1,
    // Clues have dimmed the crowd down to a short list (and actually narrowed from the full crowd).
    narrow: v.remaining <= NARROW_THRESHOLD && v.remaining < v.crowdSize,
    // Confirmed the right person before the train left.
    confirm: v.status === 'won',
  };

  const steps: DaddyTutorialStep[] = [
    { id: 'orient', label: 'Read your clues & the clock', hint: 'The Case File lists what you know; the train leaves when the timer hits 0:00.', done: done.orient },
    { id: 'interrogate', label: 'Interrogate a bystander', hint: 'Open Interrogate and pick a question — they reveal one of dad’s details.', done: done.interrogate },
    { id: 'narrow', label: 'Narrow the suspects', hint: 'Each clue dims the people who don’t match. Get down to a few.', done: done.narrow },
    { id: 'confirm', label: 'Confirm dad before he leaves', hint: 'Make the call — a wrong guess costs time, the right one wins the round.', done: done.confirm },
  ];

  let activeIndex = steps.findIndex((s) => !s.done);
  if (activeIndex === -1) activeIndex = steps.length;
  return { steps, activeIndex, allDone: activeIndex === steps.length };
}
