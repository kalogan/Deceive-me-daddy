import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type ArtProp } from './props';
import {
  STATION_ACCENT,
  STATION_FLOOR,
  STATION_PILLAR,
  STATION_TRIM,
  STATION_WALL,
  buildArrivalsPillar,
  buildBench,
  buildDepartureBoard,
  buildLuggageCart,
  buildPillarClock,
  buildPlatformCanopy,
  buildPlatformStripe,
  buildTicketGate,
  buildTrainCar,
  buildVendingMachine,
} from './stationProps';

// Every station builder, keyed by name so the suite can sweep them uniformly.
const builders: Record<string, () => ArtProp> = {
  buildBench,
  buildDepartureBoard,
  buildTicketGate,
  buildPlatformCanopy,
  buildLuggageCart,
  buildPillarClock,
  buildTrainCar,
  buildPlatformStripe,
  buildVendingMachine,
  buildArrivalsPillar,
};

describe('station palette', () => {
  it('exports every constant as a number', () => {
    for (const c of [STATION_FLOOR, STATION_WALL, STATION_PILLAR, STATION_ACCENT, STATION_TRIM]) {
      expect(typeof c).toBe('number');
    }
  });

  it('uses a warm amber for the signage accent', () => {
    expect(STATION_ACCENT).toBe(0xffb13c);
  });
});

describe('station builders', () => {
  for (const [name, build] of Object.entries(builders)) {
    describe(name, () => {
      it('returns a populated THREE.Group', () => {
        const prop = build();
        expect(prop.group).toBeInstanceOf(THREE.Object3D);
        expect(prop.group.children.length).toBeGreaterThan(0);
        prop.dispose();
      });

      it('owns a non-empty materials array', () => {
        const prop = build();
        expect(Array.isArray(prop.materials)).toBe(true);
        expect(prop.materials.length).toBeGreaterThan(0);
        for (const m of prop.materials) {
          expect(m).toBeInstanceOf(THREE.MeshStandardMaterial);
        }
        prop.dispose();
      });

      it('disposes without throwing', () => {
        const prop = build();
        expect(() => {
          prop.dispose();
        }).not.toThrow();
      });
    });
  }
});
