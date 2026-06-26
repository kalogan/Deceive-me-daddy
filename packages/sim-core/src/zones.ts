// Zone membership + clearance enforcement (Phase 2, PROJECT_BRIEF §2b). Determines which
// zone each player is standing in and whether their disguise tier is allowed there. The
// "scolded" flag (in a zone above your clearance) is the clearance-mismatch detection axis
// that the suspicion slice will read. Engine-agnostic + deterministic, like all of sim-core.
import { CLEARANCE_LEVEL, canAccess, type Zone } from '@deceive/shared';
import type { Vec3, WorldState } from './world';

/** True iff `pos` lies within `zone`'s XZ box (Y ignored). Bounds may be authored min>max. */
function containsXZ(zone: Zone, pos: Vec3): boolean {
  const [ax, , az] = zone.bounds.min;
  const [bx, , bz] = zone.bounds.max;
  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const minZ = Math.min(az, bz);
  const maxZ = Math.max(az, bz);
  return pos.x >= minX && pos.x <= maxX && pos.z >= minZ && pos.z <= maxZ;
}

/**
 * The zone whose XZ bounds contain `pos`, or `undefined` if none. When several zones
 * overlap the point, the MOST RESTRICTIVE one wins (highest `requiredClearance` via
 * `CLEARANCE_LEVEL`) — that's the binding access constraint. Pure + deterministic:
 * ties (equal clearance) resolve to the earlier zone in array order.
 */
export function zoneAt(pos: Vec3, zones: readonly Zone[]): Zone | undefined {
  let best: Zone | undefined;
  for (const zone of zones) {
    if (!containsXZ(zone, pos)) continue;
    if (
      best === undefined ||
      CLEARANCE_LEVEL[zone.requiredClearance] > CLEARANCE_LEVEL[best.requiredClearance]
    ) {
      best = zone;
    }
  }
  return best;
}

/**
 * Update every player's `currentZoneId` + `inForbiddenZone` from their position against
 * `world.pack.zones`. With no loaded pack there are no zones, so everyone is outside
 * everything (currentZoneId '' + inForbiddenZone false).
 */
export function stepZones(world: WorldState): void {
  const zones = world.pack?.zones;
  for (const player of world.players.values()) {
    const zone = zones === undefined ? undefined : zoneAt(player.pos, zones);
    if (zone === undefined) {
      player.currentZoneId = '';
      player.inForbiddenZone = false;
      continue;
    }
    player.currentZoneId = zone.id;
    // Access is granted by a high-enough disguise OR a held keycard of sufficient tier
    // (PROJECT_BRIEF §2b — keycards are an access route). Otherwise the player is "scolded".
    const byDisguise = canAccess(player.disguiseTier, zone.requiredClearance);
    const byKeycard =
      player.heldKeycard !== '' && canAccess(player.heldKeycard, zone.requiredClearance);
    player.inForbiddenZone = !(byDisguise || byKeycard);
  }
}
