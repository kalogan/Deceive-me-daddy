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

// Beach palette — sunny, warm, outdoor. Shared by the beach set-dressing builders so MapView
// and the gallery agree on "what the beach looks like".
export const BEACH_SAND = 0xe8d9a8; // sandy / tan floor
export const BEACH_WOOD = 0xc9a16b; // light boardwalk wood
export const BEACH_CABANA = 0xf4efe2; // white / cream cabana fabric
export const BEACH_TEAL = 0x35c5c0; // teal / aqua umbrella + water accent
export const BEACH_CORAL = 0xff7a59; // warm coral accent
export const BEACH_OCEAN = 0x2b9fd6; // sea blue

/** Tunable knobs a config UI can pass in (defaults reproduce the shipping look). */
export interface PropConfig {
  /** Emissive strength of the glowing accents (screens, cards, rings). */
  glow: number;
}
export const DEFAULT_PROP_CONFIG: PropConfig = { glow: 0.6 };

/** Small accumulator so each builder tracks its geometries/materials for disposal. Exported so
 *  themed set-dressing modules (e.g. art/stationProps, art/mallProps) reuse the SAME accumulator +
 *  disposal contract instead of forking it. */
export class Builder {
  readonly group = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[] = [];
  readonly mats: THREE.MeshStandardMaterial[] = [];
  // InstancedMeshes hold their own GPU instance buffer, freed explicitly on dispose.
  private readonly instances: THREE.InstancedMesh[] = [];

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

