// Pure reveal-style selectors (PROJECT_BRIEF §2.5 — detection / hard reveal). The server
// is authoritative for a player's `phase`; the client only RENDERS it. These helpers map
// the authoritative AgentPhase to a cosmetic "blown" marker style so any client can spot a
// hard-revealed rival at a glance. Display only — no gameplay decision is made here.
//
// Kept DOM/WebGL-free so it can be unit-tested in the node env (PROJECT_BRIEF §4.6).
import type { AgentPhase } from '@deceive/shared';

/** A hard-revealed player (cover blown for a window) — the must-have "that one's blown". */
export function isRevealed(phase: AgentPhase): boolean {
  return phase === 'revealed';
}

/** A player the meter has flagged as suspicious — a subtler amber tell. */
export function isSuspicious(phase: AgentPhase): boolean {
  return phase === 'suspicious';
}

/** The cosmetic marker shown above a player, derived from the authoritative phase. */
export interface RevealMarkerStyle {
  /** Whether the over-head marker is shown at all. */
  visible: boolean;
  /** Hex color of the marker (bright red = revealed, amber = suspicious). */
  color: number;
  /** Relative emissive intensity — revealed reads hotter than suspicious. */
  intensity: number;
}

const HIDDEN: RevealMarkerStyle = { visible: false, color: 0x000000, intensity: 0 };
const REVEALED: RevealMarkerStyle = { visible: true, color: 0xff1a1a, intensity: 1 };
const SUSPICIOUS: RevealMarkerStyle = { visible: true, color: 0xffb020, intensity: 0.45 };

/**
 * Select the over-head marker style for a phase. 'revealed' is the unmistakable bright-red
 * "blown" marker; 'suspicious' is a subtler amber tell; every other phase hides the marker
 * so the avatar reads as its plain tier color again the moment the window reverts.
 */
export function revealMarkerStyle(phase: AgentPhase): RevealMarkerStyle {
  if (isRevealed(phase)) return REVEALED;
  if (isSuspicious(phase)) return SUSPICIOUS;
  return HIDDEN;
}
