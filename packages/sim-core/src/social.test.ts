import {
  type ClearanceTier,
  type ContentPack,
  type SocialSpot,
  SOCIAL_BLEED,
  SOCIAL_RANGE,
} from '@deceive/shared';
import { describe, expect, it } from 'vitest';
import { stepSocial } from './social';
import type { AgentPhase } from './world';
import { createWorld, spawnPlayer } from './world';

// A minimal pack fixture: stepSocial only ever reads `pack.socialSpots`, so we cast a
// partial object rather than building a full validated ContentPack. Deterministic; no I/O.
function packWith(spots: SocialSpot[]): ContentPack {
  return { socialSpots: spots } as unknown as ContentPack;
}

function spot(
  id: string,
  tier: ClearanceTier,
  position: [number, number, number],
): SocialSpot {
  return { id, tier, action: 'sit', position };
}

function setup(opts: {
  tier?: ClearanceTier;
  pos?: { x: number; y: number; z: number };
  suspicion?: number;
  phase?: AgentPhase;
  spots?: SocialSpot[] | null;
}) {
  const world = createWorld();
  const p = spawnPlayer(world, 'p1', 0, opts.pos ?? { x: 0, y: 0, z: 0 });
  p.disguiseTier = opts.tier ?? 'civilian';
  p.suspicion = opts.suspicion ?? 0;
  p.phase = opts.phase ?? 'blended';
  world.pack = opts.spots === null ? null : packWith(opts.spots ?? []);
  return { world, p };
}

const DT = 1000; // 1 second

describe('stepSocial — matching-tier spot in range', () => {
  it('bleeds suspicion by SOCIAL_BLEED * dt over a step', () => {
    const { world, p } = setup({
      tier: 'staff',
      suspicion: 50,
      spots: [spot('plant', 'staff', [0, 0, 0])],
    });
    stepSocial(world, DT);
    expect(p.suspicion).toBeCloseTo(50 - SOCIAL_BLEED, 5);
  });

  it('scales the bleed by dtMs (half a second = half the bleed)', () => {
    const { world, p } = setup({
      tier: 'staff',
      suspicion: 50,
      spots: [spot('plant', 'staff', [0, 0, 0])],
    });
    stepSocial(world, 500);
    expect(p.suspicion).toBeCloseTo(50 - SOCIAL_BLEED * 0.5, 5);
  });

  it('clamps at 0 and never goes negative', () => {
    const { world, p } = setup({
      tier: 'staff',
      suspicion: 5, // less than one second of bleed
      spots: [spot('plant', 'staff', [0, 0, 0])],
    });
    stepSocial(world, DT);
    expect(p.suspicion).toBe(0);
  });

  it('uses XZ distance only (ignores Y) — at the edge of range still bleeds', () => {
    const { world, p } = setup({
      tier: 'staff',
      pos: { x: SOCIAL_RANGE, y: 99, z: 0 },
      suspicion: 50,
      spots: [spot('plant', 'staff', [0, 0, 0])],
    });
    stepSocial(world, DT);
    expect(p.suspicion).toBeCloseTo(50 - SOCIAL_BLEED, 5);
  });

  it('does not stack multiple matching spots in range', () => {
    const { world, p } = setup({
      tier: 'staff',
      suspicion: 50,
      spots: [spot('a', 'staff', [0, 0, 0]), spot('b', 'staff', [0.5, 0, 0.5])],
    });
    stepSocial(world, DT);
    expect(p.suspicion).toBeCloseTo(50 - SOCIAL_BLEED, 5);
  });
});

describe('stepSocial — no bleed cases', () => {
  it('does not bleed at a DIFFERENT-tier spot in range', () => {
    const { world, p } = setup({
      tier: 'civilian',
      suspicion: 50,
      spots: [spot('post', 'security', [0, 0, 0])],
    });
    stepSocial(world, DT);
    expect(p.suspicion).toBe(50);
  });

  it('does not bleed when out of range of any matching spot', () => {
    const { world, p } = setup({
      tier: 'staff',
      pos: { x: SOCIAL_RANGE + 1, y: 0, z: 0 },
      suspicion: 50,
      spots: [spot('plant', 'staff', [0, 0, 0])],
    });
    stepSocial(world, DT);
    expect(p.suspicion).toBe(50);
  });

  it('does not bleed a downed player at a matching spot', () => {
    const { world, p } = setup({
      tier: 'staff',
      suspicion: 50,
      phase: 'downed',
      spots: [spot('plant', 'staff', [0, 0, 0])],
    });
    stepSocial(world, DT);
    expect(p.suspicion).toBe(50);
  });

  it('does not bleed an out player at a matching spot', () => {
    const { world, p } = setup({
      tier: 'staff',
      suspicion: 50,
      phase: 'out',
      spots: [spot('plant', 'staff', [0, 0, 0])],
    });
    stepSocial(world, DT);
    expect(p.suspicion).toBe(50);
  });

  it('is a no-op when the pack is null', () => {
    const { world, p } = setup({ tier: 'staff', suspicion: 50, spots: null });
    stepSocial(world, DT);
    expect(p.suspicion).toBe(50);
  });

  it('is a no-op when there are no social spots', () => {
    const { world, p } = setup({ tier: 'staff', suspicion: 50, spots: [] });
    stepSocial(world, DT);
    expect(p.suspicion).toBe(50);
  });
});