  /**
   * An InstancedMesh of `count` copies of one geometry under one material — the cheap way to
   * place MANY identical small parts (railing balusters, ring segments, floor tiles, leaves)
   * as a SINGLE draw call. The caller positions each instance via the returned mesh's
   * `setMatrixAt`. Geometry + material are tracked for disposal like any other.
   */
  instanced(
    geo: THREE.BufferGeometry,
    color: number,
    count: number,
    opts: THREE.MeshStandardMaterialParameters = {},
  ): THREE.InstancedMesh {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });
    this.geos.push(geo);
    this.mats.push(mat);
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.castShadow = true;
    this.instances.push(inst);
    this.group.add(inst);
    return inst;
  }

  finish(): ArtProp {
    const geos = this.geos;
    const mats = this.mats;
    const instances = this.instances;
    return {
      group: this.group,
      materials: mats,
      dispose: () => {
        for (const inst of instances) inst.dispose();
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

// ===========================================================================================
// QUALITY PASS 2 — shared kit: GREENERY, warm/practical FIXTURES, decorative PROPS,
// architectural RAILINGS + a hero DAIS, and thin emissive FLOOR DECALS. These read in BOTH
// themes (MapView tints / picks per theme) and appear in the preview Assets gallery.
// All STATIC (MapView has no per-frame tick) and emissive-led so the bloom pass sells them.
// ===========================================================================================

const FOLIAGE_GREEN = 0x3f9a55;
const FOLIAGE_DEEP = 0x2f7a44;
const TRUNK_BROWN = 0x6e5638;
const PLANTER_TERRACOTTA = 0x8a4a32;
const PLANTER_STONE = 0x9aa0ab;

/**
 * A tall potted PALM: a slim trunk in a planter pot crowned with a fan of angled fronds.
 * The fronds are one InstancedMesh (a single draw call) so a forest of palms stays cheap.
 * `height` scales the whole plant. The pot colour can be swapped (terracotta vs stone).
 */
export function buildPalm(height = 3.2, potColor = PLANTER_TERRACOTTA): ArtProp {
  const b = new Builder();
  const potH = height * 0.2;
  // Pot (slightly tapered) + soil cap.
  b.cylinder(height * 0.16, potH, potColor, { roughness: 0.85 }).position.set(0, potH / 2, 0);
  b.cylinder(height * 0.14, 0.05, 0x2a221c, { roughness: 0.95 }).position.set(0, potH + 0.02, 0);
  // Trunk.
  const trunkH = height * 0.62;
  b.cylinder(height * 0.05, trunkH, TRUNK_BROWN, { roughness: 0.9 }).position.set(0, potH + trunkH / 2, 0);
  // Crown of fronds as one InstancedMesh — flat tapered blades fanning out + drooping.
  const crownY = potH + trunkH;
  const frondCount = 9;
  const frondGeo = new THREE.BoxGeometry(0.16, 0.05, height * 0.5);
  frondGeo.translate(0, 0, height * 0.24); // pivot at the trunk end so it fans from the crown
  const fronds = b.instanced(frondGeo, FOLIAGE_GREEN, frondCount, { roughness: 0.8 });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  for (let i = 0; i < frondCount; i += 1) {
    const yaw = (i / frondCount) * Math.PI * 2;
    const droop = 0.5 + (i % 2) * 0.12; // alternate droop for a fuller crown
    e.set(droop, yaw, 0);
    q.setFromEuler(e);
    pos.set(0, crownY, 0);
    scl.set(1, 1, 0.8 + (i % 3) * 0.18);
    m.compose(pos, q, scl);
    fronds.setMatrixAt(i, m);
  }
  fronds.instanceMatrix.needsUpdate = true;
  return b.finish();
}

/**
 * A leafy MONSTERA / broadleaf bush in a low pot: a cluster of big flat angled leaves. The
 * leaves are one InstancedMesh. A compact, lush filler for corners and doorway flanks.
 */
export function buildMonstera(scale = 1): ArtProp {
  const b = new Builder();
  const potH = 0.4 * scale;
  b.cylinder(0.34 * scale, potH, PLANTER_STONE, { roughness: 0.8 }).position.set(0, potH / 2, 0);
  b.cylinder(0.3 * scale, 0.05, 0x2a221c, { roughness: 0.95 }).position.set(0, potH, 0);
  const leafCount = 11;
  const leafGeo = new THREE.BoxGeometry(0.5 * scale, 0.04, 0.7 * scale);
  leafGeo.translate(0, 0, 0.34 * scale);
  const leaves = b.instanced(leafGeo, FOLIAGE_DEEP, leafCount, { roughness: 0.75 });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < leafCount; i += 1) {
    const yaw = (i / leafCount) * Math.PI * 2 + (i % 2) * 0.4;
    const tilt = -0.7 - (i % 3) * 0.12;
    const y = potH + (0.5 + (i % 4) * 0.18) * scale;
    e.set(tilt, yaw, 0);
    q.setFromEuler(e);
    pos.set(0, y, 0);
    m.compose(pos, q, one);
    leaves.setMatrixAt(i, m);
  }
  leaves.instanceMatrix.needsUpdate = true;
  return b.finish();
}

/**
 * A big square PLANTER BOX with a dense low hedge of foliage cubes — a heavyweight greenery
 * filler for flanking a dais / lining a wall. `length` stretches it into a hedge run.
 */
export function buildPlanterBox(length = 2.2, planterColor = PLANTER_STONE): ArtProp {
  const b = new Builder();
  const boxH = 0.5;
  const depth = 0.7;
  b.box(length, boxH, depth, planterColor, { roughness: 0.85 }).position.set(0, boxH / 2, 0);
  // Soil.
  b.box(length - 0.12, 0.06, depth - 0.12, 0x2a221c, { roughness: 0.95 }).position.set(0, boxH, 0);
  // A row of rounded foliage clumps as one InstancedMesh.
  const n = Math.max(2, Math.round(length / 0.6));
  const clumpGeo = new THREE.IcosahedronGeometry(0.34, 0);
  const clumps = b.instanced(clumpGeo, FOLIAGE_GREEN, n, { roughness: 0.85 });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  for (let i = 0; i < n; i += 1) {
    const x = -length / 2 + (i + 0.5) * (length / n);
    const s = 0.8 + (i % 3) * 0.16;
    pos.set(x, boxH + 0.22, (i % 2) * 0.08 - 0.04);
    scl.set(s, s * 0.85, s);
    m.compose(pos, q, scl);
    clumps.setMatrixAt(i, m);
  }
  clumps.instanceMatrix.needsUpdate = true;
  return b.finish();
}

/**
 * A hanging GLOBE PENDANT lamp: a thin drop-stem + a warm emissive sphere. Cheap, and under
 * the bloom pass it reads as a real warm practical light. `color` tints the glow (warm amber
 * by default; pass a neon for a club fixture).
 */
export function buildGlobePendant(color = 0xffd9a0, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  b.box(0.04, 0.7, 0.04, 0x1a1a20, { roughness: 0.7 }).position.set(0, 0.35, 0);
  // Tiny ceiling rose.
  b.cylinder(0.08, 0.04, 0x24242c, { roughness: 0.6 }).position.set(0, 0.7, 0);
  const geo = b.ownGeo(new THREE.SphereGeometry(0.22, 18, 14));
  const mat = b.own(
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: cfg.glow * 1.6,
      roughness: 0.25,
    }),
  );
  const globe = new THREE.Mesh(geo, mat);
  globe.position.set(0, 0, 0);
  b.group.add(globe);
  return b.finish();
}

