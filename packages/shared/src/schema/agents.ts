// Playable agents (PROJECT_BRIEF §2). Faithful to Deceive Inc.'s roster: each Agent is a
// shared base kit + ONE signature "Expertise" (the active ability). v1 ships the three
// default-unlocked agents, chosen to be maximally distinct — each Expertise exercises a
// different existing system (recon / combat / stealth):
//
//   Squire  (Vanguard)  — "Eyes on the Prize": reveal nearby intel, keycards and the
//                          package through walls for a short window.
//   Chavez  (Vanguard)  — "Hard Boiled": become briefly invulnerable to push an objective.
//   Larcin  (Scoundrel) — "Adieu": cloak — unseen and untouchable — to slip past or grab.
//
// Heavier PASSIVES (Squire's Sixth Sense, Chavez's Tough Luck grey-health, Larcin's
// item-steal melee) are catalogued here for flavor but their EFFECTS are a tuning-pass
// follow-up; v1 implements the signature Expertise of each.
import { z } from 'zod';

/** The playable agent ids. The original three default-unlocked agents come first, followed by
 *  five roster expansions (each reuses an EXISTING ability + gadget kind — only stats/flavor differ). */
export const AGENT_IDS = [
  'squire',
  'chavez',
  'larcin',
  'sasha',
  'red',
  'octo',
  'yuki',
  'cavaliere',
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** The signature Expertise each agent triggers. One per agent in v1. */
export const ABILITY_KINDS = ['eyes_on_prize', 'hard_boiled', 'adieu'] as const;
export type AbilityKind = (typeof ABILITY_KINDS)[number];

/** Deceive Inc.'s four agent archetypes (flavor; only the three above are playable in v1). */
export const AGENT_ROLES = ['vanguard', 'tracker', 'scoundrel', 'disruptor'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** The deployable GADGET kinds (the second active slot, alongside the signature Expertise). */
export const GADGET_KINDS = ['scan', 'frag', 'mirage'] as const;
export type GadgetKind = (typeof GADGET_KINDS)[number];

/** Primary-weapon handling — what makes each agent SHOOT differently (combat depth). */
export const WeaponStatsSchema = z.object({
  /** Damage per hit. */
  damage: z.number().positive(),
  /** Minimum ms between shots (rate of fire). */
  fireCooldownMs: z.number().int().positive(),
  /** Max effective range (m). */
  range: z.number().positive(),
});
export type WeaponStats = z.infer<typeof WeaponStatsSchema>;

/**
 * An agent's deployable gadget: a second active on its own cooldown.
 *   - scan   → ping the area; nearby rivals are revealed to you for `magnitude` ms.
 *   - frag   → burst; deal `magnitude` damage to enemies within `radius`.
 *   - mirage → drop a holo-decoy at your spot and instantly re-blend (escape).
 * `magnitude` is kind-specific (scan: reveal ms; frag: damage; mirage: unused).
 */
export const GadgetSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(GADGET_KINDS),
  description: z.string().min(1),
  cooldownMs: z.number().int().positive(),
  /** Effect radius (m); 0 for self-only gadgets (mirage). */
  radius: z.number().nonnegative(),
  /** Kind-specific magnitude (scan: reveal ms, frag: damage, mirage: 0). */
  magnitude: z.number().nonnegative(),
});
export type Gadget = z.infer<typeof GadgetSchema>;

export const AgentSchema = z.object({
  id: z.enum(AGENT_IDS),
  name: z.string().min(1),
  role: z.enum(AGENT_ROLES),
  /** Flavor name of the primary weapon. */
  weapon: z.string().min(1),
  /** Primary-weapon handling (damage / rate of fire / range). */
  weaponStats: WeaponStatsSchema,
  /** The deployable gadget (second active slot). */
  gadget: GadgetSchema,
  /** The signature Expertise this agent triggers. */
  ability: z.enum(ABILITY_KINDS),
  /** Display name of the Expertise, e.g. 'Eyes on the Prize'. */
  abilityName: z.string().min(1),
  /** How long the Expertise stays active once triggered (ms). */
  abilityDurationMs: z.number().int().positive(),
  /** Cooldown from activation until ready again (ms). */
  abilityCooldownMs: z.number().int().positive(),
  /** Flavor name of the agent's passive (effect is a tuning-pass follow-up). */
  passive: z.string().min(1),
  description: z.string().min(1),
});
export type Agent = z.infer<typeof AgentSchema>;

