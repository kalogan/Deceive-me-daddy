// "Deceive Me Daddy" expansion — the CONCEPT PREVIEW tab. Stages a crowd of distinguishable NPCs in a
// minimal train-station setting and drives the find-the-dad loop through a "Case File" panel: a live
// departure countdown, clues that dim the suspects who don't match, and a confirm/reveal interaction.
// Preview-only DOM + THREE (never in the game bundle). Pure deduction logic lives in ./daddyHunt
// (unit-tested); this file is the visualisation + wiring. See docs/EXPANSION_DECEIVE_ME_DADDY.md.
import * as THREE from 'three';
import { buildAvatarBody, AVATAR_HEIGHT, type AvatarBody } from '../render/avatar';
import {
  clueSequence,
  formatCountdown,
  generateRoster,
  makeRng,
  matchesAll,
  type Clue,
  type Suspect,
} from './daddyHunt';

const CROWD_SIZE = 16;
const ROUND_MS = 120_000; // a 2:00 departure
const WRONG_PENALTY_MS = 15_000; // a wrong accusation costs time
const ROUND_SEED_BASE = 0xdadd1e; // varied per "new round" by an incrementing offset

interface CrowdMember {
  readonly suspect: Suspect;
  readonly body: AvatarBody;
}

export class DaddyStage {
  private readonly root = new THREE.Group();
  private readonly panel: HTMLDivElement;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  private crowd: CrowdMember[] = [];
  private clues: Clue[] = []; // the full ordered sequence for the current dad
  private revealed = 0; // how many clues are known
  private timeLeftMs = ROUND_MS;
  private roundOver: 'won' | 'lost' | null = null;
  private roundSeed = ROUND_SEED_BASE;

  // DOM refs.
  private clockEl: HTMLDivElement | null = null;
  private clueListEl: HTMLDivElement | null = null;
  private leftEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private findBtn: HTMLButtonElement | null = null;
  private askBtn: HTMLButtonElement | null = null;
  private confirmBtn: HTMLButtonElement | null = null;

  constructor(
    scene: THREE.Scene,
    private readonly host: HTMLElement,
  ) {
    scene.add(this.root);
    this.root.visible = false;
    this.buildBackdrop();
    this.panel = this.buildPanel();
    this.startRound();
  }

  // --- round lifecycle -------------------------------------------------------------------------

  private startRound(): void {
    this.teardownCrowd();
    const rng = makeRng(this.roundSeed);
    const roster = generateRoster(CROWD_SIZE, rng);
    const dad = roster.find((s) => s.isDad)!;
    this.clues = clueSequence(dad);
    this.revealed = 2; // start with 1–2 clues (here: coat + platform)
    this.timeLeftMs = ROUND_MS;
    this.roundOver = null;

    // Lay the crowd out in a loose 4×N grid with a little jitter, all facing the camera.
    const cols = 4;
    const jitter = makeRng(this.roundSeed ^ 0x9e37);
    roster.forEach((suspect, i) => {
      const body = buildAvatarBody({ seed: suspect.seed });
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = (col - (cols - 1) / 2) * 2.4 + (jitter() - 0.5) * 0.7;
      const z = row * 2.2 - 3 + (jitter() - 0.5) * 0.6;
      body.group.position.set(x, AVATAR_HEIGHT / 2, z);
      body.group.rotation.y = Math.PI + (jitter() - 0.5) * 0.5;
      body.setTier(suspect.coat.hex); // tint each by their coat colour so clues read in the crowd
      this.root.add(body.group);
      this.crowd.push({ suspect, body });
    });

    this.applyNarrowing();
    this.refreshPanel();
    this.setStatus('Two clues in. Narrow the crowd, then confirm before the train leaves.');
  }

  private teardownCrowd(): void {
    for (const m of this.crowd) {
      m.body.dispose();
      m.body.group.removeFromParent();
    }
    this.crowd = [];
  }

  /** The clues currently known to the player. */
  private activeClues(): Clue[] {
    return this.clues.slice(0, this.revealed);
  }

  /** Dim every suspect who fails a known clue; keep matchers bright. Resets emissive each pass. */
  private applyNarrowing(): void {
    const active = this.activeClues();
    for (const m of this.crowd) {
      const match = matchesAll(m.suspect, active);
      m.body.setBrightness(match ? 1 : 0.22);
      m.body.setOpacity(match ? 1 : 0.5);
      m.body.setEmissive(0x000000, 0);
    }
  }

  private remaining(): CrowdMember[] {
    const active = this.activeClues();
    return this.crowd.filter((m) => matchesAll(m.suspect, active));
  }

  private revealNextClue(source: 'found' | 'witness'): void {
    if (this.roundOver) return;
    if (this.revealed >= this.clues.length) {
      this.setStatus('No more clues to find — make the call.');
      return;
    }
    const clue = this.clues[this.revealed]!;
    this.revealed += 1;
    this.applyNarrowing();
    this.refreshPanel();
    const lead =
      source === 'witness' ? 'A bystander mutters:' : 'You find a dropped photo — new detail:';
    this.setStatus(`${lead} “${clue.label}.” ${this.remaining().length} suspect(s) left.`);
  }

