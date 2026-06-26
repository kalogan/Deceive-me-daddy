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
import { boundsToBox, npcAnchor } from './mapGeometry';

// A neutral colour for elements with no tier (e.g. the objective package / extractions).
const OBJECTIVE_COLOR = '#ffcf3f';
const EXTRACTION_COLOR = '#3fffd0';
const INTEL_COLOR = '#ff7fd0';
const SPAWN_COLOR = '#ffffff';
// A distinct mark for doors that carry a keycard requirement or an intel unlock cost.
const DOOR_SPECIAL_COLOR = '#ffffff';

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

    // Index zones by id so doors/npcs can resolve a home-zone centre.
    const zoneCenters = new Map<string, Vec3Tuple>();

    // --- zones: translucent boxes tinted by required clearance ---
    for (const zone of pack.zones) {
      const { center, size } = boundsToBox(zone.bounds.min, zone.bounds.max);
      zoneCenters.set(zone.id, center);
      const box = this.box(size, tierColor(zone.requiredClearance), {
        opacity: 0.14,
        transparent: true,
      });
      box.position.set(center[0], center[1], center[2]);
      this.root.add(box);

      // A wire outline so adjacent same-tier zones stay legible where boxes overlap.
      const edges = new THREE.LineSegments(
        this.track(new THREE.EdgesGeometry(box.geometry)),
        this.trackMat(
          new THREE.LineBasicMaterial({
            color: tierColor(zone.requiredClearance),
            transparent: true,
            opacity: 0.6,
          }),
        ),
      );
      edges.position.copy(box.position);
      this.root.add(edges);
    }

    // --- doors: small markers tinted by tier, with a topper if special ---
    for (const door of pack.doors) {
      const marker = this.box([0.8, 2.2, 0.8], tierColor(door.requiredClearance));
      this.place(marker, door.position, 1.1);
      this.root.add(marker);

      // A distinct white pip above doors that gate on a keycard or intel unlock.
      if (door.keycardColor || door.intelToUnlock > 0) {
        const pip = this.sphere(0.35, new THREE.Color(DOOR_SPECIAL_COLOR).getHex());
        this.place(pip, door.position, 2.6);
        this.root.add(pip);
      }
    }

    // --- npcs: capsule at a sensible spot in/around the home zone, tier-coloured ---
    for (const npc of pack.npcs) {
      const anchor = npcAnchor(npc.routine.waypoints[0], zoneCenters.get(npc.homeZone));
      const mesh = this.capsule(0.35, 1.4, tierColor(npc.tier));
      this.place(mesh, anchor, 0.9);
      this.root.add(mesh);
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

  private capsule(radius: number, height: number, color: number): THREE.Mesh {
    const geo = this.track(
      new THREE.CapsuleGeometry(radius, Math.max(height - radius * 2, 0.01), 4, 10),
    );
    const mat = this.trackMat(new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
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
