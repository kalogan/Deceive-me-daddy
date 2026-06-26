// The AGENTS tab (preview-only). A self-contained inspector for each playable agent's KIT: it
// stands the selected AGENT avatar a few metres from a TARGET DUMMY, shows the full kit in a DOM
// panel (weapon / gadget / Expertise / passive), and lets you TRIGGER each skill's VISUALS against
// the dummy. The FX come from render/combatFx — the SAME builders the game will use — so what you
// see here is what ships. Mirrors Gallery's ownership: constructed `(scene, host, audio?)`, owns a
// root group + a fixed DOM panel, and exposes setVisible / frame / update(dt) / dispose().
//
// Preview-only DOM: this file lives ONLY behind preview.html, never the game bundle.
import * as THREE from 'three';
import {
  AGENT_IDS,
  AGENTS_BY_ID,
  type Agent,
  type AgentId,
  type AbilityKind,
} from '@deceive/shared';
import { AVATAR_HEIGHT, buildAvatarBody, type AvatarBody } from '../render/avatar';
import {
  abilityAura,
  fragBurst,
  impactFlash,
  miragePoof,
  muzzleFlash,
  scanPulse,
  tracer,
  type AuraKind,
  type FxHandle,
} from '../render/combatFx';
import type { AudioEngine } from '../audio/AudioEngine';

// --- Pure helpers (exported + unit-tested; no THREE/DOM) ---------------------------------------

/** Map an agent's signature Expertise to its aura look. */
export function auraForAbility(ability: AbilityKind): AuraKind {
  switch (ability) {
    case 'eyes_on_prize':
      return 'eyes';
    case 'hard_boiled':
      return 'invuln';
    case 'adieu':
      return 'cloak';
  }
}

/** Human-friendly cooldown/duration label from a millisecond value (e.g. 16000 → "16.0s"). */
export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// --- Stage layout constants --------------------------------------------------------------------

const AGENT_X = -1.6; // agent stands left of centre
const DUMMY_X = 1.6; // dummy stands right of centre
const AGENT_TINT = 0x4f6fd9; // an agent-ish blue accent so the hero reads distinct
const DUMMY_TINT = 0x8a8f99; // neutral grey training dummy
const IDLE_SPEED = 0; // both idle-animate (breathing bob), not walking
const HAND_OFFSET = new THREE.Vector3(0.32, 1.2, 0.34); // approx right-hand weapon muzzle (local)
const FLINCH_TIME = 0.32; // seconds the dummy recoils / red-tints

/** A scheduled removal of a persistent aura (the Expertise duration in the preview, sped flavor). */
interface ActiveAura {
  fx: FxHandle;
  remaining: number;
}

export class AgentStage {
  private readonly root = new THREE.Group();
  private readonly panel: HTMLDivElement;

  private selected: AgentId = AGENT_IDS[0];
  private agent: AvatarBody | null = null;
  private dummy: AvatarBody | null = null;

  // Live one-shot FX (muzzle/tracer/impact/gadget bursts) — updated + reaped each frame.
  private readonly oneShots: FxHandle[] = [];
  // The single active Expertise aura (re-triggering replaces it).
  private activeAura: ActiveAura | null = null;

  // Dummy flinch state (recoil + red tint), counted down then restored.
  private flinch = 0;

  // Cosmetic cooldown affordance per skill (purely visual flavor using the kit numbers).
  private cd = { fire: 0, gadget: 0, ability: 0 };
  private statusEl: HTMLDivElement | null = null;

  constructor(
    scene: THREE.Scene,
    private readonly host: HTMLElement,
    private readonly audio?: AudioEngine,
  ) {
    scene.add(this.root);
    this.root.visible = false;
    this.panel = this.buildPanel();
    this.select(this.selected);
  }

  // --- agent (re)build -------------------------------------------------------------------------

