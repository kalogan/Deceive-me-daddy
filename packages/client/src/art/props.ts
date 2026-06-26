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
export const ACCENT_CYAN = 0x33d6e6;

// Theme accent palette — used by the new themed set-dressing builders so MapView and the
// gallery share one source of truth for "what facility/neon look like".
export const HAZARD_GOLD = 0xffc21f; // facility vault hazard stripes
export const HAZARD_DARK = 0x1c1d22; // the dark band between hazard stripes
export const NEON_MAGENTA = 0xff2fb0; // neon club primary accent
export const NEON_CYAN = 0x2ff0ff; // neon club secondary accent
export const NEON_PURPLE = 0x6a2bd8; // neon club deep-violet glow
export const BAR_AMBER = 0xffaa3c; // warm bar / bottle glow

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

  /** A thin emissive panel/strip — no shadow casting (cheap glowing trim). */
  glowBox(
    w: number,
    h: number,
    d: number,
    color: number,
    intensity: number,
    opts: THREE.MeshStandardMaterialParameters = {},
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: intensity,
      roughness: 0.35,
      ...opts,
    });
    this.geos.push(geo);
    this.mats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);
    return mesh;
  }

  /** Adopt an externally-built material so the prop owns + disposes it (and the gallery can tag it). */
  own(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    this.mats.push(mat);
    return mat;
  }

  /** Adopt an externally-built geometry so the prop disposes it. */
  ownGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.geos.push(geo);
    return geo;
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

/** Set-dressing: a server rack — a dark cabinet with a column of blinking indicator lights. */
export function buildServerRack(cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  b.box(0.62, 1.8, 0.5, 0x23262e, { roughness: 0.8, metalness: 0.3 }).position.set(0, 0.9, 0);
  // A vertical strip of small emissive lights down the front (alternating cyan/amber/green).
  const lights = [ACCENT_CYAN, 0xffb23f, 0x4fe08a];
  for (let i = 0; i < 6; i += 1) {
    const c = lights[i % lights.length] ?? ACCENT_CYAN;
    const led = b.box(0.08, 0.06, 0.03, c, { emissive: c, emissiveIntensity: cfg.glow * 1.1 });
    led.position.set(-0.18, 0.5 + i * 0.22, 0.26);
  }
  return b.finish();
}

