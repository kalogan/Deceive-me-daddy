// Full-match regression guard (PROJECT_BRIEF §2): build the authoritative world exactly as
// MatchRoom does — the real Facility Alpha pack + MATCH_BOT_COUNT bots — and step the
// deterministic sim. Proves a solo match actually COMPLETES: the intel economy lets a
// contestant reach the vault threshold (the "vault never opens" bug), and a bot then carries
// the package to extraction and wins. Deterministic (seeded rng + FixedClock), so it's a
// stable gate check, not a flaky timing test.
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
import { FACILITY_ALPHA } from '../content';

/** Run a bots-only match for up to `maxSeconds` of sim time; report when milestones land. */
function runMatch(maxSeconds: number, seed: number) {
  const clock = new FixedClock(0);
  const deps: SimDeps = { clock, rng: createRng(seed) };
  const world = createWorld();
  // Mirror MatchRoom.onCreate: crowd (also sets world.pack) → objective → bots.
  spawnNpcsFromPack(world, FACILITY_ALPHA);
  loadObjective(world, FACILITY_ALPHA);
  spawnBots(world, deps, MATCH_BOT_COUNT);

  const ticks = Math.ceil((maxSeconds * 1000) / TICK_MS);
  let vaultOpenedMs = -1;
  let wonMs = -1;
  for (let i = 0; i < ticks; i += 1) {
    clock.advance(TICK_MS); // the server advances its clock before each step
    step(world, deps, TICK_MS);
    if (vaultOpenedMs < 0 && world.objective.vaultOpen) vaultOpenedMs = world.timeMs;
    if (world.objective.winningTeam !== -1) {
      wonMs = world.timeMs;
      break;
    }
  }
  return { world, vaultOpenedMs, wonMs };
}

describe('match flow — a solo (bots-only) match completes', () => {
  it('opens the vault (a contestant reaches the intel threshold) well within the match', () => {
    const { vaultOpenedMs } = runMatch(120, 7);
    expect(vaultOpenedMs).toBeGreaterThanOrEqual(0); // the vault DID open (the core fix)
    expect(vaultOpenedMs).toBeLessThanOrEqual(90_000); // and within a reasonable window
  });

  it('reaches a winner (package grabbed → carried → extracted)', () => {
    const { wonMs, world } = runMatch(180, 7);
    expect(wonMs).toBeGreaterThanOrEqual(0);
    expect(world.objective.winningTeam).not.toBe(-1);
  });

  it('still completes from a different seed (not a single-seed fluke)', () => {
    const { vaultOpenedMs } = runMatch(120, 42);
    expect(vaultOpenedMs).toBeGreaterThanOrEqual(0);
  });
});
