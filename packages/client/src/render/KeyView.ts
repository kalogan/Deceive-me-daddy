// KeyView owns the Three.js representation of the VAULT KEY flow (objective.requiresVaultKey
// packs — e.g. the tutorial level). Two pieces, both driven from NetMatchState.objective:
//   - the FORGE terminal: a static glowing pillar at the authored keyForgePosition, so the
//     player can see where to assemble the key once they have enough intel;
//   - the loose KEY: a small spinning gold key that appears at keyX/keyZ once forged + loose
//     (keyCreated && no holder), and hides while carried (the HUD shows "CARRYING").
//
// Authority (PROJECT_BRIEF §3/§4.2): positions + state are the sim's word (server online, the
// offline LocalSimSource otherwise); KeyView only PRESENTS them. Inert for non-key packs.
import * as THREE from 'three';
import type { NetMatchState, Vec3Tuple } from '@deceive/shared';

const SPIN_RATE = 1.4; // rad/s — a brisk glint on the loose key
const KEY_HOVER = 1.0; // metres the loose key floats above its point

export class KeyView {
  private readonly root = new THREE.Group();
  private readonly forge = new THREE.Group();
  private readonly key = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private t = 0;
  private active = false;

  constructor(scene: THREE.Scene) {
    // --- Forge terminal: a dark pillar with a glowing amber crown ---
    const pillarGeo = new THREE.CylinderGeometry(0.5, 0.6, 1.6, 12);
    const pillarMat = this.mat(0x2a2d3c, 0.7, 0.25);
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.y = 0.8;
    const crownGeo = new THREE.TorusGeometry(0.5, 0.08, 8, 24);
    const crownMat = this.mat(0xffcf3f, 0.4, 0.3, 0xffcf3f);
    const crown = new THREE.Mesh(crownGeo, crownMat);
    crown.rotation.x = Math.PI / 2;
    crown.position.y = 1.65;
    this.forge.add(pillar, crown);
    this.forge.visible = false;

    // --- Loose vault key: a gold key (ring + shaft + teeth) that spins ---
    const gold = this.mat(0xffd24a, 0.35, 0.6, 0x6a4e10);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 8, 20), gold);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.5), gold);
    shaft.position.z = 0.3;
    const tooth1 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.07, 0.07), gold);
    tooth1.position.set(0.09, 0, 0.5);
    const tooth2 = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.07), gold);
    tooth2.position.set(0.07, 0, 0.42);
    this.key.add(ring, shaft, tooth1, tooth2);
    this.key.visible = false;
    for (const g of [pillarGeo, crownGeo]) this.disposables.push(g);
    this.disposables.push(
      ring.geometry, shaft.geometry, tooth1.geometry, tooth2.geometry,
    );

    this.root.add(this.forge, this.key);
    scene.add(this.root);
  }

  private mat(color: number, rough: number, metal: number, emissive = 0x000000): THREE.Material {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: rough,
      metalness: metal,
      emissive,
      emissiveIntensity: emissive ? 0.5 : 0,
    });
    this.disposables.push(m);
    return m;
  }

  /** Place the forge at the pack's keyForgePosition (call on map load); null disables the view. */
  setForge(pos: Vec3Tuple | null | undefined): void {
    this.active = !!pos;
    this.forge.visible = !!pos;
    if (pos) this.forge.position.set(pos[0], pos[1], pos[2]);
  }

  /** Sync the loose key to the objective + advance the spin. `dt` in seconds. */
  sync(state: NetMatchState, dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const o = state.objective;
    const loose = o.keyCreated && o.keyHolderId === '';
    this.key.visible = loose;
    if (loose) {
      this.key.position.set(o.keyX, o.keyY + KEY_HOVER + Math.sin(this.t * 2) * 0.08, o.keyZ);
      this.key.rotation.y += SPIN_RATE * dt;
    }
    // Pulse the forge crown a touch so it reads as interactive.
    this.forge.rotation.y += dt * 0.3;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.root.removeFromParent();
  }
}
