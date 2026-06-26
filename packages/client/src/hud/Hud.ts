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
  tier: 'civilian',
  tierLabel: ' ',
  tierColor: '',
  suspicion: { pct: -1, level: 'low', label: ' ' },
  zoneName: ' ',
  scolded: false,
  takeTargetId: ' ',
  takeTargetTier: null,
};

/** Suspicion bar fill colour per severity band (mirrors hudModel SuspicionLevel). */
const SUSPICION_COLOR = {
  low: '#3fae62',
  mid: '#e0b341',
  high: '#ff5a5a',
} as const;

function fmtTier(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly swatch: HTMLSpanElement;
  private readonly tierText: HTMLSpanElement;
  private readonly suspFill: HTMLDivElement;
  private readonly suspText: HTMLSpanElement;
  private readonly zoneText: HTMLSpanElement;
  private readonly warning: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
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

    // Row 3: current zone.
    const zoneRow = document.createElement('div');
    zoneRow.style.marginTop = '6px';
    const zoneLabel = document.createElement('span');
    zoneLabel.textContent = 'Zone: ';
    zoneLabel.style.color = '#9aa';
    const zoneText = document.createElement('span');
    zoneRow.append(zoneLabel, zoneText);

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

    // Row 5: take-disguise prompt (hidden unless an NPC is in reach).
    const prompt = document.createElement('div');
    Object.assign(prompt.style, {
      marginTop: '6px',
      color: '#ffe08a',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    root.append(tierRow, suspRow, zoneRow, warning, prompt);
    parent.appendChild(root);

    this.root = root;
    this.swatch = swatch;
    this.tierText = tierText;
    this.suspFill = suspFill;
    this.suspText = suspText;
    this.zoneText = zoneText;
    this.warning = warning;
    this.prompt = prompt;
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

      if (fresh || model.tierLabel !== prev.tierLabel) this.tierText.textContent = model.tierLabel;
      if (fresh || model.tierColor !== prev.tierColor) this.swatch.style.background = model.tierColor;

      const s = model.suspicion;
      const ps = prev.suspicion;
      if (fresh || s.pct !== ps.pct) this.suspFill.style.width = `${Math.round(s.pct * 100)}%`;
      if (fresh || s.level !== ps.level) this.suspFill.style.background = SUSPICION_COLOR[s.level];
      if (fresh || s.label !== ps.label) this.suspText.textContent = s.label;

      if (fresh || model.zoneName !== prev.zoneName) this.zoneText.textContent = model.zoneName;
      if (fresh || model.scolded !== prev.scolded) {
        this.warning.style.display = model.scolded ? 'block' : 'none';
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
    }
    this.last = model;
  }

  dispose(): void {
    this.root.remove();
  }
}