/** Set-dressing: a planter — a low box with a cluster of soft low-poly foliage. */
export function buildPlanter(): ArtProp {
  const b = new Builder();
  b.box(0.7, 0.45, 0.7, 0x4a4138, { roughness: 0.9 }).position.set(0, 0.225, 0);
  const leaf = (w: number, h: number, d: number, x: number, y: number, z: number): void => {
    b.box(w, h, d, 0x3f8a52, { roughness: 0.85 }).position.set(x, y, z);
  };
  leaf(0.5, 0.5, 0.5, 0, 0.72, 0);
  leaf(0.34, 0.4, 0.34, 0.18, 0.95, 0.1);
  leaf(0.32, 0.36, 0.32, -0.16, 0.92, -0.12);
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

// ===========================================================================================
// FACILITY (research_facility) set-dressing — clean modern spy-HQ kit.
// ===========================================================================================

/** A lab bench / workstation: a steel-topped desk with a small glowing cyan monitor on it. */
export function buildLabBench(cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  // Worktop + two leg blocks.
  b.box(2.0, 0.1, 0.9, 0xc6ccd6, { roughness: 0.45, metalness: 0.35 }).position.set(0, 0.92, 0);
  b.box(0.12, 0.92, 0.8, 0x4a4f5b, { roughness: 0.7 }).position.set(-0.9, 0.46, 0);
  b.box(0.12, 0.92, 0.8, 0x4a4f5b, { roughness: 0.7 }).position.set(0.9, 0.46, 0);
  // A low cabinet under the bench.
  b.box(1.0, 0.5, 0.7, PROP_BODY_COLOR, { roughness: 0.8 }).position.set(0.4, 0.27, 0);
  // Desktop monitor (glowing cyan screen on a stalk).
  b.box(0.06, 0.18, 0.06, 0x2a2d35, { roughness: 0.6 }).position.set(-0.45, 1.07, -0.05);
  const screen = b.box(0.7, 0.42, 0.05, ACCENT_CYAN, {
    emissive: ACCENT_CYAN,
    emissiveIntensity: cfg.glow * 1.1,
    roughness: 0.4,
  });
  screen.position.set(-0.45, 1.32, -0.05);
  return b.finish();
}

/** A semi-transparent glass partition panel in a steel frame (an office divider). */
export function buildGlassPartition(width = 3.0, height = 2.4): ArtProp {
  const b = new Builder();
  const frame = 0x6a7280;
  // Frame: two posts + top & bottom rails.
  b.box(0.1, height, 0.1, frame, { roughness: 0.5, metalness: 0.4 }).position.set(-width / 2, height / 2, 0);
  b.box(0.1, height, 0.1, frame, { roughness: 0.5, metalness: 0.4 }).position.set(width / 2, height / 2, 0);
  b.box(width, 0.1, 0.1, frame, { roughness: 0.5, metalness: 0.4 }).position.set(0, height - 0.05, 0);
  b.box(width, 0.1, 0.1, frame, { roughness: 0.5, metalness: 0.4 }).position.set(0, 0.05, 0);
  // The glass pane — its own translucent material (not the body colour).
  const glassGeo = b.ownGeo(new THREE.BoxGeometry(width - 0.12, height - 0.16, 0.04));
  const glass = b.own(
    new THREE.MeshStandardMaterial({
      color: 0xaee6f2,
      roughness: 0.08,
      metalness: 0.0,
      transparent: true,
      opacity: 0.22,
    }),
  );
  const pane = new THREE.Mesh(glassGeo, glass);
  pane.position.set(0, height / 2, 0);
  b.group.add(pane);
  return b.finish();
}

/** A wall-mounted monitor / display panel with a subtle emissive face. */
export function buildWallMonitor(color = ACCENT_CYAN, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  b.box(1.5, 0.9, 0.08, 0x1b1d23, { roughness: 0.5 }).position.set(0, 0, 0);
  const screen = b.box(1.34, 0.74, 0.04, color, {
    emissive: color,
    emissiveIntensity: cfg.glow * 0.85,
    roughness: 0.4,
  });
  screen.position.set(0, 0, 0.05);
  return b.finish();
}

/** A ceiling duct / pipe run: a boxy duct with two round pipes alongside (one merged mesh). */
export function buildCeilingDuct(length = 8): ArtProp {
  const b = new Builder();
  b.box(0.6, 0.5, length, 0x5a606c, { roughness: 0.65, metalness: 0.4 }).position.set(0, 0, 0);
  // Two pipes flanking the duct.
  const pipeGeo = b.ownGeo(new THREE.CylinderGeometry(0.12, 0.12, length, 10));
  const pipeMat = b.own(new THREE.MeshStandardMaterial({ color: 0x767c88, roughness: 0.5, metalness: 0.5 }));
  for (const dx of [-0.5, 0.5]) {
    const p = new THREE.Mesh(pipeGeo, pipeMat);
    p.rotation.x = Math.PI / 2;
    p.position.set(dx, -0.05, 0);
    b.group.add(p);
  }
  return b.finish();
}

/** A hazard stripe accent panel (yellow/black diagonal-feel bars) for high-clearance zones. */
export function buildHazardStripe(length = 4, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  // Dark backing bar.
  b.box(length, 0.4, 0.12, HAZARD_DARK, { roughness: 0.85 }).position.set(0, 0.2, 0);
  // Slanted gold bars across it.
  const n = Math.max(2, Math.round(length / 0.7));
  const barW = 0.32;
  for (let i = 0; i < n; i += 1) {
    const x = -length / 2 + (i + 0.5) * (length / n);
    const bar = b.glowBox(barW, 0.34, 0.14, HAZARD_GOLD, cfg.glow * 0.5, { roughness: 0.5 });
    bar.position.set(x, 0.2, 0.01);
    bar.rotation.z = 0.5;
  }
  return b.finish();
}

// ===========================================================================================
// NEON (nightclub) set-dressing — synthwave club kit, emissive-heavy for the bloom pass.
// ===========================================================================================

/**
 * A glowing dancefloor: a checkerboard of emissive magenta/cyan tiles, built as TWO merged
 * meshes (one per colour) so a whole floor is just two draw calls. Static (no per-frame
 * contract exists in MapView) but high-contrast under bloom.
 */
export function buildDancefloor(width: number, depth: number, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  const tile = 2.2;
  const nx = Math.max(2, Math.floor(width / tile));
  const nz = Math.max(2, Math.floor(depth / tile));
  const cellW = width / nx;
  const cellD = depth / nz;
  const aGeos: THREE.BufferGeometry[] = [];
  const bGeos: THREE.BufferGeometry[] = [];
  for (let ix = 0; ix < nx; ix += 1) {
    for (let iz = 0; iz < nz; iz += 1) {
      const px = -width / 2 + (ix + 0.5) * cellW;
      const pz = -depth / 2 + (iz + 0.5) * cellD;
      const g = new THREE.BoxGeometry(cellW * 0.92, 0.06, cellD * 0.92);
      g.translate(px, 0, pz);
      ((ix + iz) % 2 === 0 ? aGeos : bGeos).push(g);
    }
  }
  const mergedA = mergeGeometries(aGeos, false);
  const mergedB = mergeGeometries(bGeos, false);
  for (const g of aGeos) g.dispose();
  for (const g of bGeos) g.dispose();
  b.mesh(mergedA, NEON_MAGENTA, {
    emissive: NEON_MAGENTA,
    emissiveIntensity: cfg.glow * 1.1,
    roughness: 0.3,
  }).castShadow = false;
  b.mesh(mergedB, NEON_CYAN, {
    emissive: NEON_CYAN,
    emissiveIntensity: cfg.glow * 1.1,
    roughness: 0.3,
  }).castShadow = false;
  return b.finish();
}

/** A straight neon light strip (emissive bar) — magenta or cyan club trim. */
export function buildNeonStrip(length: number, color = NEON_MAGENTA, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  b.glowBox(length, 0.14, 0.1, color, cfg.glow * 1.3, { roughness: 0.3 });
  return b.finish();
}

/** A glowing neon sign: a stack of emissive bars (a letters-suggestion) over a dark backer. */
export function buildNeonSign(cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  b.box(2.6, 1.1, 0.12, 0x121017, { roughness: 0.8 }).position.set(0, 0, 0);
  // A few emissive bars arranged to read as glowing signage strokes.
  const strokes: Array<[number, number, number, number, number]> = [
    // x, y, w, h, colorIndex
    [-0.9, 0.25, 0.16, 0.7, 0],
    [-0.55, 0.25, 0.16, 0.7, 0],
    [-0.72, 0.05, 0.5, 0.16, 0],
    [-0.05, 0.2, 0.7, 0.16, 1],
    [0.35, 0.0, 0.16, 0.8, 1],
    [0.75, -0.25, 0.7, 0.16, 0],
  ];
  const cols = [NEON_MAGENTA, NEON_CYAN];
  for (const [x, y, w, h, ci] of strokes) {
    const c = cols[ci] ?? NEON_MAGENTA;
    b.glowBox(w, h, 0.08, c, cfg.glow * 1.4).position.set(x, y, 0.08);
  }
  return b.finish();
}

/** A bar counter: a long dark counter with a glowing amber back-shelf + a row of bottles. */
export function buildBarCounter(length = 5, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  // Counter body + top.
  b.box(length, 1.1, 0.9, 0x17121d, { roughness: 0.5, metalness: 0.2 }).position.set(0, 0.55, 0);
  b.box(length + 0.1, 0.1, 1.0, 0x2a2030, { roughness: 0.3, metalness: 0.3 }).position.set(0, 1.13, 0);
  // A glowing amber light strip along the counter front (under-bar glow).
  b.glowBox(length * 0.96, 0.08, 0.06, BAR_AMBER, cfg.glow * 1.2).position.set(0, 0.2, 0.46);
  // Back shelf (behind the counter) lit amber, with a row of bottles.
  b.box(length, 1.4, 0.25, 0x140f18, { roughness: 0.7 }).position.set(0, 0.7, -0.7);
  b.glowBox(length * 0.95, 0.06, 0.2, BAR_AMBER, cfg.glow * 1.0).position.set(0, 0.65, -0.6);
  const bottleGeo = b.ownGeo(new THREE.CylinderGeometry(0.07, 0.09, 0.5, 8));
  const bottleCols = [NEON_CYAN, NEON_MAGENTA, BAR_AMBER, 0x6fe08a];
  const count = Math.max(3, Math.floor(length / 0.6));
  for (let i = 0; i < count; i += 1) {
    const x = -length / 2 + (i + 0.5) * (length / count);
    const c = bottleCols[i % bottleCols.length] ?? BAR_AMBER;
    const bottleMat = b.own(
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: cfg.glow * 0.5, roughness: 0.3 }),
    );
    const m = new THREE.Mesh(bottleGeo, bottleMat);
    m.position.set(x, 1.0, -0.62);
    b.group.add(m);
  }
  return b.finish();
}

