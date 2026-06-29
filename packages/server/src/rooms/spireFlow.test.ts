// Multi-floor completion guard: the bots-only heist must finish on Vertex Spire, which spreads the
// objective across TWO floors (intel on both, the vault upstairs, an upper extraction option). This
// proves the multi-floor sim end-to-end — bots climb the stair/vent, gather intel, the vault opens,
// a bot grabs the package upstairs and carries it to an extraction point to win. Deterministic.
import { describe, expect, it } from 'vitest';
import { MATCH_BOT_COUNT, TICK_MS } from '@deceive/shared';
import {
  FixedClock,
  createRng,
  createWorld,
  loadObjective,
  spawnBots,
  spawnNpcsFromPack,
  step,
  type SimDeps,
} from '@deceive/sim-core';
import { VERTEX_SPIRE } from '../content';

function runMatch(maxSeconds: number, seed: number) {
  const clock = new FixedClock(0);
  const deps: SimDeps = { clock, rng: createRng(seed) };
  const world = createWorld();
  spawnNpcsFromPack(world, VERTEX_SPIRE);
  loadObjective(world, VERTEX_SPIRE);
  spawnBots(world, deps, MATCH_BOT_COUNT);

  const ticks = Math.ceil((maxSeconds * 1000) / TICK_MS);
  let vaultOpenedMs = -1;
  let wonMs = -1;
  let anyClimbed = false;
  for (let i = 0; i < ticks; i += 1) {
    clock.advance(TICK_MS);
    step(world, deps, TICK_MS);
    for (const p of world.players.values()) if (p.isBot && p.floor > 0) anyClimbed = true;
    if (vaultOpenedMs < 0 && world.objective.vaultOpen) vaultOpenedMs = world.timeMs;
    if (world.objective.winningTeam !== -1) {
      wonMs = world.timeMs;
      break;
    }
  }
  return { world, vaultOpenedMs, wonMs, anyClimbed };
}

describe('Vertex Spire — a multi-floor bots-only match completes', () => {
  it('bots climb, open the vault, and a team extracts to win', () => {
    const { world, vaultOpenedMs, wonMs, anyClimbed } = runMatch(240, 7);
    expect(anyClimbed).toBe(true); // verticality is actually used
    expect(vaultOpenedMs).toBeGreaterThanOrEqual(0);
    expect(wonMs).toBeGreaterThanOrEqual(0);
    expect(world.objective.winningTeam).not.toBe(-1);
  });

  it('still completes from a different seed (not a single-seed fluke)', () => {
    const { wonMs } = runMatch(240, 23);
    expect(wonMs).toBeGreaterThanOrEqual(0);
  });
});
