import { describe, expect, it } from 'vitest';
import { ABILITY_KINDS, AGENTS_BY_ID, AGENT_IDS } from '@deceive/shared';
import { auraForAbility, formatMs } from './AgentStage';

describe('auraForAbility', () => {
  it('maps each signature Expertise to its aura look', () => {
    expect(auraForAbility('eyes_on_prize')).toBe('eyes');
    expect(auraForAbility('hard_boiled')).toBe('invuln');
    expect(auraForAbility('adieu')).toBe('cloak');
  });

  it('covers every ability kind in the roster (no missing case)', () => {
    for (const k of ABILITY_KINDS) {
      expect(['eyes', 'invuln', 'cloak']).toContain(auraForAbility(k));
    }
  });

  it('resolves an aura for every shipped agent', () => {
    for (const id of AGENT_IDS) {
      expect(['eyes', 'invuln', 'cloak']).toContain(auraForAbility(AGENTS_BY_ID[id].ability));
    }
  });
});

describe('formatMs', () => {
  it('renders milliseconds as one-decimal seconds', () => {
    expect(formatMs(16000)).toBe('16.0s');
    expect(formatMs(6000)).toBe('6.0s');
    expect(formatMs(520)).toBe('0.5s');
    expect(formatMs(0)).toBe('0.0s');
  });
});
