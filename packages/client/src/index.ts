// @deceive/client — Three.js renderer + input + HUD + interpolation (PROJECT_BRIEF §3).
// Optimistic-cosmetic only; the server is authoritative. The Three.js scene + the
// preview harness land in slices 1.2/1.3. This Phase 0 stub proves the client surface
// compiles against shared (DOM lib is enabled for the real renderer).
import { type ClearanceTier, TIER_COLOR } from '@deceive/shared';

/** Disguise tier -> display color for avatars/HUD. */
export function tierColor(tier: ClearanceTier): string {
  return TIER_COLOR[tier];
}