/** A WALL SCONCE: a small dark backplate with a warm emissive bar — soft wall uplight. */
export function buildWallSconce(color = 0xffc27a, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  b.box(0.26, 0.4, 0.08, 0x1c1c22, { roughness: 0.7 }).position.set(0, 0, 0);
  b.glowBox(0.16, 0.3, 0.06, color, cfg.glow * 1.5, { roughness: 0.3 }).position.set(0, 0, 0.05);
  return b.finish();
}

/**
 * A cozy FIREPLACE: a stone surround framing a glowing ember bed + a low flame block. Adds a
 * warm lounge anchor. Static (the flame is an emissive block, no per-frame animation).
 */
export function buildFireplace(cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  const surround = 0x3a3d44;
  // Mantel surround: two jambs + a header + hearth slab.
  b.box(0.4, 1.6, 0.6, surround, { roughness: 0.8 }).position.set(-1.1, 0.8, 0);
  b.box(0.4, 1.6, 0.6, surround, { roughness: 0.8 }).position.set(1.1, 0.8, 0);
  b.box(2.6, 0.4, 0.6, surround, { roughness: 0.8 }).position.set(0, 1.6, 0);
  b.box(2.6, 0.2, 0.8, 0x2c2e34, { roughness: 0.85 }).position.set(0, 0.1, 0.05);
  // Dark firebox recess.
  b.box(1.8, 1.3, 0.3, 0x0c0a0a, { roughness: 0.95 }).position.set(0, 0.75, -0.18);
  // Glowing ember bed + a warm flame block.
  b.glowBox(1.6, 0.18, 0.3, 0xff7a1f, cfg.glow * 1.6, { roughness: 0.5 }).position.set(0, 0.28, -0.05);
  b.glowBox(1.0, 0.7, 0.2, 0xffb33c, cfg.glow * 1.3, { roughness: 0.4 }).position.set(0, 0.6, -0.1);
  return b.finish();
}

/**
 * A retro LOUNGE SET: a low two-seat sofa + a round coffee table. Characterful seating mass
 * for a lounge corner. `accent` tints the upholstery (warm by default).
 */
export function buildLoungeSet(accent = 0x9c5a3c): ArtProp {
  const b = new Builder();
  const frame = 0x2c2e36;
  // Sofa: base + back + two arms + cushions.
  b.box(2.2, 0.4, 0.9, frame, { roughness: 0.8 }).position.set(0, 0.3, 0);
  b.box(2.2, 0.7, 0.22, frame, { roughness: 0.8 }).position.set(0, 0.75, -0.34);
  b.box(0.22, 0.55, 0.9, frame, { roughness: 0.8 }).position.set(-1.0, 0.62, 0);
  b.box(0.22, 0.55, 0.9, frame, { roughness: 0.8 }).position.set(1.0, 0.62, 0);
  b.box(0.95, 0.2, 0.78, accent, { roughness: 0.85 }).position.set(-0.5, 0.55, 0.02);
  b.box(0.95, 0.2, 0.78, accent, { roughness: 0.85 }).position.set(0.5, 0.55, 0.02);
  // Round coffee table in front.
  b.cylinder(0.5, 0.06, 0x4a3a2c, { roughness: 0.4, metalness: 0.2 }).position.set(0, 0.42, 1.0);
  b.cylinder(0.06, 0.42, 0x2c2e36, { roughness: 0.5 }).position.set(0, 0.21, 1.0);
  return b.finish();
}

