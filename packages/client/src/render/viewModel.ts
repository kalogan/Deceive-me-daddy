// First-person viewmodel — a low-poly gloved hand holding a deployable gadget, locked in the
// lower-right of the view (mirrors the reference HUD's held-gadget). Cosmetic only; no gameplay
// truth. SHARED by the live game (main.ts) and the preview's First-Person stage so the preview
// shows the real thing (PREVIEW_HARNESS.md: reuse, never fork).
//
// It is NOT parented to the camera (that would require the camera in the scene graph); instead
// update(camera, dt) copies the camera's world transform onto the group each frame and the child
// meshes sit at a fixed camera-local offset — so it renders in front of whatever camera draws the
// scene, in the game and the preview alike.
import * as THREE from 'three';

/** Camera-local rest offset of the held gadget (right, down, forward into the screen = -Z). */
const HOLD_OFFSET = new THREE.Vector3(0.34, -0.32, -0.66);

export class ViewModel {
  /** Root synced to the camera transform every frame. */
  readonly group = new THREE.Group();
  /** Holder at the fixed camera-local offset; carries the bob so the root stays a clean copy. */
  private readonly holder = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private t = 0;
  private visible = true;

  constructor(gadgetColor = 0x2f6bff) {
    this.holder.position.copy(HOLD_OFFSET);
    // A slight inward/upward tilt so the gadget reads as held, not floating.
    this.holder.rotation.set(0.12, -0.22, 0.06);
    this.group.add(this.holder);

    const glove = this.mat(0x1b1d28, 0.85, 0.15);
    const cuff = this.mat(0x2a2d3c, 0.8, 0.2);
    const body = this.mat(gadgetColor, 0.45, 0.35);
    const trim = this.mat(0x8fb3ff, 0.4, 0.6, 0x18306a);
    const face = this.mat(0xeaf2ff, 0.5, 0.25, 0x223a78);

    // Forearm + cuff receding toward the camera (so it reads as "your arm").
    this.add(new THREE.BoxGeometry(0.14, 0.14, 0.4), cuff, [0.02, -0.06, 0.2]);
    // Fist (the glove) under the gadget.
    this.add(new THREE.BoxGeometry(0.18, 0.12, 0.2), glove, [0, -0.05, 0]);
    // Four stubby knuckles for a hint of a hand without a full rig.
    for (let i = 0; i < 4; i++) {
      this.add(new THREE.BoxGeometry(0.035, 0.05, 0.07), glove, [-0.06 + i * 0.04, 0.02, -0.09]);
    }
    // The held gadget: a chunky rounded block with a lighter top trim + an emblem face.
    this.add(new THREE.BoxGeometry(0.22, 0.16, 0.22), body, [0, 0.06, -0.02]);
    this.add(new THREE.BoxGeometry(0.2, 0.04, 0.2), trim, [0, 0.15, -0.02]);
    this.add(new THREE.CircleGeometry(0.05, 16), face, [0, 0.06, -0.135], [0, 0, 0]);

    this.group.renderOrder = 999; // drawn after the world so it never clips behind near geometry
  }

  /** Build a tracked standard material (auto-disposed). */
  private mat(color: number, rough: number, metal: number, emissive = 0x000000): THREE.Material {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: rough,
      metalness: metal,
      emissive,
      emissiveIntensity: emissive ? 0.6 : 0,
    });
    this.disposables.push(m);
    return m;
  }

  /** Add a tracked mesh to the holder at a camera-local position (+ optional euler rotation). */
  private add(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    rot?: [number, number, number],
  ): void {
    this.disposables.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    this.holder.add(mesh);
  }

  /** Show/hide the whole viewmodel (hidden while the local player is downed/spectating). */
  setVisible(v: boolean): void {
    this.visible = v;
    this.group.visible = v;
  }

  /**
   * Lock the viewmodel in front of `camera` and advance a gentle idle bob. `dt` seconds. Copies
   * the camera's world transform onto the root; the holder's fixed local offset keeps the gadget
   * pinned to the lower-right of the view at any look angle.
   */
  update(camera: THREE.Camera, dt: number): void {
    if (!this.visible) return;
    this.t += dt;
    camera.updateMatrixWorld();
    this.group.position.setFromMatrixPosition(camera.matrixWorld);
    this.group.quaternion.setFromRotationMatrix(camera.matrixWorld);
    // Idle bob — a few millimetres, purely cosmetic.
    this.holder.position.y = HOLD_OFFSET.y + Math.sin(this.t * 1.8) * 0.006;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
