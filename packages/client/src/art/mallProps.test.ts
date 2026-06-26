import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ArtProp } from './props';
import {
  MALL_ACCENT,
  MALL_FLOOR,
  MALL_GLASS,
  MALL_PILLAR,
  MALL_WALL,
  buildBalconyRail,
  buildBenchSeat,
  buildDirectory,
  buildEscalator,
  buildFoodCourtSet,
  buildFountain,
  buildHangingBanner,
  buildKiosk,
  buildMallPlanter,
  buildStorefront,
} from './mallProps';

// DOM-free / Node-friendly: builders are pure geometry assembly, no renderer needed.

const builders: Array<readonly [string, () => ArtProp]> = [
  ['buildStorefront', () => buildStorefront()],
  ['buildEscalator', () => buildEscalator()],
  ['buildFountain', () => buildFountain()],
  ['buildFoodCourtSet', () => buildFoodCourtSet()],
  ['buildMallPlanter', () => buildMallPlanter()],
  ['buildDirectory', () => buildDirectory()],
  ['buildKiosk', () => buildKiosk()],
  ['buildBalconyRail', () => buildBalconyRail()],
  ['buildHangingBanner', () => buildHangingBanner()],
  ['buildBenchSeat', () => buildBenchSeat()],
];

describe('mall palette', () => {
  it('exports every palette constant as a number', () => {
    for (const c of [MALL_FLOOR, MALL_WALL, MALL_PILLAR, MALL_ACCENT, MALL_GLASS]) {
      expect(typeof c).toBe('number');
    }
  });
});

describe('mall prop builders', () => {
  for (const [name, build] of builders) {
    describe(name, () => {
      it('returns a group (Object3D with children), owned materials, and a dispose()', () => {
        const prop = build();
        expect(prop.group).toBeInstanceOf(THREE.Object3D);
        expect(prop.group.children.length).toBeGreaterThan(0);
        expect(Array.isArray(prop.materials)).toBe(true);
        expect(prop.materials.length).toBeGreaterThan(0);
        for (const m of prop.materials) {
          expect(m).toBeInstanceOf(THREE.MeshStandardMaterial);
        }
        expect(typeof prop.dispose).toBe('function');
        prop.dispose();
      });

      it('dispose() runs without throwing', () => {
        const prop = build();
        expect(() => prop.dispose()).not.toThrow();
      });
    });
  }

  it('honours custom parameters without throwing', () => {
    const variants = [
      buildStorefront(7, MALL_ACCENT),
      buildFountain(3),
      buildFoodCourtSet(MALL_GLASS),
      buildMallPlanter(4),
      buildKiosk(MALL_GLASS),
      buildBalconyRail(6),
      buildHangingBanner(3, MALL_GLASS),
    ];
    for (const prop of variants) {
      expect(prop.group.children.length).toBeGreaterThan(0);
      prop.dispose();
    }
  });
});