/** A retro ARCADE CABINET: a tall body with a glowing angled screen + a neon side glow. */
export function buildArcadeCabinet(color = NEON_CYAN, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  const body = 0x161620;
  b.box(0.8, 1.9, 0.7, body, { roughness: 0.7 }).position.set(0, 0.95, 0);
  // Marquee header (glowing).
  b.glowBox(0.78, 0.3, 0.6, color, cfg.glow * 1.2, { roughness: 0.4 }).position.set(0, 1.75, 0.05);
  // Angled screen.
  const screen = b.glowBox(0.62, 0.5, 0.05, color, cfg.glow * 1.0, { roughness: 0.4 });
  screen.position.set(0, 1.25, 0.34);
  screen.rotation.x = -0.4;
  // Control deck + two button dots.
  b.box(0.78, 0.12, 0.45, 0x22222c, { roughness: 0.6 }).position.set(0, 1.0, 0.42);
  b.glowBox(0.06, 0.04, 0.06, NEON_MAGENTA, cfg.glow * 1.1).position.set(-0.15, 1.07, 0.5);
  b.glowBox(0.06, 0.04, 0.06, BAR_AMBER, cfg.glow * 1.1).position.set(0.15, 1.07, 0.5);
  // Neon side strips.
  b.glowBox(0.04, 1.7, 0.04, color, cfg.glow * 1.3).position.set(-0.41, 0.95, 0.3);
  b.glowBox(0.04, 1.7, 0.04, color, cfg.glow * 1.3).position.set(0.41, 0.95, 0.3);
  return b.finish();
}

/** A PINBALL machine: a low slanted glowing playfield on legs with a small backbox. */
export function buildPinball(cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  const body = 0x18121f;
  // Legs.
  for (const dx of [-0.5, 0.5]) {
    for (const dz of [-0.8, 0.8]) {
      b.box(0.1, 0.7, 0.1, 0x101016, { roughness: 0.6 }).position.set(dx, 0.35, dz);
    }
  }
  // Slanted playfield.
  const field = b.glowBox(1.2, 0.1, 1.9, NEON_MAGENTA, cfg.glow * 0.7, { roughness: 0.4 });
  field.position.set(0, 0.8, 0);
  field.rotation.x = -0.16;
  // Cabinet sides under the field.
  b.box(1.24, 0.4, 1.94, body, { roughness: 0.7 }).position.set(0, 0.58, 0);
  // Backbox (glowing).
  const back = b.glowBox(1.2, 0.9, 0.12, NEON_CYAN, cfg.glow * 1.2, { roughness: 0.4 });
  back.position.set(0, 1.3, -0.95);
  back.rotation.x = 0.25;
  return b.finish();
}

/** A PATIO SET: a round table under a tilted parasol umbrella + a glowing rim, two stools. */
export function buildPatioSet(umbrellaColor = NEON_CYAN, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  // Table.
  b.cylinder(0.06, 0.74, 0x2c2e36, { roughness: 0.5 }).position.set(0, 0.37, 0);
  b.cylinder(0.62, 0.06, 0xc6ccd6, { roughness: 0.4, metalness: 0.3 }).position.set(0, 0.74, 0);
  // Umbrella pole + canopy (a shallow cone) with a glowing rim.
  b.cylinder(0.04, 1.7, 0x9aa0ab, { roughness: 0.5, metalness: 0.4 }).position.set(0, 1.6, 0);
  const canopyGeo = b.ownGeo(new THREE.ConeGeometry(1.3, 0.5, 16, 1, true));
  const canopyMat = b.own(new THREE.MeshStandardMaterial({ color: 0x232531, roughness: 0.8, side: THREE.DoubleSide }));
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, 2.3, 0);
  b.group.add(canopy);
  // A glowing ring under the canopy edge — a torus.
  const rimGeo = b.ownGeo(new THREE.TorusGeometry(1.25, 0.04, 8, 28));
  const rimMat = b.own(
    new THREE.MeshStandardMaterial({ color: umbrellaColor, emissive: umbrellaColor, emissiveIntensity: cfg.glow * 1.4, roughness: 0.3 }),
  );
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, 2.12, 0);
  b.group.add(rim);
  // Two stools.
  for (const dx of [-0.95, 0.95]) {
    b.cylinder(0.05, 0.5, 0x2c2e36, { roughness: 0.5 }).position.set(dx, 0.25, 0);
    b.cylinder(0.24, 0.08, 0x4a3a2c, { roughness: 0.6 }).position.set(dx, 0.5, 0);
  }
  return b.finish();
}

