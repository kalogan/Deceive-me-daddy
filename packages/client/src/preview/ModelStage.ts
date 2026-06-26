// The MODELS tab (preview-only). A character inspector + A/B comparison: a picker switches the staged
// character between OUR procedural avatar (render/avatar) and external CC0 glTF/GLB packs (the
// registry in render/assetModels, loaded via render/assetCharacter). Both expose the SAME controllable
// surface (animate / setTier / setBrightness / setOpacity / setEmissive / dispose), so the recolor +
// state demos and the turntable drive EITHER identically — that's the whole point: proving the modular
// asset path matches the procedural one feature-for-feature.
//
// Mirrors Gallery/AgentStage ownership: constructed `(scene, host)`, owns a root group + a fixed DOM
// panel, and exposes setVisible / frame / update(dt) / dispose(). Preview-only DOM: this file lives
// ONLY behind preview.html, never the game bundle.
import * as THREE from 'three';
import { CLEARANCE_TIERS, TIER_COLOR, type ClearanceTier } from '@deceive/shared';
import { buildAvatarBody, AVATAR_HEIGHT, type AvatarBody } from '../render/avatar';
import { ASSET_MODELS, type AssetModelDef } from '../render/assetModels';
import { loadAssetCharacter, type AssetCharacter } from '../render/assetCharacter';

// --- Pure helpers (exported + unit-tested; no THREE/DOM) ----------------------------------------

/** The procedural avatar is option index 0; each registry model follows. */
export const PROCEDURAL_OPTION_ID = 'procedural';

export interface ModelOption {
  readonly id: string;
  readonly label: string;
  /** The asset def when this option loads an external model; null for our procedural avatar. */
  readonly def: AssetModelDef | null;
}

/** Build the picker option list: "Procedural (ours)" first, then one per registry asset. */
export function buildModelOptions(models: readonly AssetModelDef[] = ASSET_MODELS): ModelOption[] {
  return [
    { id: PROCEDURAL_OPTION_ID, label: 'Procedural (ours)', def: null },
    ...models.map((m) => ({ id: m.id, label: m.name, def: m })),
  ];
}

/** The walk speed (m/s) the Idle/Walk toggle feeds the character when set to "Walk". */
export const WALK_SPEED = 1.4;

/** Speed for the current toggle state: 0 idle, WALK_SPEED walking. Pure. */
export function speedForMode(walking: boolean): number {
  return walking ? WALK_SPEED : 0;
}

/** The attribution/info line for an option (procedural has no licence). Pure, data-in/data-out. */
export function infoLine(option: ModelOption): string {
  if (!option.def) return 'Procedural avatar (ours) — buildAvatarBody, no external asset.';
  return `${option.def.name} — ${option.def.license}. ${option.def.credit}`;
}

// --- A common controllable surface so the stage drives procedural + asset identically ------------

interface StagedCharacter {
  readonly group: THREE.Object3D;
  animate(dt: number, speed: number): void;
  setTier(hex: number): void;
  setBrightness(mult: number): void;
  setOpacity(opacity: number): void;
  setEmissive(hex: number, intensity: number): void;
  dispose(): void;
}

/** Wrap a procedural AvatarBody as a StagedCharacter (its group is centred, not feet-at-0). */
function fromAvatar(body: AvatarBody): StagedCharacter {
  // The procedural avatar is centred on its origin (feet near -H/2); lift it so feet sit at y = 0.
  body.group.position.y = AVATAR_HEIGHT / 2;
  return {
    group: body.group,
    animate: (dt, speed) => body.animate(dt, speed),
    setTier: (hex) => body.setTier(hex),
    setBrightness: (m) => body.setBrightness(m),
    setOpacity: (o) => body.setOpacity(o),
    setEmissive: (hex, i) => body.setEmissive(hex, i),
    dispose: () => body.dispose(),
  };
}

const TURNTABLE_RATE = 0.5; // rad/s slow spin
const PROCEDURAL_SEED = 0x5eed; // a fixed pleasant look for the comparison

export class ModelStage {
  private readonly root = new THREE.Group();
  private readonly panel: HTMLDivElement;
  private readonly options = buildModelOptions();

  private character: StagedCharacter | null = null;
  private loadToken = 0; // guards against a stale async load resolving after a newer switch
  private walking = false;
  private currentTier: ClearanceTier | null = null;

  private infoEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;

  constructor(
    scene: THREE.Scene,
    private readonly host: HTMLElement,
  ) {
    scene.add(this.root);
    this.root.visible = false;
    this.panel = this.buildPanel();
    void this.select(PROCEDURAL_OPTION_ID);
  }

  private optionById(id: string): ModelOption {
    return this.options.find((o) => o.id === id) ?? this.options[0]!;
  }

  // --- character (re)build ---------------------------------------------------------------------

