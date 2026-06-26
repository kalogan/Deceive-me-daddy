// Disguise acquisition + Holo-Crumbs (Phase 2, PROJECT_BRIEF §2b). A player takes the look
// of a nearby NPC (their cover then matches that NPC's tier), leaving a Holo-Crumb tell at
// the theft spot for a short window. Engine-agnostic + deterministic.
//
// SCAFFOLD: `takeDisguise` + `stepCrumbs` are STUBS — the disguise builder fills them.
import { DISGUISE_TAKE_RANGE, HOLO_CRUMB_MS } from '@deceive/shared';
import type { ClearanceTier } from '@deceive/shared';
import type { Vec3, WorldState } from './world';
import type { SimDeps } from './world';

/** A Holo-Crumb: the tell dropped where a disguise was stolen. */
export interface Crumb {
  id: string;
  pos: Vec3;
  tier: ClearanceTier;
  /** Sim time (ms) at which this crumb expires. */
  expiresMs: number;
}

/**
 * Attempt to take the disguise of NPC `targetNpcId` for player `playerId`. STUB — filled
 * by the disguise builder. The seam: if the player exists, isn't out/downed, and the NPC is
 * within DISGUISE_TAKE_RANGE, set the player's `disguiseTier` to the NPC's tier and drop a
 * Crumb at the player's position (tier = the OLD disguise) expiring in HOLO_CRUMB_MS.
 * Returns whether the take succeeded. Use `deps.clock.now()` for the expiry timestamp.
 */
export function takeDisguise(
  world: WorldState,
  playerId: string,
  targetNpcId: string,
  deps: SimDeps,
): boolean {
  const player = world.players.get(playerId);
  const npc = world.npcs.get(targetNpcId);
  // Either party missing → nothing to take.
  if (!player || !npc) return false;

  // Can't re-disguise while down/out — only an active agent can grab a look.
  if (player.phase === 'out' || player.phase === 'downed') return false;

  // Reach check on the XZ plane (y is height; the take is a ground-plane proximity).
  const dx = npc.pos.x - player.pos.x;
  const dz = npc.pos.z - player.pos.z;
  if (Math.hypot(dx, dz) > DISGUISE_TAKE_RANGE) return false;

  // Drop the Holo-Crumb at the theft spot, tagged with the OLD disguise (the tell reveals
  // what the thief WAS). Deterministic id: (playerId, tick) is unique per take this tick —
  // no Math.random, replay-stable.
  const oldTier = player.disguiseTier;
  const crumb: Crumb = {
    id: `crumb:${playerId}:${world.tick}`,
    pos: { ...player.pos },
    tier: oldTier,
    expiresMs: deps.clock.now() + HOLO_CRUMB_MS,
  };
  world.crumbs.set(crumb.id, crumb);

  // Cover now matches the NPC: clearance tier AND appearance. Recording the NPC's id lets the
  // client render the player as that SPECIFIC NPC (the varied crowd is seeded by entity id), so
  // a disguise actually looks like the person you copied — not just their tier colour.
  player.disguiseTier = npc.tier;
  player.disguiseId = npc.id;
  return true;
}

/** Expire Holo-Crumbs whose `expiresMs` has passed. */
export function stepCrumbs(world: WorldState, deps: SimDeps): void {
  const now = deps.clock.now();
  for (const [id, crumb] of world.crumbs) {
    if (crumb.expiresMs <= now) world.crumbs.delete(id);
  }
}
