// VehicleView — the get-away ride. When a heist is WON (objective.winningTeam set), a themed
// vehicle appears at the extraction point and drives off, selling the "depart the level" beat the
// player triggers with [E]/[Q] at the extraction. Boat on beach themes, train at a station, a car
// everywhere else. Purely cosmetic; it reads the authoritative win + the pack's extraction point.
import * as THREE from 'three';
import type { NetMatchState, Vec3Tuple } from '@deceive/shared';

type VehicleKind = 'car' | 'boat' | 'train';

/** Pick a get-away vehicle from a pack theme. */
function vehicleForTheme(theme: string): VehicleKind {
  const t = theme.toLowerCase();
  if (t.includes('beach') || t.includes('harbor') || t.includes('water')) return 'boat';
  if (t.includes('station') || t.includes('train') || t.includes('subway')) return 'train';
  return 'car';
}

const DRIVE_SPEED = 7; // m/s the ride accelerates away to
const RIDE_SECONDS = 6; // how long it drives before we stop animating

export class VehicleView {
  private readonly root = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private exit: Vec3Tuple = [0, 0, 0];
  private kind: VehicleKind = 'car';
  private built = false;
  private launched = false;
  private t = 0;

  constructor(scene: THREE.Scene) {
    this.root.visible = false;
    scene.add(this.root);
  }

  /** Configure the get-away for the loaded pack (theme picks the vehicle, exit is where it waits). */
  setRoute(theme: string, extractionPoint: Vec3Tuple | undefined): void {
    this.kind = vehicleForTheme(theme);
    this.exit = extractionPoint ?? [0, 0, 0];
  }

  private mat(color: number, rough = 0.5, metal = 0.4, emissive = 0x000000): THREE.Material {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive });
    this.disposables.push(m);
    return m;
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, pos: [number, number, number]): void {
    const g = new THREE.BoxGeometry(w, h, d);
    this.disposables.push(g);
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    this.root.add(mesh);
  }

  private wheel(x: number, z: number, mat: THREE.Material): void {
    const g = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 12);
    this.disposables.push(g);
    const w = new THREE.Mesh(g, mat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.35, z);
    this.root.add(w);
  }

  /** Build the chosen vehicle's low-poly mesh once (lazily, on the first win). */
  private build(): void {
    if (this.built) return;
    this.built = true;
    if (this.kind === 'boat') {
      const hull = this.mat(0xcdd6e6, 0.6, 0.2);
      this.box(1.8, 0.7, 4.2, hull, [0, 0.7, 0]);
      this.box(1.2, 0.8, 1.6, this.mat(0x6f86ff, 0.4, 0.3), [0, 1.4, -0.4]);
      this.box(0.15, 1.4, 0.15, this.mat(0x2a2d3c), [0, 2.0, 0.6]); // mast
    } else if (this.kind === 'train') {
      const body = this.mat(0x8a3b3b, 0.6, 0.3);
      this.box(2.2, 2.0, 6.5, body, [0, 1.2, 0]);
      this.box(2.0, 0.7, 6.7, this.mat(0x2a2d3c), [0, 0.4, 0]);
      this.box(1.6, 0.9, 1.4, this.mat(0x1b1d28, 0.5, 0.4, 0x222a44), [0, 2.0, 2.4]); // cab
    } else {
      const body = this.mat(0x2f6bff, 0.4, 0.5);
      this.box(2.0, 0.7, 4.2, body, [0, 0.8, 0]);
      this.box(1.7, 0.7, 2.0, this.mat(0x9fc0ff, 0.3, 0.4, 0x16306a), [0, 1.35, -0.2]); // cabin
      const tyre = this.mat(0x14151c, 0.8, 0.1);
      this.wheel(-1.0, 1.3, tyre);
      this.wheel(1.0, 1.3, tyre);
      this.wheel(-1.0, -1.3, tyre);
      this.wheel(1.0, -1.3, tyre);
    }
    this.root.position.set(this.exit[0], this.exit[1], this.exit[2]);
  }

  /** Read the win + drive the ride away. `dt` seconds. */
  sync(state: NetMatchState, dt: number): void {
    const won = state.objective.winningTeam !== -1;
    if (won && !this.launched) {
      this.build();
      this.root.visible = true;
      this.launched = true;
      this.t = 0;
    }
    if (this.launched && this.t < RIDE_SECONDS) {
      this.t += dt;
      // Ease in, then drive off along -Z (toward the horizon past the extraction edge).
      const speed = DRIVE_SPEED * Math.min(1, this.t / 1.2);
      this.root.position.z -= speed * dt;
      if (this.kind !== 'boat') this.root.rotation.y = 0; // keep the car/train facing forward
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.root.removeFromParent();
  }
}