/** A speaker stack: two dark cabinets with magenta-lit cones (PA tower). */
export function buildSpeakerStack(cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  const coneGeo = b.ownGeo(new THREE.CylinderGeometry(0.28, 0.36, 0.12, 14));
  const coneMat = b.own(
    new THREE.MeshStandardMaterial({
      color: NEON_MAGENTA,
      emissive: NEON_MAGENTA,
      emissiveIntensity: cfg.glow * 0.7,
      roughness: 0.5,
    }),
  );
  for (let i = 0; i < 2; i += 1) {
    const y = 0.6 + i * 1.15;
    b.box(0.9, 1.1, 0.8, 0x0e0e14, { roughness: 0.8 }).position.set(0, y, 0);
    // Two cones per cabinet, facing +Z.
    for (const dy of [0.22, -0.22]) {
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.rotation.x = Math.PI / 2;
      cone.position.set(0, y + dy, 0.42);
      b.group.add(cone);
    }
  }
  return b.finish();
}

/** A DJ booth: an angled console deck with a glowing cyan face + magenta trim. */
export function buildDjBooth(cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  // Booth body (wide, slightly back-leaning facade).
  b.box(3.2, 1.2, 1.2, 0x140f1c, { roughness: 0.6 }).position.set(0, 0.6, 0);
  // Glowing front facade.
  const face = b.glowBox(3.0, 0.9, 0.08, NEON_CYAN, cfg.glow * 1.2);
  face.position.set(0, 0.65, 0.62);
  // Magenta trim strip along the top edge.
  b.glowBox(3.2, 0.08, 1.2, NEON_MAGENTA, cfg.glow * 1.1).position.set(0, 1.22, 0);
  // The deck top with two "turntable" discs.
  b.box(3.0, 0.1, 1.0, 0x0c0a12, { roughness: 0.5 }).position.set(0, 1.26, 0);
  const discGeo = b.ownGeo(new THREE.CylinderGeometry(0.36, 0.36, 0.06, 18));
  const discMat = b.own(
    new THREE.MeshStandardMaterial({ color: NEON_MAGENTA, emissive: NEON_MAGENTA, emissiveIntensity: cfg.glow * 0.6, roughness: 0.4 }),
  );
  for (const dx of [-0.8, 0.8]) {
    const d = new THREE.Mesh(discGeo, discMat);
    d.position.set(dx, 1.33, 0);
    b.group.add(d);
  }
  return b.finish();
}

