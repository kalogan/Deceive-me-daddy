// The player's first-person HUD — a fullscreen DOM overlay (NOT Three) laid out to mirror the
// reference spy-FPS HUD: a top-left objective banner, a top-centre compass, a "WRONG COVER"
// alert, a bottom-left hex agent portrait + segmented health + ability/gadget pips, a
// bottom-centre intel counter, a right-side Expertise radial, a bottom-right gadget slot, and
// centred interaction prompts. Original layout/styling built from the same HudModel the old
// corner HUD consumed.
//
// Authority (PROJECT_BRIEF §3/§4.2): PRESENTS a HudModel derived from the server's snapshot
// (hudModel.ts) — it owns no gameplay truth. The compass heading is the LOCAL look bearing
// (camera yaw), fed via setHeading() since it isn't part of the server snapshot. Kept cheap:
// diffs the model and only touches the DOM on a changed field.
import type { HudModel } from './hudModel';
import { objectivePhase } from './hudModel';
import { cardinal } from '../render/firstPersonCamera';

/** Sentinel that never equals a real model, forcing the first update() to paint. */
const NEVER: HudModel = {
  present: false,
  agentName: ' ',
  ability: { name: ' ', active: false, ready: false, cooldownSec: -1, label: ' ' },
  gadget: { name: ' ', ready: false, cooldownSec: -1, label: ' ' },
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
  cast: { kind: ' ', progress: -1 },
  win: { show: false, text: ' ', localWon: false },
};

/** Readable label for an active channeled interaction (shown over the progress bar). */
const CAST_LABEL: Record<string, string> = {
  intel: 'GATHERING INTEL',
  disguise: 'STEALING DISGUISE',
  create_key: 'FORGING VAULT KEY',
  grab_key: 'GRABBING KEY',
  package: 'GRABBING PACKAGE',
  depart: 'DEPARTING',
};

const ACCENT = '#ffcf3f'; // signature gold
const ALERT = '#ff5a5a';
const HEALTH_COLOR = { ok: '#37e0e6', hurt: '#e0b341', critical: '#ff5a5a' } as const;
const SUSPICION_COLOR = { low: '#37e0e6', mid: '#e0b341', high: '#ff5a5a' } as const;
const ABILITY_COLOR = { ready: '#7fdca0', active: ACCENT, cooldown: '#7d8596' } as const;
const HEALTH_SEGMENTS = 5;

