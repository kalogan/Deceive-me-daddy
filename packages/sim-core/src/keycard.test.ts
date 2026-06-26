import {
  type ClearanceTier,
  type ContentPack,
  type Keycard,
  KEYCARD_PICKUP_RANGE,
} from '@deceive/shared';
import { describe, expect, it } from 'vitest';
import { stepKeycardPickup } from './keycard';
import type { AgentPhase } from './world';
import { createWorld, spawnPlayer } from './world';

// A minimal pack fixture: stepKeycardPickup only ever reads `pack.keycards`, so we cast a
// partial object rather than building a full validated ContentPack. Deterministic; no I/O.
function packWith(keycards: Keycard[]): ContentPack {
  return { keycards } as unknown as ContentPack;
}

function card(
  id: string,
  color: ClearanceTier,
  position: [number, number, number],
): Keycard {
  return { id, color, position };
}

function setup(opts: {
  pos?: { x: number; y: number; z: number };
  phase?: AgentPhase;
  cards?: Keycard[] | null;
}) {
  const world = createWorld();
  const p = spawnPlayer(world, 'p1', 0, opts.pos ?? { x: 0, y: 0, z: 0 });
  p.phase = opts.phase ?? 'blended';
  world.pack = opts.cards === null ? null : packWith(opts.cards ?? []);
  return { world, p };
}

describe('stepKeycardPickup — pickup', () => {
  it('picks up a keycard in range: heldKeycard becomes its color, id is collected', () => {
    const { world, p } = setup({ cards: [card('card-sci', 'scientist', [0, 0, 0])] });
    stepKeycardPickup(world);
    expect(p.heldKeycard).toBe('scientist');
    expect(world.collectedKeycards.has('card-sci')).toBe(true);
  });

  it('uses XZ distance only (ignores Y) — at the edge of range still picks up', () => {
    const { world, p } = setup({
      pos: { x: KEYCARD_PICKUP_RANGE, y: 99, z: 0 },
      cards: [card('card-sci', 'scientist', [0, 0, 0])],
    });
    stepKeycardPickup(world);
    expect(p.heldKeycard).toBe('scientist');
    expect(world.collectedKeycards.has('card-sci')).toBe(true);
  });

  it('grabbing a second card replaces heldKeycard (latest wins)', () => {
    const { world, p } = setup({ cards: [card('card-a', 'scientist', [0, 0, 0])] });
    stepKeycardPickup(world);
    expect(p.heldKeycard).toBe('scientist');

    // A new card appears under the player on a later tick.
    world.pack = packWith([card('card-b', 'security', [0, 0, 0])]);
    stepKeycardPickup(world);
    expect(p.heldKeycard).toBe('security');
    expect(world.collectedKeycards.has('card-b')).toBe(true);
  });
});

describe('stepKeycardPickup — no pickup', () => {
  it('picks up nothing when out of range', () => {
    const { world, p } = setup({
      pos: { x: KEYCARD_PICKUP_RANGE + 1, y: 0, z: 0 },
      cards: [card('card-sci', 'scientist', [0, 0, 0])],
    });
    stepKeycardPickup(world);
    expect(p.heldKeycard).toBe('');
    expect(world.collectedKeycards.size).toBe(0);
  });

  it('does not re-grab an already-collected card (idempotent across ticks)', () => {
    const { world, p } = setup({ cards: [card('card-sci', 'scientist', [0, 0, 0])] });
    stepKeycardPickup(world);
    expect(p.heldKeycard).toBe('scientist');
    expect(world.collectedKeycards.size).toBe(1);

    // The held card was consumed; running again over the same (collected) card is a no-op.
    p.heldKeycard = '';
    stepKeycardPickup(world);
    expect(p.heldKeycard).toBe('');
    expect(world.collectedKeycards.size).toBe(1);
  });

  it('a downed player picks up nothing', () => {
    const { world, p } = setup({
      phase: 'downed',
      cards: [card('card-sci', 'scientist', [0, 0, 0])],
    });
    stepKeycardPickup(world);
    expect(p.heldKeycard).toBe('');
    expect(world.collectedKeycards.size).toBe(0);
  });

  it('an out player picks up nothing', () => {
    const { world, p } = setup({
      phase: 'out',
      cards: [card('card-sci', 'scientist', [0, 0, 0])],
    });
    stepKeycardPickup(world);
    expect(p.heldKeycard).toBe('');
    expect(world.collectedKeycards.size).toBe(0);
  });

  it('is a no-op when the pack is null', () => {
    const { world, p } = setup({ cards: null });
    stepKeycardPickup(world);
    expect(p.heldKeycard).toBe('');
    expect(world.collectedKeycards.size).toBe(0);
  });

  it('is a no-op when there are no keycards', () => {
    const { world, p } = setup({ cards: [] });
    stepKeycardPickup(world);
    expect(p.heldKeycard).toBe('');
    expect(world.collectedKeycards.size).toBe(0);
  });
});
