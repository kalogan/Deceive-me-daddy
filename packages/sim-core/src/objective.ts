// The heist objective loop (Phase 3, PROJECT_BRIEF §2): gather intel → open the vault →
// grab the package → carry it to an extraction point to win. Authoritative + deterministic.
//
// SCAFFOLD: `loadObjective` (init) is implemented; `collectIntel`, `grabPackage`, and
// `stepObjective` are STUBS — the objective builder fills them against this seam.
import {
  EXTRACT_RANGE,
  INTEL_COLLECT_RANGE,
  KEY_FORGE_RANGE,
  KEY_GRAB_RANGE,
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
  // Vault key: loose at the forge until grabbed (key packs only; inert elsewhere).
  const forge = pack.objective.keyForgePosition;
  world.objective.keyCreated = false;
  world.objective.keyHolderId = '';
  world.objective.keyPos = forge
    ? { x: forge[0], y: forge[1], z: forge[2] }
    : { x: 0, y: 0, z: 0 };
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

  // Vault-key packs DON'T auto-open: the player must forge + grab the key (see createVaultKey).
  // Standard packs keep the original behaviour — any player reaching the threshold pops the
  // vault open for everyone.
  if (!pack.objective.requiresVaultKey) {
    const required = pack.objective.intelRequiredToOpenVault;
    for (const p of world.players.values()) {
      if (p.intel >= required) {
        world.objective.vaultOpen = true;
        break;
      }
    }
  }
  return true;
}

/**
 * Forge the vault key at the terminal (objective.requiresVaultKey packs only). Seam: the pack
 * requires a key + has a `keyForgePosition`, the key isn't already created, the player is alive,
 * holds enough intel (>= intelRequiredToOpenVault), and is within KEY_FORGE_RANGE of the forge
 * → mark the key created (loose at the forge), and open the vault. Returns success.
 */
export function createVaultKey(world: WorldState, playerId: string, deps: SimDeps): boolean {
  void deps;
  const pack = world.pack;
  if (!pack || !pack.objective.requiresVaultKey) return false;
  const forge = pack.objective.keyForgePosition;
  if (!forge) return false;

  const obj = world.objective;
  if (obj.keyCreated) return false;

  const player = world.players.get(playerId);
  if (!player || !isAlive(player)) return false;
  if (player.intel < pack.objective.intelRequiredToOpenVault) return false;

  const forgePos = { x: forge[0], y: forge[1], z: forge[2] };
  if (distanceXZ(player.pos, forgePos) > KEY_FORGE_RANGE) return false;

  obj.keyCreated = true;
  obj.keyHolderId = '';
  obj.keyPos = forgePos;
  // Forging the key cracks the vault — keep vaultOpen meaningful for UI keyed on it.
  obj.vaultOpen = true;
  return true;
}

/**
 * Grab the forged vault key (objective.requiresVaultKey packs only). Seam: the key is created,
 * loose (no holder), the player is alive and within KEY_GRAB_RANGE → the player carries the key.
 * Like the package, grabbing the prize BLOWS COVER (the carrier is revealed). Returns success.
 */
export function grabVaultKey(world: WorldState, playerId: string, deps: SimDeps): boolean {
  const pack = world.pack;
  if (!pack || !pack.objective.requiresVaultKey) return false;

  const obj = world.objective;
  if (!obj.keyCreated || obj.keyHolderId !== '') return false;

  const player = world.players.get(playerId);
  if (!player || !isAlive(player)) return false;
  if (distanceXZ(player.pos, obj.keyPos) > KEY_GRAB_RANGE) return false;

  obj.keyHolderId = playerId;
  player.carrying = true;
  hardReveal(world, playerId, deps);
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
  // Vault-key packs replace the package with the key — there is nothing to grab here.
  if (world.pack?.objective.requiresVaultKey) return false;
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
  // Standard packs carry the PACKAGE; vault-key packs carry the KEY. Both follow the same rules
  // (track the holder, drop on down/out, win on extraction), so one helper handles either.
  stepCarriedObjective(world, 'package');
  if (world.pack?.objective.requiresVaultKey) {
    stepCarriedObjective(world, 'key');
  }
}

/**
 * Per-tick upkeep for a single carried objective — the `package` or the `key`. Keeps its world
 * position glued to the holder, drops it where they fall if downed/out, and wins for the holder's
 * team on reaching any extraction point. Deterministic; no Math.random/Date.now.
 */
function stepCarriedObjective(world: WorldState, kind: 'package' | 'key'): void {
  const obj = world.objective;
  const holderId = kind === 'package' ? obj.packageHolderId : obj.keyHolderId;
  if (holderId === '') return;

  const holder = world.players.get(holderId);

  // Holder gone or down → drop it where they fell (the pos already tracks them).
  if (!holder || !isAlive(holder)) {
    if (kind === 'package') obj.packageHolderId = '';
    else obj.keyHolderId = '';
    if (holder) holder.carrying = false;
    return;
  }

  // Carried: keep the prize glued to the holder.
  const pos = { x: holder.pos.x, y: holder.pos.y, z: holder.pos.z };
  if (kind === 'package') obj.packagePos = pos;
  else obj.keyPos = pos;

  // Reaching any extraction point with the prize wins for the holder's team (first only).
  if (obj.winningTeam === -1 && world.pack) {
    for (const [ex, ey, ez] of world.pack.objective.extractionPoints) {
      if (distanceXZ(holder.pos, { x: ex, y: ey, z: ez }) <= EXTRACT_RANGE) {
        obj.winningTeam = holder.team;
        break;
      }
    }
  }
}
