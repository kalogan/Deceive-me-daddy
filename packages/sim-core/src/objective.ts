// The heist objective loop (Phase 3, PROJECT_BRIEF §2): gather intel → open the vault →
// grab the package → carry it to an extraction point to win. Authoritative + deterministic.
//
// SCAFFOLD: `loadObjective` (init) is implemented; `collectIntel`, `grabPackage`, and
// `stepObjective` are STUBS — the objective builder fills them against this seam.
import {
  EXTRACT_RANGE,
  INTEL_COLLECT_RANGE,
  PACKAGE_GRAB_RANGE,
} from '@deceive/shared';
import type { ContentPack } from '@deceive/shared';
import { hardReveal } from './detection';
import type { PlayerState, SimDeps, Vec3, WorldState } from './world';

/** Planar (XZ) distance between two points; the objective loop ignores height. */
function distanceXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** A player counts as alive while not knocked down or eliminated. */
function isAlive(player: PlayerState): boolean {
  return player.phase !== 'downed' && player.phase !== 'out';
}

/** Initialize the objective state from a content pack (call when the map loads). */
export function loadObjective(world: WorldState, pack: ContentPack): void {
  const [x, y, z] = pack.objective.packagePosition;
  world.objective.vaultOpen = false;
  world.objective.packageHolderId = '';
  world.objective.packagePos = { x, y, z };
  world.objective.collectedIntel.clear();
  world.objective.winningTeam = -1;
}

/**
 * Player collects intel from node `nodeId`. STUB — filled by the objective builder. Seam:
 * if the player exists + alive, the node exists in pack.intelNodes, hasn't been collected
 * (objective.collectedIntel), and the player is within INTEL_COLLECT_RANGE → mark the node
 * collected, add its intelValue to player.intel, and if any player's intel reaches
 * pack.objective.intelRequiredToOpenVault set objective.vaultOpen = true. Returns success.
 */
export function collectIntel(
  world: WorldState,
  playerId: string,
  nodeId: string,
  deps: SimDeps,
): boolean {
  void deps;
  const pack = world.pack;
  if (!pack) return false;

  const player = world.players.get(playerId);
  if (!player || !isAlive(player)) return false;

  const node = pack.intelNodes.find((n) => n.id === nodeId);
  if (!node) return false;
  if (world.objective.collectedIntel.has(nodeId)) return false;

  const [nx, ny, nz] = node.position;
  if (distanceXZ(player.pos, { x: nx, y: ny, z: nz }) > INTEL_COLLECT_RANGE) return false;

  world.objective.collectedIntel.add(nodeId);
  player.intel += node.intelValue;

  // Any single player reaching the threshold pops the vault open for everyone.
  const required = pack.objective.intelRequiredToOpenVault;
  for (const p of world.players.values()) {
    if (p.intel >= required) {
      world.objective.vaultOpen = true;
      break;
    }
  }
  return true;
}

/**
 * Player grabs the package. STUB. Seam: vault must be open, no current holder, player alive
 * and within PACKAGE_GRAB_RANGE of objective.packagePos → set packageHolderId = playerId,
 * player.carrying = true. Returns success.
 */
export function grabPackage(world: WorldState, playerId: string, deps: SimDeps): boolean {
  void deps;
  const obj = world.objective;
  if (!obj.vaultOpen) return false;
  if (obj.packageHolderId !== '') return false;

  const player = world.players.get(playerId);
  if (!player || !isAlive(player)) return false;

  if (distanceXZ(player.pos, obj.packagePos) > PACKAGE_GRAB_RANGE) return false;

  obj.packageHolderId = playerId;
  player.carrying = true;
  // Grabbing the prize BLOWS YOUR COVER (PROJECT_BRIEF §2) — the carrier is revealed so rivals
  // (and bots, which only engage revealed enemies) can contest the extraction.
  hardReveal(world, playerId, deps);
  return true;
}

/**
 * Per-tick objective upkeep. STUB. Seam:
 * - if a holder exists: keep objective.packagePos synced to the holder's position; if the
 *   holder is downed/out, DROP it (clear packageHolderId + carrying, leave packagePos where
 *   they fell); if the holder is within EXTRACT_RANGE of any pack.objective.extractionPoints
 *   → WIN: set objective.winningTeam = holder.team.
 * Deterministic; no Math.random/Date.now.
 */
export function stepObjective(world: WorldState, deps: SimDeps): void {
  void deps;
  const obj = world.objective;
  if (obj.packageHolderId === '') return;

  const holder = world.players.get(obj.packageHolderId);

  // Holder gone or down → drop the package where they fell (packagePos already tracks them).
  if (!holder || !isAlive(holder)) {
    obj.packageHolderId = '';
    if (holder) holder.carrying = false;
    return;
  }

  // Carried: keep the package glued to the holder.
  obj.packagePos = { x: holder.pos.x, y: holder.pos.y, z: holder.pos.z };

  // Reaching any extraction point with the package wins for the holder's team (first only).
  if (obj.winningTeam === -1 && world.pack) {
    for (const [ex, ey, ez] of world.pack.objective.extractionPoints) {
      if (distanceXZ(holder.pos, { x: ex, y: ey, z: ez }) <= EXTRACT_RANGE) {
        obj.winningTeam = holder.team;
        break;
      }
    }
  }
}
