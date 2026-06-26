// PURE event derivation: diff two match snapshots and decide which SFX to fire this frame.
//
// This is the bridge between the authoritative wire state and the procedural AudioEngine: it
// looks only at how the LOCAL player and the shared objective CHANGED between the previous and
// current snapshot, and emits a list of `SfxKind`s for main.ts to hand to `audio.playSfx`.
//
// It is deliberately DOM-free and side-effect-free (no AudioContext, no `window`) so it can be
// unit-tested under Node in the gate. The AudioEngine imports `SfxKind` from HERE (not the other
// way round), which keeps this module — the one that's tested — free of any browser-only import.
import type { NetMatchState } from '@deceive/shared';

/**
 * The full set of one-shot effects the AudioEngine can synthesise. Defined here (the pure,
 * tested module) and re-exported by AudioEngine so the union has a single source of truth.
 */
export type SfxKind =
  | 'fire'
  | 'hit'
  | 'reveal'
  | 'disguise'
  | 'intel'
  | 'keycard'
  | 'vaultOpen'
  | 'win'
  | 'downed'
  | 'revive'
  | 'ability'
  // UI feedback, NOT a gameplay diff — `deriveAudioEvents` never emits it. It exists in the
  // union so the menu can call `audio.playSfx('uiTick')` for a light click on option selects.
  | 'uiTick';

/**
 * Derive the SFX to play this frame by diffing the LOCAL player + the objective between two
 * snapshots. Returns the kinds in a stable, documented order (so multiple simultaneous events
 * are deterministic). On the FIRST frame (`prev === null`) it returns `[]` — there's no prior
 * state to diff against, so we must not fire spurious events for the initial spawn values.
 *
 * Only transitions that MATTER to the local player are surfaced; everyone else's changes are
 * ignored (this is the local player's own soundtrack). The diff reads:
 *   - phase → 'revealed' (from blended/suspicious)  ⇒ 'reveal'  (cover blown)
 *   - health decreased                              ⇒ 'hit'
 *   - phase → 'downed'                              ⇒ 'downed'
 *   - phase downed/out → 'blended'                  ⇒ 'revive'  (back on your feet)
 *   - disguiseTier changed                          ⇒ 'disguise'
 *   - heldKeycard changed to a non-empty tier       ⇒ 'keycard'
 *   - intel increased                               ⇒ 'intel'
 *   - abilityActive false → true                    ⇒ 'ability'
 *   - objective.vaultOpen false → true              ⇒ 'vaultOpen'
 *   - objective.winningTeam -1 → >= 0               ⇒ 'win'
 *
 * @param prev          the previous snapshot (or null on the first frame)
 * @param next          the current snapshot
 * @param localPlayerId which player in the snapshot is "us"
 */
export function deriveAudioEvents(
  prev: NetMatchState | null,
  next: NetMatchState,
  localPlayerId: string,
): SfxKind[] {
  // No prior state → nothing to diff. Avoids firing on the initial spawn snapshot.
  if (prev === null) return [];

  const events: SfxKind[] = [];

  const before = prev.players[localPlayerId];
  const after = next.players[localPlayerId];

  // Player-scoped diffs only run once the local player exists in BOTH snapshots — otherwise
  // there's no meaningful before/after to compare (e.g. mid-join).
  if (before && after) {
    // Cover blown: transitioned INTO 'revealed' from a still-hidden phase. We gate on the prior
    // phase being blended/suspicious so re-entering 'revealed' from itself doesn't re-alarm.
    if (
      after.phase === 'revealed' &&
      (before.phase === 'blended' || before.phase === 'suspicious')
    ) {
      events.push('reveal');
    }

    // Took damage this frame.
    if (after.health < before.health) {
      events.push('hit');
    }

    // Went down (entered the 'downed' phase, from any other phase).
    if (after.phase === 'downed' && before.phase !== 'downed') {
      events.push('downed');
    }

    // Revived: came back to 'blended' from being downed or out.
    if (
      after.phase === 'blended' &&
      (before.phase === 'downed' || before.phase === 'out')
    ) {
      events.push('revive');
    }

    // Swapped disguise identity (any tier change, including to/from civilian).
    if (after.disguiseTier !== before.disguiseTier) {
      events.push('disguise');
    }

    // Picked up a keycard: the held tier changed to a NON-empty value.
    if (after.heldKeycard !== before.heldKeycard && after.heldKeycard !== '') {
      events.push('keycard');
    }

    // Collected intel (count went up; a spend that lowers it shouldn't blip).
    if (after.intel > before.intel) {
      events.push('intel');
    }

    // Engaged the signature Expertise (rising edge of abilityActive).
    if (after.abilityActive && !before.abilityActive) {
      events.push('ability');
    }
  }

  // Objective diffs are global (not player-scoped) — they always exist in both snapshots.
  if (next.objective.vaultOpen && !prev.objective.vaultOpen) {
    events.push('vaultOpen');
  }

  // A team extracted: the winner flipped from "live" (-1) to a real team index.
  if (prev.objective.winningTeam < 0 && next.objective.winningTeam >= 0) {
    events.push('win');
  }

  return events;
}
