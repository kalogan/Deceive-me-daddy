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
  buildArcadeCabinet,
  buildBarCounter,
  buildBeachBall,
  buildBeachUmbrella,
  buildCeilingDuct,
  buildDais,
  buildDancefloor,
  buildDjBooth,
  buildDoorFrame,
  buildFireplace,
  buildFloorDecal,
  buildGlassPartition,
  buildGlobePendant,
  buildHangingSign,
  buildHazardStripe,
  buildKeycardReader,
  buildLabBench,
  buildLifeguardTower,
  buildLoungeSet,
  buildMonstera,
  buildNeonSign,
  buildNeonStrip,
  buildPalm,
  buildPatioSet,
  buildPinball,
  buildPlanter,
  buildPlanterBox,
  buildRailing,
  buildRingTrack,
  buildServerRack,
  buildSpeakerStack,
  buildSpotLight,
  buildSunLounger,
  buildSurfboard,
  buildTerminal,
  buildTikiBar,
  buildVaultPodium,
  buildVelvetRope,
  buildWallClock,
  buildWallMonitor,
  buildWallSconce,
  ACCENT_CYAN,
  BEACH_CABANA,
  BEACH_CORAL,
  BEACH_OCEAN,
  BEACH_SAND,
  BEACH_TEAL,
  BEACH_WOOD,
  NEON_CYAN,
  NEON_MAGENTA,
  type ArtProp,
} from '../art/props';
import {
  STATION_FLOOR,
  STATION_WALL,
  STATION_PILLAR,
  STATION_ACCENT,
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
} from '../art/stationProps';
import {
  MALL_FLOOR,
  MALL_WALL,
  MALL_PILLAR,
  MALL_ACCENT,
  buildStorefront,
  buildEscalator,
  buildFountain,
  buildFoodCourtSet,
  buildMallPlanter,
  buildDirectory,
  buildKiosk,
  buildBalconyRail,
  buildHangingBanner,
  buildBenchSeat,
} from '../art/mallProps';
// Type-only import (erased at build → no bundle cost). The implementation is loaded lazily via a
// dynamic import in setPack(), so prop-free maps never pull GLTFLoader/DRACOLoader into the bundle.
import type { MapPropLayer } from './mapProps';

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
  // Glossier cool floor: much lower roughness + a touch more metalness reads as a polished,
  // crisply-specular HQ floor under the directional key + bloom (no real reflection pass).
  floorRoughness: 0.32,
  floorMetalness: 0.45,
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
  // Dark glossy reflective club floor: very low roughness + high metalness for a wet-look
  // sheen that catches the neon as crisp specular streaks.
  floorRoughness: 0.12,
  floorMetalness: 0.7,
  tierWash: 0.1,
};

// Sunny outdoor beachfront palette: warm sandy floors, light boardwalk wood, white/cream
// cabana structures, teal/aqua water + umbrella accents. Bright and matte — the daylight
// fill (hemisphere + sun) added to the root for this theme does the lighting, not glow.
const BEACH: ThemePalette = {
  floor: BEACH_SAND,
  wall: BEACH_WOOD,
  pillar: BEACH_CABANA,
  accent: BEACH_TEAL,
  // Outdoor: no overhead light panels (the sky/sun light the scene). Kept for completeness.
  ceilingLight: 0xfff2cf,
  ceilingLightIntensity: 0.0,
  // Matte dry sand — high roughness, no metalness.
  floorRoughness: 0.95,
  floorMetalness: 0.0,
  tierWash: 0.12,
};

// Bright transit-hall palette: pale stone floors, light concrete walls, warm amber departure-board
// signage. Lit, clean, public — the structural shell reads as a grand station once dressed.
const STATION: ThemePalette = {
  floor: STATION_FLOOR,
  wall: STATION_WALL,
  pillar: STATION_PILLAR,
  accent: STATION_ACCENT,
  ceilingLight: 0xfff0d8,
  ceilingLightIntensity: 0.85,
  floorRoughness: 0.5,
  floorMetalness: 0.12,
  tierWash: 0.12,
};

// Bright modern indoor-mall palette: light cream tile, white columns, friendly teal storefront
// signage, lots of glass. The brightest theme — clean and airy.
const MALL: ThemePalette = {
  floor: MALL_FLOOR,
  wall: MALL_WALL,
  pillar: MALL_PILLAR,
  accent: MALL_ACCENT,
  ceilingLight: 0xffffff,
  ceilingLightIntensity: 1.0,
  floorRoughness: 0.3,
  floorMetalness: 0.2,
  tierWash: 0.1,
};

type ThemeId = 'research_facility' | 'nightclub' | 'beach' | 'train_station' | 'shopping_mall';

function resolveTheme(theme: string): ThemeId {
  if (theme === 'nightclub') return 'nightclub';
  if (theme === 'beach') return 'beach';
  if (theme === 'train_station') return 'train_station';
  if (theme === 'shopping_mall') return 'shopping_mall';
  return 'research_facility';
}

