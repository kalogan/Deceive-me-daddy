import { CAST_MS, CAST_MOVE_CANCEL, type ContentPack } from '@deceive/shared';
import { describe, expect, it } from 'vitest';
import { cancelCast, castKindForTarget, castProgress, startCast, stepCast } from './cast';
import { loadObjective } from './objective';
import type { Rng } from './rng';
import type { SimDeps, WorldState } from './world';
import { createWorld, spawnPlayer, step } from './world';

/** A clock whose time the test advances by hand, so channels complete deterministically. */
function makeDeps(): { deps: SimDeps; advance: (ms: number) => void } {
  const clk = { ms: 0 };
  const deps: SimDeps = { clock: { now: () => clk.ms }, rng: { next: () => 0 } as unknown as Rng };
  return { deps, advance: (ms) => (clk.ms += ms) };
}

function keyPack(): ContentPack {
  return {
    intelNodes: [{ id: 'n1', position: [0, 0, 0], zoneId: 'z', intelValue: 3 }],
    objective: {
      packagePosition: [99, 0, 99],
      intelRequiredToOpenVault: 3,
      extractionPoints: [[20, 0, 0]],
      requiresVaultKey: true,
      keyForgePosition: [0, 0, 0],
    },
  } as unknown as ContentPack;
}

function world(): WorldState {
  const w = createWorld();
  w.pack = keyPack();
  loadObjective(w, w.pack);
  return w;
}

describe('castKindForTarget', () => {
  it('maps literal targets + falls back to intel for node ids', () => {
    expect(castKindForTarget('package')).toBe('package');
    expect(castKindForTarget('create_key')).toBe('create_key');
    expect(castKindForTarget('grab_key')).toBe('grab_key');
    expect(castKindForTarget('depart')).toBe('depart');
    expect(castKindForTarget('intel_desk_2')).toBe('intel');
  });
});

describe('startCast / castProgress', () => {
  it('arms a cast with the kind duration; progress runs 0 → 1', () => {
    const { deps, advance } = makeDeps();
    const w = world();
    const p = spawnPlayer(w, 'p', 0, { x: 0, y: 0, z: 0 });
    expect(startCast(w, 'p', 'intel', 'n1', deps)).toBe(true);
    expect(p.cast?.durationMs).toBe(CAST_MS.intel);
    expect(castProgress(p, deps.clock.now())).toBe(0);
    advance(CAST_MS.intel / 2);
    expect(castProgress(p, deps.clock.now())).toBeCloseTo(0.5);
    advance(CAST_MS.intel);
    expect(castProgress(p, deps.clock.now())).toBe(1); // clamped
  });
});

describe('stepCast', () => {
  it('completes the intel channel after its duration', () => {
    const { deps, advance } = makeDeps();
    const w = world();
    const p = spawnPlayer(w, 'p', 0, { x: 0, y: 0, z: 0 });
    startCast(w, 'p', 'intel', 'n1', deps);

    stepCast(w, deps); // not elapsed yet
    expect(p.cast).not.toBeNull();
    expect(p.intel).toBe(0);

    advance(CAST_MS.intel);
    stepCast(w, deps);
    expect(p.cast).toBeNull();
    expect(p.intel).toBe(3); // collectIntel ran on completion
  });

  it('cancels when the player walks off the anchor', () => {
    const { deps, advance } = makeDeps();
    const w = world();
    const p = spawnPlayer(w, 'p', 0, { x: 0, y: 0, z: 0 });
    startCast(w, 'p', 'intel', 'n1', deps);
    p.pos.x = CAST_MOVE_CANCEL + 0.5; // drifted away
    advance(50);
    stepCast(w, deps);
    expect(p.cast).toBeNull();
    expect(p.intel).toBe(0);
  });

  it('cancels when the player is downed', () => {
    const { deps } = makeDeps();
    const w = world();
    const p = spawnPlayer(w, 'p', 0, { x: 0, y: 0, z: 0 });
    startCast(w, 'p', 'intel', 'n1', deps);
    p.phase = 'downed';
    stepCast(w, deps);
    expect(p.cast).toBeNull();
  });

  it('forges the vault key after the 10s channel', () => {
    const { deps, advance } = makeDeps();
    const w = world();
    const p = spawnPlayer(w, 'p', 0, { x: 0, y: 0, z: 0 });
    p.intel = 3; // enough to forge
    startCast(w, 'p', 'create_key', 'create_key', deps);
    expect(p.cast?.durationMs).toBe(10000);
    advance(10000);
    stepCast(w, deps);
    expect(w.objective.keyCreated).toBe(true);
  });

  it('depart channel at the extraction wins for the carrier', () => {
    const { deps, advance } = makeDeps();
    const w = world();
    spawnPlayer(w, 'p', 2, { x: 20, y: 0, z: 0 }); // at the extraction point
    w.objective.keyCreated = true;
    w.objective.keyHolderId = 'p';
    startCast(w, 'p', 'depart', 'depart', deps);
    advance(CAST_MS.depart);
    stepCast(w, deps);
    expect(w.objective.winningTeam).toBe(2);
  });

  it('cancelCast clears an in-progress channel', () => {
    const { deps } = makeDeps();
    const w = world();
    spawnPlayer(w, 'p', 0, { x: 0, y: 0, z: 0 });
    startCast(w, 'p', 'intel', 'n1', deps);
    cancelCast(w, 'p');
    expect(w.players.get('p')?.cast).toBeNull();
  });
});

describe('jump (step movement)', () => {
  it('a grounded player who requested a jump rises then lands back at y=0', () => {
    const { deps } = makeDeps();
    const w = createWorld();
    const p = spawnPlayer(w, 'p', 0, { x: 0, y: 0, z: 0 });
    p.wantsJump = true;
    step(w, deps, 50);
    expect(p.pos.y).toBeGreaterThan(0); // launched
    expect(p.wantsJump).toBe(false); // intent consumed
    // Let gravity bring them down over ~1.5s of ticks.
    for (let i = 0; i < 40; i++) step(w, deps, 50);
    expect(p.pos.y).toBe(0);
    expect(p.vel.y).toBe(0);
  });
});
