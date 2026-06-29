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
import { Gallery } from './Gallery';
import { AgentStage } from './AgentStage';
import { ModelStage } from './ModelStage';
import { PropStage } from './PropStage';
import { DaddyStage } from './DaddyStage';
import { FirstPersonStage } from './FirstPersonStage';
import { AudioEngine } from '../audio/AudioEngine';
import { loadAllPacks } from './dataSource';

type PreviewMode = 'map' | 'assets' | 'agents' | 'models' | 'props' | 'daddy' | 'firstperson';

export class PreviewApp {
  private readonly scene = new THREE.Scene();
  private readonly mapView: MapView;
  private readonly gallery: Gallery;
  private readonly agentStage: AgentStage;
  private readonly modelStage: ModelStage;
  private readonly propStage: PropStage;
  private readonly daddyStage: DaddyStage;
  private readonly firstPersonStage: FirstPersonStage;
  private readonly audio = new AudioEngine();
  private readonly controls: OrbitControls;
  private readonly packs: ContentPack[];
  private mode: PreviewMode = 'map';
  private selectedPack = 0;

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
    this.gallery = new Gallery(this.scene, this.host, this.audio);
    this.agentStage = new AgentStage(this.scene, this.host, this.audio);
    this.modelStage = new ModelStage(this.scene, this.host);
    this.propStage = new PropStage(this.scene, this.host);
    this.daddyStage = new DaddyStage(this.scene, this.host);
    this.firstPersonStage = new FirstPersonStage(this.scene, this.host, renderer.domElement);
    this.controls = new OrbitControls(camera, renderer.domElement);

    // Browsers block audio until a user gesture — unlock the engine on the first interaction
    // so the gallery's ambient toggle + SFX preview buttons can sound.
    const unlock = (): void => {
      this.audio.resume();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
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

  /** Drive the orbit damping + gallery turntable each frame. `dt` seconds. */
  update(dt: number): void {
    this.controls.update();
    this.mapView.update(dt); // animate imported-GLB map props (e.g. the Sandbox test range)
    this.gallery.update(dt);
    this.agentStage.update(dt);
    this.modelStage.update(dt);
    this.propStage.update(dt);
    this.daddyStage.update(dt);
    this.firstPersonStage.update(dt);
  }

  /** Switch between the authored map, the asset gallery, the agents, models, and props tabs. */
  private setMode(mode: PreviewMode): void {
    this.mode = mode;
    const assets = mode === 'assets';
    const agents = mode === 'agents';
    const models = mode === 'models';
    const props = mode === 'props';
    const daddy = mode === 'daddy';
    const fp = mode === 'firstperson';
    // The FP tab looks at the SAME authored map (production-truthful), so keep MapView mounted.
    this.mapView.setVisible(mode === 'map' || fp);
    // Top-down Map view hides the roof so you can read the floor plan; First Person keeps it (you're
    // inside, under it).
    this.mapView.setRoofVisible(fp);
    this.gallery.setVisible(assets);
    this.agentStage.setVisible(agents);
    this.modelStage.setVisible(models);
    this.propStage.setVisible(props);
    this.daddyStage.setVisible(daddy);
    this.firstPersonStage.setVisible(fp);
    if (assets) this.gallery.frame(this.camera, this.controls);
    else if (agents) this.agentStage.frame(this.camera, this.controls);
    else if (models) this.modelStage.frame(this.camera, this.controls);
    else if (props) this.propStage.frame(this.camera, this.controls);
    else if (daddy) this.daddyStage.frame(this.camera, this.controls);
    else if (fp) this.firstPersonStage.frame(this.camera, this.controls);
    else {
      const pack = this.packs[this.selectedPack];
      if (pack) this.frameCamera(pack);
    }
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  private selectPack(index: number): void {
    const pack = this.packs[index];
    if (!pack) return;
    this.selectedPack = index;
    this.mapView.setPack(pack);
    this.firstPersonStage.setPack(pack);
    if (this.mode === 'map') this.frameCamera(pack);
    else if (this.mode === 'firstperson') this.firstPersonStage.frame(this.camera, this.controls);
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
    title.textContent = 'Preview';
    panel.appendChild(title);

    // Mode toggle: the authored Map, or the Asset Gallery (every art asset + live config).
    const modes = document.createElement('div');
    Object.assign(modes.style, { display: 'flex', gap: '6px', margin: '4px 0 8px' });
    const mkBtn = (label: string, mode: PreviewMode): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.flex = '1';
      b.style.cursor = 'pointer';
      b.addEventListener('click', () => {
        this.setMode(mode);
        mapBtn.style.fontWeight = mode === 'map' ? '700' : '400';
        assetsBtn.style.fontWeight = mode === 'assets' ? '700' : '400';
        agentsBtn.style.fontWeight = mode === 'agents' ? '700' : '400';
        modelsBtn.style.fontWeight = mode === 'models' ? '700' : '400';
        propsBtn.style.fontWeight = mode === 'props' ? '700' : '400';
        daddyBtn.style.fontWeight = mode === 'daddy' ? '700' : '400';
        fpBtn.style.fontWeight = mode === 'firstperson' ? '700' : '400';
      });
      return b;
    };
    const mapBtn = mkBtn('Map', 'map');
    const assetsBtn = mkBtn('Assets', 'assets');
    const agentsBtn = mkBtn('Agents', 'agents');
    const modelsBtn = mkBtn('Models', 'models');
    const propsBtn = mkBtn('Props', 'props');
    const daddyBtn = mkBtn('Daddy', 'daddy');
    const fpBtn = mkBtn('First Person', 'firstperson');
    mapBtn.style.fontWeight = '700';
    modes.style.flexWrap = 'wrap';
    modes.append(mapBtn, assetsBtn, agentsBtn, modelsBtn, propsBtn, daddyBtn, fpBtn);
    panel.appendChild(modes);

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
    this.gallery.dispose();
    this.agentStage.dispose();
    this.modelStage.dispose();
    this.propStage.dispose();
    this.daddyStage.dispose();
    this.firstPersonStage.dispose();
    this.audio.dispose();
    this.controls.dispose();
  }
}
