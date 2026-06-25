// Playable agents (PROJECT_BRIEF §2): 3 agents, each a shared base kit + ONE signature
// gadget. Identities/gadget choices are a review-queue item — these are placeholders to
// build the FIRST against, judge, then replicate (never mass-produce before judged good).
import { z } from 'zod';

export const GADGET_KINDS = ['teleport', 'trap_mine', 'reveal_pulse'] as const;
export type GadgetKind = (typeof GADGET_KINDS)[number];

export const AgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  gadget: z.enum(GADGET_KINDS),
  gadgetCooldownMs: z.number().int().positive(),
  description: z.string().min(1),
});
export type Agent = z.infer<typeof AgentSchema>;

export const ROSTER: readonly Agent[] = [
  {
    id: 'blink',
    name: 'Blink',
    gadget: 'teleport',
    gadgetCooldownMs: 12000,
    description: 'Short-range teleport to break line of sight or reach a stolen disguise.',
  },
  {
    id: 'snare',
    name: 'Snare',
    gadget: 'trap_mine',
    gadgetCooldownMs: 15000,
    description: 'Places a proximity trap that reveals and slows whoever trips it.',
  },
  {
    id: 'oracle',
    name: 'Oracle',
    gadget: 'reveal_pulse',
    gadgetCooldownMs: 18000,
    description: 'Emits a pulse that briefly flags suspicious agents in range.',
  },
];