  /** Select + (re)build the stage for an agent id. */
  private select(id: AgentId): void {
    this.selected = id;
    this.teardownAvatars();

    // The hero agent — tinted blue, facing the dummy.
    const agent = buildAvatarBody({ seed: hashId(id) });
    agent.setTier(AGENT_TINT);
    agent.group.position.set(AGENT_X, AVATAR_HEIGHT / 2, 0);
    agent.group.rotation.y = Math.PI / 2; // +X faces +X toward the dummy
    this.root.add(agent.group);
    this.agent = agent;

    // The training dummy — neutral grey, facing back at the agent.
    const dummy = buildAvatarBody({ seed: 0xd00d });
    dummy.setTier(DUMMY_TINT);
    dummy.group.position.set(DUMMY_X, AVATAR_HEIGHT / 2, 0);
    dummy.group.rotation.y = -Math.PI / 2;
    this.root.add(dummy.group);
    this.dummy = dummy;

    this.renderKit(AGENTS_BY_ID[id]);
    this.updateStatus();
  }

  private teardownAvatars(): void {
    this.clearAura();
    for (const fx of this.oneShots) fx.dispose();
    this.oneShots.length = 0;
    this.flinch = 0;
    if (this.agent) {
      this.agent.dispose();
      this.agent.group.removeFromParent();
      this.agent = null;
    }
    if (this.dummy) {
      this.dummy.dispose();
      this.dummy.group.removeFromParent();
      this.dummy = null;
    }
  }

  // --- world helpers ---------------------------------------------------------------------------

  /** World position of the agent's weapon muzzle (its right hand), in scene space. */
  private muzzleWorld(): THREE.Vector3 {
    if (!this.agent) return new THREE.Vector3();
    return this.agent.group.localToWorld(HAND_OFFSET.clone());
  }

  /** World position of the dummy's torso (chest height), in scene space. */
  private dummyChest(): THREE.Vector3 {
    if (!this.dummy) return new THREE.Vector3(DUMMY_X, 1.0, 0);
    return this.dummy.group.localToWorld(new THREE.Vector3(0, 0.95, 0));
  }

  private addFx(fx: FxHandle): void {
    this.root.add(fx.object3d);
    this.oneShots.push(fx);
  }

  // --- skill triggers (purely visual) ----------------------------------------------------------

  /** Fire: muzzle flash at the hand → tracer to the dummy → impact + a quick dummy flinch. */
  private triggerFire(): void {
    if (!this.agent || !this.dummy) return;
    const from = this.muzzleWorld();
    const to = this.dummyChest();
    const dir = to.clone().sub(from);
    this.addFx(muzzleFlash(from, dir));
    this.addFx(tracer(from, to));
    this.addFx(impactFlash(to));
    this.flinch = FLINCH_TIME;
    this.audio?.playSfx('fire');
    this.cd.fire = AGENTS_BY_ID[this.selected].weaponStats.fireCooldownMs / 1000;
    this.updateStatus();
  }

  /** Gadget: kind-appropriate FX (scan ring / frag burst / mirage poof). */
  private triggerGadget(): void {
    if (!this.agent || !this.dummy) return;
    const g = AGENTS_BY_ID[this.selected].gadget;
    if (g.kind === 'scan') {
      const center = this.root.localToWorld(new THREE.Vector3(AGENT_X, 0, 0));
      this.addFx(scanPulse(center, Math.min(g.radius, 6))); // clamp preview radius to the stage
      this.dummyHighlight();
    } else if (g.kind === 'frag') {
      this.addFx(fragBurst(this.dummyChest(), Math.min(g.radius, 3)));
      this.flinch = FLINCH_TIME;
    } else {
      // mirage: poof at the agent + the agent briefly fades (a decoy is left in the poof).
      const at = this.root.localToWorld(new THREE.Vector3(AGENT_X, 0, 0));
      this.addFx(miragePoof(at));
      this.agentFade();
    }
    this.audio?.playSfx('ability');
    this.cd.gadget = g.cooldownMs / 1000;
    this.updateStatus();
  }

  /** Expertise: attach the matching aura to the agent for the ability duration, then auto-remove. */
  private triggerAbility(): void {
    if (!this.agent) return;
    const a = AGENTS_BY_ID[this.selected];
    this.clearAura();
    const fx = abilityAura(auraForAbility(a.ability));
    fx.object3d.position.set(AGENT_X, 0, 0);
    this.root.add(fx.object3d);
    // Preview flavor: run the aura for a fraction of the real duration so it auto-clears promptly.
    this.activeAura = { fx, remaining: Math.min(a.abilityDurationMs / 1000, 6) };
    this.audio?.playSfx('ability');
    this.cd.ability = a.abilityCooldownMs / 1000;
    this.updateStatus();
  }

