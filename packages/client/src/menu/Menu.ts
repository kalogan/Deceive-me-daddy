// The front-of-game splash + start menu (a plain fixed DOM overlay, NOT Three). The game
// boots into THIS, not straight into a match: nothing connects until the player picks a
// mode here. It owns no gameplay truth — it just gathers the player's choice (mode + agent)
// and resolves a Promise main.ts awaits before it calls the existing game-start logic.
//
// Style: a sibling of the HUD (see hud/Hud.ts) — clean monospace, dark translucent panels,
// inline styles, no framework. It's a full-screen fixed overlay with a big "DECEIVE" title.
//
// Browser-only (it touches the DOM + AudioEngine), so it must NEVER be imported by a Node
// gate test. Only main.ts imports it. The one piece of LOGIC worth testing — mapping a menu
// choice to ColyseusSource connect options — is the PURE `connectOptionsFor` below, which
// menu.test.ts exercises with no DOM at all.
import { AGENT_IDS, AGENTS_BY_ID, type AgentId } from '@deceive/shared';
import type { AudioEngine } from '../audio/AudioEngine';

/** The two ways into a match the menu offers. */
export type MenuMode = 'solo' | 'multiplayer';

/** The player's resolved choice: which mode to enter and which agent to play. */
export interface MenuChoice {
  mode: MenuMode;
  agent: AgentId;
}

/**
 * The connect options main.ts threads into source selection (and on to ColyseusSource.connect).
 * Mirrors the `connect(opts)` contract: `mode` picks create-vs-join, `agent` is the requested
 * loadout the server honours. Kept a STANDALONE shape (not the whole MenuChoice) so the net
 * layer never depends on menu types.
 */
export interface ConnectOptions {
  mode: MenuMode;
  agent: AgentId;
}

/**
 * PURE choice → connect-options mapping (no DOM), the one unit-tested seam of the menu.
 * Today it's a straight pass-through, but isolating it means the create-vs-join decision
 * and any future normalisation (default agent, mode fallbacks) live in ONE tested place
 * rather than being smeared through the DOM wiring. See menu.test.ts.
 */
export function connectOptionsFor(choice: MenuChoice): ConnectOptions {
  return { mode: choice.mode, agent: choice.agent };
}

/** Non-match control hooks the menu's Settings screen drives (wired to main.ts). */
export interface MenuControls {
  /** Toggle strafe inversion (some players want move-right → world-left). Default off. */
  onInvertStrafe?: (inverted: boolean) => void;
}

// --- Palette ------------------------------------------------------------------------------
// A tight dark-spy palette shared across the screens, echoing the HUD's translucent panels.
const INK = '#dde'; // primary text
const MUTED = '#9aa'; // labels / secondary text
const ACCENT = '#7fe3ff'; // cyan highlight (selected agent, focus)
const GOLD = '#ffcf3f'; // call-to-action gold (Quick Play)
const PANEL_BG = 'rgba(10, 12, 18, 0.82)';
const CARD_BG = 'rgba(0, 0, 0, 0.5)';
const BORDER = 'rgba(255, 255, 255, 0.16)';

/** Apply a partial inline style set (typed, matching the HUD's `Object.assign(...style)`). */
function style(el: HTMLElement, s: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, s);
}

/**
 * Build a menu button in the house style: a dark translucent pill that lights up on hover.
 * `tone` lets the primary call-to-action read gold while secondary actions stay neutral.
 */
function makeButton(label: string, tone: 'primary' | 'normal' = 'normal'): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  const base = tone === 'primary' ? GOLD : INK;
  style(btn, {
    display: 'block',
    width: '100%',
    margin: '0 0 10px',
    padding: '13px 16px',
    font: '600 15px/1.2 ui-monospace, monospace',
    letterSpacing: '0.04em',
    color: base,
    background: CARD_BG,
    border: `1px solid ${tone === 'primary' ? 'rgba(255,207,63,0.55)' : BORDER}`,
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 0.12s linear, border-color 0.12s linear, transform 0.06s linear',
  });
  btn.addEventListener('pointerenter', () => {
    btn.style.background = 'rgba(255, 255, 255, 0.08)';
    btn.style.borderColor = tone === 'primary' ? 'rgba(255,207,63,0.9)' : 'rgba(255,255,255,0.4)';
  });
  btn.addEventListener('pointerleave', () => {
    btn.style.background = CARD_BG;
    btn.style.borderColor = tone === 'primary' ? 'rgba(255,207,63,0.55)' : BORDER;
  });
  btn.addEventListener('pointerdown', () => {
    btn.style.transform = 'translateY(1px)';
  });
  btn.addEventListener('pointerup', () => {
    btn.style.transform = 'translateY(0)';
  });
  return btn;
}

