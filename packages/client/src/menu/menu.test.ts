// Unit tests for the menu's one PURE seam: `connectOptionsFor`, the choice → connect-options
// mapping main.ts threads into source selection. The Menu CLASS itself is browser-only (it
// touches the DOM + AudioEngine) and is deliberately NOT imported here — these tests stay
// DOM-free so they run under the Node gate, exactly like the rest of the suite.
import { describe, expect, it } from 'vitest';
import { AGENT_IDS } from '@deceive/shared';
import { connectOptionsFor, type MenuChoice } from './Menu';

describe('connectOptionsFor', () => {
  it('maps a solo Quick Play choice to create-vs-join solo options', () => {
    const choice: MenuChoice = { mode: 'solo', agent: 'squire' };
    expect(connectOptionsFor(choice)).toEqual({ mode: 'solo', agent: 'squire' });
  });

  it('maps an online multiplayer choice to multiplayer options', () => {
    const choice: MenuChoice = { mode: 'multiplayer', agent: 'larcin' };
    expect(connectOptionsFor(choice)).toEqual({ mode: 'multiplayer', agent: 'larcin' });
  });

  it('carries every playable agent through unchanged', () => {
    for (const agent of AGENT_IDS) {
      const opts = connectOptionsFor({ mode: 'solo', agent });
      expect(opts.agent).toBe(agent);
      expect(opts.mode).toBe('solo');
    }
  });

  it('returns a fresh object (no aliasing of the input choice)', () => {
    const choice: MenuChoice = { mode: 'multiplayer', agent: 'chavez' };
    const opts = connectOptionsFor(choice);
    expect(opts).not.toBe(choice);
  });
});