  /** Select + (re)build the staged character. Async because asset options stream a GLB. */
  private async select(id: string): Promise<void> {
    const option = this.optionById(id);
    const token = ++this.loadToken;

    this.teardownCharacter();
    this.setInfo(option);

    if (!option.def) {
      // Procedural: synchronous build.
      const body = buildAvatarBody({ seed: PROCEDURAL_SEED });
      const staged = fromAvatar(body);
      this.mount(staged);
      this.setStatus('Procedural avatar ready.');
      return;
    }

    // Asset: stream the GLB. Show a loading state; ignore the result if a newer switch happened.
    this.setStatus(`Loading ${option.def.name}…`);
    try {
      const asset: AssetCharacter = await loadAssetCharacter(option.def);
      if (token !== this.loadToken) {
        asset.dispose(); // a newer selection won the race — drop this one cleanly
        return;
      }
      this.mount(asset);
      this.setStatus(`${option.def.name} loaded · clips: ${asset.clips.join(', ') || 'none'}`);
    } catch (err) {
      if (token !== this.loadToken) return;
      this.setStatus(`Failed to load ${option.def.name}: ${String(err)}`);
      console.error('[ModelStage] asset load failed', err);
    }
  }

  /** Mount a built character, re-applying the active tier so a recolor survives the switch. */
  private mount(character: StagedCharacter): void {
    this.root.add(character.group);
    this.character = character;
    if (this.currentTier) character.setTier(hexNum(TIER_COLOR[this.currentTier]));
  }

  private teardownCharacter(): void {
    if (this.character) {
      this.character.dispose();
      this.character.group.removeFromParent();
      this.character = null;
    }
  }

  // --- recolor + state demos -------------------------------------------------------------------

  private applyTier(tier: ClearanceTier): void {
    this.currentTier = tier;
    this.character?.setTier(hexNum(TIER_COLOR[tier]));
    this.setStatus(`Tier applied: ${tier}.`);
  }

  private applyDowned(): void {
    this.character?.setBrightness(0.45);
    this.character?.setOpacity(0.55);
    this.setStatus('State: Downed (dimmed + ghosted).');
  }

  private applyInvuln(): void {
    this.character?.setEmissive(0xffcc33, 0.9);
    this.setStatus('State: Invuln (gold emissive shell).');
  }

  private applyReset(): void {
    this.character?.setBrightness(1);
    this.character?.setOpacity(1);
    this.character?.setEmissive(0x000000, 0);
    this.currentTier = null;
    this.setStatus('State reset.');
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
    title.textContent = 'Character Models';
    panel.appendChild(title);

    // Picker: Procedural + one per asset.
    const picker = document.createElement('select');
    picker.className = 'preview-picker';
    for (const opt of this.options) {
      const o = document.createElement('option');
      o.value = opt.id;
      o.textContent = opt.label;
      picker.appendChild(o);
    }
    picker.addEventListener('change', () => {
      void this.select(picker.value);
    });
    panel.appendChild(picker);

    // Idle / Walk toggle.
    const animRow = this.row();
    const idleBtn = this.mkBtn('Idle', () => {
      this.walking = false;
      this.markActive(idleBtn, walkBtn, true);
    });
    const walkBtn = this.mkBtn('Walk', () => {
      this.walking = true;
      this.markActive(idleBtn, walkBtn, false);
    });
    idleBtn.style.fontWeight = '700';
    animRow.append(idleBtn, walkBtn);
    panel.appendChild(this.labelled('Animation', animRow));

    // Tier swatches (recolor demo).
    const tierRow = this.row();
    for (const tier of CLEARANCE_TIERS) {
      const b = document.createElement('button');
      b.textContent = tier;
      b.style.flex = '1 1 45%';
      b.style.cursor = 'pointer';
      b.style.fontSize = '11px';
      b.style.borderLeft = `4px solid ${TIER_COLOR[tier]}`;
      b.addEventListener('click', () => this.applyTier(tier));
      tierRow.appendChild(b);
    }
    panel.appendChild(this.labelled('Tier (recolor)', tierRow));

    // State demo buttons.
    const stateRow = this.row();
    stateRow.append(
      this.mkBtn('Downed', () => this.applyDowned()),
      this.mkBtn('Invuln', () => this.applyInvuln()),
      this.mkBtn('Reset', () => this.applyReset()),
    );
    panel.appendChild(this.labelled('State', stateRow));

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

  private markActive(idle: HTMLButtonElement, walk: HTMLButtonElement, idleActive: boolean): void {
    idle.style.fontWeight = idleActive ? '700' : '400';
    walk.style.fontWeight = idleActive ? '400' : '700';
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

  private setInfo(option: ModelOption): void {
    if (this.infoEl) this.infoEl.textContent = infoLine(option);
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  // --- lifecycle -------------------------------------------------------------------------------

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.panel.style.display = visible ? 'block' : 'none';
  }

  /** Point the orbit camera at the single staged figure (front-on, slightly above). */
  frame(camera: THREE.PerspectiveCamera, controls: { target: THREE.Vector3; update(): void }): void {
    controls.target.set(0, 1.0, 0);
    camera.position.set(0, 1.4, 4.5);
    camera.lookAt(0, 1.0, 0);
    controls.update();
  }

  /** Turntable-spin + animate the staged character each frame. `dt` seconds. */
  update(dt: number): void {
    if (!this.root.visible) return;
    if (this.character) {
      this.character.group.rotation.y += dt * TURNTABLE_RATE;
      this.character.animate(dt, speedForMode(this.walking));
    }
  }

  dispose(): void {
    this.teardownCharacter();
    this.panel.remove();
    this.root.removeFromParent();
  }
}

/** Parse a '#rrggbb' string into a 0xrrggbb number for the THREE styling API. */
function hexNum(css: string): number {
  return parseInt(css.replace('#', ''), 16);
}