/**
 * The splash + start menu overlay. Construct it, call `choose()` to show it and await the
 * player's pick; the returned Promise resolves with { mode, agent } once Quick Play or
 * Online Multiplayer is clicked, at which point the overlay hides and the game can start.
 *
 * The first user gesture anywhere on the overlay unlocks + starts the AudioEngine (browsers
 * suspend audio until a gesture), so the ambient bed and UI feel alive before the match.
 */
export class Menu {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  /** The currently-selected agent, surfaced on MAIN and confirmed on AGENT SELECT. */
  private agent: AgentId = AGENT_IDS[0];
  /** The label on MAIN's "Agent: <name> ▸" row, kept in sync with `agent`. */
  private agentRowText: HTMLSpanElement | null = null;
  /** Resolver for the active `choose()` Promise; null when no choice is pending. */
  private resolveChoice: ((choice: MenuChoice) => void) | null = null;
  /** One-shot audio unlock (browsers need a gesture); cleared after it fires once. */
  private unlockAudio: (() => void) | null = null;

  constructor(
    private readonly audio: AudioEngine,
    private readonly controls: MenuControls = {},
    parent: HTMLElement = document.body,
  ) {
    const root = document.createElement('div');
    root.id = 'menu';
    style(root, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      // A dark vignette over a near-black base so the greybox scene behind never bleeds
      // through and the title reads as the focal point.
      background:
        'radial-gradient(120% 90% at 50% 18%, rgba(36,42,60,0.55), rgba(8,9,14,0.96) 70%), #0c0d12',
      color: INK,
      font: '14px/1.5 ui-monospace, monospace',
      userSelect: 'none',
      zIndex: '50',
    });

    // First gesture of ANY kind unlocks audio (see field doc). Browsers suspend audio until a
    // gesture, so we resume + bring up the menu ambient bed on the earliest interaction —
    // pointer, touch, OR key — so the splash soundtrack comes up as soon as the player touches
    // anything, then we detach. main.ts's own unlock listeners are a fallback for the in-game path.
    this.unlockAudio = () => {
      this.audio.resume();
      this.audio.startAmbient('menu');
      this.detachUnlock();
    };
    root.addEventListener('pointerdown', this.unlockAudio);
    root.addEventListener('touchstart', this.unlockAudio);
    window.addEventListener('keydown', this.unlockAudio);

    // Title block: oversized "DECEIVE" wordmark + subtitle, sitting above the active panel.
    const title = document.createElement('div');
    title.textContent = 'DECEIVE';
    style(title, {
      font: '900 64px/1 ui-monospace, monospace',
      letterSpacing: '0.18em',
      color: INK,
      textShadow: '0 0 24px rgba(127,227,255,0.25)',
      marginBottom: '8px',
    });
    const subtitle = document.createElement('div');
    subtitle.textContent = 'a stealth-heist of disguises and deception';
    style(subtitle, {
      color: MUTED,
      letterSpacing: '0.06em',
      marginBottom: '26px',
      textAlign: 'center',
    });

    // The panel that swaps content between the three screens. A single translucent card so
    // the layout stays stable as screens change.
    const panel = document.createElement('div');
    style(panel, {
      width: 'min(440px, 90vw)',
      maxHeight: '70vh',
      overflowY: 'auto',
      padding: '20px',
      background: PANEL_BG,
      border: `1px solid ${BORDER}`,
      borderRadius: '12px',
      boxShadow: '0 18px 60px rgba(0,0,0,0.6)',
    });

    root.append(title, subtitle, panel);
    parent.appendChild(root);
    root.style.display = 'none'; // hidden until choose() shows it.

