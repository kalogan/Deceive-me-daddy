// @deceive/server — the authoritative game server (PROJECT_BRIEF §3). Owns the world
// state, steps sim-core each tick, validates client inputs. The Colyseus room is added
// in slice 1.1; this Phase 0 stub proves the server surface compiles against the core.
import { MAX_PLAYERS } from '@deceive/shared';
import { createRng, createWorld, FixedClock, spawnPlayer, step } from '@deceive/sim-core';

export function bootstrap(): { tick: number; maxPlayers: number } {
  const world = createWorld();
  spawnPlayer(world, 'host', 0, { x: 0, y: 0, z: 0 });
  step(world, { clock: new FixedClock(), rng: createRng(1) });
  return { tick: world.tick, maxPlayers: MAX_PLAYERS };
}
