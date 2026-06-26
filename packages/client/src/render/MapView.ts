// MapView — the REAL, reusable Three.js renderer for a map's authored content
// (PROJECT_BRIEF §2b/§8). Given a `ContentPack` (the SAME shared schema the server
// resolves), it builds greybox 3D for every authored element so the clearance layout +
// objective flow read at a glance. The game mounts this for static map geometry; the
// preview harness just mounts the same component over a file-loaded pack — never a
// forked "preview renderer" (PROJECT_BRIEF §4.5).
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
  buildDoorFrame,
  buildKeycardReader,
  buildPlanter,
  buildServerRack,
  buildTerminal,
  buildVaultPodium,
  type ArtProp,
} from '../art/props';

/** Blend hex colour `a` toward `b` by `t` (0..1). */
function mix(a: number, b: number, t: number): number {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}

// Sleek modern spy-HQ palette: cool brushed-steel surfaces, a bright cyan accent strip, and
// cool-white overhead light panels (the bloom post-pass makes the accents + lights glow).
const HQ_FLOOR = 0x39414f;
const HQ_WALL = 0x474e5c;
const HQ_ACCENT = 0x33d6e6;
const HQ_CEILING_LIGHT = 0xcfe6ff;

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

    // --- zones: a solid tinted FLOOR slab + a glowing tier baseboard curb, so each clearance
    //     area reads as an actual ROOM. We also accumulate the overall footprint for the
    //     enclosing outer walls below. (The live NPC crowd is drawn by NpcView, not here.) ---
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;

    for (const zone of pack.zones) {
      const { center, size } = boundsToBox(zone.bounds.min, zone.bounds.max);
      const [sx, , sz] = size;
      minX = Math.min(minX, center[0] - sx / 2);
      maxX = Math.max(maxX, center[0] + sx / 2);
      minZ = Math.min(minZ, center[2] - sz / 2);
      maxZ = Math.max(maxZ, center[2] + sz / 2);

      const tint = tierColor(zone.requiredClearance);
      // Brushed-steel floor with a faint tier wash + a slight metallic sheen.
      const floor = this.box([sx, 0.12, sz], mix(HQ_FLOOR, tint, 0.16), {
        roughness: 0.68,
        metalness: 0.28,
      });
      floor.position.set(center[0], 0.06, center[2]);
      floor.receiveShadow = true;
      this.root.add(floor);

      this.addCurb(center, sx, sz, tint);
      this.addCeilingLight(center, sx);
      this.addSetDressing(center, sx, sz);
    }

    // --- outer walls: enclose the whole facility so the space reads as a building ---
    if (Number.isFinite(minX)) this.addOuterWalls(minX, minZ, maxX, maxZ);

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
    const opts: THREE.MeshStandardMaterialParameters = {
      emissive: color,
      emissiveIntensity: 0.65,
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

  /** A bit of lived-in set dressing per room: a server rack against one corner + a planter in
   *  the opposite one (inset off the walls). Cosmetic — no collision. */
  private addSetDressing(center: Vec3Tuple, sx: number, sz: number): void {
    const inset = 1.2;
    const rack = buildServerRack();
    rack.group.position.set(center[0] - sx / 2 + inset, 0, center[2] - sz / 2 + inset);
    rack.group.rotation.y = Math.PI / 4;
    this.root.add(rack.group);
    this.artProps.push(rack);

    this.placeProp(buildPlanter(), [center[0] + sx / 2 - inset, 0, center[2] + sz / 2 - inset]);
  }

  /** A cool-white overhead light panel centred over a room (glows under the bloom pass). */
  private addCeilingLight(center: Vec3Tuple, sx: number): void {
    const panel = this.box([Math.min(sx * 0.5, 12), 0.12, 0.7], HQ_CEILING_LIGHT, {
      emissive: HQ_CEILING_LIGHT,
      emissiveIntensity: 0.9,
      roughness: 0.3,
    });
    panel.position.set(center[0], 4.7, center[2]);
    this.root.add(panel);
  }

  /** Enclosing brushed-steel walls with a glowing cyan accent strip along their base. */
  private addOuterWalls(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const h = 5;
    const t = 0.4;
    const w = maxX - minX;
    const d = maxZ - minZ;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const opts: THREE.MeshStandardMaterialParameters = { roughness: 0.78, metalness: 0.18 };
    const accent: THREE.MeshStandardMaterialParameters = {
      emissive: HQ_ACCENT,
      emissiveIntensity: 0.7,
      roughness: 0.4,
    };
    // A wall panel + a thin cyan accent strip running along its inner base. `inset` nudges the
    // strip just inside the wall so it faces the room.
    const wall = (sw: number, sd: number, x: number, z: number, insetX: number, insetZ: number): void => {
      const m = this.box([sw, h, sd], HQ_WALL, opts);
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);

      const horizontal = sw > sd;
      const strip = this.box(
        horizontal ? [sw * 0.98, 0.12, 0.06] : [0.06, 0.12, sd * 0.98],
        HQ_ACCENT,
        accent,
      );
      strip.position.set(x + insetX, 0.45, z + insetZ);
      this.root.add(strip);
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
