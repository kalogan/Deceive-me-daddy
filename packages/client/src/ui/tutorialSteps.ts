// PURE step-tracking for the interactive tutorial (no DOM), so the progression logic is
// unit-testable in the node gate. The DOM overlay (TutorialCoach.ts) renders this. Each step
// completes from the LIVE authoritative snapshot — the same NetMatchState the renderer reads —
// so the coach ticks a beat the instant the player actually does it in the (offline) sim.
//
// The six beats mirror the Deceive-Inc-style flow the Director asked for:
//   grab intel -> change costume -> shoot a player -> forge the vault key -> grab the key -> leave.
import type { NetMatchState } from '@deceive/shared';

/** One coached beat: its label, an imperative hint, and whether it's done this frame. */
export interface TutorialStepState {
  id: 'intel' | 'disguise' | 'shoot' | 'forge_key' | 'grab_key' | 'extract';
  label: string;
  hint: string;
  done: boolean;
}

/** The whole tutorial's live progress: the six steps, the active (first-unfinished) index, done. */
export interface TutorialProgress {
  steps: TutorialStepState[];
  /** Index of the first not-yet-done step, or steps.length when every beat is complete. */
  activeIndex: number;
  allDone: boolean;
}

/**
 * Derive tutorial progress from the live snapshot for `localId`. PURE. `intelRequired` is the
 * pack's intelRequiredToOpenVault (how much intel the forge needs). A missing local player (pre-
 * spawn) yields all-incomplete steps at index 0.
 */
export function tutorialProgress(
  state: NetMatchState,
  localId: string,
  intelRequired: number,
): TutorialProgress {
  const p = state.players[localId];
  const o = state.objective;

  const done: Record<TutorialStepState['id'], boolean> = {
    // Gathered enough intel to power the forge.
    intel: !!p && p.intel >= Math.max(1, intelRequired),
    // Took a disguise — no longer the starting civilian.
    disguise: !!p && p.disguiseTier !== 'civilian',
    // Fired at least once (fireSeq counts shots; 0 at spawn).
    shoot: !!p && (p.fireSeq ?? 0) > 0,
    // Forged the vault key at the terminal.
    forge_key: o.keyCreated,
    // Carrying the forged key.
    grab_key: o.keyHolderId === localId && localId !== '',
    // Extracted — the local team won.
    extract: !!p && o.winningTeam === p.team && o.winningTeam !== -1,
  };

  const steps: TutorialStepState[] = [
    { id: 'intel', label: 'Gather intel', hint: 'Walk to a glowing terminal and press [E].', done: done.intel },
    { id: 'disguise', label: 'Change costume', hint: 'Approach a guard and press [E] to steal their disguise.', done: done.disguise },
    { id: 'shoot', label: 'Take a shot', hint: 'Click / press [F] to fire — no target needed, just take a shot.', done: done.shoot },
    { id: 'forge_key', label: 'Forge the vault key', hint: 'With enough intel, reach the forge terminal and press [E].', done: done.forge_key },
    { id: 'grab_key', label: 'Grab the vault key', hint: 'Pick up the forged key with [E].', done: done.grab_key },
    { id: 'extract', label: 'Leave the map', hint: 'Carry the key to the extraction point.', done: done.extract },
  ];

  let activeIndex = steps.findIndex((s) => !s.done);
  if (activeIndex === -1) activeIndex = steps.length;
  return { steps, activeIndex, allDone: activeIndex === steps.length };
}