/** A WALL CLOCK: a round dark face with a glowing rim ring + two hands. */
export function buildWallClock(color = ACCENT_CYAN, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  b.cylinder(0.42, 0.06, 0x1a1a20, { roughness: 0.6 }).rotation.x = Math.PI / 2;
  const rimGeo = b.ownGeo(new THREE.TorusGeometry(0.42, 0.035, 8, 30));
  const rimMat = b.own(
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: cfg.glow * 1.3, roughness: 0.3 }),
  );
  const rim = new THREE.Mesh(rimGeo, rimMat);
  b.group.add(rim);
  // Hands.
  const hMat = b.own(
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: cfg.glow * 1.0, roughness: 0.3 }),
  );
  const hourGeo = b.ownGeo(new THREE.BoxGeometry(0.04, 0.22, 0.02));
  const hour = new THREE.Mesh(hourGeo, hMat);
  hour.position.set(0, 0.08, 0.04);
  b.group.add(hour);
  const minGeo = b.ownGeo(new THREE.BoxGeometry(0.32, 0.04, 0.02));
  const min = new THREE.Mesh(minGeo, hMat);
  min.position.set(0.1, 0, 0.04);
  b.group.add(min);
  return b.finish();
}

/**
 * HANGING SIGNAGE: a suspended board on two drop chains with a glowing emissive face. A small
 * directional / branding sign for over a doorway or the bar. `color` tints the face glow.
 */
export function buildHangingSign(width = 1.8, color = BAR_AMBER, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  // Two drop stems.
  for (const dx of [-width / 2 + 0.2, width / 2 - 0.2]) {
    b.box(0.03, 0.5, 0.03, 0x1a1a20, { roughness: 0.7 }).position.set(dx, 0.25, 0);
  }
  // Board + glowing face.
  b.box(width, 0.55, 0.08, 0x14121a, { roughness: 0.7 }).position.set(0, -0.1, 0);
  b.glowBox(width - 0.16, 0.38, 0.05, color, cfg.glow * 1.3, { roughness: 0.35 }).position.set(0, -0.1, 0.05);
  return b.finish();
}

/**
 * A RAILING / balustrade run: two horizontal rails + a row of vertical balusters (one
 * InstancedMesh — a single draw call) + two end posts. For mezzanine + dais edges; adds
 * architectural depth. `length` is the run; `accent` glows the top rail (theme-tinted).
 */
export function buildRailing(length = 4, accent = ACCENT_CYAN, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  const metal = 0x7a808c;
  const railH = 1.0;
  // Top rail (glowing accent) + a lower rail.
  b.glowBox(length, 0.08, 0.08, accent, cfg.glow * 1.0, { roughness: 0.35 }).position.set(0, railH, 0);
  b.box(length, 0.05, 0.05, metal, { roughness: 0.5, metalness: 0.5 }).position.set(0, railH * 0.45, 0);
  // End posts.
  b.box(0.1, railH, 0.1, metal, { roughness: 0.5, metalness: 0.5 }).position.set(-length / 2, railH / 2, 0);
  b.box(0.1, railH, 0.1, metal, { roughness: 0.5, metalness: 0.5 }).position.set(length / 2, railH / 2, 0);
  // Balusters as one InstancedMesh.
  const n = Math.max(2, Math.round(length / 0.5));
  const balGeo = new THREE.CylinderGeometry(0.025, 0.025, railH, 8);
  const bal = b.instanced(balGeo, metal, n, { roughness: 0.5, metalness: 0.5 });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i += 1) {
    const x = -length / 2 + (i + 0.5) * (length / n);
    pos.set(x, railH / 2, 0);
    m.compose(pos, q, one);
    bal.setMatrixAt(i, m);
  }
  bal.instanceMatrix.needsUpdate = true;
  return b.finish();
}

/**
 * The hero CENTRAL DAIS: a low round raised platform (the references put a car on a glowing
 * disc) with a stepped base, a matte top, and a bright glowing rim ring. `radius` sizes it;
 * `rim` tints the glow (cyan for facility, magenta for the club).
 */
export function buildDais(radius = 4, rim = ACCENT_CYAN, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  // Two stepped tiers for depth.
  b.cylinder(radius, 0.18, 0x2a2d36, { roughness: 0.5, metalness: 0.3 }).position.set(0, 0.09, 0);
  b.cylinder(radius * 0.86, 0.16, 0x33363f, { roughness: 0.4, metalness: 0.35 }).position.set(0, 0.26, 0);
  // Glossy top inlay.
  b.cylinder(radius * 0.8, 0.04, 0x3a3e49, { roughness: 0.18, metalness: 0.5 }).position.set(0, 0.36, 0);
  // Glowing rim ring (a torus laid flat).
  const rimGeo = b.ownGeo(new THREE.TorusGeometry(radius * 0.9, 0.09, 10, 60));
  const rimMat = b.own(
    new THREE.MeshStandardMaterial({ color: rim, emissive: rim, emissiveIntensity: cfg.glow * 1.5, roughness: 0.3 }),
  );
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  rimMesh.rotation.x = Math.PI / 2;
  rimMesh.position.set(0, 0.2, 0);
  b.group.add(rimMesh);
  // A faint emissive inlay glow under the rim so the platform top reads as lit.
  b.glowBox(radius * 1.5, 0.02, radius * 1.5, rim, cfg.glow * 0.18, { roughness: 0.5 }).position.set(0, 0.385, 0);
  return b.finish();
}

