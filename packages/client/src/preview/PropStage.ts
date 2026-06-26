// The PROPS tab (preview-only). An environment-prop inspector: a picker switches the staged prop
// between the CC0/CC-BY glTF/GLB set pieces in render/propModels, loaded via three's GLTFLoader and
// scale-normalised so wildly different native scales all read at the same camera. Every baked clip
// plays (so animated props — LittlestTokyo, the truck wheels — move), with a turntable spin toggle and
// an attribution panel. This proves the import + placement pipeline for set-dressing the same way the
// Models tab proves it for characters; it is preview-only DOM, never in the game bundle.
//
// Mirrors ModelStage/Gallery/AgentStage ownership: constructed `(scene, host)`, owns a root group + a
// fixed DOM panel, and exposes setVisible / frame / update(dt) / dispose().
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { fitScale } from '../render/assetCharacter';
import {
  PROP_DEFAULT_HEIGHT,
  PROP_MODELS,
  propInfoLine,
  propModelById,
  type PropModelDef,
} from '../render/propModels';

const TURNTABLE_RATE = 0.5; // rad/s slow spin

/** A staged prop: its scene group, baked clip names, an animation pump + leak-free disposal. */
interface StagedProp {
  readonly group: THREE.Object3D;
  readonly clips: readonly string[];
  update(dt: number): void;
  dispose(): void;
}

const _box = new THREE.Box3();
const _size = new THREE.Vector3();

/**
 * A shared DRACO decoder so DRACO-compressed props (e.g. LittlestTokyo) parse. The decoder files are
 * copied into public/draco/ (three's `libs/draco/gltf/`), served as static assets. Created lazily +
 * reused so we don't spin up a decoder worker per load.
 */
let _draco: DRACOLoader | null = null;
function dracoLoader(): DRACOLoader {
  if (!_draco) {
    _draco = new DRACOLoader();
    _draco.setDecoderPath('/draco/');
  }
  return _draco;
}

/**
 * Load a glTF/GLB prop: scale-normalise via its bounding box to `displayHeight`, drop it onto the
 * ground (min.y → 0) and centre it on X/Z, then play EVERY baked clip so animated props move. Async
 * (network + parse). Geometries + cloned materials are tracked for leak-free disposal. A DRACOLoader
 * is attached so DRACO-compressed assets decode.
 */
async function loadProp(def: PropModelDef): Promise<StagedProp> {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader());
  const gltf = await loader.loadAsync(def.url);
  const model = gltf.scene;

  // Clone materials so we never mutate three's shared GLTF cache; collect geometries for disposal.
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const src = mesh.material;
    const cloneOne = (m: THREE.Material): THREE.Material => {
      const c = m.clone();
      materials.add(c);
      return c;
    };
    if (Array.isArray(src)) mesh.material = src.map(cloneOne);
    else if (src) mesh.material = cloneOne(src);
  });

  // Scale-normalise to the target display height, then seat on the ground + centre on X/Z.
  _box.setFromObject(model);
  _box.getSize(_size);
  model.scale.setScalar(fitScale(_size.y, def.displayHeight ?? PROP_DEFAULT_HEIGHT));
  _box.setFromObject(model);
  model.position.y -= _box.min.y;
  model.position.x -= (_box.min.x + _box.max.x) / 2;
  model.position.z -= (_box.min.z + _box.max.z) / 2;

  // Play every baked clip (props are set-dressing — no idle/walk selection, just "alive").
  const mixer = new THREE.AnimationMixer(model);
  const clips = gltf.animations.map((c) => c.name);
  for (const clip of gltf.animations) mixer.clipAction(clip).play();

  return {
    group: model,
    clips,
    update: (dt) => mixer.update(dt),
    dispose: () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      model.removeFromParent();
    },
  };
}

export class PropStage {
  private readonly root = new THREE.Group();
  private readonly panel: HTMLDivElement;

  private prop: StagedProp | null = null;
  private loadToken = 0; // guards against a stale async load resolving after a newer switch
  private spinning = true;

  private infoEl: HTMLDivElement | null = null;
  private usageEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;

  constructor(
    scene: THREE.Scene,
    private readonly host: HTMLElement,
  ) {
    scene.add(this.root);
    this.root.visible = false;
    this.panel = this.buildPanel();
    void this.select(PROP_MODELS[0]!.id);
  }

  // --- prop (re)build --------------------------------------------------------------------------

  /** Select + (re)load the staged prop. Async — each prop streams a GLB. */
  private async select(id: string): Promise<void> {
    const def = propModelById(id);
    if (!def) return;
    const token = ++this.loadToken;

    this.teardownProp();
    this.setInfo(def);
    this.setStatus(`Loading ${def.name}…`);
    try {
      const staged = await loadProp(def);
      if (token !== this.loadToken) {
        staged.dispose(); // a newer selection won the race — drop this one cleanly
        return;
      }
      this.root.add(staged.group);
      this.prop = staged;
      this.setStatus(`${def.name} loaded · clips: ${staged.clips.join(', ') || 'none (static)'}`);
    } catch (err) {
      if (token !== this.loadToken) return;
      this.setStatus(`Failed to load ${def.name}: ${String(err)}`);
      console.error('[PropStage] prop load failed', err);
    }
  }

