// PackageView owns the Three.js representation of the LIVE objective package — the heist's
// prize (PROJECT_BRIEF §2). A single glowing briefcase mesh driven from NetMatchState.objective:
// `packageX/Y/Z` is the authoritative package position, which the SERVER moves to follow the
// carrier (packageHolderId) and leaves at the last drop point when loose. So PackageView just
// chases those coords each frame — when carried it rides the holder, when loose it sits in the
// world. It rides a little higher when held so it reads as "in someone's hands".
//
// MapView already draws a STATIC objective marker at the authored spawn (a map legend element);
// THIS is the live one that actually moves with play. Both can coexist — the static one marks
// the vault, this one tracks the package — but we lift this clearly above the floor + spin it
// so the live prize is unmistakable.
//
// Authority (PROJECT_BRIEF §3/§4.2): the package position + holder are the server's word.
// PackageView only PRESENTS them; it owns no objective truth.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { NetMatchState } from '@deceive/shared';

// A warm objective gold, matching MapView's OBJECTIVE_COLOR so the live package and the
// authored marker read as the same prize.
const PACKAGE_COLOR = 0xffcf3f;
const PACKAGE_SIZE = 0.7; // a chunky briefcase/box, distinct from the capsule avatars
// How high above the authoritative point the briefcase hovers. When held it rides at chest
// height on the carrier; when loose it sits just off the floor.
const HELD_HOVER = 1.3;
const LOOSE_HOVER = 0.55;
const SPIN_RATE = 0.9; // radians/second, a slow glint to catch the eye

/** A box of size (w,h,d) translated to (x,y,z), as a standalone geometry to be merged. */
function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

export class PackageView {
  private readonly root = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene) {
    // A briefcase: a flattened body + a handle (two posts + a top bar), merged into one
    // geometry so it stays a single glowing mesh.
    const bw = PACKAGE_SIZE;
    const bh = PACKAGE_SIZE * 0.62;
    const bd = PACKAGE_SIZE * 0.34;
    const parts = [
      box(bw, bh, bd, 0, 0, 0), // body
      box(0.05, 0.16, 0.05, -0.16, bh / 2 + 0.08, 0), // left handle post
      box(0.05, 0.16, 0.05, 0.16, bh / 2 + 0.08, 0), // right handle post
      box(0.37, 0.05, 0.05, 0, bh / 2 + 0.16, 0), // handle bar
      box(bw + 0.02, 0.05, bd + 0.02, 0, 0, 0), // latch seam line
    ];
    this.geometry = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();

    this.material = new THREE.MeshStandardMaterial({
      color: PACKAGE_COLOR,
      emissive: PACKAGE_COLOR,
      emissiveIntensity: 0.55,
      roughness: 0.4,
      metalness: 0.2,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.root.add(this.mesh);
    scene.add(this.root);
  }

  /** Sync to the authoritative package position + advance the spin. `dt` in seconds. */
  sync(state: NetMatchState, dt: number): void {
    const o = state.objective;
    const held = o.packageHolderId !== '';
    const hover = held ? HELD_HOVER : LOOSE_HOVER;
    this.root.position.set(o.packageX, o.packageY + hover, o.packageZ);
    this.mesh.rotation.y += SPIN_RATE * dt;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }
}