    this.root = root;
    this.panel = panel;
  }

  /** Detach the one-shot audio-unlock listeners from every target they were attached to. */
  private detachUnlock(): void {
    if (!this.unlockAudio) return;
    this.root.removeEventListener('pointerdown', this.unlockAudio);
    this.root.removeEventListener('touchstart', this.unlockAudio);
    window.removeEventListener('keydown', this.unlockAudio);
    this.unlockAudio = null;
  }

  /** A light UI click for menu-option feedback. No-op until audio is unlocked (pre-gesture). */
  private tick(): void {
    this.audio.playSfx('uiTick');
  }

  /**
   * Show the menu and resolve once the player commits to a mode (Quick Play / Online
   * Multiplayer). Resolves with their { mode, agent }; the overlay hides itself just before
   * resolving so the game can take over the screen cleanly.
   */
  choose(): Promise<MenuChoice> {
    this.root.style.display = 'flex';
    this.showMain();
    return new Promise<MenuChoice>((resolve) => {
      this.resolveChoice = resolve;
    });
  }

  /** Commit a mode pick: hide the overlay and resolve the pending choose() Promise. */
  private commit(mode: MenuMode): void {
    this.tick();
    const resolve = this.resolveChoice;
    this.resolveChoice = null;
    this.root.style.display = 'none';
    resolve?.({ mode, agent: this.agent });
  }

  /** Swap the panel to a fresh screen, clearing whatever was there. */
  private setScreen(build: (panel: HTMLDivElement) => void): void {
    this.panel.replaceChildren();
    build(this.panel);
  }

  /** MAIN: Quick Play / Online Multiplayer / the agent row / Settings. */
  private showMain(): void {
    this.tick(); // light feedback on navigation (no-op until the first gesture unlocks audio).
    this.setScreen((panel) => {
      const quick = makeButton('Quick Play', 'primary');
      quick.setAttribute('data-menu', 'quick-play');
      const quickHint = document.createElement('span');
      quickHint.textContent = '  — vs bots';
      quickHint.style.color = MUTED;
      quick.append(quickHint);
      quick.addEventListener('click', () => this.commit('solo'));

      const online = makeButton('Online Multiplayer');
      online.setAttribute('data-menu', 'online');
      online.addEventListener('click', () => this.commit('multiplayer'));

      // The agent-select entry: a row showing the current pick that opens AGENT SELECT.
      const agentRow = makeButton(`Agent: ${AGENTS_BY_ID[this.agent].name}  ▸`);
      agentRow.setAttribute('data-menu', 'agent-select');
      // Hold the text node so reselecting an agent can update the label in place.
      const agentRowText = document.createElement('span');
      agentRow.replaceChildren(agentRowText);
      this.agentRowText = agentRowText;
      this.syncAgentRow();
      agentRow.addEventListener('click', () => this.showAgents());

      const settings = makeButton('Settings');
      settings.setAttribute('data-menu', 'settings');
      settings.addEventListener('click', () => this.showSettings());

      panel.append(quick, online, agentRow, settings);
    });
  }

  /** Refresh MAIN's agent row to match the current selection (name only; arrow affords more). */
  private syncAgentRow(): void {
    if (this.agentRowText) {
      this.agentRowText.textContent = `Agent: ${AGENTS_BY_ID[this.agent].name}  ▸`;
    }
  }

  /**
   * AGENT SELECT: a card per playable agent (Squire / Chavez / Larcin) showing name, role,
   * weapon, Expertise name + description. Clicking a card selects that agent and returns to
   * MAIN. The currently-selected card reads with the cyan accent border.
   */
  private showAgents(): void {
    this.tick();
    this.setScreen((panel) => {
      const heading = document.createElement('div');
      heading.textContent = 'SELECT AGENT';
      style(heading, {
        font: '800 16px/1.2 ui-monospace, monospace',
        letterSpacing: '0.08em',
        marginBottom: '14px',
        color: INK,
      });
      panel.append(heading);

      for (const id of AGENT_IDS) {
        panel.append(this.makeAgentCard(id));
      }

      const back = makeButton('◂ Back');
      back.setAttribute('data-menu', 'agents-back');
      back.addEventListener('click', () => this.showMain());
      panel.append(back);
    });
  }

  /** One agent card (a clickable panel). Selecting it sets `agent` and returns to MAIN. */
  private makeAgentCard(id: AgentId): HTMLButtonElement {
    const agent = AGENTS_BY_ID[id];
    const selected = id === this.agent;
    const card = document.createElement('button');
    card.type = 'button';
    card.setAttribute('data-agent', id);
    style(card, {
      display: 'block',
      width: '100%',
      margin: '0 0 12px',
      padding: '12px 14px',
      textAlign: 'left',
      color: INK,
      background: CARD_BG,
      border: `1px solid ${selected ? ACCENT : BORDER}`,
      borderRadius: '8px',
      cursor: 'pointer',
      transition: 'border-color 0.12s linear, background 0.12s linear',
    });

    // Header row: name (bold) + a SELECTED pill on the active card.
    const head = document.createElement('div');
    style(head, { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' });
    const name = document.createElement('span');
    name.textContent = agent.name;
    style(name, { font: '800 16px/1.2 ui-monospace, monospace', letterSpacing: '0.03em' });
    const role = document.createElement('span');
    role.textContent = `${agent.role} · ${agent.weapon}`;
    style(role, { color: MUTED, fontSize: '12px' });
    head.append(name, role);
    if (selected) {
      const pill = document.createElement('span');
      pill.textContent = 'SELECTED';
      style(pill, {
        marginLeft: 'auto',
        color: ACCENT,
        fontSize: '11px',
        letterSpacing: '0.08em',
        fontWeight: '700',
      });
      head.append(pill);
    }

    // Expertise name + description: the at-a-glance reason to pick this agent.
    const ability = document.createElement('div');
    ability.textContent = `◎ ${agent.abilityName}`;
    style(ability, { color: GOLD, fontWeight: '700', margin: '2px 0 4px' });
    const desc = document.createElement('div');
    desc.textContent = agent.description;
    style(desc, { color: MUTED, fontSize: '12px', lineHeight: '1.5' });

    card.append(head, ability, desc);

    card.addEventListener('pointerenter', () => {
      if (id !== this.agent) card.style.borderColor = 'rgba(255,255,255,0.4)';
    });
    card.addEventListener('pointerleave', () => {
      if (id !== this.agent) card.style.borderColor = BORDER;
    });
    card.addEventListener('click', () => {
      this.agent = id;
      this.syncAgentRow();
      this.showMain();
    });
    return card;
  }

  /**
   * SETTINGS: Music + SFX volume sliders and a Mute checkbox, wired LIVE to the AudioEngine
   * (a drag rides the music/sfx bus gains immediately; the checkbox rides the master). A Back
   * button returns to MAIN. Settings are session-local (no persistence in v1).
   */
  private showSettings(): void {
    this.tick();
    this.setScreen((panel) => {
      const heading = document.createElement('div');
      heading.textContent = 'SETTINGS';
      style(heading, {
        font: '800 16px/1.2 ui-monospace, monospace',
        letterSpacing: '0.08em',
        marginBottom: '16px',
        color: INK,
      });
      panel.append(heading);

      // Music + SFX sliders, each driving the matching AudioEngine setter on input.
      panel.append(
        this.makeSlider('Music volume', 0.6, (v) => this.audio.setMusicVolume(v)),
        this.makeSlider('SFX volume', 0.6, (v) => this.audio.setSfxVolume(v)),
      );

      // Mute checkbox — rides the master gain (same path as the in-game 'M' key).
      const muteRow = document.createElement('label');
      style(muteRow, {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        margin: '8px 0 18px',
        cursor: 'pointer',
        color: INK,
      });
      const mute = document.createElement('input');
      mute.type = 'checkbox';
      mute.setAttribute('data-menu', 'mute');
      style(mute, { width: '16px', height: '16px', accentColor: ACCENT, cursor: 'pointer' });
      mute.addEventListener('change', () => this.audio.setMuted(mute.checked));
      const muteLabel = document.createElement('span');
      muteLabel.textContent = 'Mute all audio';
      muteRow.append(mute, muteLabel);
      panel.append(muteRow);

      // Invert strafe — flips left/right movement for players who prefer it (default off).
      const invertRow = document.createElement('label');
      style(invertRow, {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        margin: '0 0 18px',
        cursor: 'pointer',
        color: INK,
      });
      const invert = document.createElement('input');
      invert.type = 'checkbox';
      invert.setAttribute('data-menu', 'invert-strafe');
      style(invert, { width: '16px', height: '16px', accentColor: ACCENT, cursor: 'pointer' });
      invert.addEventListener('change', () => this.controls.onInvertStrafe?.(invert.checked));
      const invertLabel = document.createElement('span');
      invertLabel.textContent = 'Invert strafe (left/right)';
      invertRow.append(invert, invertLabel);
      panel.append(invertRow);

      const back = makeButton('◂ Back');
      back.setAttribute('data-menu', 'settings-back');
      back.addEventListener('click', () => this.showMain());
      panel.append(back);
    });
  }

  /**
   * A labelled 0..1 volume slider. `initial` seeds both the thumb and a live read-out; `apply`
   * is the AudioEngine setter called on every `input` so the change is audible immediately.
   */
  private makeSlider(
    label: string,
    initial: number,
    apply: (v: number) => void,
  ): HTMLDivElement {
    const row = document.createElement('div');
    style(row, { margin: '0 0 16px' });

    const head = document.createElement('div');
    style(head, { display: 'flex', justifyContent: 'space-between', marginBottom: '6px' });
    const name = document.createElement('span');
    name.textContent = label;
    name.style.color = MUTED;
    const value = document.createElement('span');
    value.textContent = `${Math.round(initial * 100)}%`;
    value.style.color = INK;
    head.append(name, value);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.round(initial * 100));
    style(slider, { width: '100%', accentColor: ACCENT, cursor: 'pointer' });
    slider.addEventListener('input', () => {
      const v = Number(slider.value) / 100;
      value.textContent = `${slider.value}%`;
      apply(v);
    });
    // Seed the engine with the initial value so the displayed read-out matches reality.
    apply(initial);

    row.append(head, slider);
    return row;
  }

  /** Remove the overlay + detach the one-shot audio-unlock listener (hot-reload teardown). */
  dispose(): void {
    this.detachUnlock();
    this.root.remove();
  }
}
