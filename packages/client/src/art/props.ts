// Reusable art-asset builders (the "procedural art engine" prop kit). Each returns an
// ArtProp — a self-contained THREE.Group plus the materials it owns (so a config UI can
// recolour / retune them live) and a dispose() that frees its geometries + materials.
//
// SINGLE SOURCE OF TRUTH (PROJECT_BRIEF §4.5): both the in-game MapView/PackageView AND the
// preview asset gallery build their props from THESE functions — never a forked copy — so
// what you tweak in the preview is exactly what ships.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A built art asset: its group, the materials it owns (for live recolour), and disposal. */
export interface ArtProp {
  group: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  dispose(): void;
}

/** Neutral cabinet/stand colour shared by the props. */
export const PROP_BODY_COLOR = 0x3a3d48;
export const OBJECTIVE_GOLD = 0xffcf3f;
export const INTEL_PINK = 0xff7fd0;

/** Tunable knobs a config UI can pass in (defaults reproduce the shipping look). */
export interface PropConfig {
  /** Emissive strength of the glowing accents (screens, cards, rings). */
  glow: number;
}
export const DEFAULT_PROP_CONFIG: PropConfig = { glow: 0.6 };

/** Small accumulator so each builder tracks its geometries/materials for disposal. */
class Builder {
  readonly group = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[] = [];
  readonly mats: THREE.MeshStandardMaterial[] = [];

  box(
    w: number,
    h: number,
    d: number,
    color: number,
    opts: THREE.MeshStandardMaterialParameters = {},
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });
    this.geos.push(geo);
    this.mats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  cylinder(
    radius: number,
    height: number,
    color: number,
    opts: THREE.MeshStandardMaterialParameters = {},
  ): THREE.Mesh {
    const geo = new THREE.CylinderGeometry(radius, radius, height, 20);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });
    this.geos.push(geo);
    this.mats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  /** Add a pre-built (e.g. merged) geometry under a tracked material. */
  mesh(geo: THREE.BufferGeometry, color: number, opts: THREE.MeshStandardMaterialParameters = {}): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });
    this.geos.push(geo);
    this.mats.push(mat);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    this.group.add(m);
    return m;
  }

  finish(): ArtProp {
    const geos = this.geos;
    const mats = this.mats;
    return {
      group: this.group,
      materials: mats,
      dispose: () => {
        for (const g of geos) g.dispose();
        for (const m of mats) m.dispose();
      },
    };
  }
}

/** A door as a passage frame: two posts + a lintel, tier-coloured (hotter when special). */
export function buildDoorFrame(color: number, special: boolean, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  const postH = 2.4;
  const postT = 0.26;
  const gap = 1.4;
  const opts = { emissive: color, emissiveIntensity: special ? cfg.glow : cfg.glow * 0.36, roughness: 0.5 };
  const post = (dx: number): void => {
    b.box(postT, postH, postT, color, opts).position.set(dx, postH / 2, 0);
  };
  post(-gap / 2);
  post(gap / 2);
  b.box(gap + postT, postT, postT, color, opts).position.set(0, postH, 0);
  return b.finish();
}

/** An intel node as a console cabinet with a glowing, tilted screen. */
export function buildTerminal(cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  b.box(0.55, 0.95, 0.4, PROP_BODY_COLOR, { roughness: 0.85 }).position.set(0, 0.475, 0);
  const screen = b.box(0.5, 0.42, 0.06, INTEL_PINK, {
    emissive: INTEL_PINK,
    emissiveIntensity: cfg.glow * 1.17,
    roughness: 0.4,
  });
  screen.position.set(0, 0.95, 0.16);
  screen.rotation.x = -0.35;
  return b.finish();
}

/** A keycard pickup: a glowing tier-coloured card propped in a small reader stand. */
export function buildKeycardReader(color: number, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  b.box(0.3, 0.5, 0.24, PROP_BODY_COLOR, { roughness: 0.85 }).position.set(0, 0.25, 0);
  const card = b.box(0.46, 0.3, 0.04, color, {
    emissive: color,
    emissiveIntensity: cfg.glow * 0.92,
    roughness: 0.4,
  });
  card.position.set(0, 0.78, 0);
  card.rotation.x = -0.25;
  return b.finish();
}

/** The vault: a pedestal + a glowing gold ring (the package rests here until grabbed). */
export function buildVaultPodium(cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  b.cylinder(0.7, 0.35, PROP_BODY_COLOR, { roughness: 0.8 }).position.set(0, 0.175, 0);
  b.cylinder(0.5, 0.08, OBJECTIVE_GOLD, {
    emissive: OBJECTIVE_GOLD,
    emissiveIntensity: cfg.glow * 0.83,
  }).position.set(0, 0.38, 0);
  return b.finish();
}

/** The objective package: a glowing briefcase (flattened body + a handle), one merged mesh. */
export function buildBriefcase(size = 0.7, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  const bw = size;
  const bh = size * 0.62;
  const bd = size * 0.34;
  const box = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.BoxGeometry => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  };
  const merged = mergeGeometries(
    [
      box(bw, bh, bd, 0, 0, 0),
      box(0.05, 0.16, 0.05, -0.16, bh / 2 + 0.08, 0),
      box(0.05, 0.16, 0.05, 0.16, bh / 2 + 0.08, 0),
      box(0.37, 0.05, 0.05, 0, bh / 2 + 0.16, 0),
      box(bw + 0.02, 0.05, bd + 0.02, 0, 0, 0),
    ],
    false,
  );
  b.mesh(merged, OBJECTIVE_GOLD, {
    emissive: OBJECTIVE_GOLD,
    emissiveIntensity: cfg.glow * 0.92,
    roughness: 0.4,
    metalness: 0.2,
  });
  return b.finish();
}
