// The heist objective loop (Phase 3, PROJECT_BRIEF §2): gather intel → open the vault →
// grab the package → carry it to an extraction point to win. Authoritative + deterministic.
//
// SCAFFOLD: `loadObjective` (init) is implemented; `collectIntel`, `grabPackage`, and
// `stepObjective` are STUBS — the objective builder fills them against this seam.
import type { ContentPack } from '@deceive/shared';
import type { SimDeps, WorldState } from './world';

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
  void world;
  void playerId;
  void nodeId;
  void deps;
  return false;
}

/**
 * Player grabs the package. STUB. Seam: vault must be open, no current holder, player alive
 * and within PACKAGE_GRAB_RANGE of objective.packagePos → set packageHolderId = playerId,
 * player.carrying = true. Returns success.
 */
export function grabPackage(world: WorldState, playerId: string, deps: SimDeps): boolean {
  void world;
  void playerId;
  void deps;
  return false;
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
  void world;
  void deps;
}