/**
 * A concentric NEON-RING TRACK floor centerpiece (the club reference's hero floor work): a
 * set of flat glowing rings nested around a centre, built as one InstancedMesh of ring
 * segments... actually as `rings` torus meshes (few, cheap), alternating two neon colours.
 * Thin and laid just above the floor (caller positions y to avoid z-fighting).
 */
export function buildRingTrack(outerRadius = 6, rings = 4, cfg = DEFAULT_PROP_CONFIG): ArtProp {
  const b = new Builder();
  const cols = [NEON_MAGENTA, NEON_CYAN];
  for (let i = 0; i < rings; i += 1) {
    const r = outerRadius * (1 - i / rings) * 0.95 + 0.4;
    const c = cols[i % cols.length] ?? NEON_MAGENTA;
    const geo = b.ownGeo(new THREE.TorusGeometry(r, 0.08, 8, Math.max(40, Math.round(r * 10))));
    const mat = b.own(
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: cfg.glow * 1.4, roughness: 0.3 }),
    );
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = Math.PI / 2;
    b.group.add(ring);
  }
  // A small bright centre disc.
  b.glowBox(0.8, 0.04, 0.8, NEON_CYAN, cfg.glow * 1.3, { roughness: 0.3 });
  return b.finish();
}

/**
 * A FLOOR DECAL: a thin emissive shape laid just above the floor. `kind` picks the motif —
 * a bullseye/target rug (nested rings), a directional stripe set, or a tile-grid patch. One
 * InstancedMesh for the repeated elements where possible. Static, near-flat, glow-led.
 */
export function buildFloorDecal(
  kind: 'target' | 'stripes' | 'grid',
  size = 4,
  color = ACCENT_CYAN,
  cfg = DEFAULT_PROP_CONFIG,
): ArtProp {
  const b = new Builder();
  if (kind === 'target') {
    // Nested ring rug — a base mat + concentric glowing rings.
    b.box(size, 0.02, size, 0x202229, { roughness: 0.9 }).position.set(0, 0, 0);
    const rings = 3;
    for (let i = 0; i < rings; i += 1) {
      const r = (size / 2) * (1 - i / rings) * 0.85;
      const geo = b.ownGeo(new THREE.TorusGeometry(r, 0.05, 8, 40));
      const mat = b.own(
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: cfg.glow * 1.1, roughness: 0.35 }),
      );
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, 0.02, 0);
      b.group.add(ring);
    }
    b.glowBox(0.4, 0.025, 0.4, color, cfg.glow * 1.2).position.set(0, 0.02, 0);
  } else if (kind === 'stripes') {
    // A set of parallel directional stripes (one InstancedMesh).
    const n = 4;
    const stripeGeo = new THREE.BoxGeometry(size, 0.02, size * 0.12);
    const stripes = b.instanced(stripeGeo, color, n, {
      emissive: color,
      emissiveIntensity: cfg.glow * 1.0,
      roughness: 0.35,
    });
    stripes.castShadow = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < n; i += 1) {
      const z = -size / 2 + (i + 0.5) * (size / n);
      pos.set(0, 0.02, z);
      m.compose(pos, q, one);
      stripes.setMatrixAt(i, m);
    }
    stripes.instanceMatrix.needsUpdate = true;
  } else {
    // A tile-grid patch — a base panel + a lattice of thin glowing seams (one InstancedMesh).
    b.box(size, 0.02, size, 0x1c1e25, { roughness: 0.85 }).position.set(0, 0, 0);
    const lines = 5;
    const total = lines * 2;
    const lineGeo = new THREE.BoxGeometry(size, 0.025, 0.04);
    const seams = b.instanced(lineGeo, color, total, {
      emissive: color,
      emissiveIntensity: cfg.glow * 0.7,
      roughness: 0.4,
    });
    seams.castShadow = false;
    const m = new THREE.Matrix4();
    const qFlat = new THREE.Quaternion();
    const qTurn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < lines; i += 1) {
      const o = -size / 2 + (i + 0.5) * (size / lines);
      pos.set(0, 0.02, o);
      m.compose(pos, qFlat, one);
      seams.setMatrixAt(i, m);
      pos.set(o, 0.02, 0);
      m.compose(pos, qTurn, one);
      seams.setMatrixAt(lines + i, m);
    }
    seams.instanceMatrix.needsUpdate = true;
  }
  return b.finish();
}