  private clearAura(): void {
    if (this.activeAura) {
      this.activeAura.fx.dispose();
      this.activeAura = null;
    }
  }

  /** Briefly highlight the dummy (cyan emissive) — used by the scan ping. */
  private dummyHighlight(): void {
    if (!this.dummy) return;
    this.dummy.setEmissive(0x35e0ff, 0.8);
    window.setTimeout(() => this.dummy?.setEmissive(0x000000, 0), 600);
  }

  /** Briefly fade the agent (mirage vanish). */
  private agentFade(): void {
    if (!this.agent) return;
    this.agent.setOpacity(0.2);
    window.setTimeout(() => this.agent?.setOpacity(1), 500);
  }

  // --- DOM kit panel ---------------------------------------------------------------------------

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
    title.textContent = 'Agent Kit';
    panel.appendChild(title);

    // Agent picker — one button per playable agent.
    const picker = document.createElement('div');
    Object.assign(picker.style, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px',
      margin: '4px 0 8px',
    } satisfies Partial<CSSStyleDeclaration>);
    for (const id of AGENT_IDS) {
      const b = document.createElement('button');
      b.textContent = AGENTS_BY_ID[id].name;
      b.dataset.agent = id;
      b.style.flex = '1 1 30%';
      b.style.cursor = 'pointer';
      b.style.fontSize = '11px';
      b.addEventListener('click', () => {
        this.select(id);
        for (const child of picker.children) {
          const el = child as HTMLButtonElement;
          el.style.fontWeight = el.dataset.agent === id ? '700' : '400';
        }
      });
      if (id === this.selected) b.style.fontWeight = '700';
      picker.appendChild(b);
    }
    panel.appendChild(picker);

    // Kit body (filled by renderKit on each select).
    this.kitBody = document.createElement('div');
    panel.appendChild(this.kitBody);

    // Trigger buttons.
    const triggers = document.createElement('div');
    Object.assign(triggers.style, {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: '6px',
      marginTop: '10px',
    } satisfies Partial<CSSStyleDeclaration>);
    triggers.append(
      this.mkTrigger('Fire', () => this.triggerFire()),
      this.mkTrigger('Gadget', () => this.triggerGadget()),
      this.mkTrigger('Expertise', () => this.triggerAbility()),
    );
    panel.appendChild(triggers);

    // Cosmetic cooldown status line.
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

  private kitBody: HTMLDivElement = document.createElement('div');

  private mkTrigger(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cursor = 'pointer';
    b.style.fontSize = '12px';
    b.addEventListener('click', onClick); // safe to spam — each trigger reaps prior one-shots
    return b;
  }

  /** Render the selected agent's full kit into the DOM panel. */
  private renderKit(a: Agent): void {
    this.kitBody.replaceChildren();

    const head = document.createElement('div');
    head.style.fontSize = '13px';
    head.style.margin = '0 0 6px';
    head.innerHTML = `<b style="color:#fff">${esc(a.name)}</b> · <span style="color:#9ab">${esc(a.role)}</span>`;
    this.kitBody.appendChild(head);

    const desc = document.createElement('div');
    desc.style.fontSize = '11px';
    desc.style.color = '#aab';
    desc.style.margin = '0 0 8px';
    desc.textContent = a.description;
    this.kitBody.appendChild(desc);

    this.kitBody.appendChild(
      this.section('Weapon', `${a.weapon}`, [
        ['Damage', String(a.weaponStats.damage)],
        ['Fire rate', `${a.weaponStats.fireCooldownMs}ms`],
        ['Range', `${a.weaponStats.range}m`],
      ]),
    );
    this.kitBody.appendChild(
      this.section(`Gadget (${a.gadget.kind})`, a.gadget.name, [
        ['Cooldown', formatMs(a.gadget.cooldownMs)],
        ['Radius', `${a.gadget.radius}m`],
        ['Detail', a.gadget.description],
      ]),
    );
    this.kitBody.appendChild(
      this.section('Expertise', a.abilityName, [
        ['Duration', formatMs(a.abilityDurationMs)],
        ['Cooldown', formatMs(a.abilityCooldownMs)],
      ]),
    );
    this.kitBody.appendChild(this.section('Passive', a.passive, []));
  }

  /** A labelled kit section: a heading, a highlighted value, and a list of stat rows. */
  private section(label: string, value: string, rows: ReadonlyArray<readonly [string, string]>): HTMLElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      margin: '6px 0',
      padding: '6px 8px',
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid #2a2f40',
      borderRadius: '5px',
    } satisfies Partial<CSSStyleDeclaration>);

    const head = document.createElement('div');
    head.style.fontSize = '10px';
    head.style.letterSpacing = '0.08em';
    head.style.textTransform = 'uppercase';
    head.style.color = '#789';
    head.textContent = label;
    wrap.appendChild(head);

    const val = document.createElement('div');
    val.style.fontSize = '13px';
    val.style.color = '#fff';
    val.style.margin = '1px 0 3px';
    val.textContent = value;
    wrap.appendChild(val);

    for (const [k, v] of rows) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '10px',
        fontSize: '11px',
        color: '#bcd',
      } satisfies Partial<CSSStyleDeclaration>);
      const kk = document.createElement('span');
      kk.textContent = k;
      kk.style.color = '#89a';
      const vv = document.createElement('span');
      vv.textContent = v;
      vv.style.textAlign = 'right';
      row.append(kk, vv);
      wrap.appendChild(row);
    }
    return wrap;
  }

  private updateStatus(): void {
    if (!this.statusEl) return;
    const line = (name: string, cd: number): string =>
      cd > 0 ? `${name}: on cooldown ${cd.toFixed(1)}s…` : `${name}: ready`;
    this.statusEl.textContent = [
      line('Fire', this.cd.fire),
      line('Gadget', this.cd.gadget),
      line('Expertise', this.cd.ability),
    ].join('\n');
  }

  // --- lifecycle -------------------------------------------------------------------------------

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.panel.style.display = visible ? 'block' : 'none';
  }

  /** Point the orbit camera at the two-figure stage (front-on, slightly above). */
  frame(camera: THREE.PerspectiveCamera, controls: { target: THREE.Vector3; update(): void }): void {
    controls.target.set(0, 1.0, 0);
    camera.position.set(0, 1.8, 6.5);
    camera.lookAt(0, 1.0, 0);
    controls.update();
  }

  /** Drive avatar idle animation, active FX, flinch + cosmetic cooldown countdowns. `dt` seconds. */
  update(dt: number): void {
    if (!this.root.visible) return;

    this.agent?.animate(dt, IDLE_SPEED);
    this.dummy?.animate(dt, IDLE_SPEED);

    // One-shots: advance + reap finished.
    for (let i = this.oneShots.length - 1; i >= 0; i--) {
      const fx = this.oneShots[i];
      if (!fx) continue;
      fx.update(dt);
      if (fx.done) {
        fx.dispose();
        this.oneShots.splice(i, 1);
      }
    }

    // Persistent aura: run, then auto-remove when its window elapses.
    if (this.activeAura) {
      this.activeAura.fx.update(dt);
      this.activeAura.remaining -= dt;
      if (this.activeAura.remaining <= 0) this.clearAura();
    }

    // Dummy flinch: recoil back + red tint, easing back to rest.
    if (this.flinch > 0 && this.dummy) {
      this.flinch = Math.max(0, this.flinch - dt);
      const t = this.flinch / FLINCH_TIME; // 1→0
      this.dummy.group.position.x = DUMMY_X + t * 0.25; // knock back along +X
      this.dummy.setBrightness(1 + t * 1.2); // brief flash
      this.dummy.setEmissive(0xff3030, t * 0.8); // red tint
      if (this.flinch === 0) {
        this.dummy.group.position.x = DUMMY_X;
        this.dummy.setBrightness(1);
        this.dummy.setEmissive(0x000000, 0);
      }
    }

    // Cosmetic cooldown countdowns.
    let changed = false;
    for (const k of ['fire', 'gadget', 'ability'] as const) {
      if (this.cd[k] > 0) {
        this.cd[k] = Math.max(0, this.cd[k] - dt);
        changed = true;
      }
    }
    if (changed) this.updateStatus();
  }

  dispose(): void {
    this.teardownAvatars();
    this.panel.remove();
    this.root.removeFromParent();
  }
}

// --- small pure utils --------------------------------------------------------------------------

/** Deterministic 32-bit hash of an agent id → a stable avatar seed (distinct look per agent). */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Escape a string for safe innerHTML interpolation in the kit header. */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return '&quot;';
    }
  });
}
