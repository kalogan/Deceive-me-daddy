// MapView — the REAL, reusable Three.js renderer for a map's authored content
// (PROJECT_BRIEF §2b/§8). Given a `ContentPack` (the SAME shared schema the server
// resolves), it builds greybox 3D for every authored element so the clearance layout +
// objective flow read at a glance. The game mounts this for static map geometry; the
// preview harness just mounts the same component over a file-loaded pack — never a
// forked "preview renderer" (PROJECT_BRIEF §4.5).
//
// THEME-AWARE: the renderer reads `pack.theme` and re-skins the structural shell + swaps in
// theme-specific set dressing so the two shipped levels read as distinct places —
// `research_facility` (a cool, sterile spy HQ) vs `nightclub` (a moody synthwave club).
// Any unknown theme falls back to the facility look.
//
// API: `new MapView(scene)`, `setPack(pack)` (clears + rebuilds), `dispose()`.
import * as THREE from 'three';
import {
  TIER_COLOR,
  type ClearanceTier,
  type ContentPack,
  type Vec3Tuple,
} from '@deceive/shared';
import { boundsToBox } from './mapGeometry';
import {
  buildBarCounter,
  buildCeilingDuct,
  buildDancefloor,
  buildDjBooth,
  buildDoorFrame,
  buildGlassPartition,
  buildHazardStripe,
  buildKeycardReader,
  buildLabBench,
  buildNeonSign,
  buildNeonStrip,
  buildPlanter,
  buildServerRack,
  buildSpeakerStack,
  buildSpotLight,
  buildTerminal,
  buildVaultPodium,
  buildVelvetRope,
  buildWallMonitor,
  NEON_CYAN,
  NEON_MAGENTA,
  type ArtProp,
} from '../art/props';

/** Blend hex colour `a` toward `b` by `t` (0..1). */
function mix(a: number, b: number, t: number): number {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}

// --- Per-theme palettes -------------------------------------------------------------------
// Each theme re-skins the SAME structural elements (floors, curbs, walls, ceiling lights,
// pillars) so the level identity is carried by colour + dressing, not a different layout.

interface ThemePalette {
  floor: number;
  wall: number;
  pillar: number;
  accent: number; // wall accent strip + curb-ish trim
  ceilingLight: number;
  ceilingLightIntensity: number;
  floorRoughness: number;
  floorMetalness: number;
  /** How strongly the per-zone tier wash tints the floor (0..1). */
  tierWash: number;
}

// Sleek modern spy-HQ palette: cool brushed-steel surfaces, a bright cyan accent strip, and
// cool-white overhead light panels (the bloom post-pass makes the accents + lights glow).
const FACILITY: ThemePalette = {
  floor: 0x39414f,
  wall: 0x474e5c,
  pillar: 0x474e5c,
  accent: 0x33d6e6,
  ceilingLight: 0xcfe6ff,
  ceilingLightIntensity: 0.9,
  floorRoughness: 0.68,
  floorMetalness: 0.28,
  tierWash: 0.16,
};

// Synthwave club palette: a deep purple/near-black glossy base lit by saturated magenta & cyan
// neon. Dark, high-contrast, emissive-heavy (this is where the bloom pass pays off).
const NEON: ThemePalette = {
  floor: 0x110a1a,
  wall: 0x181024,
  pillar: 0x241634,
  accent: NEON_MAGENTA,
  ceilingLight: 0x7a3cff,
  ceilingLightIntensity: 0.55,
  floorRoughness: 0.22,
  floorMetalness: 0.55,
  tierWash: 0.1,
};

type ThemeId = 'research_facility' | 'nightclub';

function resolveTheme(theme: string): ThemeId {
  return theme === 'nightclub' ? 'nightclub' : 'research_facility';
}

// Neutral colours for elements with no tier (intel/vault/package props are built by art/props).
const EXTRACTION_COLOR = '#3fffd0';
const SPAWN_COLOR = '#ffffff';

function tierColor(tier: ClearanceTier): number {
  return new THREE.Color(TIER_COLOR[tier]).getHex();
}