// ===========================================================================================
// BEACH set-dressing — sunny outdoor kit (umbrellas, loungers, lifeguard tower, surfboards,
// beach balls, a tiki bar). Bright, warm, matte (no neon glow); the daylight fill in MapView
// lights them. All STATIC and instanced/merged where repeated.
// ===========================================================================================

/**
 * A BEACH UMBRELLA / parasol: a thin pole crowned by a wide tilted canopy (a shallow cone)
 * with a bright fabric. `canopyColor` tints the fabric; alternate teal/coral/cream per spot
 * for a lively beach read. `height` scales the whole parasol.
 */
export function buildBeachUmbrella(canopyColor = BEACH_TEAL, height = 3.0): ArtProp {
  const b = new Builder();
  // Pole.
  b.cylinder(0.05, height, 0xece6d6, { roughness: 0.6 }).position.set(0, height / 2, 0);
  // Canopy — a shallow open cone, double-sided so it reads from below too.
  const canopyGeo = b.ownGeo(new THREE.ConeGeometry(height * 0.62, height * 0.34, 14, 1, true));
  const canopyMat = b.own(
    new THREE.MeshStandardMaterial({ color: canopyColor, roughness: 0.75, side: THREE.DoubleSide }),
  );
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, height - height * 0.1, 0);
  canopy.rotation.z = 0.16; // a jaunty tilt
  b.group.add(canopy);
  // A small finial cap on top.
  b.cylinder(0.06, 0.12, 0xece6d6, { roughness: 0.6 }).position.set(0, height + 0.06, 0);
  return b.finish();
}

/**
 * A SUN LOUNGER / beach chair: a low slatted frame with a raised, reclined backrest + a
 * folded towel. `towelColor` tints the towel so loungers vary down a row.
 */
export function buildSunLounger(towelColor = BEACH_CORAL): ArtProp {
  const b = new Builder();
  const frame = 0xece6d6;
  // Four short legs.
  for (const dx of [-0.32, 0.32]) {
    for (const dz of [-0.85, 0.85]) {
      b.box(0.06, 0.34, 0.06, frame, { roughness: 0.55, metalness: 0.2 }).position.set(dx, 0.17, dz);
    }
  }
  // Seat slab.
  b.box(0.78, 0.08, 1.9, frame, { roughness: 0.6 }).position.set(0, 0.36, 0);
  // Reclined backrest.
  const back = b.box(0.78, 0.08, 0.9, frame, { roughness: 0.6 });
  back.position.set(0, 0.62, -0.85);
  back.rotation.x = 0.7;
  // A folded towel on the seat.
  b.box(0.66, 0.06, 0.8, towelColor, { roughness: 0.85 }).position.set(0, 0.42, 0.2);
  return b.finish();
}

/**
 * A LIFEGUARD TOWER: a raised cabin on four splayed legs with a ladder, a railing rim, and a
 * pitched roof flying a bright flag. A tall outdoor landmark for the beach club zone.
 */