function fmtTier(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
function joinLoot(loot: string[] | null): string {
  return loot ? loot.join('|') : '';
}

/** A small element factory — assigns styles in one shot. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

const PANEL = 'rgba(8,10,18,0.62)';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

export class Hud {
  private readonly root: HTMLDivElement;

  // Top banner.
  private readonly phaseEl: HTMLDivElement;
  private readonly taskEl: HTMLDivElement;
  // Compass.
  private readonly compassDeg: HTMLDivElement;
  private readonly compassCard: HTMLDivElement;
  // Alert pill.
  private readonly alertPill: HTMLDivElement;
  // Portrait cluster.
  private readonly portraitHex: HTMLDivElement;
  private readonly agentInitial: HTMLDivElement;
  private readonly agentNameEl: HTMLDivElement;
  private readonly tierEl: HTMLDivElement;
  private readonly healthSegs: HTMLDivElement[] = [];
  private readonly healthNum: HTMLDivElement;
  private readonly suspFill: HTMLDivElement;
  private readonly abilityPip: HTMLDivElement;
  private readonly gadgetPip: HTMLDivElement;
  private readonly downedCallout: HTMLDivElement;
  // Centre-bottom intel counter.
  private readonly intelEl: HTMLSpanElement;
  private readonly vaultEl: HTMLDivElement;
  private readonly carryEl: HTMLDivElement;
  // Right Expertise radial.
  private readonly abilityRing: SVGCircleElement;
  private readonly abilityKey: HTMLDivElement;
  private readonly abilityNameEl: HTMLDivElement;
  private readonly abilityState: HTMLDivElement;
  // Bottom-right gadget slot.
  private readonly gadgetName: HTMLDivElement;
  private readonly gadgetState: HTMLDivElement;
  // Squire sense readout.
  private readonly sensePanel: HTMLDivElement;
  // Centre prompts.
  private readonly prompt: HTMLDivElement;
  private readonly revivePrompt: HTMLDivElement;
  private readonly interactPrompt: HTMLDivElement;
  private readonly social: HTMLDivElement;
  // Win.
  private readonly winBanner: HTMLDivElement;
  // Channeled-interaction progress.
  private readonly castBox: HTMLDivElement;
  private readonly castLabel: HTMLDivElement;
  private readonly castFill: HTMLDivElement;

  private last: HudModel = NEVER;
  private heading = -1;

  constructor(parent: HTMLElement = document.body) {
    const root = el('div', {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      userSelect: 'none',
      font: `13px/1.4 ${MONO}`,
      color: '#dfe6f2',
      zIndex: '5',
      display: 'none',
    });
    root.id = 'hud';

    // ---- Top-left objective banner ----
    const banner = el('div', { position: 'absolute', left: '18px', top: '16px', maxWidth: '40vw' });
    this.phaseEl = el('div', {
      color: ACCENT,
      font: `600 12px/1.2 ${MONO}`,
      letterSpacing: '0.18em',
    });
    this.taskEl = el('div', {
      marginTop: '4px',
      background: ACCENT,
      color: '#1a1205',
      font: `800 15px/1.2 ${MONO}`,
      letterSpacing: '0.06em',
      padding: '4px 10px',
      display: 'inline-block',
      borderRadius: '2px',
    });
    banner.append(this.phaseEl, this.taskEl);

    // ---- Top-centre compass ----
    const compass = el('div', {
      position: 'absolute',
      left: '50%',
      top: '14px',
      transform: 'translateX(-50%)',
      textAlign: 'center',
    });
    this.compassDeg = el('div', { font: `700 16px/1 ${MONO}`, letterSpacing: '0.1em' }, '—');
    const strip = el('div', {
      marginTop: '4px',
      width: '320px',
      height: '20px',
      borderTop: '1px solid rgba(255,255,255,0.25)',
      position: 'relative',
    });
    this.compassCard = el('div', {
      position: 'absolute',
      left: '50%',
      top: '2px',
      transform: 'translateX(-50%)',
      color: ACCENT,
      font: `800 13px/1 ${MONO}`,
    }, 'N');
    strip.append(this.compassCard);
    // A faint centre tick under the cardinal.
    strip.append(el('div', {
      position: 'absolute',
      left: '50%',
      top: '-1px',
      width: '2px',
      height: '8px',
      background: ACCENT,
      transform: 'translateX(-50%)',
    }));
    compass.append(this.compassDeg, strip);

    // ---- "WRONG COVER" alert under the compass ----
    this.alertPill = el('div', {
      position: 'absolute',
      left: '50%',
      top: '70px',
      transform: 'translateX(-50%)',
      background: 'rgba(40,6,6,0.7)',
      color: ALERT,
      border: `1px solid ${ALERT}`,
      font: `800 12px/1 ${MONO}`,
      letterSpacing: '0.12em',
      padding: '5px 12px',
      borderRadius: '3px',
      display: 'none',
    }, 'WRONG COVER');

    // ---- Bottom-left portrait cluster ----
    const cluster = el('div', {
      position: 'absolute',
      left: '18px',
      bottom: '18px',
      display: 'flex',
      alignItems: 'flex-end',
      gap: '12px',
    });
    // Hex portrait.
    this.portraitHex = el('div', {
      width: '64px',
      height: '72px',
      clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
      background: 'linear-gradient(160deg, #2b3145, #11141f)',
      border: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: `inset 0 0 0 2px ${ACCENT}`,
    });
    this.agentInitial = el('div', { font: `800 30px/1 ${MONO}`, color: '#eaf2ff' }, '?');
    this.portraitHex.append(this.agentInitial);

    const meters = el('div', { minWidth: '170px' });
    const nameRow = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
    this.agentNameEl = el('div', { font: `800 14px/1 ${MONO}`, letterSpacing: '0.04em' }, ' ');
    this.tierEl = el('div', {
      font: `600 10px/1 ${MONO}`,
      letterSpacing: '0.08em',
      color: '#aeb8c9',
      border: '1px solid rgba(255,255,255,0.25)',
      borderRadius: '2px',
      padding: '2px 5px',
    }, ' ');
    nameRow.append(this.agentNameEl, this.tierEl);

    // Health: number + segmented bar.
    const healthRow = el('div', { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '7px' });
    this.healthNum = el('div', { font: `800 22px/1 ${MONO}`, color: HEALTH_COLOR.ok, minWidth: '44px' }, '—');
    const segWrap = el('div', { display: 'flex', gap: '3px' });
    for (let i = 0; i < HEALTH_SEGMENTS; i++) {
      const seg = el('div', {
        width: '26px',
        height: '9px',
        background: HEALTH_COLOR.ok,
        borderRadius: '1px',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
      });
      this.healthSegs.push(seg);
      segWrap.append(seg);
    }
    healthRow.append(this.healthNum, segWrap);

    // Downed/eliminated callout replaces the bar.
    this.downedCallout = el('div', {
      marginTop: '7px',
      font: `800 14px/1.2 ${MONO}`,
      letterSpacing: '0.05em',
      color: ALERT,
      display: 'none',
    });

    // Suspicion sliver + ability/gadget pips.
    const suspTrack = el('div', {
      marginTop: '8px',
      width: '100%',
      height: '5px',
      borderRadius: '3px',
      background: 'rgba(255,255,255,0.12)',
      overflow: 'hidden',
    });
    this.suspFill = el('div', {
      height: '100%',
      width: '0%',
      background: SUSPICION_COLOR.low,
      transition: 'width 0.12s linear, background 0.2s linear',
    });
    suspTrack.append(this.suspFill);

    const pips = el('div', { display: 'flex', gap: '6px', marginTop: '7px' });
    this.abilityPip = this.mkPip();
    this.gadgetPip = this.mkPip();
    pips.append(this.abilityPip, this.gadgetPip);

    meters.append(nameRow, healthRow, this.downedCallout, suspTrack, pips);
    cluster.append(this.portraitHex, meters);

    // ---- Squire sense readout (above the cluster) ----
    this.sensePanel = el('div', {
      position: 'absolute',
      left: '18px',
      bottom: '150px',
      color: '#ffe08a',
      font: `12px/1.45 ${MONO}`,
      whiteSpace: 'pre',
      background: PANEL,
      padding: '6px 9px',
      borderRadius: '4px',
      display: 'none',
    });

    // ---- Bottom-centre intel counter ----
    const intelWrap = el('div', {
      position: 'absolute',
      left: '50%',
      bottom: '20px',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '4px',
    });
    const intelChip = el('div', {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      background: PANEL,
      borderRadius: '4px',
      padding: '4px 10px',
    });
    intelChip.append(el('div', { color: ACCENT, font: '13px/1 sans-serif' }, '📄'));
    this.intelEl = el('span', { font: `800 14px/1 ${MONO}` }, '—');
    intelChip.append(this.intelEl);
    this.vaultEl = el('div', { font: `700 10px/1 ${MONO}`, letterSpacing: '0.12em', color: ALERT }, 'VAULT LOCKED');
    this.carryEl = el('div', {
      font: `800 12px/1 ${MONO}`,
      letterSpacing: '0.06em',
      color: ACCENT,
      display: 'none',
    }, 'CARRYING PACKAGE');
    intelWrap.append(intelChip, this.vaultEl, this.carryEl);

    // ---- Right-side Expertise radial ----
    // Right-side stack, tucked UNDER the minimap (top-right): Expertise radial, gadget slot, the
    // objective waypoint (separate component) and the cast progress all live here, out of the way.
    const radial = el('div', {
      position: 'absolute',
      right: '20px',
      top: '156px',
      width: '116px',
      textAlign: 'center',
    });
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '58');
    svg.setAttribute('height', '58');
    svg.setAttribute('viewBox', '0 0 58 58');
    const bg = document.createElementNS(svgNS, 'circle');
    bg.setAttribute('cx', '29');
    bg.setAttribute('cy', '29');
    bg.setAttribute('r', '25');
    bg.setAttribute('fill', 'rgba(8,10,18,0.55)');
    bg.setAttribute('stroke', 'rgba(255,255,255,0.18)');
    bg.setAttribute('stroke-width', '3');
    const ring = document.createElementNS(svgNS, 'circle');
    ring.setAttribute('cx', '29');
    ring.setAttribute('cy', '29');
    ring.setAttribute('r', '25');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', ABILITY_COLOR.ready);
    ring.setAttribute('stroke-width', '3');
    ring.setAttribute('stroke-linecap', 'round');
    ring.setAttribute('transform', 'rotate(-90 29 29)');
    ring.setAttribute('stroke-dasharray', String(Math.PI * 2 * 25));
    this.abilityRing = ring;
    svg.append(bg, ring);
    this.abilityKey = el('div', { font: `800 18px/1 ${MONO}`, color: '#eaf2ff' }, 'G');
    const radialInner = el('div', { position: 'relative', width: '58px', height: '58px', margin: '0 auto' });
    radialInner.append(svg);
    const keyOverlay = el('div', {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });
    keyOverlay.append(this.abilityKey);
    radialInner.append(keyOverlay);
    this.abilityNameEl = el('div', { marginTop: '6px', font: `700 11px/1.2 ${MONO}`, maxWidth: '110px' }, ' ');
    this.abilityState = el('div', { marginTop: '2px', font: `700 11px/1 ${MONO}`, color: ABILITY_COLOR.ready }, ' ');
    radial.append(radialInner, this.abilityNameEl, this.abilityState);

    // ---- Gadget slot (right column, under the Expertise radial) ----
    const slot = el('div', {
      position: 'absolute',
      right: '20px',
      top: '270px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      background: PANEL,
      borderRadius: '5px',
      padding: '8px 10px',
    });
    const slotKey = el('div', {
      width: '22px',
      height: '22px',
      border: '1px solid rgba(255,255,255,0.35)',
      borderRadius: '3px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      font: `800 12px/1 ${MONO}`,
    }, 'H');
    const slotText = el('div', {});
    this.gadgetName = el('div', { font: `800 12px/1 ${MONO}` }, ' ');
    this.gadgetState = el('div', { marginTop: '3px', font: `700 10px/1 ${MONO}`, color: ABILITY_COLOR.ready }, ' ');
    slotText.append(this.gadgetName, this.gadgetState);
    slot.append(slotKey, slotText);

    // ---- Centre interaction prompts ----
    const promptStack = el('div', {
      position: 'absolute',
      left: '50%',
      top: '58%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
    });
    this.prompt = this.mkPrompt('#ffe08a');
    this.revivePrompt = this.mkPrompt('#7fe3ff');
    this.revivePrompt.textContent = '[R] Revive teammate';
    this.interactPrompt = this.mkPrompt('#ffd76a');
    this.social = this.mkPrompt('#7fdca0');
    promptStack.append(this.interactPrompt, this.prompt, this.revivePrompt, this.social);

    // ---- Channeled-interaction progress (right column, under the objective waypoint) ----
    const castBox = el('div', {
      position: 'absolute',
      right: '20px',
      top: '420px',
      width: '150px',
      textAlign: 'right',
      display: 'none',
    });
    this.castLabel = el('div', {
      font: `800 12px/1.2 ${MONO}`,
      letterSpacing: '0.12em',
      color: ACCENT,
      marginBottom: '6px',
    }, ' ');
    const castTrack = el('div', {
      width: '100%',
      height: '8px',
      borderRadius: '5px',
      background: 'rgba(8,10,18,0.7)',
      border: '1px solid rgba(255,255,255,0.25)',
      overflow: 'hidden',
    });
    this.castFill = el('div', {
      height: '100%',
      width: '0%',
      background: ACCENT,
      transition: 'width 0.08s linear',
    });
    castTrack.append(this.castFill);
    castBox.append(this.castLabel, castTrack);
    this.castBox = castBox;

    // ---- Centred win banner ----
    this.winBanner = el('div', {
      position: 'absolute',
      left: '50%',
      top: '40%',
      transform: 'translate(-50%, -50%)',
      font: `800 34px/1.2 ${MONO}`,
      textAlign: 'center',
      padding: '18px 28px',
      borderRadius: '10px',
      background: 'rgba(0,0,0,0.72)',
      border: '2px solid rgba(255,255,255,0.25)',
      letterSpacing: '0.04em',
      display: 'none',
    });

    root.append(
      banner,
      compass,
      this.alertPill,
      cluster,
      this.sensePanel,
      intelWrap,
      radial,
      slot,
      promptStack,
      this.castBox,
      this.winBanner,
    );
    parent.appendChild(root);
    this.root = root;
  }

  private mkPip(): HTMLDivElement {
    return el('div', {
      width: '0',
      height: '0',
      borderLeft: '7px solid transparent',
      borderRight: '7px solid transparent',
      borderBottom: `12px solid ${ABILITY_COLOR.cooldown}`,
      filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.6))',
    });
  }

  private mkPrompt(color: string): HTMLDivElement {
    return el('div', {
      color,
      font: `700 13px/1 ${MONO}`,
      background: PANEL,
      padding: '5px 11px',
      borderRadius: '4px',
      display: 'none',
    });
  }

  /**
   * Mount a live portrait canvas (PortraitView) into the hex frame, replacing the agent-initial
   * letter — so the corner shows the face of whoever the player currently looks like.
   */
  mountPortrait(canvas: HTMLCanvasElement): void {
    this.agentInitial.style.display = 'none';
    canvas.style.clipPath = this.portraitHex.style.clipPath; // keep the hex silhouette
    canvas.style.display = 'block';
    this.portraitHex.append(canvas);
  }

  /** Feed the LOCAL look bearing (camera yaw → degrees) so the compass reads where you face. */
  setHeading(deg: number): void {
    const d = Math.round(deg);
    if (d === this.heading) return;
    this.heading = d;
    this.compassDeg.textContent = String(d).padStart(3, '0');
    this.compassCard.textContent = cardinal(d);
  }

  /** Repaint from the latest model, touching the DOM only on changed fields. */
  update(model: HudModel): void {
    const prev = this.last;
    if (model.present !== prev.present) {
      this.root.style.display = model.present ? 'block' : 'none';
    }
    if (model.present) {
      const fresh = !prev.present;

      // Objective banner.
      const banner = objectivePhase(model.objective);
      if (fresh || banner.phase !== objectivePhase(prev.objective).phase) {
        this.phaseEl.textContent = `${banner.phase} PHASE`;
      }
      if (fresh || banner.task !== objectivePhase(prev.objective).task) {
        this.taskEl.textContent = banner.task;
      }

      // Agent identity + portrait.
      if (fresh || model.agentName !== prev.agentName) {
        this.agentNameEl.textContent = model.agentName;
        this.agentInitial.textContent = (model.agentName.trim()[0] ?? '?').toUpperCase();
      }
      if (fresh || model.tierColor !== prev.tierColor) {
        this.portraitHex.style.boxShadow = `inset 0 0 0 2px ${model.tierColor || ACCENT}`;
      }
      if (fresh || model.tierLabel !== prev.tierLabel) this.tierEl.textContent = model.tierLabel;

      // Health: number + segments, or the downed callout.
      const h = model.health;
      const ph = prev.health;
      if (fresh || h.pct !== ph.pct || h.level !== ph.level) {
        const pctNum = Math.round(h.pct * 100);
        this.healthNum.textContent = `${pctNum}`;
        this.healthNum.style.color = HEALTH_COLOR[h.level];
        const filled = Math.round(h.pct * HEALTH_SEGMENTS);
        for (let i = 0; i < HEALTH_SEGMENTS; i++) {
          const seg = this.healthSegs[i]!;
          if (i < filled) {
            seg.style.background = HEALTH_COLOR[h.level];
            seg.style.opacity = '1';
          } else {
            seg.style.background = 'rgba(255,255,255,0.14)';
            seg.style.opacity = '1';
          }
        }
      }
      if (fresh || h.status !== ph.status) {
        const downed = h.status !== '';
        this.healthNum.parentElement!.style.display = downed ? 'none' : 'flex';
        this.downedCallout.style.display = downed ? 'block' : 'none';
        if (downed) {
          this.downedCallout.textContent = h.status;
          this.downedCallout.style.color = h.status === 'ELIMINATED' ? '#9aa' : ALERT;
        }
      }

      // Suspicion sliver + "WRONG COVER" alert (scolded = wrong clearance for the zone).
      const s = model.suspicion;
      const psv = prev.suspicion;
      if (fresh || s.pct !== psv.pct) this.suspFill.style.width = `${Math.round(s.pct * 100)}%`;
      if (fresh || s.level !== psv.level) this.suspFill.style.background = SUSPICION_COLOR[s.level];
      if (fresh || model.scolded !== prev.scolded || s.level !== psv.level) {
        const alert = model.scolded || s.level === 'high';
        this.alertPill.style.display = alert ? 'block' : 'none';
        this.alertPill.textContent = model.scolded ? 'WRONG COVER' : 'SUSPICIOUS';
      }

      // Ability pip + Expertise radial.
      const ab = model.ability;
      const pab = prev.ability;
      if (fresh || ab.ready !== pab.ready || ab.active !== pab.active) {
        const col = ab.active ? ABILITY_COLOR.active : ab.ready ? ABILITY_COLOR.ready : ABILITY_COLOR.cooldown;
        this.abilityPip.style.borderBottomColor = col;
        this.abilityRing.setAttribute('stroke', col);
        // Ready/active → full ring; cooling → a dim quarter ring as a "charging" hint (exact
        // sweep needs the cooldown max on the wire — a follow-up).
        const circ = Math.PI * 2 * 25;
        this.abilityRing.setAttribute('stroke-dashoffset', ab.ready || ab.active ? '0' : String(circ * 0.75));
      }
      if (fresh || ab.name !== pab.name) this.abilityNameEl.textContent = ab.name;
      if (fresh || ab.label !== pab.label) {
        this.abilityState.textContent = ab.label;
        this.abilityState.style.color = ab.active
          ? ABILITY_COLOR.active
          : ab.ready
            ? ABILITY_COLOR.ready
            : ABILITY_COLOR.cooldown;
      }

      // Gadget pip + slot.
      const gd = model.gadget;
      const pgd = prev.gadget;
      if (fresh || gd.ready !== pgd.ready) {
        this.gadgetPip.style.borderBottomColor = gd.ready ? ABILITY_COLOR.ready : ABILITY_COLOR.cooldown;
      }
      if (fresh || gd.name !== pgd.name) this.gadgetName.textContent = gd.name;
      if (fresh || gd.label !== pgd.label) {
        this.gadgetState.textContent = gd.label;
        this.gadgetState.style.color = gd.ready ? ABILITY_COLOR.ready : ABILITY_COLOR.cooldown;
      }

      // Squire sense readout.
      const loot = model.sensedLoot;
      if (fresh || joinLoot(loot) !== joinLoot(prev.sensedLoot)) {
        if (loot && loot.length > 0) {
          this.sensePanel.textContent = `◎ Eyes on the Prize\n${loot.join('\n')}`;
          this.sensePanel.style.display = 'block';
        } else {
          this.sensePanel.style.display = 'none';
        }
      }

      // Intel counter + vault + carry.
      const o = model.objective;
      const po = prev.objective;
      if (fresh || o.intel !== po.intel || o.intelRequired !== po.intelRequired) {
        this.intelEl.textContent = o.intelRequired > 0 ? `${o.intel} / ${o.intelRequired}` : `${o.intel}`;
      }
      if (fresh || o.vaultOpen !== po.vaultOpen) {
        this.vaultEl.textContent = o.vaultOpen ? 'VAULT OPEN' : 'VAULT LOCKED';
        this.vaultEl.style.color = o.vaultOpen ? '#3fffd0' : ALERT;
      }
      if (fresh || o.carrying !== po.carrying) {
        this.carryEl.style.display = o.carrying ? 'block' : 'none';
      }

      // Centre prompts.
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
      if (fresh || model.interactLabel !== prev.interactLabel) {
        if (model.interactLabel) {
          this.interactPrompt.textContent = `[Q] ${model.interactLabel}`;
          this.interactPrompt.style.display = 'block';
        } else {
          this.interactPrompt.style.display = 'none';
        }
      }
      if (fresh || model.socialAction !== prev.socialAction) {
        if (model.socialAction) {
          this.social.textContent = `Blending in: ${model.socialAction}`;
          this.social.style.display = 'block';
        } else {
          this.social.style.display = 'none';
        }
      }

      // Channeled-interaction progress ring/bar — shown while the local player is mid-cast.
      const c = model.cast;
      const pc = prev.cast;
      if (fresh || c.kind !== pc.kind) {
        this.castBox.style.display = c.kind ? 'block' : 'none';
        if (c.kind) this.castLabel.textContent = CAST_LABEL[c.kind] ?? 'WORKING…';
      }
      if (fresh || c.progress !== pc.progress) {
        this.castFill.style.width = `${Math.round(c.progress * 100)}%`;
      }
    }

    // Win banner — independent of present.
    const w = model.win;
    const pw = prev.win;
    if (w.show !== pw.show || w.text !== pw.text || w.localWon !== pw.localWon) {
      this.winBanner.style.display = w.show ? 'block' : 'none';
      if (w.show) {
        this.winBanner.textContent = w.text;
        this.winBanner.style.color = w.localWon ? '#3fffd0' : ACCENT;
      }
    }

    this.last = model;
  }

  dispose(): void {
    this.root.remove();
  }
}
