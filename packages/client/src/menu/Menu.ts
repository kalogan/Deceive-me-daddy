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
import {
  loadSettings,
  saveSettings,
  type PersistedSettings,
} from '../hud/settingsStore';

/** The ways into a match the menu offers: solo-vs-bots, online team heist, or a 1v1 duel. */
export type MenuMode = 'solo' | 'multiplayer' | 'duel';

/** The player's resolved choice: which mode to enter, which agent, and which level. */
export interface MenuChoice {
  mode: MenuMode;
  agent: AgentId;
  /** Requested level pack id, or '' for RANDOM (the server/offline mock picks one). */
  mapId: string;
  /**
   * True when the player chose TUTORIAL from the splash — a solo run on the tutorial level with
   * the step-by-step coach active. Optional (absent = a normal match) so existing MenuChoice
   * literals (and the pure connectOptionsFor contract) are unaffected. main.ts reads it to load
   * the tutorial pack + show the coach; the net layer ignores it (tutorial is just solo).
   */
  tutorial?: boolean;
}

/** A selectable level shown in the menu's LEVEL screen (id + display name). */
export interface MapOption {
  id: string;
  name: string;
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
  /** Requested level pack id ('' = let the server choose). */
  mapId: string;
}

/**
 * PURE choice → connect-options mapping (no DOM), the one unit-tested seam of the menu.
 * Today it's a straight pass-through, but isolating it means the create-vs-join decision
 * and any future normalisation (default agent, mode fallbacks) live in ONE tested place
 * rather than being smeared through the DOM wiring. See menu.test.ts.
 */
