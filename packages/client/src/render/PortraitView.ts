// PortraitView — the HUD's bottom-left mugshot. Renders the LOCAL player's CURRENT look (their
// own agent, or whoever they're disguised as) as a head-and-shoulders portrait, so you can see at
// a glance which disguise you're wearing. It reuses the SAME procedural avatar the world renders
// (buildAvatarBody) seeded by the SAME id hash (hashId), so the face in the corner is the exact
// person your body looks like in-world — and it rebuilds the instant you steal a new disguise.
//
// It owns a tiny dedicated WebGLRenderer (a small offscreen canvas) and renders ONLY when the look
// changes, so the cost is negligible. Cosmetic; no gameplay truth.
import * as THREE from 'three';
import { TIER_COLOR, type ClearanceTier } from '@deceive/shared';
import { buildAvatarBody, type AvatarBody } from './avatar';

/** FNV-1a string→uint32 hash — IDENTICAL to WorldView/NpcView so the portrait matches the body. */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class PortraitView {
  /** The portrait canvas — mount this into the HUD's hex frame. */
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private body: AvatarBody | null = null;
  private lookKey = '';

  constructor(size = 132) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    this.renderer.setSize(size, size, false);
    this.canvas = this.renderer.domElement;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';

    // Soft key + fill so the toon face reads with a little form, matching the scene's lit look.
    this.scene.add(new THREE.HemisphereLight(0xdfe7ff, 0x202028, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1.2, 2.4, 2.0);
    this.scene.add(key);

    // Frame head-and-shoulders. The procedural avatar is CENTRED on the origin (avatar.ts: feet at
    // ~-0.9, head centre at y≈0.74, face on +Z), so we look at the head from just in front (+Z).
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, 0.78, 1.05);
    this.camera.lookAt(0, 0.7, 0);
  }

  /**
   * Set the portrait to a given look. `seedId` is the entity id whose appearance the player wears
   * (their disguiseId when disguised, else their own id) — the SAME seed the world body uses. No-op
   * when the look hasn't changed, so the small render only happens on an actual disguise/spawn change.
   */
  setLook(seedId: string, tier: ClearanceTier): void {
    const key = `${seedId}|${tier}`;
    if (key === this.lookKey) return;
    this.lookKey = key;

    if (this.body) {
      this.scene.remove(this.body.group);
      this.body.dispose();
      this.body = null;
    }
    const body = buildAvatarBody({ seed: hashId(seedId), hasWeapon: false });
    body.setTier(new THREE.Color(TIER_COLOR[tier] ?? '#ffffff').getHex());
    this.scene.add(body.group);
    this.body = body;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.body) {
      this.scene.remove(this.body.group);
      this.body.dispose();
      this.body = null;
    }
    this.renderer.dispose();
    this.canvas.remove();
  }
}
