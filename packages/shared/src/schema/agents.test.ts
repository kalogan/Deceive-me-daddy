import { describe, expect, it } from 'vitest';
import {
  ABILITY_KINDS,
  AGENT_IDS,
  AGENTS_BY_ID,
  AgentSchema,
  GADGET_KINDS,
  ROSTER,
  agentForJoinIndex,
} from './agents';

describe('agent roster', () => {
  it('ships the expected number of agents', () => {
    expect(AGENT_IDS).toHaveLength(8);
    expect(ROSTER).toHaveLength(AGENT_IDS.length);
  });

  it('has exactly one ROSTER entry per AGENT_IDS id', () => {
    for (const id of AGENT_IDS) {
      const matches = ROSTER.filter((a) => a.id === id);
      expect(matches).toHaveLength(1);
    }
    // and no stray roster entries beyond the declared ids
    for (const a of ROSTER) {
      expect(AGENT_IDS).toContain(a.id);
    }
  });

  it('resolves AGENTS_BY_ID[id].id === id for every id', () => {
    for (const id of AGENT_IDS) {
      expect(AGENTS_BY_ID[id]).toBeDefined();
      expect(AGENTS_BY_ID[id].id).toBe(id);
    }
  });

  it('parses every roster entry via AgentSchema', () => {
    for (const a of ROSTER) {
      expect(() => AgentSchema.parse(a)).not.toThrow();
    }
  });

  it('only references ability + gadget kinds the sim/VFX can handle', () => {
    for (const a of ROSTER) {
      expect(ABILITY_KINDS).toContain(a.ability);
      expect(GADGET_KINDS).toContain(a.gadget.kind);
    }
  });

  it('round-robins agentForJoinIndex across the whole roster', () => {
    for (let i = 0; i < AGENT_IDS.length * 2; i++) {
      expect(agentForJoinIndex(i)).toBe(AGENT_IDS[i % AGENT_IDS.length]);
    }
  });
});