export function connectOptionsFor(choice: MenuChoice): ConnectOptions {
  return { mode: choice.mode, agent: choice.agent, mapId: choice.mapId };
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
  /** The requested level ('' = Random); surfaced on MAIN, confirmed on LEVEL SELECT. */
  private mapId = '';
  /** The label on MAIN's "Level: <name> ▸" row, kept in sync with `mapId`. */
  private mapRowText: HTMLSpanElement | null = null;
  /** Resolver for the active `choose()` Promise; null when no choice is pending. */
  private resolveChoice: ((choice: MenuChoice) => void) | null = null;
  /** One-shot audio unlock (browsers need a gesture); cleared after it fires once. */
  private unlockAudio: (() => void) | null = null;
  /**
   * The persisted player settings (volumes / mute / invert-strafe), loaded from localStorage on
   * construct and re-saved on every Settings change. Seeds the Settings sliders/checkboxes; the
   * audio values are applied to the AudioEngine in the constructor so saved levels take effect
   * immediately (the slider's own apply re-applies once the graph exists post-resume).
   */
  private settings: PersistedSettings;

  /** The Storage handle settings persist to. null when localStorage is unavailable (e.g. SSR/blocked). */
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;

  constructor(
    private readonly audio: AudioEngine,
    private readonly controls: MenuControls = {},
    /** The levels the player can pick (or '' Random). Empty → the Level row is hidden. */
    private readonly maps: readonly MapOption[] = [],
    parent: HTMLElement = document.body,
  ) {
    // Resolve a Storage handle defensively — touching `localStorage` can THROW in some browsers
    // (disabled cookies / private mode), so guard it and fall back to no persistence.
    let storage: Pick<Storage, 'getItem' | 'setItem'> | null = null;
    try {
      storage = typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      storage = null;
    }
    this.storage = storage;
    this.settings = loadSettings(storage);
    // Apply the saved audio levels up front so restored values are honoured (no-op pre-resume; the
    // sliders re-apply on build). Invert-strafe is applied via the controls hook so main.ts's
    // session flag matches the restored checkbox.
    this.audio.setMusicVolume(this.settings.musicVolume);
    this.audio.setSfxVolume(this.settings.sfxVolume);
    this.audio.setMuted(this.settings.muted);
    this.controls.onInvertStrafe?.(this.settings.invertStrafe);
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

  /** Save the current settings to storage. Resilient to absent/blocked storage (no-op + false). */
  private persist(): void {
    saveSettings(this.storage, this.settings);
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

  /**
   * Commit a mode pick: hide the overlay and resolve the pending choose() Promise. `tutorial`
   * marks the run as the onboarding tutorial (solo on the tutorial level with the coach), which
   * main.ts honours; the net layer ignores it.
   */
  private commit(mode: MenuMode, tutorial = false): void {
    this.tick();
    const resolve = this.resolveChoice;
    this.resolveChoice = null;
    this.root.style.display = 'none';
    resolve?.({ mode, agent: this.agent, mapId: this.mapId, tutorial });
  }

  /** Swap the panel to a fresh screen, clearing whatever was there. */
  private setScreen(build: (panel: HTMLDivElement) => void): void {
    this.panel.replaceChildren();
    build(this.panel);
  }

  /** MAIN: the clean three-option splash — Play / Tutorial / Settings. */
  private showMain(): void {
    this.tick(); // light feedback on navigation (no-op until the first gesture unlocks audio).
    this.setScreen((panel) => {
      const play = makeButton('Play', 'primary');
      play.setAttribute('data-menu', 'play');
      const playHint = document.createElement('span');
      playHint.textContent = '  — vs bots, online, or 1v1';
      playHint.style.color = MUTED;
      play.append(playHint);
      play.addEventListener('click', () => this.showPlay());

      // Tutorial: a guided solo run on the tutorial level with the step coach. Commits a solo
      // choice flagged tutorial:true — main.ts loads the tutorial pack + shows the coach.
      const tutorial = makeButton('Tutorial');
      tutorial.setAttribute('data-menu', 'tutorial');
      const tutHint = document.createElement('span');
      tutHint.textContent = '  — learn the heist';
      tutHint.style.color = MUTED;
      tutorial.append(tutHint);
      tutorial.addEventListener('click', () => this.commit('solo', true));

      const settings = makeButton('Settings');
      settings.setAttribute('data-menu', 'settings');
      settings.addEventListener('click', () => this.showSettings());

      panel.append(play, tutorial, settings);
    });
  }

  /**
   * PLAY: the match-setup screen reached from the splash's Play button — Quick Play (vs bots),
   * Online Multiplayer, 1v1 Duel, plus the Agent and Level pickers. A Back returns to MAIN.
   */
  private showPlay(): void {
    this.tick();
    this.setScreen((panel) => {
      const heading = document.createElement('div');
      heading.textContent = 'PLAY';
      style(heading, {
        font: '800 16px/1.2 ui-monospace, monospace',
        letterSpacing: '0.08em',
        marginBottom: '14px',
        color: INK,
      });
      panel.append(heading);

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

      // 1v1 Duel: a human-vs-human round-based stealth hunt (first to 3 round wins). Uses the
      // same agent + level pickers; commit('duel') routes the net layer to the 'duel' room.
      const duel = makeButton('1v1 Duel');
      duel.setAttribute('data-menu', 'duel');
      const duelHint = document.createElement('span');
      duelHint.textContent = '  — vs human';
      duelHint.style.color = MUTED;
      duel.append(duelHint);
      duel.addEventListener('click', () => this.commit('duel'));

      // The agent-select entry: a row showing the current pick that opens AGENT SELECT.
      const agentRow = makeButton(`Agent: ${AGENTS_BY_ID[this.agent].name}  ▸`);
      agentRow.setAttribute('data-menu', 'agent-select');
      // Hold the text node so reselecting an agent can update the label in place.
      const agentRowText = document.createElement('span');
      agentRow.replaceChildren(agentRowText);
      this.agentRowText = agentRowText;
      this.syncAgentRow();
      agentRow.addEventListener('click', () => this.showAgents());

      // The level-select entry — shown only when the host supplied the available maps.
      let levelRow: HTMLButtonElement | null = null;
      if (this.maps.length > 0) {
        levelRow = makeButton(`Level: ${this.mapLabel()}  ▸`);
        levelRow.setAttribute('data-menu', 'level-select');
        const levelRowText = document.createElement('span');
        levelRow.replaceChildren(levelRowText);
        this.mapRowText = levelRowText;
        this.syncMapRow();
        levelRow.addEventListener('click', () => this.showLevels());
      }

      panel.append(quick, online, duel, agentRow);
      if (levelRow) panel.append(levelRow);

      const back = makeButton('◂ Back');
      back.setAttribute('data-menu', 'play-back');
      back.addEventListener('click', () => this.showMain());
      panel.append(back);
    });
  }

  /** Refresh MAIN's agent row to match the current selection (name only; arrow affords more). */
  private syncAgentRow(): void {
    if (this.agentRowText) {
      this.agentRowText.textContent = `Agent: ${AGENTS_BY_ID[this.agent].name}  ▸`;
    }
  }

  /** The display name of the currently-selected level ('Random' when none is pinned). */
  private mapLabel(): string {
    if (!this.mapId) return 'Random';
    return this.maps.find((m) => m.id === this.mapId)?.name ?? 'Random';
  }

  /** Refresh MAIN's level row to match the current selection. */
  private syncMapRow(): void {
    if (this.mapRowText) this.mapRowText.textContent = `Level: ${this.mapLabel()}  ▸`;
  }

  /**
   * LEVEL SELECT: a "Random" entry + one per available map. Picking one pins `mapId` (or '' for
   * Random) and returns to MAIN. Random lets the server (or offline mock) choose, so successive
   * matches vary; pinning a level forces it. The active choice reads with the cyan accent border.
   */
  private showLevels(): void {
    this.tick();
    this.setScreen((panel) => {
      const heading = document.createElement('div');
      heading.textContent = 'SELECT LEVEL';
      style(heading, {
        font: '800 16px/1.2 ui-monospace, monospace',
        letterSpacing: '0.08em',
        marginBottom: '14px',
        color: INK,
      });
      panel.append(heading);

      const pick = (id: string): void => {
        this.mapId = id;
        this.syncMapRow();
        this.showPlay();
      };
      panel.append(this.makeLevelCard('', 'Random', 'Surprise me — a different level each match.', pick));
      for (const m of this.maps) {
        panel.append(this.makeLevelCard(m.id, m.name, '', pick));
      }

      const back = makeButton('◂ Back');
      back.setAttribute('data-menu', 'levels-back');
      back.addEventListener('click', () => this.showPlay());
      panel.append(back);
    });
  }

  /** One level option (a clickable row). Selecting it pins `mapId` and returns to MAIN. */
  private makeLevelCard(id: string, name: string, hint: string, pick: (id: string) => void): HTMLButtonElement {
    const selected = id === this.mapId;
    const card = makeButton(`${name}${hint ? `  — ${hint}` : ''}`);
    card.setAttribute('data-level', id || 'random');
    if (selected) card.style.borderColor = ACCENT;
    card.addEventListener('click', () => pick(id));
    return card;
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
      back.addEventListener('click', () => this.showPlay());
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
      this.showPlay();
    });
    return card;
  }

  /**
   * SETTINGS: Music + SFX volume sliders and a Mute checkbox, wired LIVE to the AudioEngine
   * (a drag rides the music/sfx bus gains immediately; the checkbox rides the master). A Back
   * button returns to MAIN. Values are seeded from the PERSISTED settings on build and saved to
   * localStorage on every change (resilient to absent/blocked storage — see settingsStore.ts).
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

      // Music + SFX sliders — seeded from the saved values, driving the matching AudioEngine
      // setter on input AND persisting the new level.
      panel.append(
        this.makeSlider('Music volume', this.settings.musicVolume, (v) => {
          this.audio.setMusicVolume(v);
          this.settings.musicVolume = v;
          this.persist();
        }),
        this.makeSlider('SFX volume', this.settings.sfxVolume, (v) => {
          this.audio.setSfxVolume(v);
          this.settings.sfxVolume = v;
          this.persist();
        }),
      );

      // Mute checkbox — rides the master gain (same path as the in-game 'M' key). Seeded + saved.
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
      mute.checked = this.settings.muted;
      mute.setAttribute('data-menu', 'mute');
      style(mute, { width: '16px', height: '16px', accentColor: ACCENT, cursor: 'pointer' });
      mute.addEventListener('change', () => {
        this.audio.setMuted(mute.checked);
        this.settings.muted = mute.checked;
        this.persist();
      });
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
      invert.checked = this.settings.invertStrafe;
      invert.setAttribute('data-menu', 'invert-strafe');
      style(invert, { width: '16px', height: '16px', accentColor: ACCENT, cursor: 'pointer' });
      invert.addEventListener('change', () => {
        this.controls.onInvertStrafe?.(invert.checked);
        this.settings.invertStrafe = invert.checked;
        this.persist();
      });
      const invertLabel = document.createElement('span');
      invertLabel.textContent = 'Invert strafe (left/right)';
      invertRow.append(invert, invertLabel);
      panel.append(invertRow);

      // Controls reference (moved off the in-game HUD). A compact key → action list.
      panel.append(this.makeControls());

      const back = makeButton('◂ Back');
      back.setAttribute('data-menu', 'settings-back');
      back.addEventListener('click', () => this.showMain());
      panel.append(back);
    });
  }

  /** A read-only Controls reference shown in Settings (the old on-screen hint lives here now). */
  private makeControls(): HTMLDivElement {
    const wrap = document.createElement('div');
    style(wrap, { margin: '4px 0 18px' });

    const heading = document.createElement('div');
    heading.textContent = 'CONTROLS';
    style(heading, {
      font: '800 13px/1.2 ui-monospace, monospace',
      letterSpacing: '0.08em',
      margin: '0 0 8px',
      color: INK,
    });
    wrap.append(heading);

    const rows: [string, string][] = [
      ['Move', 'W A S D'],
      ['Run', 'Shift (hold)'],
      ['Jump', 'Space'],
      ['Look', 'Right-drag · or click to capture'],
      ['Fire', 'Left-click · or F'],
      ['Interact / collect', 'Q'],
      ['Steal disguise', 'E'],
      ['Revive teammate', 'R'],
      ['Expertise', 'G'],
      ['Gadget', 'H'],
      ['Depart (at exit)', 'E'],
      ['Mute audio', 'M'],
    ];
    for (const [action, keys] of rows) {
      const row = document.createElement('div');
      style(row, {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '3px 0',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      });
      const a = document.createElement('span');
      a.textContent = action;
      style(a, { color: MUTED, fontSize: '13px' });
      const k = document.createElement('span');
      k.textContent = keys;
      style(k, { color: INK, fontSize: '13px', fontWeight: '700', textAlign: 'right' });
      row.append(a, k);
      wrap.append(row);
    }

    const note = document.createElement('div');
    note.textContent = 'Mobile: left stick to move · right-drag to look · on-screen buttons act.';
    style(note, { color: MUTED, fontSize: '11px', lineHeight: '1.5', marginTop: '8px' });
    wrap.append(note);
    return wrap;
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
