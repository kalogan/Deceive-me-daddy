// Keycards (Phase 3, PROJECT_BRIEF §2b — an access route). A keycard grants access to its
// tier's zones without "scolding" you, even if your disguise is too low. Walk over one to
// pick it up; you hold one keycard (the latest). Access is enforced in zones.ts, which
// treats a held keycard like a disguise tier. Authoritative + deterministic.
//
// SCAFFOLD: `stepKeycardPickup` is a STUB — the keycard builder fills it against this seam.
import type { WorldState } from './world';

/**
 * Pick up any keycard a player walks over. STUB — filled by the keycard builder. Seam: for
 * each alive player, for each pack.keycards entry NOT in world.collectedKeycards, if the
 * player is within KEYCARD_PICKUP_RANGE (XZ) → set player.heldKeycard = card.color and add
 * the card id to collectedKeycards (so it's consumed). One pickup per player per tick is
 * fine. Deterministic; no Math.random/Date.now.
 */
export function stepKeycardPickup(world: WorldState): void {
  void world;
}