/** A hanging par-can / spotlight: a small dark housing with a glowing coloured lens. */
export function buildSpotLight(color = NEON_MAGENTA, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  // Short drop-stem so it reads as hanging from the rig.
  b.box(0.05, 0.5, 0.05, 0x222228, { roughness: 0.7 }).position.set(0, 0.25, 0);
  b.cylinder(0.16, 0.3, 0x141418, { roughness: 0.6 }).position.set(0, -0.05, 0);
  const lensGeo = b.ownGeo(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 16));
  const lensMat = b.own(
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: cfg.glow * 1.5, roughness: 0.3 }),
  );
  const lens = new THREE.Mesh(lensGeo, lensMat);
  lens.position.set(0, -0.21, 0);
  b.group.add(lens);
  return b.finish();
}

/** A velvet-rope post: a chrome stanchion with a glowing magenta rope ring on top. */
export function buildVelvetRope(cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  b.cylinder(0.18, 0.06, 0x2a2a30, { roughness: 0.4, metalness: 0.6 }).position.set(0, 0.03, 0);
  b.cylinder(0.05, 0.95, 0xb9bcc4, { roughness: 0.25, metalness: 0.85 }).position.set(0, 0.5, 0);
  // The rope ring / ball cap, glowing magenta.
  const cap = b.box(0.16, 0.16, 0.16, NEON_MAGENTA, {
    emissive: NEON_MAGENTA,
    emissiveIntensity: cfg.glow * 0.9,
    roughness: 0.4,
  });
  cap.position.set(0, 1.0, 0);
  return b.finish();
}
