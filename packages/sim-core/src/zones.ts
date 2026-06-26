// Zone membership + clearance enforcement (Phase 2, PROJECT_BRIEF §2b). Determines which
// zone each player is standing in and whether their disguise tier is allowed there. The
// "scolded" flag (in a zone above your clearance) is the clearance-mismatch detection axis
// that the suspicion slice will read. Engine-agnostic + deterministic, like all of sim-core.
//
// SCAFFOLD: `stepZones` is a STUB — the zones builder fills it. The seam it must satisfy:
// for each player set `currentZoneId` (the zone whose XZ bounds contain the player, or '')
// and `inForbiddenZone` (true iff in a zone requiring a higher tier than the disguise).
import type { WorldState } from './world';

/**
 * Update every player's `currentZoneId` + `inForbiddenZone` from their position against
 * `world.pack.zones`. STUB — filled by the zones builder. (Use `canAccess` from
 * @deceive/shared for the clearance check; zones are XZ boxes via `zone.bounds`.)
 */
export function stepZones(world: WorldState): void {
  void world;
}
