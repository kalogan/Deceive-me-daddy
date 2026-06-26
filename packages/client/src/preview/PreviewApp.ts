// PreviewApp — the harness SHELL (PROJECT_BRIEF §8). Inspection scaffolding only: it
// enumerates packs from the seam, offers a picker, frames an orbit camera over the
// selected map, and renders it via the REAL MapView. It NEVER reimplements rendering or
// data shapes — if a pack is hard to mount, the fix goes in the seam/MapView, not here.
//
// This shell + its CSS live ONLY behind the preview entry (preview.html), never the
// product (game) bundle.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  CLEARANCE_TIERS,
  TIER_COLOR,
  type ContentPack,
} from '@deceive/shared';
import { MapView } from '../render/MapView';
import { loadAllPacks } from './dataSource';

export class PreviewApp {
  private readonly scene = new THREE.Scene();
  private readonly mapView: MapView;
  private readonly controls: OrbitControls;
  private readonly packs: ContentPack[];

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    private readonly host: HTMLElement,
  ) {
    this.scene.background = new THREE.Color(0x0c0d12);

    // Greybox stage lighting + ground so the map reads with depth.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(30, 50, 20);
    this.scene.add(sun);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x16181f, roughness: 0.97 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    this.scene.add(ground);
    this.scene.add(new THREE.GridHelper(400, 80, 0x2a2f40, 0x20242f));

    this.mapView = new MapView(this.scene);
    this.controls = new OrbitControls(camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this.packs = loadAllPacks();
    this.buildUi();

    if (this.packs.length > 0) {
      this.selectPack(0);
    } else {
      console.error('[preview] no valid content packs found under content/packs');
    }
  }

  /** Drive the orbit damping each frame. Called from the rAF loop in main.ts. */
  update(): void {
    this.controls.update();
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  private selectPack(index: number): void {
    const pack = this.packs[index];
    if (!pack) return;
    this.mapView.setPack(pack);
    this.frameCamera(pack);
  }

  /** Drop the orbit target on the map centre + pull the camera back to fit its span. */
  private frameCamera(pack: ContentPack): void {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const z of pack.zones) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, z.bounds.min[i]!, z.bounds.max[i]!);
        max[i] = Math.max(max[i]!, z.bounds.min[i]!, z.bounds.max[i]!);
      }
    }
    const cx = (min[0]! + max[0]!) / 2;
    const cz = (min[2]! + max[2]!) / 2;
    const span = Math.max(max[0]! - min[0]!, max[2]! - min[2]!, 10);

    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx, span * 0.9, cz + span * 0.9);
    this.camera.lookAt(cx, 0, cz);
    this.controls.update();
  }

  // --- the picker + legend (preview-only DOM; never in the game bundle) ---
  private buildUi(): void {
    const panel = document.createElement('div');
    panel.className = 'preview-panel';

    const title = document.createElement('div');
    title.className = 'preview-title';
    title.textContent = 'Map Preview';
    panel.appendChild(title);

    if (this.packs.length === 0) {
      const warn = document.createElement('div');
      warn.className = 'preview-empty';
      warn.textContent = 'No valid content packs found.';
      panel.appendChild(warn);
    } else {
      const picker = document.createElement('select');
      picker.className = 'preview-picker';
      this.packs.forEach((pack, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `${pack.name} (${pack.theme})`;
        picker.appendChild(opt);
      });
      picker.addEventListener('change', () => {
        this.selectPack(Number(picker.value));
      });
      panel.appendChild(picker);
    }

    // Tier colour legend (Director taste — confirm tier readability).
    const legend = document.createElement('div');
    legend.className = 'preview-legend';
    for (const tier of CLEARANCE_TIERS) {
      const row = document.createElement('div');
      row.className = 'preview-legend-row';
      const swatch = document.createElement('span');
      swatch.className = 'preview-swatch';
      swatch.style.background = TIER_COLOR[tier];
      const label = document.createElement('span');
      label.textContent = tier;
      row.append(swatch, label);
      legend.appendChild(row);
    }
    panel.appendChild(legend);

    this.host.appendChild(panel);
  }

  dispose(): void {
    this.mapView.dispose();
    this.controls.dispose();
  }
}