export const ROSTER: readonly Agent[] = [
  {
    id: 'squire',
    name: 'Squire',
    role: 'vanguard',
    weapon: 'Sentinel',
    weaponStats: { damage: 30, fireCooldownMs: 200, range: 30 }, // balanced all-rounder
    gadget: {
      name: 'Scanner Pulse',
      kind: 'scan',
      description: 'Ping the area — nearby rivals are revealed to you for a few seconds.',
      cooldownMs: 16000,
      radius: 14,
      magnitude: 4000, // reveal window (ms)
    },
    ability: 'eyes_on_prize',
    abilityName: 'Eyes on the Prize',
    abilityDurationMs: 6000,
    abilityCooldownMs: 22000,
    passive: 'Sixth Sense',
    description:
      'A well-rounded vanguard. Eyes on the Prize reveals nearby intel, keycards, and the package through walls.',
  },
  {
    id: 'chavez',
    name: 'Chavez',
    role: 'vanguard',
    weapon: 'Sentinel',
    weaponStats: { damage: 55, fireCooldownMs: 520, range: 24 }, // heavy hitter, slow + short
    gadget: {
      name: 'Frag Charge',
      kind: 'frag',
      description: 'Lob a charge that bursts, damaging every rival caught nearby.',
      cooldownMs: 18000,
      radius: 6,
      magnitude: 45, // burst damage
    },
    ability: 'hard_boiled',
    abilityName: 'Hard Boiled',
    abilityDurationMs: 5000,
    abilityCooldownMs: 25000,
    passive: 'Tough Luck',
    description:
      'A rugged bruiser. Hard Boiled makes him briefly invulnerable to bull through a contested objective.',
  },
  {
    id: 'larcin',
    name: 'Larcin',
    role: 'scoundrel',
    weapon: 'Silence',
    weaponStats: { damage: 18, fireCooldownMs: 110, range: 22 }, // fast, quiet, low per-hit
    gadget: {
      name: 'Mirage',
      kind: 'mirage',
      description: 'Vanish: drop a holo-decoy and instantly slip back into the crowd.',
      cooldownMs: 20000,
      radius: 0,
      magnitude: 0,
    },
    ability: 'adieu',
    abilityName: 'Adieu',
    abilityDurationMs: 6000,
    abilityCooldownMs: 25000,
    passive: 'Merci beaucoup!',
    description:
      'A cat-burglar scoundrel. Adieu cloaks him — unseen and untouchable — to slip past rivals or steal the package.',
  },
  {
    id: 'sasha',
    name: 'Sasha',
    role: 'tracker',
    weapon: 'Bulldog',
    weaponStats: { damage: 72, fireCooldownMs: 900, range: 46 }, // marksman: hard-hitting, slow, long
    gadget: {
      name: 'Recon Dart',
      kind: 'scan',
      description: 'Tag the area — rivals caught in the sweep light up for you for several seconds.',
      cooldownMs: 17000,
      radius: 16,
      magnitude: 4200, // reveal window (ms)
    },
    ability: 'eyes_on_prize',
    abilityName: 'Eyes on the Prize',
    abilityDurationMs: 6500,
    abilityCooldownMs: 24000,
    passive: 'Steady Hand',
    description:
      'A patient tracker. The Bulldog rewards aim from afar, and Eyes on the Prize lights up intel through walls.',
  },
  {
    id: 'red',
    name: 'Red',
    role: 'scoundrel',
    weapon: 'Double Trouble',
    weaponStats: { damage: 13, fireCooldownMs: 85, range: 18 }, // dual SMGs: blistering, low per-hit, short
    gadget: {
      name: 'Mirage',
      kind: 'mirage',
      description: 'Vanish: drop a holo-decoy and instantly slip back into the crowd.',
      cooldownMs: 19000,
      radius: 0,
      magnitude: 0,
    },
    ability: 'adieu',
    abilityName: 'Adieu',
    abilityDurationMs: 5500,
    abilityCooldownMs: 24000,
    passive: 'Light Fingers',
    description:
      'A reckless scoundrel. Double Trouble shreds up close, and Adieu cloaks her for a clean getaway.',
  },
  {
    id: 'octo',
    name: 'Octo',
    role: 'disruptor',
    weapon: 'Tako',
    weaponStats: { damage: 60, fireCooldownMs: 720, range: 13 }, // shotgun: big burst, slow, point-blank
    gadget: {
      name: 'Ink Charge',
      kind: 'frag',
      description: 'Lob a charge that bursts, damaging every rival caught nearby.',
      cooldownMs: 18000,
      radius: 6,
      magnitude: 48, // burst damage
    },
    ability: 'hard_boiled',
    abilityName: 'Hard Boiled',
    abilityDurationMs: 5000,
    abilityCooldownMs: 26000,
    passive: 'Eight Arms',
    description:
      'An in-your-face disruptor. The Tako devastates point-blank, and Hard Boiled lets him crash a chokepoint.',
  },
  {
    id: 'yuki',
    name: 'Yuki',
    role: 'tracker',
    weapon: 'Frost',
    weaponStats: { damage: 26, fireCooldownMs: 170, range: 32 }, // burst rifle: tidy all-rounder
    gadget: {
      name: 'Frag Charge',
      kind: 'frag',
      description: 'Lob a charge that bursts, damaging every rival caught nearby.',
      cooldownMs: 17000,
      radius: 6,
      magnitude: 42, // burst damage
    },
    ability: 'eyes_on_prize',
    abilityName: 'Eyes on the Prize',
    abilityDurationMs: 6000,
    abilityCooldownMs: 23000,
    passive: 'Cold Read',
    description:
      'A measured tracker. The Frost rifle bursts at mid-range, and Eyes on the Prize keeps tabs on the package.',
  },
  {
    id: 'cavaliere',
    name: 'Cavaliere',
    role: 'vanguard',
    weapon: 'Duello',
    weaponStats: { damage: 34, fireCooldownMs: 230, range: 28 }, // sidearm: balanced duelist
    gadget: {
      name: 'Scanner Pulse',
      kind: 'scan',
      description: 'Ping the area — nearby rivals are revealed to you for a few seconds.',
      cooldownMs: 16000,
      radius: 14,
      magnitude: 3800, // reveal window (ms)
    },
    ability: 'hard_boiled',
    abilityName: 'Hard Boiled',
    abilityDurationMs: 5500,
    abilityCooldownMs: 25000,
    passive: 'Riposte',
    description:
      'A poised vanguard. The Duello trades cleanly at range, and Hard Boiled lets her hold ground on an objective.',
  },
];

/** O(1) lookup of an agent by id. Built generically from ROSTER so it scales to any roster size;
 *  the cast is sound because ROSTER provides exactly one entry per AgentId (asserted in tests). */
export const AGENTS_BY_ID = Object.fromEntries(ROSTER.map((a) => [a.id, a])) as Record<
  AgentId,
  Agent
>;

/** The Expertise kind a given agent triggers. */
export function agentAbility(id: AgentId): AbilityKind {
  return AGENTS_BY_ID[id].ability;
}

/** Assign an agent by join order (round-robin across the roster). Deterministic. */
export function agentForJoinIndex(joinIndex: number): AgentId {
  const id = AGENT_IDS[((joinIndex % AGENT_IDS.length) + AGENT_IDS.length) % AGENT_IDS.length];
  return id ?? 'squire';
}
