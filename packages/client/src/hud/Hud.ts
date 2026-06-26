// The player's on-screen awareness overlay — a plain fixed DOM div (NOT Three), a sibling
// of index.html's #hint. It shows, for the LOCAL player: current disguise tier (label +
// TIER_COLOR swatch), a suspicion meter (bar + phase status), current zone name, a
// "scolded" RESTRICTED warning, and a "[E] Take disguise (<tier>)" prompt when an NPC is
// in reach.
//
// Authority (PROJECT_BRIEF §3/§4.2): this only PRESENTS a HudModel derived from the
// server's snapshot (see hudModel.ts). It owns no gameplay truth — the suspicion/phase it
// shows are the server's word, display-only. Kept cheap: it diffs the model and only
// touches the DOM when a field actually changes, so driving it every frame from getState()
// is fine.
import type { HudModel } from './hudModel';

/** Sentinel that never equals a real model, forcing the first update() to paint. */
const NEVER: HudModel = {
  present: false,
  agentName: ' ',
  ability: { name: ' ', active: false, ready: false, cooldownSec: -1, label: ' ' },
  sensedLoot: null,
  tier: 'civilian',
  tierLabel: ' ',
  tierColor: '',
  suspicion: { pct: -1, level: 'low', label: ' ' },
  health: { pct: -1, level: 'ok', status: '' },
  zoneName: ' ',
  scolded: false,
  socialAction: ' ',
  takeTargetId: ' ',
  takeTargetTier: null,
  reviveTargetId: ' ',
  objective: { intel: -1, intelRequired: -1, vaultOpen: false, carrying: false },
  interactLabel: ' ',
  win: { show: false, text: ' ', localWon: false },
};

/** Suspicion bar fill colour per severity band (mirrors hudModel SuspicionLevel). */
const SUSPICION_COLOR = {
  low: '#3fae62',
  mid: '#e0b341',
  high: '#ff5a5a',
} as const;

/** Health bar fill colour per severity band (green→amber→red as it drops). */
const HEALTH_COLOR = {
  ok: '#3fae62',
  hurt: '#e0b341',
  critical: '#ff5a5a',
} as const;

