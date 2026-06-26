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

/** A hex colour scaled toward black by `factor` (0..1) — for dark, tier-tinted floors. */
function darken(hex: number, factor: number): number {
  return new THREE.Color(hex).multiplyScalar(factor).getHex();
}

// A neutral colour for elements with no tier (e.g. the objective package / extractions).
const OBJECTIVE_COLOR = '#ffcf3f';
const EXTRACTION_COLOR = '#3fffd0';
const INTEL_COLOR = '#ff7fd0';
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

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
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
      const floor = this.box([sx, 0.1, sz], darken(tint, 0.22), { roughness: 0.95 });
      floor.position.set(center[0], 0.05, center[2]);
      floor.receiveShadow = true;
      this.root.add(floor);

      this.addCurb(center, sx, sz, tint);
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

    // --- keycards: small icon boxes coloured by their tier ---
    for (const card of pack.keycards) {
      const mesh = this.box([0.6, 0.4, 0.05], tierColor(card.color));
      this.place(mesh, card.position, 1.0);
      mesh.rotation.x = Math.PI / 2;
      this.root.add(mesh);
    }

    // --- social spots: low markers tinted by tier ---
    for (const spot of pack.socialSpots) {
      const mesh = this.cylinder(0.5, 0.2, tierColor(spot.tier));
      this.place(mesh, spot.position, 0.1);
      this.root.add(mesh);
    }

    // --- intel nodes: glowing pink markers ---
    for (const node of pack.intelNodes) {
      const mesh = this.sphere(0.45, new THREE.Color(INTEL_COLOR).getHex());
      this.place(mesh, node.position, 1.2);
      this.root.add(mesh);
    }

    // --- objective: a distinct package marker + extraction markers ---
    const pkg = this.box([1.2, 1.2, 1.2], new THREE.Color(OBJECTIVE_COLOR).getHex(), {
      emissive: new THREE.Color(OBJECTIVE_COLOR).getHex(),
      emissiveIntensity: 0.4,
    });
    this.place(pkg, pack.objective.packagePosition, 0.9);
    pkg.rotation.y = Math.PI / 4;
    this.root.add(pkg);

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

  private sphere(radius: number, color: number): THREE.Mesh {
    const geo = this.track(new THREE.SphereGeometry(radius, 16, 12));
    const mat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.5,
        roughness: 0.5,
      }),
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

  /** A low, faintly-glowing tier-coloured baseboard framing a room's floor edges. */
  private addCurb(center: Vec3Tuple, sx: number, sz: number, color: number): void {
    const h = 0.34;
    const t = 0.16;
    const opts: THREE.MeshStandardMaterialParameters = {
      emissive: color,
      emissiveIntensity: 0.25,
      roughness: 0.55,
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

  /** Four tall neutral walls enclosing the facility footprint, so the space feels indoors. */
  private addOuterWalls(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const h = 4.2;
    const t = 0.4;
    const color = 0x2c2f3a;
    const w = maxX - minX;
    const d = maxZ - minZ;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const opts: THREE.MeshStandardMaterialParameters = { roughness: 0.95 };
    const wall = (sw: number, sd: number, x: number, z: number): void => {
      const m = this.box([sw, h, sd], color, opts);
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
    };
    wall(w + t * 2, t, cx, minZ - t / 2);
    wall(w + t * 2, t, cx, maxZ + t / 2);
    wall(t, d, minX - t / 2, cz);
    wall(t, d, maxX + t / 2, cz);
  }

  /** A door as a passage frame: two posts + a lintel, tier-coloured (hotter when special). */
  private addDoorFrame(at: Vec3Tuple, color: number, special: boolean): void {
    const postH = 2.4;
    const postT = 0.26;
    const gap = 1.4;
    const opts: THREE.MeshStandardMaterialParameters = {
      emissive: color,
      emissiveIntensity: special ? 0.55 : 0.2,
      roughness: 0.5,
    };
    const post = (dx: number): void => {
      const m = this.box([postT, postH, postT], color, opts);
      m.position.set(at[0] + dx, postH / 2, at[2]);
      this.root.add(m);
    };
    post(-gap / 2);
    post(gap / 2);
    const lintel = this.box([gap + postT, postT, postT], color, opts);
    lintel.position.set(at[0], postH, at[2]);
    this.root.add(lintel);
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
    this.geometries.length = 0;
    this.materials.length = 0;
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
  }
}
