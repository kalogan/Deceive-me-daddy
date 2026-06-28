// World -> schema sync (slice 1.1). After sim-core's step() mutates the authoritative
// WorldState, we copy the network-visible fields into the @colyseus/schema MatchState so
// Colyseus diffs + broadcasts them. The WorldState (sim-core, deterministic, engine-
// agnostic) is the source of truth; the schema is purely a wire mirror.
//
// Pure data-mapping (no Colyseus room), so it is unit-testable in isolation.
import {
  abilityCooldownRemaining,
  castProgress,
  gadgetCooldownRemaining,
  isAbilityActive,
  type DuelState,
  type WorldState,
} from '@deceive/sim-core';
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
  // team/disguiseTier/agentId rarely change but are cheap to mirror; @colyseus/schema only
  // emits fields whose value actually changed, so re-assigning is free on the wire.
  schema.team = p.team;
  schema.agentId = p.agentId;
  schema.x = p.pos.x;
  schema.y = p.pos.y;
  schema.z = p.pos.z;
  schema.yaw = p.yaw;
  schema.disguiseTier = p.disguiseTier;
  schema.disguiseId = p.disguiseId ?? '';
  schema.suspicion = p.suspicion;
  schema.phase = p.phase;
  schema.currentZoneId = p.currentZoneId;
  schema.health = p.health;
  schema.intel = p.intel;
  schema.carrying = p.carrying;
  schema.heldKeycard = p.heldKeycard;
  // Expertise state, derived from the sim timers against sim time (world.timeMs tracks the
  // server Clock in lockstep). Cooldown is clamped to the uint16 wire field.
  schema.abilityActive = isAbilityActive(p, world.timeMs);
  schema.abilityCooldownMs = Math.min(65535, Math.round(abilityCooldownRemaining(p, world.timeMs)));
  // The deployable gadget's remaining cooldown, clamped to the uint16 wire field.
  schema.gadgetCooldownMs = Math.min(65535, Math.round(gadgetCooldownRemaining(p, world.timeMs)));
  // The shot counter (wraps into the uint16 field); clients play fire VFX on each change.
  schema.fireSeq = p.fireSeq % 65536;
  // Landed-hit + down counters (wrap into uint16); the local client flashes a hitmarker on change.
  schema.hitSeq = p.hitSeq % 65536;
  schema.downSeq = p.downSeq % 65536;
  // Channeled interaction: kind + 0..1 progress, so the owner's client can show a progress ring.
  schema.castKind = p.cast ? p.cast.kind : '';
  schema.castProgress = castProgress(p, world.timeMs);
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
 * Mirror the deterministic DuelState into `state.duel` (the @colyseus/schema sub-object). Purely
 * additive to the world sync — the DuelRoom calls this each tick AFTER syncWorldToState. When the
 * duel is null (e.g. still in the 'waiting' lobby before two humans have joined) the schema is left
 * at its 'waiting' defaults so the wire always carries a coherent duel block in a 'duel' room.
 */
export function syncDuelToState(duel: DuelState | null, state: MatchState): void {
  const d = state.duel;
  if (!duel) {
    d.phase = 'waiting';
    d.round = 0;
    d.p1Id = '';
    d.p1Score = 0;
    d.p2Id = '';
    d.p2Score = 0;
    d.roundWinnerId = '';
    d.matchWinnerId = '';
    d.phaseEndsAtMs = 0;
    return;
  }
  d.phase = duel.phase;
  d.roundsToWin = duel.roundsToWin;
  d.round = duel.round;
  d.p1Id = duel.p1Id;
  d.p1Score = duel.p1Score;
  d.p2Id = duel.p2Id;
  d.p2Score = duel.p2Score;
  d.roundWinnerId = duel.roundWinnerId;
  d.matchWinnerId = duel.matchWinnerId;
  d.phaseEndsAtMs = duel.phaseEndsAtMs;
}

/**
 * Sync the entire authoritative WorldState into the broadcast MatchState. Adds schema
 * entries for new sim players/NPCs and prunes entries whose sim entity has left.
 */
export function syncWorldToState(world: WorldState, state: MatchState): void {
  state.tick = world.tick;
  state.timeMs = world.timeMs;

  // Objective (single sub-object, not a map).
  const obj = world.objective;
  state.objective.vaultOpen = obj.vaultOpen;
  state.objective.packageHolderId = obj.packageHolderId;
  state.objective.packageX = obj.packagePos.x;
  state.objective.packageY = obj.packagePos.y;
  state.objective.packageZ = obj.packagePos.z;
  state.objective.winningTeam = obj.winningTeam;
  state.objective.keyCreated = obj.keyCreated;
  state.objective.keyHolderId = obj.keyHolderId;
  state.objective.keyX = obj.keyPos.x;
  state.objective.keyY = obj.keyPos.y;
  state.objective.keyZ = obj.keyPos.z;

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