  private confirm(): void {
    if (this.roundOver) return;
    const candidates = this.remaining();
    // "Walk up to" the most likely suspect — the first still-matching one.
    const accused = candidates[0];
    if (!accused) {
      this.setStatus('No one matches your clues — re-check them.');
      return;
    }
    if (accused.suspect.isDad) {
      this.roundOver = 'won';
      accused.body.setBrightness(1);
      accused.body.setOpacity(1);
      accused.body.setEmissive(0xffd54a, 1.1); // golden "found you!" glow
      this.setStatus('🎉 “DAD!” You found him with time to spare. Round won.');
    } else {
      this.timeLeftMs -= WRONG_PENALTY_MS;
      this.setStatus(
        `“…sorry, wrong person.” Not your dad — −15s. ${this.remaining().length} still match.`,
      );
    }
    this.refreshPanel();
  }

  private revealDad(): void {
    const dad = this.crowd.find((m) => m.suspect.isDad);
    if (!dad) return;
    for (const m of this.crowd) {
      const isDad = m.suspect.isDad;
      m.body.setBrightness(isDad ? 1 : 0.18);
      m.body.setOpacity(isDad ? 1 : 0.4);
      m.body.setEmissive(isDad ? 0xffd54a : 0x000000, isDad ? 1.1 : 0);
    }
    this.setStatus(
      `Debug — dad: ${dad.suspect.coat.name} coat · platform ${dad.suspect.platform} · ${dad.suspect.accessory}.`,
    );
  }

  private loseRound(): void {
    this.roundOver = 'lost';
    for (const m of this.crowd) {
      m.body.setBrightness(0.2);
      m.body.setOpacity(0.45);
    }
    this.setStatus('🚆 The train departed. Dad boarded and is gone — round lost.');
    this.refreshPanel();
  }

  // --- DOM panel -------------------------------------------------------------------------------

  private buildPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'preview-panel';
    Object.assign(panel.style, {
      display: 'none',
      maxWidth: '310px',
      position: 'fixed',
      right: '12px',
      top: '12px',
      left: 'auto',
    } satisfies Partial<CSSStyleDeclaration>);

    const title = document.createElement('div');
    title.className = 'preview-title';
    title.textContent = '🚂 Case File — Find Dad';
    panel.appendChild(title);

    const sub = document.createElement('div');
    Object.assign(sub.style, { fontSize: '10px', color: '#889', margin: '0 0 6px' });
    sub.textContent = '“Deceive Me Daddy” expansion — concept preview';
    panel.appendChild(sub);

    // Big departure clock.
    const clock = document.createElement('div');
    Object.assign(clock.style, {
      fontSize: '22px',
      fontWeight: '700',
      letterSpacing: '0.04em',
      padding: '6px 8px',
      borderRadius: '6px',
      background: 'rgba(255,255,255,0.05)',
      border: '1px solid #2a2f40',
      color: '#cfe6ff',
      textAlign: 'center',
    } satisfies Partial<CSSStyleDeclaration>);
    this.clockEl = clock;
    panel.appendChild(clock);

    // Known clues.
    const clues = document.createElement('div');
    Object.assign(clues.style, { margin: '10px 0 0', fontSize: '12px', color: '#bcd' });
    this.clueListEl = clues;
    panel.appendChild(this.labelled('Clues known', clues));

    // Suspects-left readout.
    const left = document.createElement('div');
    Object.assign(left.style, { marginTop: '8px', fontSize: '12px', color: '#9fb' });
    this.leftEl = left;
    panel.appendChild(left);

    // Action buttons.
    const actions = this.row();
    this.findBtn = this.mkBtn('🔍 Find a clue', () => this.revealNextClue('found'));
    this.askBtn = this.mkBtn('🗣 Interrogate', () => this.revealNextClue('witness'));
    actions.append(this.findBtn, this.askBtn);
    panel.appendChild(this.labelled('Investigate', actions));

    const calls = this.row();
    this.confirmBtn = this.mkBtn('✋ Confirm Dad', () => this.confirm());
    calls.append(this.confirmBtn);
    panel.appendChild(this.labelled('Make the call', calls));

    const debug = this.row();
    debug.append(
      this.mkBtn('Reveal Dad (debug)', () => this.revealDad()),
      this.mkBtn('↻ New round', () => {
        this.roundSeed = (this.roundSeed + 0x1f7) >>> 0;
        this.startRound();
      }),
    );
    panel.appendChild(this.labelled('Debug', debug));

    // Status line.
    const status = document.createElement('div');
    Object.assign(status.style, {
      marginTop: '10px',
      fontSize: '11px',
      color: '#cab',
      whiteSpace: 'pre-line',
      minHeight: '28px',
    } satisfies Partial<CSSStyleDeclaration>);
    this.statusEl = status;
    panel.appendChild(status);

