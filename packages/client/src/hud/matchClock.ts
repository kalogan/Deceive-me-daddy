// PURE, DOM-free helper for the top-center MATCH CLOCK. Formats the authoritative elapsed
// match time (`state.timeMs`) into a stable MM:SS string. The DOM render lives in
// MatchTimer.ts (the component, not imported by any test).
//
// Authority (PROJECT_BRIEF §3/§4.2): `timeMs` is the server's word; this only shapes it.

/**
 * Format an elapsed-time value in milliseconds as `MM:SS`. PURE.
 *
 * Negative or non-finite inputs clamp to 0 (defensive — a pre-join snapshot, or a corrupt
 * value, shows "00:00" rather than garbage). Minutes are NOT capped at 99, so a long match
 * reads "100:00" correctly; seconds are always zero-padded to two digits.
 */
export function formatMatchClock(timeMs: number): string {
  const safe = Number.isFinite(timeMs) && timeMs > 0 ? timeMs : 0;
  const totalSec = Math.floor(safe / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
