// Keycards (Phase 3, PROJECT_BRIEF §2b — an access route). A keycard grants access to its
// tier's zones without "scolding" you, even if your disguise is too low. Walk over one to
// pick it up; you hold one keycard (the latest). Access is enforced in zones.ts, which
// treats a held keycard like a disguise tier. Authoritative + deterministic.
import { KEYCARD_PICKUP_RANGE } from '@deceive/shared';
import type { WorldState } from './world';

/** Squared XZ-plane distance between a player position and a keycard position [x, y, z]. */
function distSqXZ(px: number, pz: number, position: readonly [number, number, number]): number {
  const dx = px - position[0];
  const dz = pz - position[2];
  return dx * dx + dz * dz;
}

/**
 * Pick up any keycard a player walks over. For each alive player, scan `pack.keycards` for the
 * first card NOT yet in `world.collectedKeycards` whose position is within KEYCARD_PICKUP_RANGE
 * (XZ distance) of the player. On a match: set `player.heldKeycard = card.color` (latest wins,
 * an existing held card is simply replaced) and add the card id to `world.collectedKeycards`,
 * consuming it (removed from the map). One pickup per player per tick. Runs before zones, so a
 * just-grabbed card augments access this same tick. Deterministic; no Math.random/Date.now.
 */
export function stepKeycardPickup(world: WorldState): void {
  const pack = world.pack;
  if (!pack) return;
  // keycards is schema-defaulted to [] for validated packs, but test/cast fixtures may omit
  // it — treat a missing list as empty rather than throwing (mirrors social.ts).
  const keycards = pack.keycards;
  if (!keycards || keycards.length === 0) return;

  const rangeSq = KEYCARD_PICKUP_RANGE * KEYCARD_PICKUP_RANGE;

  for (const player of world.players.values()) {
    if (player.phase === 'downed' || player.phase === 'out') continue;

    for (const card of keycards) {
      if (world.collectedKeycards.has(card.id)) continue;
      if (distSqXZ(player.pos.x, player.pos.z, card.position) <= rangeSq) {
        player.heldKeycard = card.color;
        world.collectedKeycards.add(card.id);
        break; // one pickup per player per tick
      }
    }
  }
}