  private teardownProp(): void {
    if (this.prop) {
      this.prop.dispose();
      this.prop.group.removeFromParent();
      this.prop = null;
    }
  }

  // --- DOM panel -------------------------------------------------------------------------------

  private buildPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'preview-panel';
    Object.assign(panel.style, {
      display: 'none',
      maxWidth: '300px',
      position: 'fixed',
      right: '12px',
      top: '12px',
      left: 'auto',
    } satisfies Partial<CSSStyleDeclaration>);

    const title = document.createElement('div');
    title.className = 'preview-title';
    title.textContent = 'Environment Props';
    panel.appendChild(title);

    // Picker: one option per registered prop.
    const picker = document.createElement('select');
    picker.className = 'preview-picker';
    for (const def of PROP_MODELS) {
      const o = document.createElement('option');
      o.value = def.id;
      o.textContent = def.name;
      picker.appendChild(o);
    }
    picker.addEventListener('change', () => {
      void this.select(picker.value);
    });
    panel.appendChild(picker);

    // Turntable spin toggle.
    const spinRow = this.row();
    const spinBtn = this.mkBtn('Spin: On', () => {
      this.spinning = !this.spinning;
      spinBtn.textContent = this.spinning ? 'Spin: On' : 'Spin: Off';
      spinBtn.style.fontWeight = this.spinning ? '700' : '400';
    });
    spinBtn.style.fontWeight = '700';
    spinRow.append(spinBtn);
    panel.appendChild(this.labelled('Turntable', spinRow));

    // Info / attribution panel.
    const info = document.createElement('div');
    Object.assign(info.style, {
      marginTop: '10px',
      padding: '6px 8px',
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid #2a2f40',
      borderRadius: '5px',
      fontSize: '11px',
      color: '#bcd',
    } satisfies Partial<CSSStyleDeclaration>);
    this.infoEl = info;
    panel.appendChild(info);

    // Usage hint (where this prop fits in our maps).
    const usage = document.createElement('div');
    Object.assign(usage.style, {
      marginTop: '6px',
      fontSize: '11px',
      color: '#cab',
      fontStyle: 'italic',
    } satisfies Partial<CSSStyleDeclaration>);
    this.usageEl = usage;
    panel.appendChild(usage);

    // Status line.
    const status = document.createElement('div');
    Object.assign(status.style, {
      marginTop: '8px',
      fontSize: '11px',
      color: '#9fb',
      whiteSpace: 'pre-line',
    } satisfies Partial<CSSStyleDeclaration>);
    this.statusEl = status;
    panel.appendChild(status);

    this.host.appendChild(panel);
    return panel;
  }

  private row(): HTMLDivElement {
    const r = document.createElement('div');
    Object.assign(r.style, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px',
    } satisfies Partial<CSSStyleDeclaration>);
    return r;
  }

  private labelled(label: string, body: HTMLElement): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.margin = '8px 0 0';
    const head = document.createElement('div');
    head.style.fontSize = '10px';
    head.style.letterSpacing = '0.08em';
    head.style.textTransform = 'uppercase';
    head.style.color = '#789';
    head.style.margin = '0 0 4px';
    head.textContent = label;
    wrap.append(head, body);
    return wrap;
  }

  private mkBtn(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.flex = '1';
    b.style.cursor = 'pointer';
    b.style.fontSize = '12px';
    b.addEventListener('click', onClick);
    return b;
  }

  private setInfo(def: PropModelDef): void {
    if (this.infoEl) this.infoEl.textContent = propInfoLine(def);
    if (this.usageEl) this.usageEl.textContent = def.usage ?? '';
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  // --- lifecycle -------------------------------------------------------------------------------

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.panel.style.display = visible ? 'block' : 'none';
  }

  /** Point the orbit camera at the staged prop (slightly above, pulled back to frame larger props). */
  frame(camera: THREE.PerspectiveCamera, controls: { target: THREE.Vector3; update(): void }): void {
    controls.target.set(0, 1.0, 0);
    camera.position.set(0, 1.8, 5.5);
    camera.lookAt(0, 1.0, 0);
    controls.update();
  }

  /** Turntable-spin + pump the prop's animations each frame. `dt` seconds. */
  update(dt: number): void {
    if (!this.root.visible || !this.prop) return;
    if (this.spinning) this.prop.group.rotation.y += dt * TURNTABLE_RATE;
    this.prop.update(dt);
  }

  dispose(): void {
    this.teardownProp();
    this.panel.remove();
    this.root.removeFromParent();
  }
}