export class MapView {
  private readonly root = new THREE.Group();
  // Everything we own, tracked for disposal so setPack() can be called repeatedly
  // without leaking GPU geometries/materials.
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  // Props built from the shared art kit (art/props) — tracked so clear() frees them.
  private readonly artProps: ArtProp[] = [];

  // Active theme for the current pack (set at the top of setPack).
  private themeId: ThemeId = 'research_facility';
  private palette: ThemePalette = FACILITY;

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
  }

  /** Show/hide the whole map (the preview toggles this when showing the asset gallery). */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** Clear any previous build and render `pack` from scratch. */
  setPack(pack: ContentPack): void {
    this.clear();

    // Read the authored theme and select the palette (default → facility for unknown themes).
    this.themeId = resolveTheme(pack.theme);
    this.palette = this.themeId === 'nightclub' ? NEON : FACILITY;
    const pal = this.palette;

    // --- zones: a solid tinted FLOOR slab + a glowing tier baseboard curb, so each clearance
    //     area reads as an actual ROOM. We also accumulate the overall footprint for the
    //     enclosing outer walls below. (The live NPC crowd is drawn by NpcView, not here.) ---
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    // Unique zone corners → structural pillars (deduped so shared corners get one column).
    const corners = new Map<string, [number, number]>();

    for (const zone of pack.zones) {
      const { center, size } = boundsToBox(zone.bounds.min, zone.bounds.max);
      const [sx, , sz] = size;
      const x0 = center[0] - sx / 2;
      const x1 = center[0] + sx / 2;
      const z0 = center[2] - sz / 2;
      const z1 = center[2] + sz / 2;
      minX = Math.min(minX, x0);
      maxX = Math.max(maxX, x1);
      minZ = Math.min(minZ, z0);
      maxZ = Math.max(maxZ, z1);
      const cornerList: [number, number][] = [
        [x0, z0],
        [x1, z0],
        [x0, z1],
        [x1, z1],
      ];
      for (const [cx, cz] of cornerList) {
        corners.set(`${Math.round(cx)},${Math.round(cz)}`, [cx, cz]);
      }

      const tint = tierColor(zone.requiredClearance);
      // Themed floor with a faint per-tier wash (kept across themes) + a theme sheen.
      const floor = this.box([sx, 0.12, sz], mix(pal.floor, tint, pal.tierWash), {
        roughness: pal.floorRoughness,
        metalness: pal.floorMetalness,
      });
      floor.position.set(center[0], 0.06, center[2]);
      floor.receiveShadow = true;
      this.root.add(floor);

      this.addCurb(center, sx, sz, tint);
      if (this.themeId === 'nightclub') {
        this.addNeonZoneDressing(zone.requiredClearance, center, sx, sz);
      } else {
        this.addFloorSeams(center, sx, sz);
      }
      this.addCeilingLight(center, sx);
      this.addSetDressing(zone.requiredClearance, center, sx, sz);
    }

    // --- outer walls + structural pillars at the zone corners (the building's frame) ---
    if (Number.isFinite(minX)) this.addOuterWalls(minX, minZ, maxX, maxZ);
    for (const [cx, cz] of corners.values()) this.addPillar(cx, cz);

    // --- doors: a passage FRAME (two posts + a lintel), tier-coloured; brighter when it gates
    //     on a keycard / intel unlock (a "special" door reads hotter). ---
    for (const door of pack.doors) {
      this.addDoorFrame(
        door.position,
        tierColor(door.requiredClearance),
        Boolean(door.keycardColor) || door.intelToUnlock > 0,
      );
    }

    // --- keycards: a glowing card slotted in a small reader stand ---
    for (const card of pack.keycards) {
      this.addKeycardProp(card.position, tierColor(card.color));
    }

    // --- social spots: low markers tinted by tier ---
    for (const spot of pack.socialSpots) {
      const mesh = this.cylinder(0.5, 0.2, tierColor(spot.tier));
      this.place(mesh, spot.position, 0.1);
      this.root.add(mesh);
    }

    // --- intel nodes: a console terminal with a glowing pink screen (you "hack" these) ---
    for (const node of pack.intelNodes) {
      this.addTerminal(node.position);
    }

    // --- objective: a vault podium where the package spawns (the LIVE moving package is
    //     drawn by PackageView) + extraction markers ---
    this.addVaultPodium(pack.objective.packagePosition);

    for (const exit of pack.objective.extractionPoints) {
      const ring = this.cylinder(1.4, 0.1, new THREE.Color(EXTRACTION_COLOR).getHex(), {
        transparent: true,
        opacity: 0.7,
      });
      this.place(ring, exit, 0.05);
      this.root.add(ring);
    }

    // --- spawn points: flat white discs ---
    for (const spawn of pack.spawnPoints) {
      const disc = this.cylinder(0.9, 0.05, new THREE.Color(SPAWN_COLOR).getHex(), {
        transparent: true,
        opacity: 0.5,
      });
      this.place(disc, spawn.position, 0.03);
      this.root.add(disc);
    }
  }

  // --- mesh factories (each tracks geometry + material for disposal) ---

  private box(
    size: Vec3Tuple,
    color: number,
    matOpts: THREE.MeshStandardMaterialParameters = {},
  ): THREE.Mesh {
    const geo = this.track(new THREE.BoxGeometry(size[0], size[1], size[2]));
    const mat = this.trackMat(
      new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...matOpts }),
    );
    return new THREE.Mesh(geo, mat);
  }

  private cylinder(
    radius: number,
    height: number,
    color: number,
    matOpts: THREE.MeshStandardMaterialParameters = {},
  ): THREE.Mesh {
    const geo = this.track(new THREE.CylinderGeometry(radius, radius, height, 20));
    const mat = this.trackMat(
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...matOpts }),
    );
    return new THREE.Mesh(geo, mat);
  }

  /** Place a mesh at a content Vec3, lifting it by `yLift` above the authored y. */
  private place(mesh: THREE.Object3D, at: Vec3Tuple, yLift: number): void {
    mesh.position.set(at[0], at[1] + yLift, at[2]);
  }

  /** A sleek, brightly-glowing tier-coloured light strip tracing a room's floor edges. */
  private addCurb(center: Vec3Tuple, sx: number, sz: number, color: number): void {
    const h = 0.16;
    const t = 0.1;
    // Neon clubs lean on a brighter, glossier curb so the zone edges read as light tubes.
    const intensity = this.themeId === 'nightclub' ? 1.15 : 0.65;
    const opts: THREE.MeshStandardMaterialParameters = {
      emissive: color,
      emissiveIntensity: intensity,
      roughness: 0.4,
    };
    const seg = (w: number, d: number, x: number, z: number): void => {
      const m = this.box([w, h, d], color, opts);
      m.position.set(x, h / 2, z);
      this.root.add(m);
    };
    seg(sx, t, center[0], center[2] - sz / 2);
    seg(sx, t, center[0], center[2] + sz / 2);
    seg(t, sz, center[0] - sx / 2, center[2]);
    seg(t, sz, center[0] + sx / 2, center[2]);
  }

  /** Per-zone set dressing, dispatched by theme so each level reads as its own place. */
  private addSetDressing(
    tier: ClearanceTier,
    center: Vec3Tuple,
    sx: number,
    sz: number,
  ): void {
    if (this.themeId === 'nightclub') this.addNeonSetDressing(tier, center, sx, sz);
    else this.addFacilitySetDressing(tier, center, sx, sz);
  }

  // --- FACILITY set dressing ---------------------------------------------------------------

  /**
   * Clean spy-HQ dressing: a server rack + planter (the original lived-in pair), plus a lab
   * bench, a glass partition, a wall monitor and ceiling ducts. The vault (scientist) zone
   * also gets a hazard-stripe accent. Placed in corners / against walls so nothing overlaps
   * gameplay markers. Cosmetic — no collision.
   */
  private addFacilitySetDressing(
    tier: ClearanceTier,
    center: Vec3Tuple,
    sx: number,
    sz: number,
  ): void {
    const inset = 1.4;
    const [cx, , cz] = center;
    const hx = sx / 2;
    const hz = sz / 2;

    // Server rack in the NW corner, planter in the SE corner (original opposite-corner pair).
    const rack = buildServerRack();
    rack.group.position.set(cx - hx + inset, 0, cz - hz + inset);
    rack.group.rotation.y = Math.PI / 4;
    this.root.add(rack.group);
    this.artProps.push(rack);

    this.placeProp(buildPlanter(), [cx + hx - inset, 0, cz + hz - inset]);

    // Lab bench against the north wall (only when the room is wide enough to host it).
    if (sx >= 8) {
      const bench = buildLabBench();
      bench.group.position.set(cx - hx * 0.35, 0, cz - hz + inset);
      this.root.add(bench.group);
      this.artProps.push(bench);
    }

    // A glass partition divider set inward along the south edge of larger rooms.
    if (sx >= 12 && sz >= 10) {
      const glass = buildGlassPartition(Math.min(sx * 0.4, 5), 2.4);
      glass.group.position.set(cx + hx * 0.3, 0, cz + hz - inset);
      this.root.add(glass.group);
      this.artProps.push(glass);
    }

    // A wall-mounted monitor on the west wall, facing into the room (+X).
    const monitor = buildWallMonitor();
    monitor.group.position.set(cx - hx + 0.25, 2.4, cz);
    monitor.group.rotation.y = Math.PI / 2;
    this.root.add(monitor.group);
    this.artProps.push(monitor);

    // A ceiling duct run across the room near the ceiling.
    const duct = buildCeilingDuct(Math.min(sz * 0.7, 14));
    duct.group.position.set(cx + hx * 0.35, 4.3, cz);
    this.root.add(duct.group);
    this.artProps.push(duct);

    // The high-clearance vault zone gets hazard-stripe accents flanking it.
    if (tier === 'scientist') {
      for (const sign of [-1, 1]) {
        const stripe = buildHazardStripe(Math.min(sx * 0.5, 6));
        stripe.group.position.set(cx + sign * hx * 0.45, 0, cz - hz + 0.4);
        this.root.add(stripe.group);
        this.artProps.push(stripe);
      }
    }
  }

  // --- NEON set dressing -------------------------------------------------------------------

  /**
   * Club dressing keyed to the zone's tier: the civilian floor gets a glowing dancefloor + DJ
   * booth + speaker stacks, the bar lives in a corner, the VIP (staff) zone gets velvet ropes,
   * and every room gets neon signage + hanging par-cans. Placed off the gameplay markers.
   */
  private addNeonSetDressing(
    tier: ClearanceTier,
    center: Vec3Tuple,
    sx: number,
    sz: number,
  ): void {
    const [cx, , cz] = center;
    const hx = sx / 2;
    const hz = sz / 2;

    // Hanging par-can spotlights over every room (a small rig of coloured lenses).
    const cols = [NEON_MAGENTA, NEON_CYAN];
    for (let i = 0; i < 2; i += 1) {
      const c = cols[i] ?? NEON_MAGENTA;
      const spot = buildSpotLight(c);
      spot.group.position.set(cx + (i === 0 ? -hx * 0.4 : hx * 0.4), 4.4, cz + (i === 0 ? -hz * 0.3 : hz * 0.3));
      this.root.add(spot.group);
      this.artProps.push(spot);
    }

    // A neon sign mounted high on the north wall of every room.
    const sign = buildNeonSign();
    sign.group.position.set(cx, 3.2, cz - hz + 0.3);
    this.root.add(sign.group);
    this.artProps.push(sign);

    if (tier === 'civilian') {
      // The main floor: a glowing dancefloor centred, a DJ booth at the back, flanking speakers.
      const floorW = Math.min(sx * 0.62, 26);
      const floorD = Math.min(sz * 0.62, 26);
      const dance = buildDancefloor(floorW, floorD);
      dance.group.position.set(cx, 0.14, cz);
      this.root.add(dance.group);
      this.artProps.push(dance);

      const dj = buildDjBooth();
      dj.group.position.set(cx, 0, cz - hz + 1.6);
      this.root.add(dj.group);
      this.artProps.push(dj);

      for (const sign2 of [-1, 1]) {
        const spk = buildSpeakerStack();
        spk.group.position.set(cx + sign2 * (hx - 1.4), 0, cz - hz + 1.6);
        this.root.add(spk.group);
        this.artProps.push(spk);
      }

      // The bar tucked into the SW corner, angled to face the floor.
      const bar = buildBarCounter(Math.min(sx * 0.35, 6));
      bar.group.position.set(cx - hx + 2.0, 0, cz + hz - 2.0);
      bar.group.rotation.y = -Math.PI / 4;
      this.root.add(bar.group);
      this.artProps.push(bar);
    } else if (tier === 'staff') {
      // VIP lounge: velvet-rope posts cordoning a corner + a small bar.
      const ropePositions: Array<[number, number]> = [
        [cx - hx + 1.6, cz - hz + 1.6],
        [cx - hx + 1.6, cz - hz + 3.6],
        [cx - hx + 3.6, cz - hz + 1.6],
      ];
      for (const [px, pz] of ropePositions) {
        const rope = buildVelvetRope();
        rope.group.position.set(px, 0, pz);
        this.root.add(rope.group);
        this.artProps.push(rope);
      }
      const bar = buildBarCounter(Math.min(sx * 0.3, 4));
      bar.group.position.set(cx + hx - 1.8, 0, cz);
      bar.group.rotation.y = -Math.PI / 2;
      this.root.add(bar.group);
      this.artProps.push(bar);
    } else {
      // Security booth / owner suite: a speaker stack + planter for some lived-in mass.
      const spk = buildSpeakerStack();
      spk.group.position.set(cx + hx - 1.2, 0, cz - hz + 1.2);
      spk.group.rotation.y = -Math.PI / 4;
      this.root.add(spk.group);
      this.artProps.push(spk);
      this.placeProp(buildPlanter(), [cx - hx + 1.4, 0, cz + hz - 1.4]);
    }
  }

  /** Neon wall trim: a glowing strip running along each zone edge, just above the floor. */
  private addNeonZoneDressing(
    tier: ClearanceTier,
    center: Vec3Tuple,
    sx: number,
    sz: number,
  ): void {
    const [cx, , cz] = center;
    const color = tier === 'civilian' ? NEON_CYAN : NEON_MAGENTA;
    // A pair of long neon strips along the two longer edges, raised to wall height.
    const horizontal = sx >= sz;
    const len = horizontal ? sx * 0.92 : sz * 0.92;
    for (const sign of [-1, 1]) {
      const strip = buildNeonStrip(len, color);
      if (horizontal) {
        strip.group.position.set(cx, 2.6, cz + sign * (sz / 2 - 0.2));
      } else {
        strip.group.position.set(cx + sign * (sx / 2 - 0.2), 2.6, cz);
        strip.group.rotation.y = Math.PI / 2;
      }
      this.root.add(strip.group);
      this.artProps.push(strip);
    }
  }

  /** Faint recessed panel seams across a floor (a sparse grid) for a tiled-facility read. */
  private addFloorSeams(center: Vec3Tuple, sx: number, sz: number): void {
    const seamColor = 0x20242d;
    const opts: THREE.MeshStandardMaterialParameters = { roughness: 0.9 };
    const step = 6; // metres between seams
    const y = 0.12; // just above the floor top
    const nx = Math.floor(sx / step);
    const nz = Math.floor(sz / step);
    for (let i = 1; i <= nx; i += 1) {
      const x = center[0] - sx / 2 + i * step;
      const m = this.box([0.08, 0.04, sz], seamColor, opts);
      m.position.set(x, y, center[2]);
      this.root.add(m);
    }
    for (let i = 1; i <= nz; i += 1) {
      const z = center[2] - sz / 2 + i * step;
      const m = this.box([sx, 0.04, 0.08], seamColor, opts);
      m.position.set(center[0], y, z);
      this.root.add(m);
    }
  }

  /** A structural column from floor to ceiling at a zone corner (re-skinned per theme). */
  private addPillar(x: number, z: number): void {
    const h = 5;
    const col = this.box([0.5, h, 0.5], this.palette.pillar, { roughness: 0.7, metalness: 0.22 });
    col.position.set(x, h / 2, z);
    col.castShadow = true;
    this.root.add(col);
    // Neon clubs wrap a glowing accent strip up each column.
    if (this.themeId === 'nightclub') {
      const strip = this.box([0.12, h * 0.9, 0.12], this.palette.accent, {
        emissive: this.palette.accent,
        emissiveIntensity: 1.0,
        roughness: 0.3,
      });
      strip.position.set(x, h / 2, z + 0.27);
      this.root.add(strip);
    }
  }

  /** An overhead light panel centred over a room (glows under the bloom pass). */
  private addCeilingLight(center: Vec3Tuple, sx: number): void {
    const pal = this.palette;
    const panel = this.box([Math.min(sx * 0.5, 12), 0.12, 0.7], pal.ceilingLight, {
      emissive: pal.ceilingLight,
      emissiveIntensity: pal.ceilingLightIntensity,
      roughness: 0.3,
    });
    panel.position.set(center[0], 4.7, center[2]);
    this.root.add(panel);
  }

  /** Enclosing walls with a glowing accent strip along their inner base (themed). */
  private addOuterWalls(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const pal = this.palette;
    const h = 5;
    const t = 0.4;
    const w = maxX - minX;
    const d = maxZ - minZ;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const opts: THREE.MeshStandardMaterialParameters = { roughness: 0.78, metalness: 0.18 };
    const accentIntensity = this.themeId === 'nightclub' ? 1.25 : 0.7;
    const accent: THREE.MeshStandardMaterialParameters = {
      emissive: pal.accent,
      emissiveIntensity: accentIntensity,
      roughness: 0.4,
    };
    // A wall panel + a thin accent strip running along its inner base. `inset` nudges the
    // strip just inside the wall so it faces the room. Neon clubs add a second strip up high.
    const wall = (sw: number, sd: number, x: number, z: number, insetX: number, insetZ: number): void => {
      const m = this.box([sw, h, sd], pal.wall, opts);
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);

      const horizontal = sw > sd;
      const stripSize: Vec3Tuple = horizontal ? [sw * 0.98, 0.12, 0.06] : [0.06, 0.12, sd * 0.98];
      const strip = this.box(stripSize, pal.accent, accent);
      strip.position.set(x + insetX, 0.45, z + insetZ);
      this.root.add(strip);

      if (this.themeId === 'nightclub') {
        const high = this.box(stripSize, NEON_CYAN, {
          emissive: NEON_CYAN,
          emissiveIntensity: accentIntensity,
          roughness: 0.4,
        });
        high.position.set(x + insetX, 3.6, z + insetZ);
        this.root.add(high);
      }
    };
    wall(w + t * 2, t, cx, minZ - t / 2, 0, t); // north wall — strip faces +Z (into the room)
    wall(w + t * 2, t, cx, maxZ + t / 2, 0, -t); // south
    wall(t, d, minX - t / 2, cz, t, 0); // west
    wall(t, d, maxX + t / 2, cz, -t, 0); // east
  }

  /** A door as a passage frame: two posts + a lintel, tier-coloured (hotter when special). */
  private addDoorFrame(at: Vec3Tuple, color: number, special: boolean): void {
    this.placeProp(buildDoorFrame(color, special), at);
  }

  /** Place a shared art prop at a content position, tracking it for disposal. */
  private placeProp(prop: ArtProp, at: Vec3Tuple): void {
    prop.group.position.set(at[0], at[1], at[2]);
    this.root.add(prop.group);
    this.artProps.push(prop);
  }

  /** An intel node as a console cabinet with a glowing, tilted pink screen. */
  private addTerminal(at: Vec3Tuple): void {
    this.placeProp(buildTerminal(), at);
  }

  /** A keycard pickup as a glowing tier-coloured card propped on a small reader stand. */
  private addKeycardProp(at: Vec3Tuple, color: number): void {
    this.placeProp(buildKeycardReader(color), at);
  }

  /** The vault as a pedestal + a glowing gold ring; the live package rests here until grabbed. */
  private addVaultPodium(at: Vec3Tuple): void {
    this.placeProp(buildVaultPodium(), at);
  }

  private track<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  private trackMat<T extends THREE.Material>(mat: T): T {
    this.materials.push(mat);
    return mat;
  }

  /** Remove every child + free all tracked GPU resources, ready for a fresh setPack. */
  private clear(): void {
    this.root.clear();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const p of this.artProps) p.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.artProps.length = 0;
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
  }
}
