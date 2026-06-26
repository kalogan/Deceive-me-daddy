// AI players ("bots", PROJECT_BRIEF §2). Bots ARE players (own PlayerState, team, can win)
// flagged isBot; they fill empty match slots so a 12-player match is playable solo. The
// server spawns them; this module drives them each tick. Engine-agnostic + deterministic.
//
// SCAFFOLD: `spawnBots` (creates the bots) is implemented; `stepBots` (the AI) is a STUB —
// the bots-AI builder fills it against this seam.
import { MATCH_TEAMS } from '@deceive/shared';
import type { SimDeps, Vec3, WorldState } from './world';
import { spawnPlayer } from './world';

/** Spawn `count` AI players into the world, distributed across teams at pack spawn points. */
export function spawnBots(world: WorldState, deps: SimDeps, count: number): void {
  void deps;
  const spawns = world.pack?.spawnPoints ?? [];
  for (let i = 0; i < count; i += 1) {
    const sp = spawns.length > 0 ? spawns[i % spawns.length] : undefined;
    const pos: Vec3 = sp
      ? { x: sp.position[0], y: sp.position[1], z: sp.position[2] }
      : { x: 0, y: 0, z: 0 };
    spawnPlayer(world, `bot-${i}`, i % MATCH_TEAMS, pos, true);
  }
}

/**
 * Advance every bot one tick. STUB — filled by the bots-AI builder. The seam: for each
 * player with `isBot` that is alive (phase not 'downed'/'out'), pick a goal and act —
 * navigate toward intel/package/extraction (set `vel` + `yaw`; the world step integrates
 * movement), and use the existing sim functions to collect/grab/fire/revive. Must stay
 * deterministic (use `deps.rng`/`deps.clock`, never Math.random/Date.now).
 */
export function stepBots(world: WorldState, deps: SimDeps): void {
  void world;
  void deps;
}
