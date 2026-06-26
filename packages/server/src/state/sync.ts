// World -> schema sync (slice 1.1). After sim-core's step() mutates the authoritative
// WorldState, we copy the network-visible fields into the @colyseus/schema MatchState so
// Colyseus diffs + broadcasts them. The WorldState (sim-core, deterministic, engine-
// agnostic) is the source of truth; the schema is purely a wire mirror.
//
// Pure data-mapping (no Colyseus room), so it is unit-testable in isolation.
import type { WorldState } from '@deceive/sim-core';
import { CrumbSchema, MatchState, NpcSchema, PlayerSchema } from './MatchState';

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
  schema.currentZoneId = p.currentZoneId;
  schema.health = p.health;
}

/** Copy one sim crumb into its schema mirror, creating it if absent. */
function syncCrumb(state: MatchState, id: string, world: WorldState): void {
  const c = world.crumbs.get(id);
  if (!c) return;
  let schema = state.crumbs.get(id);
  if (!schema) {
    schema = new CrumbSchema();
    schema.id = c.id;
    schema.x = c.pos.x;
    schema.y = c.pos.y;
    schema.z = c.pos.z;
    schema.tier = c.tier;
    state.crumbs.set(id, schema);
  }
  schema.expiresMs = c.expiresMs;
}

/** Copy one sim NPC into its schema mirror, creating it if absent. */
function syncNpc(state: MatchState, id: string, world: WorldState): void {
  const n = world.npcs.get(id);
  if (!n) return;
  let schema = state.npcs.get(id);
  if (!schema) {
    schema = new NpcSchema();
    schema.id = n.id;
    schema.tier = n.tier;
    state.npcs.set(id, schema);
  }
  schema.x = n.pos.x;
  schema.y = n.pos.y;
  schema.z = n.pos.z;
  schema.yaw = n.yaw;
}

/**
 * Sync the entire authoritative WorldState into the broadcast MatchState. Adds schema
 * entries for new sim players/NPCs and prunes entries whose sim entity has left.
 */
export function syncWorldToState(world: WorldState, state: MatchState): void {
  state.tick = world.tick;
  state.timeMs = world.timeMs;

  for (const id of world.players.keys()) {
    syncPlayer(state, id, world);
  }
  for (const id of [...state.players.keys()]) {
    if (!world.players.has(id)) {
      state.players.delete(id);
    }
  }

  for (const id of world.npcs.keys()) {
    syncNpc(state, id, world);
  }
  for (const id of [...state.npcs.keys()]) {
    if (!world.npcs.has(id)) {
      state.npcs.delete(id);
    }
  }

  for (const id of world.crumbs.keys()) {
    syncCrumb(state, id, world);
  }
  for (const id of [...state.crumbs.keys()]) {
    if (!world.crumbs.has(id)) {
      state.crumbs.delete(id);
    }
  }
}
