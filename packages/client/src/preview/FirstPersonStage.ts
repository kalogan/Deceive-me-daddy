// The FIRST-PERSON tab (preview-only). Mounts the REAL first-person camera rig
// (render/firstPersonCamera), the REAL HUD (hud/Hud), and the REAL held-gadget viewmodel
// (render/viewModel) against a mock match model, looking at the SAME MapView the Map tab shows
// — so the FP framing + the mirrored HUD can be iterated with no server (PREVIEW_HARNESS.md:
// production-truthful, reuse never fork). Drag to look, WASD to walk; a few state toggles let
// the Director see the alert pill / exfil banner / low-health states.
//
// Boundary (PREVIEW_HARNESS.md §6): this verifies the FP camera + HUD LOOK only. It mounts a
// MOCK HudModel — it does NOT exercise the server, netcode, suspicion/objective logic, or the
// real combat path. A green here is not a green system.
import * as THREE from 'three';
import { TIER_COLOR, type ContentPack } from '@deceive/shared';
import { applyFirstPersonCamera, headingDeg } from '../render/firstPersonCamera';
import { ViewModel } from '../render/viewModel';
import { Hud } from '../hud/Hud';
import type { HudModel } from '../hud/hudModel';

const WALK_SPEED = 4.2; // m/s
const LOOK_SENS = 0.0026; // rad per pixel of drag

/** A representative full HUD model so every cluster (banner/compass/portrait/radial/slot) shows. */
function baseModel(): HudModel {
  return {
    present: true,
    agentName: 'Squire',
    ability: { name: 'Eyes on the Prize', active: false, ready: true, cooldownSec: 0, label: 'READY' },
    gadget: { name: 'Scanner Pulse', ready: true, cooldownSec: 0, label: 'READY' },
    sensedLoot: null,
    tier: 'staff',
    tierLabel: 'Staff',
    tierColor: TIER_COLOR['staff'],
    suspicion: { pct: 0.32, level: 'low', label: 'Hidden' },
    health: { pct: 1, level: 'ok', status: '' },
    zoneName: 'Atrium',
    scolded: false,
    socialAction: null,
    takeTargetId: null,
    takeTargetTier: null,
    reviveTargetId: null,
    objective: { intel: 3, intelRequired: 7, vaultOpen: false, carrying: false },
    interactLabel: 'Collect intel',
    cast: { kind: '', progress: 0 },
    win: { show: false, text: '', localWon: false },
  };
}

export class FirstPersonStage {
  private readonly hud: Hud;
  private readonly viewModel = new ViewModel();
  private readonly panel: HTMLDivElement;

  private active = false;
  private model = baseModel();

  // Eye state (ground position + look). Pitch is cosmetic, same as the live game.
  private readonly pos = { x: 0, y: 0, z: 0 };
  private yaw = 0;
  private pitch = 0;
  private span = 30;

  private controls: { enabled?: boolean } | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private dragging = false;
  private readonly keys = { f: false, b: false, l: false, r: false };

  constructor(
    scene: THREE.Scene,
    private readonly host: HTMLElement,
    private readonly domElement: HTMLElement,
  ) {
    scene.add(this.viewModel.group);
    this.viewModel.setVisible(false);
    this.hud = new Hud(host);
    this.panel = this.buildPanel();
  }