export function buildLifeguardTower(): ArtProp {
  const b = new Builder();
  const wood = BEACH_WOOD;
  const white = BEACH_CABANA;
  const cabinY = 2.6;
  // Four legs.
  for (const dx of [-1.0, 1.0]) {
    for (const dz of [-1.0, 1.0]) {
      const leg = b.box(0.16, cabinY, 0.16, wood, { roughness: 0.8 });
      leg.position.set(dx, cabinY / 2, dz);
    }
  }
  // Cabin floor + walls (a small open hut).
  b.box(2.4, 0.16, 2.4, wood, { roughness: 0.8 }).position.set(0, cabinY, 0);
  b.box(2.4, 0.9, 0.16, white, { roughness: 0.75 }).position.set(0, cabinY + 0.55, -1.12);
  b.box(0.16, 0.9, 2.4, white, { roughness: 0.75 }).position.set(-1.12, cabinY + 0.55, 0);
  b.box(0.16, 0.9, 2.4, white, { roughness: 0.75 }).position.set(1.12, cabinY + 0.55, 0);
  // Low front railing rim.
  b.box(2.4, 0.12, 0.1, white, { roughness: 0.75 }).position.set(0, cabinY + 0.5, 1.12);
  // Pitched roof (two slabs).
  for (const sgn of [-1, 1]) {
    const slab = b.box(2.8, 0.1, 1.6, BEACH_CORAL, { roughness: 0.7 });
    slab.position.set(0, cabinY + 1.5, sgn * 0.7);
    slab.rotation.x = sgn * 0.5;
  }
  // Ladder rails down the front.
  for (const dx of [-0.4, 0.4]) {
    b.box(0.06, cabinY, 0.06, wood, { roughness: 0.8 }).position.set(dx, cabinY / 2, 1.2);
  }
  // Flagpole + a bright flag.
  b.cylinder(0.04, 1.4, 0xece6d6, { roughness: 0.6 }).position.set(1.0, cabinY + 2.4, -1.0);
  b.box(0.7, 0.45, 0.04, BEACH_TEAL, { roughness: 0.8 }).position.set(1.36, cabinY + 2.9, -1.0);
  return b.finish();
}

/**
 * A SURFBOARD: a long rounded board, stood up leaning. `color` tints the deck. Built as a
 * scaled box (cheap) with a contrasting stripe down the centre.
 */
export function buildSurfboard(color = BEACH_CORAL): ArtProp {
  const b = new Builder();
  const board = b.box(0.5, 2.4, 0.08, color, { roughness: 0.45, metalness: 0.1 });
  board.position.set(0, 1.2, 0);
  // A centre stripe.
  b.box(0.08, 2.2, 0.1, BEACH_CABANA, { roughness: 0.5 }).position.set(0, 1.2, 0.01);
  return b.finish();
}

/**
 * A BEACH BALL: a bright sphere with alternating coloured panels suggested by two crossing
 * bands. Sits on the sand. `color` tints the panels.
 */
export function buildBeachBall(color = BEACH_CORAL, radius = 0.45): ArtProp {
  const b = new Builder();
  const geo = b.ownGeo(new THREE.SphereGeometry(radius, 18, 14));
  const mat = b.own(new THREE.MeshStandardMaterial({ color: BEACH_CABANA, roughness: 0.5 }));
  const ball = new THREE.Mesh(geo, mat);
  ball.position.set(0, radius, 0);
  ball.castShadow = true;
  b.group.add(ball);
  // Two crossing coloured bands (thin tori) for the classic panel look.
  for (let i = 0; i < 2; i += 1) {
    const bandGeo = b.ownGeo(new THREE.TorusGeometry(radius * 0.99, radius * 0.18, 8, 22));
    const bandMat = b.own(new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.set(0, radius, 0);
    band.rotation.y = (i * Math.PI) / 2;
    b.group.add(band);
  }
  return b.finish();
}

/**
 * A TIKI BAR: a thatched-roof counter — a wood counter with a row of bamboo posts and a
 * shaggy palm-thatch roof. A warm civilian-beach social anchor. `length` stretches the bar.
 */
export function buildTikiBar(length = 4): ArtProp {
  const b = new Builder();
  const wood = 0x7a5a36;
  // Counter body + top.
  b.box(length, 1.1, 0.9, wood, { roughness: 0.8 }).position.set(0, 0.55, 0);
  b.box(length + 0.2, 0.1, 1.0, 0x8a6a44, { roughness: 0.6 }).position.set(0, 1.13, 0);
  // Bamboo support posts at each end + back-of-counter posts.
  const postH = 2.4;
  for (const dx of [-length / 2 + 0.2, length / 2 - 0.2]) {
    b.cylinder(0.08, postH, 0xc9a96b, { roughness: 0.7 }).position.set(dx, postH / 2, -0.4);
  }
  // Thatched roof — two overlapping shaggy slabs.
  for (let i = 0; i < 2; i += 1) {
    const slab = b.box(length + 0.8, 0.16, 1.5, 0xb89a5c, { roughness: 0.95 });
    slab.position.set(0, postH + 0.1 + i * 0.18, -0.4);
    slab.rotation.x = 0.12;
  }
  // A bright bunting strip along the counter front.
  b.box(length * 0.96, 0.18, 0.06, BEACH_TEAL, { roughness: 0.8 }).position.set(0, 0.78, 0.46);
  return b.finish();
}

