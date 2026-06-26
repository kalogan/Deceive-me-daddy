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

/** The playable agent ids (v1 = the three default-unlocked, maximally-distinct agents). */
export const AGENT_IDS = ['squire', 'chavez', 'larcin'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** The signature Expertise each agent triggers. One per agent in v1. */
export const ABILITY_KINDS = ['eyes_on_prize', 'hard_boiled', 'adieu'] as const;
export type AbilityKind = (typeof ABILITY_KINDS)[number];

/** Deceive Inc.'s four agent archetypes (flavor; only the three above are playable in v1). */
export const AGENT_ROLES = ['vanguard', 'tracker', 'scoundrel', 'disruptor'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AgentSchema = z.object({
  id: z.enum(AGENT_IDS),
  name: z.string().min(1),
  role: z.enum(AGENT_ROLES),
  /** Flavor name of the primary weapon (no distinct weapon mechanics in the greybox yet). */
  weapon: z.string().min(1),
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
    ability: 'adieu',
    abilityName: 'Adieu',
    abilityDurationMs: 6000,
    abilityCooldownMs: 25000,
    passive: 'Merci beaucoup!',
    description:
      'A cat-burglar scoundrel. Adieu cloaks him — unseen and untouchable — to slip past rivals or steal the package.',
  },
];

/** O(1) lookup of an agent by id. */
export const AGENTS_BY_ID: Record<AgentId, Agent> = {
  squire: ROSTER[0]!,
  chavez: ROSTER[1]!,
  larcin: ROSTER[2]!,
};

/** The Expertise kind a given agent triggers. */
export function agentAbility(id: AgentId): AbilityKind {
  return AGENTS_BY_ID[id].ability;
}

/** Assign an agent by join order (round-robin across the roster). Deterministic. */
export function agentForJoinIndex(joinIndex: number): AgentId {
  const id = AGENT_IDS[((joinIndex % AGENT_IDS.length) + AGENT_IDS.length) % AGENT_IDS.length];
  return id ?? 'squire';
}