  /** Centre the eye on a pack + remember its span (called by PreviewApp on pack select). */
  setPack(pack: ContentPack): void {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const z of pack.zones) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, z.bounds.min[i]!, z.bounds.max[i]!);
        max[i] = Math.max(max[i]!, z.bounds.min[i]!, z.bounds.max[i]!);
      }
    }
    this.pos.x = (min[0]! + max[0]!) / 2;
    this.pos.z = (min[2]! + max[2]!) / 2;
    this.pos.y = 0;
    this.span = Math.max(max[0]! - min[0]!, max[2]! - min[2]!, 10);
  }

  setVisible(visible: boolean): void {
    if (visible === this.active) {
      if (!visible) return;
    }
    this.active = visible;
    this.panel.style.display = visible ? 'block' : 'none';
    this.viewModel.setVisible(visible);
    // Drive the HUD present flag so it hides when we leave the tab.
    this.hud.update(visible ? this.model : { ...this.model, present: false });
    if (visible) {
      this.attachListeners();
    } else {
      this.detachListeners();
      if (this.controls) this.controls.enabled = true; // hand the orbit cam back
    }
  }

  frame(
    camera: THREE.PerspectiveCamera,
    controls: { target: THREE.Vector3; update(): void; enabled?: boolean },
  ): void {
    this.camera = camera;
    this.controls = controls;
    controls.enabled = false; // FP drives the camera directly
    // Start looking across the map from one edge so there's depth in view.
    this.yaw = 0;
    this.pitch = 0;
    this.pos.z -= this.span * 0.35;
    applyFirstPersonCamera(camera, this.pos, this.yaw, this.pitch);
    this.hud.update(this.model);
    this.hud.setHeading(headingDeg(this.yaw));
  }

  update(dt: number): void {
    if (!this.active || !this.camera) return;
    // Walk in the look plane (yaw only; pitch doesn't change where your feet go).
    const fwd = (this.keys.f ? 1 : 0) - (this.keys.b ? 1 : 0);
    const strafe = (this.keys.r ? 1 : 0) - (this.keys.l ? 1 : 0);
    if (fwd !== 0 || strafe !== 0) {
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // forward = (sin, cos); screen-right = (cos, -sin) (matches movement.ts strafe sign).
      this.pos.x += (sin * fwd + cos * strafe) * WALK_SPEED * dt;
      this.pos.z += (cos * fwd - sin * strafe) * WALK_SPEED * dt;
    }
    applyFirstPersonCamera(this.camera, this.pos, this.yaw, this.pitch);
    this.viewModel.update(this.camera, dt);
    this.hud.setHeading(headingDeg(this.yaw));
  }

  // --- input -----------------------------------------------------------------------------------

  private readonly onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.dragging = true;
  };
  private readonly onUp = (): void => {
    this.dragging = false;
  };
  private readonly onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.yaw -= e.movementX * LOOK_SENS;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - e.movementY * LOOK_SENS));
  };
  private readonly onKey = (down: boolean) => (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'KeyW': this.keys.f = down; break;
      case 'KeyS': this.keys.b = down; break;
      case 'KeyA': this.keys.l = down; break;
      case 'KeyD': this.keys.r = down; break;
      default: return;
    }
  };
  private readonly onKeyDown = this.onKey(true);
  private readonly onKeyUp = this.onKey(false);

  private attachListeners(): void {
    this.domElement.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }
  private detachListeners(): void {
    this.domElement.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.dragging = false;
    this.keys.f = this.keys.b = this.keys.l = this.keys.r = false;
  }

  // --- state-toggle panel (preview-only DOM) ---------------------------------------------------

  private buildPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'preview-panel';
    panel.style.display = 'none';
    panel.style.top = 'auto';
    panel.style.bottom = '12px';
    panel.style.right = '12px';
    panel.style.left = 'auto';

    const title = document.createElement('div');
    title.className = 'preview-title';
    title.textContent = 'First-Person — drag to look, WASD to walk';
    panel.appendChild(title);

    const apply = (mut: (m: HudModel) => void): void => {
      mut(this.model);
      this.hud.update(this.model);
    };
    const mkBtn = (label: string, fn: () => void): void => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'display:block;width:100%;margin:4px 0;cursor:pointer';
      b.addEventListener('click', fn);
      panel.appendChild(b);
    };

    mkBtn('Toggle WRONG COVER', () => apply((m) => { m.scolded = !m.scolded; }));
    mkBtn('Cycle health (100 → 45 → 15)', () =>
      apply((m) => {
        const pct = m.health.pct > 0.6 ? 0.45 : m.health.pct > 0.3 ? 0.15 : 1;
        m.health = { pct, level: pct >= 0.6 ? 'ok' : pct >= 0.3 ? 'hurt' : 'critical', status: '' };
      }),
    );
    mkBtn('Cycle phase (Infil → Heist → Exfil)', () =>
      apply((m) => {
        if (!m.objective.vaultOpen) m.objective = { ...m.objective, vaultOpen: true };
        else if (!m.objective.carrying) m.objective = { ...m.objective, carrying: true };
        else m.objective = { intel: 3, intelRequired: 7, vaultOpen: false, carrying: false };
      }),
    );
    mkBtn('Toggle Expertise (ready/active)', () =>
      apply((m) => {
        const active = !m.ability.active;
        m.ability = { ...m.ability, active, ready: !active, label: active ? 'ACTIVE' : 'READY' };
      }),
    );

    this.host.appendChild(panel);
    return panel;
  }

  dispose(): void {
    this.detachListeners();
    this.viewModel.dispose();
    this.hud.dispose();
    this.panel.remove();
  }
}