    this.host.appendChild(panel);
    return panel;
  }

  private refreshPanel(): void {
    if (this.clueListEl) {
      this.clueListEl.innerHTML = '';
      this.activeClues().forEach((c) => {
        const row = document.createElement('div');
        row.style.margin = '2px 0';
        const tag = c.kind === 'appearance' ? '👁' : '📍';
        row.textContent = `${tag} ${c.label}`;
        this.clueListEl!.appendChild(row);
      });
      if (this.revealed < this.clues.length) {
        const more = document.createElement('div');
        Object.assign(more.style, { color: '#778', fontStyle: 'italic', marginTop: '2px' });
        more.textContent = `+${this.clues.length - this.revealed} clue(s) still out there…`;
        this.clueListEl.appendChild(more);
      }
    }
    if (this.leftEl) this.leftEl.textContent = `Suspects matching: ${this.remaining().length} / ${this.crowd.length}`;
    const allFound = this.revealed >= this.clues.length;
    if (this.findBtn) this.findBtn.disabled = allFound || this.roundOver !== null;
    if (this.askBtn) this.askBtn.disabled = allFound || this.roundOver !== null;
    if (this.confirmBtn) this.confirmBtn.disabled = this.roundOver !== null;
    this.updateClock();
  }

  private updateClock(): void {
    if (!this.clockEl) return;
    if (this.roundOver === 'won') {
      this.clockEl.textContent = `✓ Found · ${formatCountdown(this.timeLeftMs)} to spare`;
      this.clockEl.style.color = '#7CFC9B';
    } else if (this.roundOver === 'lost') {
      this.clockEl.textContent = '🚆 Departed · 0:00';
      this.clockEl.style.color = '#ff7a7a';
    } else {
      this.clockEl.textContent = `🚆 Train departs in ${formatCountdown(this.timeLeftMs)}`;
      this.clockEl.style.color = this.timeLeftMs <= 30_000 ? '#ff9a5a' : '#cfe6ff';
    }
  }

  // --- minimal station backdrop ----------------------------------------------------------------

  private buildBackdrop(): void {
    // Platform slab the crowd stands on.
    this.addBox([26, 0.2, 16], 0x2c303b, [0, -0.09, 0]);
    // Yellow safety stripe along the platform edge (back).
    this.addBox([26, 0.04, 0.5], 0xd9b13a, [0, 0.02, -7.4]);
    // A couple of benches on the flanks.
    this.addBox([3, 0.4, 0.9], 0x5a4633, [-10, 0.2, 4]);
    this.addBox([3, 0.4, 0.9], 0x5a4633, [10, 0.2, 4]);
    // Departure board behind the crowd (dark panel + an emissive cyan screen).
    this.addBox([0.4, 4, 0.4], 0x20242f, [-7, 2, -8]);
    this.addBox([0.4, 4, 0.4], 0x20242f, [7, 2, -8]);
    this.addBox([12, 2.4, 0.3], 0x10141c, [0, 3.4, -8]);
    const screen = this.addBox([11.2, 1.9, 0.1], 0x0a2030, [0, 3.4, -7.82]);
    (screen.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x33d6e6);
    (screen.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5;
  }

  private addBox(size: [number, number, number], color: number, pos: [number, number, number]): THREE.Mesh {
    const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    this.geometries.push(geo);
    this.materials.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    this.root.add(mesh);
    return mesh;
  }

  // --- small DOM helpers (match the other stages' look) ----------------------------------------

  private row(): HTMLDivElement {
    const r = document.createElement('div');
    Object.assign(r.style, { display: 'flex', flexWrap: 'wrap', gap: '6px' });
    return r;
  }

  private labelled(label: string, body: HTMLElement): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.margin = '8px 0 0';
    const head = document.createElement('div');
    Object.assign(head.style, {
      fontSize: '10px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: '#789',
      margin: '0 0 4px',
    });
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

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  // --- lifecycle -------------------------------------------------------------------------------

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.panel.style.display = visible ? 'block' : 'none';
  }

  frame(camera: THREE.PerspectiveCamera, controls: { target: THREE.Vector3; update(): void }): void {
    controls.target.set(0, 1.0, 0);
    camera.position.set(0, 6.5, 13);
    camera.lookAt(0, 1.0, 0);
    controls.update();
  }

  /** Idle-animate the crowd + tick the departure countdown each frame. `dt` seconds. */
  update(dt: number): void {
    if (!this.root.visible) return;
    for (const m of this.crowd) m.body.animate(dt, 0);
    if (this.roundOver) return;
    this.timeLeftMs -= dt * 1000;
    if (this.timeLeftMs <= 0) {
      this.timeLeftMs = 0;
      this.loseRound();
    } else {
      this.updateClock();
    }
  }

  dispose(): void {
    this.teardownCrowd();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.panel.remove();
    this.root.removeFromParent();
  }
}
