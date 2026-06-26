// Pure body-style selector for the downed/eliminated render (PROJECT_BRIEF §2.6 — combat /
// downed / revive / out). The server is authoritative for a player's `phase`; the client
// only RENDERS it. This helper maps the authoritative AgentPhase to a cosmetic BODY style
// so a downed teammate is findable (dimmed + lying flat) and an eliminated rival reads as
// neutralised (ghosted), while a live player renders upright + opaque as normal.
//
// Kept DOM/WebGL-free so it can be unit-tested in the node env (PROJECT_BRIEF §4.6); the
// side-effectful Three.js application lives in WorldView.ts.
import type { AgentPhase } from '@deceive/shared';

/** The cosmetic body style for an avatar, derived from the authoritative phase. */
export interface DownedBodyStyle {
  /** Whether the body is drawn at all ('out' players are still shown, just ghosted). */
  visible: boolean;
  /** Body opacity 0..1 (downed is dimmed; out is a faint ghost). */
  opacity: number;
  /** Roll (radians) applied to lay the body flat — 0 upright, ~PI/2 lying down. */
  roll: number;
  /** Multiplier on the tier colour so downed/out read darker than a live blend. */
  brightness: number;
}

const ALIVE: DownedBodyStyle = { visible: true, opacity: 1, roll: 0, brightness: 1 };
// Downed: dimmed + lying flat so an ally can spot a teammate on the ground to revive.
const DOWNED: DownedBodyStyle = { visible: true, opacity: 0.85, roll: Math.PI / 2, brightness: 0.45 };
// Out: still lying flat but a faint, desaturated ghost — neutralised, not gone.
const OUT: DownedBodyStyle = { visible: true, opacity: 0.28, roll: Math.PI / 2, brightness: 0.3 };

/**
 * Select the body style for a phase. 'downed' dims + lays the avatar flat (find-your-ally);
 * 'out' ghosts it (clearly neutralised); every live phase renders the body upright + opaque
 * so it reverts the instant the server changes the phase (e.g. on revive).
 */
export function downedBodyStyle(phase: AgentPhase): DownedBodyStyle {
  if (phase === 'downed') return DOWNED;
  if (phase === 'out') return OUT;
  return ALIVE;
}
