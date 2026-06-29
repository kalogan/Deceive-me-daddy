// "Deceive Me Daddy" expansion — PURE deduction logic for the concept preview (no THREE/DOM, fully
// unit-tested). Generates a crowd of suspects with readable appearance + behavior attributes, derives
// the clue sequence from the hidden target ("dad"), and narrows the suspects as clues are revealed.
//
// This is preview/prototype logic to prove the FEEL of the find-the-dad loop; the real mode will
// formalise a shared, networked clue/target model later (see docs/EXPANSION_DECEIVE_ME_DADDY.md).

/** A coat colour — the primary readable appearance attribute (we tint each avatar to match). */
export interface CoatColor {
  readonly name: string;
  readonly hex: number;
}

/** The readable coat palette. Small + distinct so "wears a RED coat" reads instantly in a crowd. */
export const COAT_PALETTE: readonly CoatColor[] = [
  { name: 'red', hex: 0xd0413b },
  { name: 'blue', hex: 0x3b6fd0 },
  { name: 'green', hex: 0x3fae5a },
  { name: 'yellow', hex: 0xd9b13a },
  { name: 'teal', hex: 0x35b6a8 },
  { name: 'purple', hex: 0x9b5cc0 },
];

/** A carried item — the secondary appearance attribute. */
export const ACCESSORIES = ['briefcase', 'umbrella', 'backpack', 'none'] as const;
export type Accessory = (typeof ACCESSORIES)[number];

/** Platforms the crowd waits at — the behavior/location attribute. */
export const PLATFORMS = [1, 2, 3, 4] as const;
export type Platform = (typeof PLATFORMS)[number];

/** One person in the crowd. `isDad` is the hidden target the player must find. */
export interface Suspect {
  readonly id: string;
  readonly seed: number;
  readonly coat: CoatColor;
  readonly accessory: Accessory;
  readonly platform: Platform;
  readonly isDad: boolean;
}

/** A clue: a labelled predicate over a suspect, tagged appearance vs. behavior (mix of both). */
export interface Clue {
  readonly id: string;
  readonly kind: 'appearance' | 'behavior';
  readonly label: string;
  test(s: Suspect): boolean;
}

/** A tiny deterministic LCG so the roster + screenshots are stable (preview-only; never the sim RNG). */
export function makeRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    // Numerical Recipes LCG.
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]!;
}

/**
 * Generate a crowd of `count` suspects with exactly one dad, guaranteeing the dad is the UNIQUE
 * suspect matching his full (coat, platform, accessory) triple — so revealing all three clues narrows
 * the crowd to exactly him. Other suspects get random attributes; any that would fully collide with
 * the dad's triple get one attribute nudged so the dad stays unique.
 */
export function generateRoster(count: number, rng: () => number): Suspect[] {
  const dadIndex = Math.floor(rng() * count);
  const dadCoat = pick(COAT_PALETTE, rng);
  const dadAccessory = pick(ACCESSORIES, rng);
  const dadPlatform = pick(PLATFORMS, rng);

  const triple = (c: CoatColor, a: Accessory, p: Platform): string => `${c.name}|${a}|${p}`;
  const dadKey = triple(dadCoat, dadAccessory, dadPlatform);

  const roster: Suspect[] = [];
  for (let i = 0; i < count; i++) {
    const isDad = i === dadIndex;
    if (isDad) {
      roster.push({
        id: `s${i}`,
        seed: 1000 + Math.floor(rng() * 100000),
        coat: dadCoat,
        accessory: dadAccessory,
        platform: dadPlatform,
        isDad: true,
      });
      continue;
    }
    let coat = pick(COAT_PALETTE, rng);
    let accessory = pick(ACCESSORIES, rng);
    const platform = pick(PLATFORMS, rng);
    // Keep the dad's triple unique: if a non-dad collides on all three, change the accessory.
    if (triple(coat, accessory, platform) === dadKey) {
      accessory = ACCESSORIES[(ACCESSORIES.indexOf(accessory) + 1) % ACCESSORIES.length]!;
      if (triple(coat, accessory, platform) === dadKey) {
        coat = COAT_PALETTE[(COAT_PALETTE.indexOf(coat) + 1) % COAT_PALETTE.length]!;
      }
    }
    roster.push({
      id: `s${i}`,
      seed: 1000 + Math.floor(rng() * 100000),
      coat,
      accessory,
      platform,
      isDad: false,
    });
  }
  return roster;
}

/** The article-aware label for an accessory clue ("carrying a briefcase", "carrying an umbrella"). */
function accessoryLabel(a: Accessory): string {
  if (a === 'none') return 'empty-handed (no bag)';
  const article = /^[aeiou]/i.test(a) ? 'an' : 'a';
  return `carrying ${article} ${a}`;
}

/**
 * The ordered clue sequence for a round, DERIVED from the dad. A mix of appearance + behavior:
 *   1. appearance — coat colour
 *   2. behavior   — which platform he's waiting at
 *   3. appearance — what he's carrying
 * Together they uniquely identify the dad (see generateRoster).
 */
export function clueSequence(dad: Suspect): Clue[] {
  return [
    {
      id: 'coat',
      kind: 'appearance',
      label: `Wears a ${dad.coat.name.toUpperCase()} coat`,
      test: (s) => s.coat.name === dad.coat.name,
    },
    {
      id: 'platform',
      kind: 'behavior',
      label: `Waiting near Platform ${dad.platform}`,
      test: (s) => s.platform === dad.platform,
    },
    {
      id: 'accessory',
      kind: 'appearance',
      label: `He's ${accessoryLabel(dad.accessory)}`,
      test: (s) => s.accessory === dad.accessory,
    },
  ];
}

/** A question the player can put to a bystander. Each maps to one of dad's clue attributes — the
 * "pick-a-question" interrogation: choose what to ask and that attribute is revealed as a clue. */
export interface Question {
  readonly id: 'coat' | 'platform' | 'accessory';
  readonly label: string;
}

export const QUESTIONS: readonly Question[] = [
  { id: 'coat', label: 'What was he wearing?' },
  { id: 'platform', label: 'Where was he waiting?' },
  { id: 'accessory', label: 'What was he carrying?' },
];

/** The clue that ANSWERS a question, from the round's clue sequence (ids align: coat/platform/
 * accessory), or undefined if absent. */
export function clueForQuestion(clues: readonly Clue[], questionId: Question['id']): Clue | undefined {
  return clues.find((c) => c.id === questionId);
}

/** Does a suspect satisfy EVERY currently-known clue? (Non-matchers get dimmed in the UI.) */
export function matchesAll(s: Suspect, activeClues: readonly Clue[]): boolean {
  return activeClues.every((c) => c.test(s));
}

/** Count suspects still consistent with the known clues — the live "X suspects left" readout. */
export function remainingSuspects(roster: readonly Suspect[], activeClues: readonly Clue[]): number {
  return roster.filter((s) => matchesAll(s, activeClues)).length;
}

/** Format a millisecond duration as "M:SS" for the departure countdown (clamped at 0:00). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