const PALETTE_BY_THEME: Record<ThemeId, ThemePalette> = {
  research_facility: FACILITY,
  nightclub: NEON,
  beach: BEACH,
  train_station: STATION,
  shopping_mall: MALL,
};

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
  // Theme lights we parent to root (e.g. the beach sun + hemisphere fill). Tracked so clear()
  // removes them — switching beach→facility must not leave the scene lit by a stray sun.
  private readonly lights: THREE.Light[] = [];

  // Active theme for the current pack (set at the top of setPack).
  private themeId: ThemeId = 'research_facility';
  private palette: ThemePalette = FACILITY;

  // The imported-GLB prop layer for the current pack (cosmetic set-dressing — only packs that author
  // `props` have one). Loaded ASYNCHRONOUSLY via a dynamic import of ./mapProps, so the base game
  // bundle never pulls in GLTFLoader/DRACOLoader for prop-free maps. `propToken` guards against a
  // stale async load resolving after a newer setPack()/clear().
  private propLayer: MapPropLayer | null = null;
  private propToken = 0;

  // The owning scene — the beach theme overrides its background/fog to a real sky (so distant
  // geometry fades to SKY, not black, from EVERY orbit angle). We remember the originals the
  // first time we override them and RESTORE them in clear(), so switching beach→facility/neon
  // returns to the dark night scene exactly as before. `envOverridden` makes the restore
  // idempotent + leak-free (the saved background colour, if any, is disposed on restore).
  private readonly scene: THREE.Scene;
  private envOverridden = false;
  private savedBackground: THREE.Scene['background'] = null;
  private savedFog: THREE.Scene['fog'] = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
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
    this.palette = PALETTE_BY_THEME[this.themeId];
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
      // Themed floor with a faint per-tier wash (kept across themes) + a theme sheen. On the
      // beach the slab carries a polygonOffset + sits a touch higher (bottom clear of the scene
      // grid at y≈0 and well above the sand apron below it) so it never z-fights them — that
      // coplanar overlap with the grid/ground was the old ground "flicker".
      const beach = this.themeId === 'beach';
      const floorOpts: THREE.MeshStandardMaterialParameters = {
        roughness: pal.floorRoughness,
        metalness: pal.floorMetalness,
      };
      if (beach) {
        floorOpts.polygonOffset = true;
        floorOpts.polygonOffsetFactor = -1;
        floorOpts.polygonOffsetUnits = -1;
      }
      const floor = this.box([sx, 0.12, sz], mix(pal.floor, tint, pal.tierWash), floorOpts);
      // Beach slab lifted so its BOTTOM (y≈0.04) clears the scene grid/ground at y≈0; other
      // themes keep the original y. Props authored at y≈0 still rest visually on the ~0.16 top.
      floor.position.set(center[0], beach ? 0.1 : 0.06, center[2]);
      floor.receiveShadow = true;
      this.root.add(floor);

      this.addCurb(center, sx, sz, tint);
      if (this.themeId === 'nightclub') {
        this.addNeonZoneDressing(zone.requiredClearance, center, sx, sz);
      } else if (this.themeId === 'beach') {
        this.addBeachFloorTrim(zone.requiredClearance, center, sx, sz);
      } else {
        this.addFloorSeams(center, sx, sz);
      }
      // Outdoor levels are lit by the sky/sun, not overhead panels — skip the ceiling light.
      if (this.themeId !== 'beach') this.addCeilingLight(center, sx);
      this.addSetDressing(zone.requiredClearance, center, sx, sz);
    }

    // --- outer walls + structural pillars at the zone corners (the building's frame).
    //     The beach is an OUTDOOR level: it gets a low boardwalk perimeter rim instead of tall
    //     enclosing walls, plus an ocean/sky/sun environment (added below). ---
    if (Number.isFinite(minX)) {
      if (this.themeId === 'beach') this.addBeachEnvironment(minX, minZ, maxX, maxZ);
      else this.addOuterWalls(minX, minZ, maxX, maxZ);
    }
    for (const [cx, cz] of corners.values()) this.addPillar(cx, cz);

    // --- hero centrepiece: a raised dais near the map centre (+ a neon ring-track on the
    //     club's dancefloor) so each level has a focal platform like the references. ---
    if (Number.isFinite(minX)) {
      this.addCentrepiece((minX + maxX) / 2, (minZ + maxZ) / 2, minZ);
    }

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

    // --- imported-GLB props (cosmetic set-dressing, e.g. the Sandbox test range). Loaded async via
    //     a DYNAMIC import so prop-free maps never bundle the glTF/DRACO loaders. clear() already
    //     bumped propToken, so a stale in-flight load from the previous pack drops itself. ---
    if (pack.props.length > 0) {
      void this.loadProps(pack.props, this.propToken);
    }
  }

  /** Stream + mount this pack's imported props. Guarded by `token`: if a newer setPack()/clear()
   *  bumped propToken while we were loading, we dispose the result instead of mounting a stale map's
   *  props. The dynamic import keeps GLTFLoader/DRACOLoader out of the base bundle. */
  private async loadProps(placements: ContentPack['props'], token: number): Promise<void> {
    try {
      const { loadMapProps } = await import('./mapProps');
      const layer = await loadMapProps(placements);
      if (token !== this.propToken || !this.root) {
        layer.dispose();
        return;
      }
      this.propLayer = layer;
      this.root.add(layer.group);
    } catch (err) {
      console.error('[MapView] prop layer failed to load', err);
    }
  }

  /** Pump the imported props' animations (mixers). Called each frame by the game + preview loops;
   *  a no-op when the current map has no props. `dt` seconds. */
  update(dt: number): void {
    this.propLayer?.update(dt);
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
    else if (this.themeId === 'beach') this.addBeachSetDressing(tier, center, sx, sz);
    else if (this.themeId === 'train_station') this.addStationSetDressing(tier, center, sx, sz);
    else if (this.themeId === 'shopping_mall') this.addMallSetDressing(tier, center, sx, sz);
    else this.addFacilitySetDressing(tier, center, sx, sz);
  }

  // --- TRAIN STATION set dressing ----------------------------------------------------------------

  /**
   * Transit-hall dressing, themed by tier so each zone reads as part of a station: the public
   * concourse (civilian) gets a departure board, benches, a clock pillar + vending; the ticketing
   * hall (staff) gets benches + an arrivals blade; signal control (security) gets ticket gates; the
   * platform/vault (scientist) gets a train car at the back edge, a safety stripe + a canopy.
   * Placed in corners / against the back wall so nothing overlaps gameplay markers. Cosmetic.
   */
  private addStationSetDressing(
    tier: ClearanceTier,
    center: Vec3Tuple,
    sx: number,
    sz: number,
  ): void {
    const inset = 1.6;
    const [cx, , cz] = center;
    const hx = sx / 2;
    const hz = sz / 2;

    // A clock pillar in one corner + an arrivals blade in another — every zone gets station signage.
    this.placeProp(buildPillarClock(3.6), [cx - hx + inset, 0, cz - hz + inset]);
    this.placeProp(buildArrivalsPillar(), [cx + hx - inset, 0, cz - hz + inset]);

    if (tier === 'civilian') {
      // The concourse: a big departure board against the back wall + waiting benches + vending.
      const board = buildDepartureBoard(Math.min(sx * 0.4, 6));
      board.group.position.set(cx, 0, cz - hz + 0.8);
      this.root.add(board.group);
      this.artProps.push(board);
      this.placeBenchRow(buildBench, cx, cz, hz, 3);
      this.placeProp(buildVendingMachine(), [cx + hx - inset, 0, cz + hz - inset]);
      this.placeProp(buildLuggageCart(), [cx - hx + inset * 2.4, 0, cz + hz - inset]);
    } else if (tier === 'staff') {
      // Ticketing hall: benches + a vending bank against the wall.
      this.placeBenchRow(buildBench, cx, cz, hz, 2);
      this.placeProp(buildVendingMachine(), [cx - hx + inset, 0, cz + hz - inset]);
      this.placeProp(buildLuggageCart(), [cx + hx - inset, 0, cz + hz - inset]);
    } else if (tier === 'security') {
      // Signal control: a row of ticket gates fronting the wing.
      for (let i = -1; i <= 1; i++) {
        this.placeProp(buildTicketGate(), [cx + i * 2.6, 0, cz - hz + inset]);
      }
    } else {
      // The platform (vault): a train car along the back edge, a safety stripe + a canopy + benches.
      const car = buildTrainCar(Math.min(sx * 0.8, 16));
      car.group.position.set(cx, 0, cz - hz + 1.0);
      this.root.add(car.group);
      this.artProps.push(car);
      const stripe = buildPlatformStripe(Math.min(sx * 0.8, 16));
      stripe.group.position.set(cx, 0.02, cz - hz + 2.6);
      this.root.add(stripe.group);
      this.artProps.push(stripe);
      this.placeProp(buildPlatformCanopy(Math.min(sx * 0.6, 10)), [cx, 0, cz + hz * 0.2]);
      this.placeBenchRow(buildBench, cx, cz, hz, 2);
    }
  }

  /** Lay a short row of benches along the south wall of a zone, facing in. Helper for stations/malls. */
  private placeBenchRow(make: (len?: number) => ArtProp, cx: number, cz: number, hz: number, count: number): void {
    const spacing = 3.0;
    const start = -((count - 1) / 2) * spacing;
    for (let i = 0; i < count; i++) {
      const bench = make(2.4);
      bench.group.position.set(cx + start + i * spacing, 0, cz + hz - 1.4);
      bench.group.rotation.y = Math.PI;
      this.root.add(bench.group);
      this.artProps.push(bench);
    }
  }

  // --- SHOPPING MALL set dressing ----------------------------------------------------------------

  /**
   * Bright indoor-mall dressing, themed by tier: the central atrium (civilian) gets a fountain
   * centrepiece, a directory, food-court seating + planters; the retail wing (staff) gets storefronts
   * + a kiosk; mall security (security) gets a balcony rail + benches; the management suite (scientist)
   * gets an escalator + a hanging banner. Placed against walls / in corners, off the markers. Cosmetic.
   */
  private addMallSetDressing(
    tier: ClearanceTier,
    center: Vec3Tuple,
    sx: number,
    sz: number,
  ): void {
    const inset = 1.8;
    const [cx, , cz] = center;
    const hx = sx / 2;
    const hz = sz / 2;

    // Every zone: a leafy planter + a modern bench for that lived-in mall feel.
    this.placeProp(buildMallPlanter(2.6), [cx - hx + inset, 0, cz - hz + inset]);
    this.placeProp(buildBenchSeat(), [cx + hx - inset, 0, cz + hz - inset]);

    if (tier === 'civilian') {
      // The atrium: a fountain centrepiece, a directory, and food-court seating.
      this.placeProp(buildFountain(2.4), [cx, 0, cz + hz * 0.1]);
      this.placeProp(buildDirectory(), [cx + hx - inset, 0, cz - hz + inset]);
      this.placeProp(buildFoodCourtSet(), [cx - hx + inset * 2.6, 0, cz + hz - inset * 1.4]);
      this.placeProp(buildFoodCourtSet(), [cx + hx - inset * 2.6, 0, cz - hz + inset * 1.4]);
    } else if (tier === 'staff') {
      // Retail wing: storefronts along the back wall + an island kiosk.
      for (let i = -1; i <= 1; i++) {
        const shop = buildStorefront(Math.min(sx * 0.28, 5));
        shop.group.position.set(cx + i * Math.min(sx * 0.3, 6), 0, cz - hz + 0.6);
        this.root.add(shop.group);
        this.artProps.push(shop);
      }
      this.placeProp(buildKiosk(), [cx, 0, cz + hz * 0.2]);
    } else if (tier === 'security') {
      // Mall security: an upper-floor balcony rail along the wall + a hanging banner.
      const rail = buildBalconyRail(Math.min(sx * 0.7, 8));
      rail.group.position.set(cx, 0, cz - hz + 0.5);
      this.root.add(rail.group);
      this.artProps.push(rail);
      this.placeProp(buildHangingBanner(2, MALL_ACCENT), [cx + hx - inset, 3.6, cz]);
    } else {
      // Management suite (vault): an escalator up + a hanging banner over the approach.
      const esc = buildEscalator();
      esc.group.position.set(cx - hx + inset * 1.6, 0, cz + hz - inset);
      esc.group.rotation.y = Math.PI / 2;
      this.root.add(esc.group);
      this.artProps.push(esc);
      this.placeProp(buildHangingBanner(2.2, MALL_ACCENT), [cx, 3.8, cz - hz * 0.3]);
    }
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

    // LUSH GREENERY: a tall palm in the NE corner + a leafy monstera in the SW corner, plus a
    // hedge planter along part of the south wall. Generous, against walls, off the markers.
    this.placeProp(buildPalm(3.2), [cx + hx - inset, 0, cz - hz + inset]);
    this.placeProp(buildMonstera(1.1), [cx - hx + inset, 0, cz + hz - inset]);
    if (sx >= 10) {
      this.placeProp(buildPlanterBox(Math.min(sx * 0.34, 5)), [cx + hx * 0.2, 0, cz + hz - 0.7]);
    }

    // Warm globe pendant lights hung off-centre so the cool HQ gets a warm practical glow.
    for (const sign of [-1, 1]) {
      this.placeProp(buildGlobePendant(0xffe2b0), [cx + sign * hx * 0.45, 4.1, cz + sign * hz * 0.2]);
    }

    // A wall sconce + a wall clock flanking the west monitor wall for lived-in detail.
    const sconce = buildWallSconce(0xffc27a);
    sconce.group.position.set(cx - hx + 0.25, 3.2, cz - hz * 0.45);
    sconce.group.rotation.y = Math.PI / 2;
    this.root.add(sconce.group);
    this.artProps.push(sconce);

    const clock = buildWallClock(ACCENT_CYAN);
    clock.group.position.set(cx - hx + 0.25, 3.4, cz + hz * 0.45);
    clock.group.rotation.y = Math.PI / 2;
    this.root.add(clock.group);
    this.artProps.push(clock);

    // A glowing target/bullseye floor rug as decorative floor work in larger rooms.
    if (sx >= 12 && sz >= 12) {
      const rug = buildFloorDecal('target', 4.5, ACCENT_CYAN);
      rug.group.position.set(cx - hx * 0.3, 0.13, cz + hz * 0.25);
      this.root.add(rug.group);
      this.artProps.push(rug);
    }

    // The staff offices get a small retro lounge set for a break-room read.
    if (tier === 'staff') {
      const lounge = buildLoungeSet(0x4a6a8c);
      lounge.group.position.set(cx + hx - 2.4, 0, cz + hz - 2.6);
      lounge.group.rotation.y = -Math.PI * 0.75;
      this.root.add(lounge.group);
      this.artProps.push(lounge);
    }

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

    // LUSH GREENERY in every club room: tall palms flanking the back wall + a leafy monstera
    // tucked into a front corner. Warm globe pendants mix with the neon for a clubby glow.
    for (const sgn of [-1, 1]) {
      this.placeProp(buildPalm(3.2, 0x4a3550), [cx + sgn * (hx - 1.3), 0, cz - hz + 1.3]);
    }
    this.placeProp(buildMonstera(1.0), [cx - hx + 1.3, 0, cz + hz - 1.3]);
    for (const sgn of [-1, 1]) {
      this.placeProp(buildGlobePendant(0xffb56b), [cx + sgn * hx * 0.5, 4.0, cz + hz * 0.25]);
    }

    if (tier === 'civilian') {
      // The main floor: a glowing dancefloor centred, a DJ booth at the back, flanking speakers.
      const floorW = Math.min(sx * 0.62, 26);
      const floorD = Math.min(sz * 0.62, 26);
      const dance = buildDancefloor(floorW, floorD);
      dance.group.position.set(cx, 0.14, cz);
      this.root.add(dance.group);
      this.artProps.push(dance);

      // The hero concentric NEON RING-TRACK laid right on the dancefloor centre (the club
      // reference's signature floor work), sitting just above the tiles.
      const track = buildRingTrack(Math.min(floorW, floorD) * 0.46, 4);
      track.group.position.set(cx, 0.2, cz);
      this.root.add(track.group);
      this.artProps.push(track);

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

      // A glowing hanging sign over the bar + an arcade cabinet against the east wall.
      const hsign = buildHangingSign(2.0, NEON_CYAN);
      hsign.group.position.set(cx - hx + 2.2, 3.4, cz + hz - 2.2);
      this.root.add(hsign.group);
      this.artProps.push(hsign);

      const arcade = buildArcadeCabinet(NEON_CYAN);
      arcade.group.position.set(cx + hx - 1.2, 0, cz + hz - 1.6);
      arcade.group.rotation.y = -Math.PI / 2;
      this.root.add(arcade.group);
      this.artProps.push(arcade);
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

      // VIP lounge: a retro sofa+table set facing in, a cozy fireplace on the south wall, and
      // a railing hinting a raised mezzanine edge — warm, plush, exclusive.
      const lounge = buildLoungeSet(0x7a3c52);
      lounge.group.position.set(cx + hx * 0.2, 0, cz + hz - 2.4);
      lounge.group.rotation.y = Math.PI;
      this.root.add(lounge.group);
      this.artProps.push(lounge);

      if (sx >= 10) {
        const fire = buildFireplace();
        fire.group.position.set(cx - hx + 2.6, 0, cz + hz - 0.5);
        this.root.add(fire.group);
        this.artProps.push(fire);
      }

      const rail = buildRailing(Math.min(sz * 0.6, 6), NEON_MAGENTA);
      rail.group.position.set(cx + hx - 0.6, 0, cz - hz * 0.1);
      rail.group.rotation.y = Math.PI / 2;
      this.root.add(rail.group);
      this.artProps.push(rail);
    } else if (tier === 'security') {
      // Security booth: a speaker stack + a pinball machine for an off-duty break-room feel.
      const spk = buildSpeakerStack();
      spk.group.position.set(cx + hx - 1.2, 0, cz - hz + 1.2);
      spk.group.rotation.y = -Math.PI / 4;
      this.root.add(spk.group);
      this.artProps.push(spk);

      const pinball = buildPinball();
      pinball.group.position.set(cx - hx + 1.8, 0, cz + hz - 2.0);
      pinball.group.rotation.y = Math.PI / 5;
      this.root.add(pinball.group);
      this.artProps.push(pinball);
    } else {
      // Owner suite: a patio table set under a glowing parasol + a speaker stack for a rooftop
      // VIP terrace read, plus a hanging sign.
      const patio = buildPatioSet(NEON_MAGENTA);
      patio.group.position.set(cx - hx + 2.6, 0, cz + hz - 2.6);
      this.root.add(patio.group);
      this.artProps.push(patio);

      const spk = buildSpeakerStack();
      spk.group.position.set(cx + hx - 1.2, 0, cz - hz + 1.2);
      spk.group.rotation.y = -Math.PI / 4;
      this.root.add(spk.group);
      this.artProps.push(spk);

      const hsign = buildHangingSign(1.8, NEON_MAGENTA);
      hsign.group.position.set(cx, 3.6, cz - hz + 0.6);
      this.root.add(hsign.group);
      this.artProps.push(hsign);
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

  // --- BEACH set dressing + environment -----------------------------------------------------

  /**
   * The OUTDOOR environment that makes the beach read as sunny + open instead of a black void.
   *
   * SKY: instead of a fragile camera-relative dome (which only covers one side when you orbit,
   * leaving black void + a visible dome edge), we override the SCENE's background + fog to a
   * real sunny sky. `scene.background` paints a bright sky-blue behind EVERYTHING from every
   * angle, and a matching light fog fades distant geometry to SKY (never black). The originals
   * are saved + restored in clear() so switching away returns to the dark night scene exactly.
   *
   * GROUND: a FINITE sand apron around the map footprint (running out toward the sea, then the
   * fog/sky takes over) — NOT a giant plane sitting on the scene's own ground/grid (that caused
   * the z-fight shimmer). Every near-horizontal beach plane is on a DISTINCT, spaced Y level and
   * the coplanar-risk surfaces carry a polygonOffset so no two fight for the same depth.
   *
   * Geometry/material are tracked (via box/cylinder/track) and lights via `this.lights` so
   * clear() frees everything; the background/fog override is restored there too.
   */
  private addBeachEnvironment(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const w = maxX - minX;
    const d = maxZ - minZ;

    // REAL SKY — override scene.background to a bright sunny sky-blue + scene.fog to a matching
    // light fog. Saved/restored in clear() (the first override remembers the originals). This is
    // bulletproof: the sky is behind the whole frame from any orbit angle, and distant geometry
    // (the sand apron / ocean running out to the horizon) fades to sky instead of a black edge.
    const skyColor = 0x86c5ef; // sunny sky-blue
    if (!this.envOverridden) {
      this.savedBackground = this.scene.background;
      this.savedFog = this.scene.fog;
      this.envOverridden = true;
    }
    this.scene.background = new THREE.Color(skyColor);
    // Push the fog back far enough that the whole map reads clearly, then fade the far sand/sea
    // into the sky at the horizon. The map span is ~60–70m; start the fade well beyond it.
    this.scene.fog = new THREE.Fog(skyColor, 120, 320);

    // A SAND APRON around the play area so the ground reads as continuous beach out to a fogged
    // horizon (the fog fades its far edge to SKY before it ends — no hard rim, no dark void). It
    // must comfortably COVER the scene's own dark ground plane (≤400m across) so that dark plane
    // never shows as a dark band on the horizon; the matching fog then takes over to sky.
    //
    // Depth ordering (the old "flicker" was a big apron coplanar with the scene grid/ground):
    //   scene ground/grid ≈ y0 (game 0.0, preview -0.02)  <  apron top ≈ y0.06  <  beach slab
    //   bottom ≈ y0.04 … wait — the apron must sit ABOVE the scene ground (to hide it) yet not
    //   poke through the play-area floor slabs. We give it a thin slab whose TOP (≈0.05) clears
    //   the scene ground but stays under the slab tops (≈0.16), plus a polygonOffset so it always
    //   wins the depth test against the coplanar scene ground/grid — zero z-fight from any angle.
    //   (The play-area slabs sit on top of the apron, so the apron only shows in the margin.)
    const apronExtent = 640;
    const apron = this.box([apronExtent, 0.1, apronExtent], BEACH_SAND, {
      roughness: 0.97,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    apron.position.set(cx, 0.0, cz); // top ≈0.05 — over the scene ground, under the slab tops
    apron.receiveShadow = true;
    this.root.add(apron);

    // OCEAN — a wide flat water plane along the north (far) edge, slightly emissive so it reads
    // as bright sea. Its own DISTINCT Y level ABOVE the sand apron (top ≈0.05) so the apron never
    // hides it, and below the foam band; a polygonOffset keeps it from fighting the apron where
    // they overlap near the shoreline. It runs wide so its far edge fogs to sky (no hard rim).
    const oceanY = 0.1; // top ≈0.13 — clearly above the apron top (≈0.05)
    const ocean = this.box([apronExtent, 0.06, 200], BEACH_OCEAN, {
      roughness: 0.18,
      metalness: 0.45,
      emissive: 0x1d5e86,
      emissiveIntensity: 0.28,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    ocean.position.set(cx, oceanY, minZ - 100);
    ocean.receiveShadow = true;
    this.root.add(ocean);

    // A pale foam/wet-sand band where the ocean meets the beach — its own Y level ABOVE the
    // ocean, with a polygonOffset so the thin band never shimmers against the water surface.
    const foam = this.box([w + 20, 0.05, 2.4], 0xeaf6ff, {
      roughness: 0.6,
      emissive: 0xbfe6ff,
      emissiveIntensity: 0.2,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    foam.position.set(cx, 0.2, minZ - 1.0);
    this.root.add(foam);

    // LOW BOARDWALK PERIMETER — a short wood rim instead of tall walls (open-air), with a
    // glowing teal lip so the play area still reads as bounded.
    const t = 0.5;
    const rimH = 0.7;
    const rim = (sw: number, sd: number, x: number, z: number): void => {
      const m = this.box([sw, rimH, sd], BEACH_WOOD, { roughness: 0.85 });
      m.position.set(x, rimH / 2, z);
      this.root.add(m);
    };
    rim(w + t * 2, t, cx, maxZ + t / 2); // back (north)
    rim(t, d, minX - t / 2, cz); // west
    rim(t, d, maxX + t / 2, cz); // east
    // (No south rim — that edge opens onto the ocean/beach foreground.)

    // DAYLIGHT FILL — a bright hemisphere (warm sky over sandy ground) + a warm directional sun
    // casting from the south-west. Parented to root so clear() removes them with the map.
    const hemi = new THREE.HemisphereLight(0xbfe4ff, 0xe8d9a8, 1.15);
    hemi.position.set(cx, 40, cz);
    this.root.add(hemi);
    this.lights.push(hemi);

    const sun = new THREE.DirectionalLight(0xfff1cf, 1.5);
    sun.position.set(cx - 30, 45, minZ - 30);
    sun.target.position.set(cx, 0, cz);
    this.root.add(sun.target);
    this.root.add(sun);
    this.lights.push(sun);
  }

  /** A subtle beach floor trim: a slightly darker damp-sand band along the shoreline edge. */
  private addBeachFloorTrim(
    tier: ClearanceTier,
    center: Vec3Tuple,
    sx: number,
    sz: number,
  ): void {
    const [cx, , cz] = center;
    // The boardwalk + decks read as light wood planking laid over the sand: a few long planks.
    // Laid just ABOVE the beach zone slab (top ≈0.16) on their own Y, with a polygonOffset so the
    // thin planks never z-fight the floor beneath them.
    if (tier !== 'civilian') {
      const plankColor = mix(BEACH_WOOD, 0xffffff, 0.08);
      const n = 4;
      for (let i = 0; i < n; i += 1) {
        const z = cz - sz / 2 + (i + 0.5) * (sz / n);
        const plank = this.box([sx * 0.92, 0.05, sz / n - 0.18], plankColor, {
          roughness: 0.85,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        plank.position.set(cx, 0.22, z);
        this.root.add(plank);
      }
    }
  }

  /**
   * Beach dressing keyed to the zone's tier: the public beach gets umbrellas, loungers, a tiki
   * bar + a beach ball; the boardwalk gets shop cabanas + a vendor parasol; the beach club gets
   * a lifeguard tower + pool-deck loungers; the pier villa gets a private cabana + surfboards.
   * Placed in corners / against the perimeter, clear of the gameplay markers + paths.
   */
  private addBeachSetDressing(
    tier: ClearanceTier,
    center: Vec3Tuple,
    sx: number,
    sz: number,
  ): void {
    const [cx, , cz] = center;
    const hx = sx / 2;
    const hz = sz / 2;
    const inset = 2.0;

    // Tall palms flank the back corners of every beach zone (lush + sunny, off the paths).
    for (const sgn of [-1, 1]) {
      this.placeProp(buildPalm(3.6), [cx + sgn * (hx - 1.6), 0, cz - hz + 1.6]);
    }

    if (tier === 'civilian') {
      // Public beach: a row of bright umbrellas + loungers across the open sand, a tiki bar in a
      // back corner, and a beach ball + surfboard for life.
      const umbrellaCols = [BEACH_TEAL, BEACH_CORAL, BEACH_CABANA];
      for (let i = 0; i < 3; i += 1) {
        const ux = cx - hx * 0.5 + i * (hx * 0.5);
        const col = umbrellaCols[i % umbrellaCols.length] ?? BEACH_TEAL;
        this.placeProp(buildBeachUmbrella(col, 3.0), [ux, 0, cz + hz * 0.4]);
        this.placeProp(buildSunLounger(BEACH_CORAL), [ux, 0, cz + hz * 0.4 + 1.4]);
      }
      const tiki = buildTikiBar(Math.min(sx * 0.3, 6));
      tiki.group.position.set(cx - hx + 3.0, 0, cz - hz + 2.0);
      tiki.group.rotation.y = Math.PI / 5;
      this.root.add(tiki.group);
      this.artProps.push(tiki);

      this.placeProp(buildBeachBall(BEACH_CORAL), [cx + hx * 0.3, 0, cz + hz * 0.15]);
      this.placeProp(buildSurfboard(BEACH_TEAL), [cx + hx - inset, 0, cz - hz * 0.1]);
    } else if (tier === 'staff') {
      // Boardwalk shops: white cabana stalls along a wall + a vendor parasol over a counter.
      for (const sgn of [-1, 1]) {
        const stall = buildBeachUmbrella(sgn < 0 ? BEACH_CORAL : BEACH_TEAL, 2.8);
        stall.group.position.set(cx + sgn * hx * 0.4, 0, cz + hz - inset);
        this.root.add(stall.group);
        this.artProps.push(stall);
      }
      const bar = buildBarCounter(Math.min(sx * 0.32, 5));
      bar.group.position.set(cx + hx - 2.0, 0, cz);
      bar.group.rotation.y = -Math.PI / 2;
      this.root.add(bar.group);
      this.artProps.push(bar);

      this.placeProp(buildSunLounger(BEACH_TEAL), [cx - hx + inset, 0, cz + hz * 0.2]);
      // A boardwalk railing run along the front (south) edge.
      const rail = buildRailing(Math.min(sx * 0.7, 8), BEACH_TEAL);
      rail.group.position.set(cx, 0.0, cz - hz + 0.8);
      this.root.add(rail.group);
      this.artProps.push(rail);
    } else if (tier === 'security') {
      // Beach club pool deck: a lifeguard tower landmark + a row of poolside loungers.
      const tower = buildLifeguardTower();
      tower.group.position.set(cx + hx - 3.0, 0, cz - hz + 3.0);
      this.root.add(tower.group);
      this.artProps.push(tower);

      for (let i = 0; i < 2; i += 1) {
        this.placeProp(buildSunLounger(BEACH_CABANA), [cx - hx + 2.4, 0, cz - hz + 4 + i * 2.4]);
      }
      this.placeProp(buildBeachUmbrella(BEACH_CABANA, 3.0), [cx - hx + 2.4, 0, cz - hz + 3.0]);
    } else {
      // Pier villa (vault): a private cabana parasol + a pair of surfboards leaning against the
      // back wall, for an exclusive beach-house terrace read.
      const cabana = buildBeachUmbrella(BEACH_CORAL, 3.2);
      cabana.group.position.set(cx - hx + 2.6, 0, cz + hz - 2.6);
      this.root.add(cabana.group);
      this.artProps.push(cabana);

      for (let i = 0; i < 2; i += 1) {
        const board = buildSurfboard(i === 0 ? BEACH_TEAL : BEACH_CORAL);
        board.group.position.set(cx + hx - 1.4 - i * 0.7, 0, cz - hz + 1.4);
        board.group.rotation.z = (i === 0 ? 1 : -1) * 0.12;
        this.root.add(board.group);
        this.artProps.push(board);
      }
      this.placeProp(buildSunLounger(BEACH_TEAL), [cx + hx * 0.2, 0, cz + hz - 2.0]);
    }
  }

  /**
   * The hero centrepiece: a low raised DAIS at the map centre with a theme-tinted glowing rim
   * (cyan for the HQ, magenta for the club) ringed by a railing + flanking greenery. The club
   * also gets a concentric neon RING-TRACK laid on its dancefloor (front-left room centre).
   * One per map — placed at the building centre, clear of the objective/extraction markers.
   */
  private addCentrepiece(cx: number, cz: number, minZ: number): void {
    const neon = this.themeId === 'nightclub';
    const beach = this.themeId === 'beach';
    const rim = neon ? NEON_MAGENTA : beach ? BEACH_TEAL : ACCENT_CYAN;
    const radius = 4.2;

    const dais = buildDais(radius, rim);
    dais.group.position.set(cx, 0, cz);
    this.root.add(dais.group);
    this.artProps.push(dais);

    // A four-segment railing ring around the dais edge (architectural depth).
    const railLen = radius * 1.5;
    const railR = radius + 0.35;
    const railDefs: Array<[number, number, number]> = [
      [cx, cz - railR, 0],
      [cx, cz + railR, 0],
      [cx - railR, cz, Math.PI / 2],
      [cx + railR, cz, Math.PI / 2],
    ];
    for (const [rx, rz, ry] of railDefs) {
      const rail = buildRailing(railLen, rim);
      rail.group.position.set(rx, 0.34, rz);
      rail.group.rotation.y = ry;
      this.root.add(rail.group);
      this.artProps.push(rail);
    }

    // Greenery flanking the dais — tall palms at the four diagonal corners (lush, never on a path).
    const pd = radius + 1.6;
    for (const [sxn, szn] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>) {
      const palm = buildPalm(3.4, neon ? 0x4a3550 : undefined);
      palm.group.position.set(cx + sxn * pd, 0, cz + szn * pd);
      this.root.add(palm.group);
      this.artProps.push(palm);
    }

    // Indoor levels hang a warm globe pendant over the dais. Outdoors there's no ceiling to
    // hang it from — the beach gets a bright parasol on the dais instead.
    if (beach) {
      const parasol = buildBeachUmbrella(BEACH_CORAL, 3.4);
      parasol.group.position.set(cx, 0.45, cz);
      this.root.add(parasol.group);
      this.artProps.push(parasol);
    } else {
      const pendant = buildGlobePendant(neon ? 0xffb56b : 0xffe2b0);
      pendant.group.position.set(cx, 4.0, cz);
      this.root.add(pendant.group);
      this.artProps.push(pendant);
    }

    if (!neon && !beach) {
      // The HQ centrepiece gets a crisp directional-stripe decal radiating off the dais.
      const decal = buildFloorDecal('stripes', radius * 2.4, ACCENT_CYAN);
      decal.group.position.set(cx, 0.13, (cz + minZ) / 2);
      this.root.add(decal.group);
      this.artProps.push(decal);
    }
    // (The club's concentric neon ring-track is laid on its dancefloor in the civilian
    //  zone dressing so it centres exactly on the floor — see addNeonSetDressing.)
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
    // Drop the imported-prop layer first + bump the token so ANY in-flight async prop load (from the
    // pack we're clearing) disposes itself on resolve instead of mounting onto the next map.
    this.propToken++;
    if (this.propLayer) {
      this.propLayer.dispose();
      this.propLayer = null;
    }
    // Restore the scene background/fog if the beach theme overrode them, so switching
    // beach→facility/neon returns to the dark night scene exactly as before (no leftover bright
    // sky/fog). Idempotent + leak-free: we dispose the sky-blue Color we installed, restore the
    // saved originals, and reset the guard so a fresh override re-reads the (restored) originals.
    if (this.envOverridden) {
      // We install a THREE.Color background (no GPU resource to free); if a future variant ever
      // installs a Texture, dispose it so the override stays leak-free.
      const installed = this.scene.background;
      if (installed instanceof THREE.Texture) installed.dispose();
      this.scene.background = this.savedBackground;
      this.scene.fog = this.savedFog;
      this.savedBackground = null;
      this.savedFog = null;
      this.envOverridden = false;
    }
    // Detach + dispose any theme lights first (root.clear() removes them from the graph; we
    // also call dispose() so e.g. a shadow map / target is freed and the sun is fully gone).
    for (const l of this.lights) {
      l.removeFromParent();
      l.dispose();
    }
    this.lights.length = 0;
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
