// World -> schema sync (slice 1.1). After sim-core's step() mutates the authoritative
// WorldState, we copy the network-visible fields into the @colyseus/schema MatchState so
// Colyseus diffs + broadcasts them. The WorldState (sim-core, deterministic, engine-
// agnostic) is the source of truth; the schema is purely a wire mirror.
//
// Pure data-mapping (no Colyseus room), so it is unit-testable in isolation.
import type { WorldState } from '@deceive/sim-core';
import { MatchState, PlayerSchema } from './MatchState';

/** Copy one sim player into its schema mirror, creating it if absent. */
function syncPlayer(state: MatchState, id: string, world: WorldState): void {
  const p = world.players.get(id);
  if (!p) return;
  let schema = state.players.get(id);
  if (!schema) {
    schema = new PlayerSchema();
    schema.id = p.id;
    state.players.set(id, schema);
  }
  // team/disguiseTier rarely change but are cheap to mirror; @colyseus/schema only
  // emits fields whose value actually changed, so re-assigning is free on the wire.
  schema.team = p.team;
  schema.x = p.pos.x;
  schema.y = p.pos.y;
  schema.z = p.pos.z;
  schema.yaw = p.yaw;
  schema.disguiseTier = p.disguiseTier;
  schema.suspicion = p.suspicion;
  schema.phase = p.phase;
}

/**
 * Sync the entire authoritative WorldState into the broadcast MatchState. Adds schema
 * entries for new sim players and prunes schema entries whose sim player has left.
 */
export function syncWorldToState(world: WorldState, state: MatchState): void {
  state.tick = world.tick;
  state.timeMs = world.timeMs;

  for (const id of world.players.keys()) {
    syncPlayer(state, id, world);
  }

  // Prune schema players the sim no longer has (defensive — onLeave also removes).
  for (const id of [...state.players.keys()]) {
    if (!world.players.has(id)) {
      state.players.delete(id);
    }
  }
}