function fmtTier(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/** Stable string form of the sensed-loot list, for cheap change-detection (null → ''). */
function joinLoot(loot: string[] | null): string {
  return loot ? loot.join('|') : '';
}

/** Ability status colour: ready (green) / active (gold) / cooling-down (grey). */
const ABILITY_COLOR = {
  ready: '#7fdca0',
  active: '#ffcf3f',
  cooldown: '#9aa',
} as const;

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly agentText: HTMLSpanElement;
  private readonly abilityText: HTMLSpanElement;
  private readonly sensePanel: HTMLDivElement;
  private readonly swatch: HTMLSpanElement;
  private readonly tierText: HTMLSpanElement;
  private readonly suspFill: HTMLDivElement;
  private readonly suspText: HTMLSpanElement;
  private readonly healthRow: HTMLDivElement;
  private readonly healthFill: HTMLDivElement;
  private readonly healthText: HTMLSpanElement;
  private readonly downedCallout: HTMLDivElement;
  private readonly zoneText: HTMLSpanElement;
  private readonly warning: HTMLDivElement;
  private readonly social: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly revivePrompt: HTMLDivElement;
  private readonly intelText: HTMLSpanElement;
  private readonly vaultText: HTMLSpanElement;
  private readonly carryText: HTMLDivElement;
  private readonly interactPrompt: HTMLDivElement;
  private readonly winBanner: HTMLDivElement;
  private last: HudModel = NEVER;

  constructor(parent: HTMLElement = document.body) {
    const root = document.createElement('div');
    root.id = 'hud';
    Object.assign(root.style, {
      position: 'fixed',
      left: '12px',
      top: '12px',
      font: '13px/1.5 ui-monospace, monospace',
      color: '#dde',
      background: 'rgba(0, 0, 0, 0.5)',
      padding: '8px 11px',
      borderRadius: '6px',
      pointerEvents: 'none',
      userSelect: 'none',
      minWidth: '160px',
    } satisfies Partial<CSSStyleDeclaration>);

    // Row 0: agent identity + signature-Expertise status. The agent NAME reads bold; the
    // Expertise line below shows its name + READY/ACTIVE/cooldown so the player knows when
    // they can trigger it ([G]).
    const agentRow = document.createElement('div');
    agentRow.style.marginBottom = '6px';
    const agentLabel = document.createElement('span');
    agentLabel.textContent = 'Agent: ';
    agentLabel.style.color = '#9aa';
    const agentText = document.createElement('span');
    agentText.style.fontWeight = '800';
    agentText.style.letterSpacing = '0.02em';
    agentRow.append(agentLabel, agentText);

    const abilityRow = document.createElement('div');
    abilityRow.style.marginBottom = '2px';
    const abilityText = document.createElement('span');
    abilityText.style.fontWeight = '700';
    abilityRow.append(abilityText);

    // Squire's "Eyes on the Prize" readout — a small list of nearby loot, shown only while the
    // Expertise is active. Hidden otherwise.
    const sensePanel = document.createElement('div');
    Object.assign(sensePanel.style, {
      marginBottom: '6px',
      color: '#ffe08a',
      font: '12px/1.45 ui-monospace, monospace',
      whiteSpace: 'pre',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    // Row 1: disguise tier + colour swatch.
    const tierRow = document.createElement('div');
    const swatch = document.createElement('span');
    Object.assign(swatch.style, {
      display: 'inline-block',
      width: '11px',
      height: '11px',
      borderRadius: '2px',
      marginRight: '7px',
      verticalAlign: 'middle',
      border: '1px solid rgba(255,255,255,0.35)',
    } satisfies Partial<CSSStyleDeclaration>);
    const tierLabel = document.createElement('span');
    tierLabel.textContent = 'Disguise: ';
    tierLabel.style.color = '#9aa';
    const tierText = document.createElement('span');
    tierRow.append(swatch, tierLabel, tierText);

    // Row 2: suspicion meter — a label + status word over a horizontal fill bar. Lets the
    // player FEEL the tension rise as the server-owned suspicion climbs.
    const suspRow = document.createElement('div');
    suspRow.style.marginTop = '6px';
    const suspHead = document.createElement('div');
    const suspLabel = document.createElement('span');
    suspLabel.textContent = 'Suspicion: ';
    suspLabel.style.color = '#9aa';
    const suspText = document.createElement('span');
    suspText.style.fontWeight = '700';
    suspHead.append(suspLabel, suspText);

    const suspTrack = document.createElement('div');
    Object.assign(suspTrack.style, {
      marginTop: '3px',
      width: '100%',
      height: '7px',
      borderRadius: '4px',
      background: 'rgba(255,255,255,0.12)',
      overflow: 'hidden',
    } satisfies Partial<CSSStyleDeclaration>);
    const suspFill = document.createElement('div');
    Object.assign(suspFill.style, {
      height: '100%',
      width: '0%',
      borderRadius: '4px',
      background: SUSPICION_COLOR.low,
      transition: 'width 0.12s linear, background 0.2s linear',
    } satisfies Partial<CSSStyleDeclaration>);
    suspTrack.append(suspFill);
    suspRow.append(suspHead, suspTrack);

    // Row 2b: health meter — a label + value over a horizontal fill bar (green→amber→red as
    // it drops). Display-only: the server owns the authoritative health. Hidden while the
    // local player is downed/eliminated; the callout below takes over then.
    const healthRow = document.createElement('div');
    healthRow.style.marginTop = '6px';
    const healthHead = document.createElement('div');
    const healthLabel = document.createElement('span');
    healthLabel.textContent = 'Health: ';
    healthLabel.style.color = '#9aa';
    const healthText = document.createElement('span');
    healthText.style.fontWeight = '700';
    healthHead.append(healthLabel, healthText);

    const healthTrack = document.createElement('div');
    Object.assign(healthTrack.style, {
      marginTop: '3px',
      width: '100%',
      height: '7px',
      borderRadius: '4px',
      background: 'rgba(255,255,255,0.12)',
      overflow: 'hidden',
    } satisfies Partial<CSSStyleDeclaration>);
    const healthFill = document.createElement('div');
    Object.assign(healthFill.style, {
      height: '100%',
      width: '100%',
      borderRadius: '4px',
      background: HEALTH_COLOR.ok,
      transition: 'width 0.12s linear, background 0.2s linear',
    } satisfies Partial<CSSStyleDeclaration>);
    healthTrack.append(healthFill);
    healthRow.append(healthHead, healthTrack);

    // Row 2c: downed / eliminated callout — replaces the bar when the server marks the local
    // player 'downed' (revivable) or 'out' (eliminated). Hidden while alive.
    const downedCallout = document.createElement('div');
    Object.assign(downedCallout.style, {
      marginTop: '6px',
      fontWeight: '800',
      letterSpacing: '0.04em',
      color: '#ff5a5a',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    // Row 3: current zone.
    const zoneRow = document.createElement('div');
    zoneRow.style.marginTop = '6px';
    const zoneLabel = document.createElement('span');
    zoneLabel.textContent = 'Zone: ';
    zoneLabel.style.color = '#9aa';
    const zoneText = document.createElement('span');
    zoneRow.append(zoneLabel, zoneText);

    // Row 3b: objective progress — intel "N / required", vault status, and a CARRYING
    // callout. The heist loop made legible (PROJECT_BRIEF §2): intel feeds the vault, the
    // vault gates the package, the package extracts. Display-only — the server owns it all.
    const objRow = document.createElement('div');
    objRow.style.marginTop = '6px';
    const intelLabel = document.createElement('span');
    intelLabel.textContent = 'Intel: ';
    intelLabel.style.color = '#9aa';
    const intelText = document.createElement('span');
    intelText.style.fontWeight = '700';
    objRow.append(intelLabel, intelText);

    const vaultRow = document.createElement('div');
    vaultRow.style.marginTop = '2px';
    const vaultLabel = document.createElement('span');
    vaultLabel.textContent = 'Vault: ';
    vaultLabel.style.color = '#9aa';
    const vaultText = document.createElement('span');
    vaultText.style.fontWeight = '700';
    vaultRow.append(vaultLabel, vaultText);

    // Carrying callout — hidden unless the local player holds the package. A triumphant gold
    // so "I have the objective, get to extraction" reads at a glance.
    const carryText = document.createElement('div');
    carryText.textContent = 'CARRYING PACKAGE';
    Object.assign(carryText.style, {
      marginTop: '4px',
      color: '#ffcf3f',
      fontWeight: '800',
      letterSpacing: '0.04em',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    // Row 4: scolded warning (hidden unless restricted).
    const warning = document.createElement('div');
    warning.textContent = 'RESTRICTED — wrong clearance';
    Object.assign(warning.style, {
      marginTop: '6px',
      color: '#ff5a5a',
      fontWeight: '700',
      letterSpacing: '0.02em',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    // Row 4b: "Blending in" social cue — a calm green line shown when the local player is
    // acting natural at a matching-tier social spot, so they understand WHY their suspicion is
    // bleeding off (PROJECT_BRIEF §2b). Hidden unless a matching social action is in reach.
    // Display-only: the server owns the actual suspicion sink.
    const social = document.createElement('div');
    Object.assign(social.style, {
      marginTop: '6px',
      color: '#7fdca0',
      fontWeight: '700',
      letterSpacing: '0.02em',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    // Row 5: take-disguise prompt (hidden unless an NPC is in reach).
    const prompt = document.createElement('div');
    Object.assign(prompt.style, {
      marginTop: '6px',
      color: '#ffe08a',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    // Row 6: revive prompt (hidden unless a downed teammate is in revive reach). A distinct
    // friendly cyan so it reads as a teammate action, not the take-disguise prompt.
    const revivePrompt = document.createElement('div');
    revivePrompt.textContent = '[R] Revive teammate';
    Object.assign(revivePrompt.style, {
      marginTop: '6px',
      color: '#7fe3ff',
      fontWeight: '700',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    // Row 7: interact prompt — "[Q] <verb>" for the nearest objective interactable (collect
    // intel / grab package). Hidden unless something is in reach. A distinct objective-gold so
    // it reads as the heist action, separate from take-disguise (amber) and revive (cyan). Q is
    // free: E=take-disguise, F/click=fire, R=revive (PROJECT_BRIEF interact keymap).
    const interactPrompt = document.createElement('div');
    Object.assign(interactPrompt.style, {
      marginTop: '6px',
      color: '#ffd76a',
      fontWeight: '700',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    root.append(
      agentRow,
      abilityRow,
      sensePanel,
      tierRow,
      suspRow,
      healthRow,
      downedCallout,
      zoneRow,
      objRow,
      vaultRow,
      carryText,
      warning,
      social,
      prompt,
      revivePrompt,
      interactPrompt,
    );
    parent.appendChild(root);

    // The win overlay — a centered, fixed banner that takes over the screen when a team
    // extracts (PROJECT_BRIEF §2). A SEPARATE fixed div (not a child of the corner HUD) so it
    // reads as the match-ending moment. Hidden while the match is live. Display-only: the
    // server decides the winner (extraction is automatic server-side).
    const winBanner = document.createElement('div');
    Object.assign(winBanner.style, {
      position: 'fixed',
      left: '50%',
      top: '38%',
      transform: 'translate(-50%, -50%)',
      font: '800 34px/1.2 ui-monospace, monospace',
      textAlign: 'center',
      padding: '18px 28px',
      borderRadius: '10px',
      background: 'rgba(0, 0, 0, 0.72)',
      border: '2px solid rgba(255,255,255,0.25)',
      letterSpacing: '0.04em',
      pointerEvents: 'none',
      userSelect: 'none',
      display: 'none',
      zIndex: '10',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(winBanner);

    this.root = root;
    this.agentText = agentText;
    this.abilityText = abilityText;
    this.sensePanel = sensePanel;
    this.swatch = swatch;
    this.tierText = tierText;
    this.suspFill = suspFill;
    this.suspText = suspText;
    this.healthRow = healthRow;
    this.healthFill = healthFill;
    this.healthText = healthText;
    this.downedCallout = downedCallout;
    this.zoneText = zoneText;
    this.warning = warning;
    this.social = social;
    this.prompt = prompt;
    this.revivePrompt = revivePrompt;
    this.intelText = intelText;
    this.vaultText = vaultText;
    this.carryText = carryText;
    this.interactPrompt = interactPrompt;
    this.winBanner = winBanner;
  }

  /** Repaint from the latest model, touching the DOM only on changed fields. */
  update(model: HudModel): void {
    const prev = this.last;
    if (model.present !== prev.present) {
      this.root.style.display = model.present ? 'block' : 'none';
    }
    if (model.present) {
      // On the frame the player first appears, prev holds a stale not-present model whose
      // fields may already equal the new ones (so per-field diffs would skip the paint).
      // Force a full repaint of every field on that transition.
      const fresh = !prev.present;

      // Agent identity + Expertise status.
      if (fresh || model.agentName !== prev.agentName) this.agentText.textContent = model.agentName;
      const ab = model.ability;
      const pab = prev.ability;
      if (fresh || ab.label !== pab.label || ab.name !== pab.name) {
        this.abilityText.textContent = `${ab.name}: ${ab.label}`;
        this.abilityText.style.color = ab.active
          ? ABILITY_COLOR.active
          : ab.ready
            ? ABILITY_COLOR.ready
            : ABILITY_COLOR.cooldown;
      }
      // Squire's sensed-loot list (only while Eyes on the Prize is active).
      const loot = model.sensedLoot;
      const ploot = prev.sensedLoot;
      if (fresh || joinLoot(loot) !== joinLoot(ploot)) {
        if (loot && loot.length > 0) {
          this.sensePanel.textContent = `◎ Eyes on the Prize\n${loot.join('\n')}`;
          this.sensePanel.style.display = 'block';
        } else {
          this.sensePanel.style.display = 'none';
        }
      }

      if (fresh || model.tierLabel !== prev.tierLabel) this.tierText.textContent = model.tierLabel;
      if (fresh || model.tierColor !== prev.tierColor) this.swatch.style.background = model.tierColor;

      const s = model.suspicion;
      const ps = prev.suspicion;
      if (fresh || s.pct !== ps.pct) this.suspFill.style.width = `${Math.round(s.pct * 100)}%`;
      if (fresh || s.level !== ps.level) this.suspFill.style.background = SUSPICION_COLOR[s.level];
      if (fresh || s.label !== ps.label) this.suspText.textContent = s.label;

      // Health: show the bar while alive; swap to the DOWNED/ELIMINATED callout otherwise.
      const h = model.health;
      const ph = prev.health;
      if (fresh || h.pct !== ph.pct) this.healthFill.style.width = `${Math.round(h.pct * 100)}%`;
      if (fresh || h.level !== ph.level) this.healthFill.style.background = HEALTH_COLOR[h.level];
      if (fresh || h.pct !== ph.pct) this.healthText.textContent = `${Math.round(h.pct * 100)}%`;
      if (fresh || h.status !== ph.status) {
        const downed = h.status !== '';
        this.healthRow.style.display = downed ? 'none' : 'block';
        this.downedCallout.style.display = downed ? 'block' : 'none';
        if (downed) {
          this.downedCallout.textContent = h.status;
          // Eliminated is grey/final; downed is the urgent red "revive me" state.
          this.downedCallout.style.color = h.status === 'ELIMINATED' ? '#9aa' : '#ff5a5a';
        }
      }

      if (fresh || model.zoneName !== prev.zoneName) this.zoneText.textContent = model.zoneName;
      if (fresh || model.scolded !== prev.scolded) {
        this.warning.style.display = model.scolded ? 'block' : 'none';
      }
      if (fresh || model.socialAction !== prev.socialAction) {
        if (model.socialAction) {
          this.social.textContent = `Blending in: ${model.socialAction}`;
          this.social.style.display = 'block';
        } else {
          this.social.style.display = 'none';
        }
      }
      if (
        fresh ||
        model.takeTargetId !== prev.takeTargetId ||
        model.takeTargetTier !== prev.takeTargetTier
      ) {
        if (model.takeTargetTier) {
          this.prompt.textContent = `[E] Take disguise (${fmtTier(model.takeTargetTier)})`;
          this.prompt.style.display = 'block';
        } else {
          this.prompt.style.display = 'none';
        }
      }
      if (fresh || model.reviveTargetId !== prev.reviveTargetId) {
        this.revivePrompt.style.display = model.reviveTargetId ? 'block' : 'none';
      }

      // Objective row: intel "N / required" (or bare "N" when required is unknown), vault
      // LOCKED/OPEN, and the CARRYING callout.
      const o = model.objective;
      const po = prev.objective;
      if (fresh || o.intel !== po.intel || o.intelRequired !== po.intelRequired) {
        this.intelText.textContent =
          o.intelRequired > 0 ? `${o.intel} / ${o.intelRequired}` : `${o.intel}`;
      }
      if (fresh || o.vaultOpen !== po.vaultOpen) {
        this.vaultText.textContent = o.vaultOpen ? 'OPEN' : 'LOCKED';
        this.vaultText.style.color = o.vaultOpen ? '#3fffd0' : '#ff5a5a';
      }
      if (fresh || o.carrying !== po.carrying) {
        this.carryText.style.display = o.carrying ? 'block' : 'none';
      }

      // Interact prompt: "[Q] <verb>" for the nearest objective interactable, or hidden.
      if (fresh || model.interactLabel !== prev.interactLabel) {
        if (model.interactLabel) {
          this.interactPrompt.textContent = `[Q] ${model.interactLabel}`;
          this.interactPrompt.style.display = 'block';
        } else {
          this.interactPrompt.style.display = 'none';
        }
      }
    }

    // Win banner — independent of the corner HUD's present flag (it can win in any state).
    const w = model.win;
    const pw = prev.win;
    if (w.show !== pw.show || w.text !== pw.text || w.localWon !== pw.localWon) {
      this.winBanner.style.display = w.show ? 'block' : 'none';
      if (w.show) {
        this.winBanner.textContent = w.text;
        this.winBanner.style.color = w.localWon ? '#3fffd0' : '#ffcf3f';
      }
    }

    this.last = model;
  }

  dispose(): void {
    this.root.remove();
    this.winBanner.remove();
  }
}
