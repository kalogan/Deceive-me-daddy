import { describe, expect, it } from 'vitest';
import { FixedClock } from './clock';
import { createRng } from './rng';
import { createWorld, type SimDeps, spawnPlayer, step } from './world';

const deps = (): SimDeps => ({ clock: new FixedClock(), rng: createRng(1) });

describe('world step', () => {
  it('advances tick and sim time deterministically', () => {
    const world = createWorld();
    step(world, deps(), 50);
    step(world, deps(), 50);
    expect(world.tick).toBe(2);
    expect(world.timeMs).toBe(100);
  });

  it('integrates player velocity into position', () => {
    const world = createWorld();
    const p = spawnPlayer(world, 'p1', 0, { x: 0, y: 0, z: 0 });
    p.vel.x = 2; // m/s
    step(world, deps(), 1000); // 1 second
    expect(p.pos.x).toBeCloseTo(2, 5);
  });

  it('spawns players disguised as civilians and blended', () => {
    const world = createWorld();
    const p = spawnPlayer(world, 'p1', 1, { x: 1, y: 0, z: 1 });
    expect(p.disguiseTier).toBe('civilian');
    expect(p.phase).toBe('blended');
    expect(p.team).toBe(1);
  });

  it('does not move eliminated players', () => {
    const world = createWorld();
    const p = spawnPlayer(world, 'p1', 0, { x: 0, y: 0, z: 0 });
    p.vel.x = 5;
    p.phase = 'out';
    step(world, deps(), 1000);
    expect(p.pos.x).toBe(0);
  });
});

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('int stays within range', () => {
    const rng = createRng(7);
    for (let i = 0; i < 100; i += 1) {
      const v = rng.int(4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4);
    }
  });
});
