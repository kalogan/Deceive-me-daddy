// Unit tests for the results screen's one PURE seam: `resultText`, the (localTeam, winningTeam)
// → headline + sub mapping. The ResultsScreen CLASS itself is browser-only (it touches the DOM)
// and is deliberately NOT imported here — these tests stay DOM-free so they run under the Node
// gate, exactly like the rest of the suite (cf. menu.test.ts / hudModel.test.ts).
import { describe, expect, it } from 'vitest';
import { resultText } from './ResultsScreen';

describe('resultText', () => {
  it("reads VICTORY when the local player's team is the winning team", () => {
    expect(resultText(1, 1)).toEqual({
      headline: 'VICTORY',
      sub: 'Team 1 extracted the package',
    });
  });

  it("reads DEFEAT when another team extracted", () => {
    expect(resultText(1, 2)).toEqual({
      headline: 'DEFEAT',
      sub: 'Team 2 extracted the package',
    });
  });

  it('names the WINNING team in the sub-line regardless of who the local player is', () => {
    // The flavour line always describes the extractor, not the local team.
    expect(resultText(0, 3).sub).toBe('Team 3 extracted the package');
    expect(resultText(5, 3).sub).toBe('Team 3 extracted the package');
  });

  it('treats team 0 as a real team (no falsy-zero surprises)', () => {
    expect(resultText(0, 0).headline).toBe('VICTORY');
    expect(resultText(0, 1).headline).toBe('DEFEAT');
    expect(resultText(1, 0).headline).toBe('DEFEAT');
  });

  it('only ever returns the two literal headlines', () => {
    for (const local of [0, 1, 2, 3]) {
      for (const winner of [0, 1, 2, 3]) {
        const { headline } = resultText(local, winner);
        expect(headline === 'VICTORY' || headline === 'DEFEAT').toBe(true);
        expect(headline).toBe(local === winner ? 'VICTORY' : 'DEFEAT');
      }
    }
  });
});
