// The 1v1 DUEL overlay (a plain fixed DOM overlay, NOT Three). It owns the duel-specific UI the
// heist HUD knows nothing about: an opponent LOBBY ("waiting for opponent"), a top-center ROUND
// SCOREBOARD, a centered COUNTDOWN banner, per-round WON/LOST banners, and the match-end
// VICTORY/DEFEAT result with a play-again flow.
//
// Authority (PROJECT_BRIEF §3/§4.2): this owns NO gameplay truth. It only PRESENTS `state.duel`
// the server broadcasts (mapping p1/p2 → you/rival via the local player id). The DOM component is
// driven from main.ts each frame; the win/lose + countdown DECISIONS live in the PURE helpers
// below (duelScoreboard / duelBanner / countdownSeconds), which DuelHud.test.ts exercises with no
// DOM at all. A sibling-in-spirit of the Menu / ResultsScreen / Minimap: dark + translucent,
// clean monospace, inline styles, palette re-declared locally, no framework.
//
// Browser-only (it touches the DOM), so it must NEVER be imported by a Node gate test — only
// main.ts imports the CLASS. The PURE helpers are DOM-free and safe to import in tests.
import type { NetDuelState } from '@deceive/shared';

// --- PURE, DOM-free, TESTED helpers -------------------------------------------------------

/** The local player's + rival's round scores, resolved from p1/p2 by the local player id. */
export interface DuelScoreboard {
  yourScore: number;
  rivalScore: number;
}

/**
 * PURE: resolve "your" + "rival" round scores from the duel's fixed p1/p2 slots. If the local id
 * is p2, your score is p2Score (and rival is p1Score); otherwise (you're p1, or — degenerately —
 * not yet seated) your score is p1Score. Isolating this keeps the you/rival mapping in ONE tested
 * place rather than smeared through the DOM. See DuelHud.test.ts.
 */
export function duelScoreboard(duel: NetDuelState, localId: string): DuelScoreboard {
  if (localId && localId === duel.p2Id) {
    return { yourScore: duel.p2Score, rivalScore: duel.p1Score };
  }
  return { yourScore: duel.p1Score, rivalScore: duel.p2Score };
}

/**
 * PURE: whole seconds remaining until a timed phase ends, derived from the authoritative sim
 * clock. `phaseEndsAtMs` is sim time (matching NetMatchState.timeMs), so pass that same clock as
 * `now`. Rounds UP so a 2.4s remainder reads "3", and never goes below 0 (a passed deadline → 0,
 * which the countdown banner renders as "GO!"). A 0 deadline (no active timer) → 0.
 */
export function countdownSeconds(phaseEndsAtMs: number, now: number): number {
  if (phaseEndsAtMs <= 0) return 0;
  const remainingMs = phaseEndsAtMs - now;
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / 1000);
}

/** The kinds of full-bleed banner the duel can show (none = scoreboard only, no banner). */
export type DuelBannerKind =
  | 'none'
  | 'waiting'
  | 'countdown'
  | 'round_won'
  | 'round_lost'
  | 'victory'
  | 'defeat';

/** A resolved banner: which kind, its headline text, and a secondary sub-line. */
export interface DuelBanner {
  kind: DuelBannerKind;
  text: string;
  sub: string;
}

/**
 * PURE: choose the duel banner for the current phase, resolving you/rival outcomes against the
 * local id. Drives the centered overlay:
 *  - waiting     → the opponent lobby ("WAITING FOR OPPONENT…").
 *  - countdown   → "ROUND {n}" + a counting-down number (or "GO!" at/after the deadline).
 *  - round_over  → ROUND WON / ROUND LOST (by roundWinnerId), with the running score.
 *  - match_over  → VICTORY / DEFEAT (by matchWinnerId), with the final score.
 *  - live        → 'none' (only the top scoreboard shows; the hunt is on).
 * `now` is the authoritative sim clock (state.timeMs) for the countdown math.
 */
export function duelBanner(duel: NetDuelState, localId: string, now: number): DuelBanner {
  const { yourScore, rivalScore } = duelScoreboard(duel, localId);
  const score = `${yourScore} — ${rivalScore}`;
  switch (duel.phase) {
    case 'waiting':
      return { kind: 'waiting', text: 'WAITING FOR OPPONENT…', sub: 'Matchmaking a rival agent' };
    case 'countdown': {
      const secs = countdownSeconds(duel.phaseEndsAtMs, now);
      return {
        kind: 'countdown',
        text: secs > 0 ? String(secs) : 'GO!',
        sub: `ROUND ${duel.round}`,
      };
    }
    case 'round_over': {
      const won = !!localId && duel.roundWinnerId === localId;
      return {
        kind: won ? 'round_won' : 'round_lost',
        text: won ? 'ROUND WON' : 'ROUND LOST',
        sub: score,
      };
    }
    case 'match_over': {
      const won = !!localId && duel.matchWinnerId === localId;
      return {
        kind: won ? 'victory' : 'defeat',
        text: won ? 'VICTORY' : 'DEFEAT',
        sub: `Final score ${score}`,
      };
    }
    case 'live':
    default:
      return { kind: 'none', text: '', sub: '' };
  }
}

// --- Palette ------------------------------------------------------------------------------
// Echoes the Menu / ResultsScreen / Minimap accents so the duel overlay reads as a sibling of the
// rest of the UI. Re-declared locally (those modules don't export their constants, and the brief
// forbids editing them).
const INK = '#dde'; // primary text
const MUTED = '#9aa'; // labels / secondary text
const ACCENT = '#7fe3ff'; // cyan — "YOU"
const RIVAL = '#ff9a6a'; // warm orange — "RIVAL"
const GOLD = '#ffcf3f'; // countdown / call-to-action gold
const WIN = '#3fffd0'; // triumphant teal (round won / VICTORY)
const LOSS = '#ff6a6a'; // muted red (round lost / DEFEAT)
const PANEL_BG = 'rgba(10, 12, 18, 0.82)';
const CARD_BG = 'rgba(0, 0, 0, 0.5)';
const BORDER = 'rgba(255, 255, 255, 0.16)';

/** Apply a partial inline style set (typed, matching the HUD/Menu's `Object.assign(...style)`). */
function style(el: HTMLElement, s: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, s);
}

/** A house-style action button (mirrors ResultsScreen's makeButton; reload-to-menu actions). */
function makeButton(label: string, tone: 'primary' | 'normal'): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  const base = tone === 'primary' ? GOLD : INK;
  const idleBorder = tone === 'primary' ? 'rgba(255,207,63,0.55)' : BORDER;
  const hotBorder = tone === 'primary' ? 'rgba(255,207,63,0.9)' : 'rgba(255,255,255,0.4)';
  style(btn, {
    display: 'block',
    width: '100%',
    margin: '0 0 10px',
    padding: '13px 16px',
    font: '600 15px/1.2 ui-monospace, monospace',
    letterSpacing: '0.04em',
    color: base,
    background: CARD_BG,
    border: `1px solid ${idleBorder}`,
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'background 0.12s linear, border-color 0.12s linear, transform 0.06s linear',
  });
  btn.addEventListener('pointerenter', () => {
    btn.style.background = 'rgba(255, 255, 255, 0.08)';
    btn.style.borderColor = hotBorder;
  });
  btn.addEventListener('pointerleave', () => {
    btn.style.background = CARD_BG;
    btn.style.borderColor = idleBorder;
  });
  return btn;
}

/** The headline colour for a banner kind. */
function bannerColor(kind: DuelBannerKind): string {
  switch (kind) {
    case 'round_won':
    case 'victory':
      return WIN;
    case 'round_lost':
    case 'defeat':
      return LOSS;
    case 'countdown':
      return GOLD;
    default:
      return INK;
  }
}

/**
 * The duel overlay. Construct it once, then call `update(duel, localId, now)` every frame: it
 * lazily builds its DOM on first use and reconciles the scoreboard + banner + match-result panel
 * to the latest `state.duel`. `update(undefined, …)` (a non-duel snapshot) hides everything.
 * `dispose()` removes it from the DOM (main.ts's hot-reload teardown).
 *
 * Layout is PHONE-FIRST and non-overlapping with the touch controls + awareness HUD: the
 * scoreboard pins TOP-CENTER (clear of the top-left awareness HUD + the top-right minimap, sitting
 * a little lower than the match timer), banners CENTER, and the match-result is a full-bleed
 * overlay. z-index sits above the canvas + HUD but BELOW the menu (z 50) / results (z 60).
 */
export class DuelHud {
  private readonly parent: HTMLElement;
  /** Built lazily on first update() so a never-duel session never touches the DOM. */
  private root: HTMLDivElement | null = null;
  private scoreboard: HTMLDivElement | null = null;
  private youScoreEl: HTMLSpanElement | null = null;
  private rivalScoreEl: HTMLSpanElement | null = null;
  private roundLineEl: HTMLDivElement | null = null;
  private banner: HTMLDivElement | null = null;
  private bannerText: HTMLDivElement | null = null;
  private bannerSub: HTMLDivElement | null = null;
  /** The full-bleed match-over result; built once on match_over, then left up. */
  private result: HTMLDivElement | null = null;
  private resultShown = false;

  constructor(parent: HTMLElement = document.body) {
    this.parent = parent;
  }

  /** Build the persistent scoreboard + banner DOM (idempotent — only the first call builds). */
  private build(): void {
    if (this.root) return;
    const root = document.createElement('div');
    root.id = 'duel-hud';
    style(root, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      color: INK,
      font: '14px/1.5 ui-monospace, monospace',
      userSelect: 'none',
      // Above the canvas + awareness HUD (z 10), below the menu (50) / results (60).
      zIndex: '20',
    });

    // TOP-CENTER scoreboard: YOU {n} — {n} RIVAL + a "ROUND x · first to y" line. Sits a touch
    // lower than the top-center match timer so the two never collide.
    const scoreboard = document.createElement('div');
    style(scoreboard, {
      position: 'absolute',
      top: '54px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '8px 16px',
      background: PANEL_BG,
      border: `1px solid ${BORDER}`,
      borderRadius: '10px',
      boxShadow: '0 6px 22px rgba(0,0,0,0.45)',
      textAlign: 'center',
      whiteSpace: 'nowrap',
    });

    const tally = document.createElement('div');
    style(tally, {
      font: '800 17px/1.1 ui-monospace, monospace',
      letterSpacing: '0.06em',
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'center',
      gap: '8px',
    });
    const youLabel = document.createElement('span');
    youLabel.textContent = 'YOU';
    style(youLabel, { color: ACCENT, fontSize: '12px', letterSpacing: '0.1em' });
    const youScore = document.createElement('span');
    youScore.textContent = '0';
    style(youScore, { color: INK });
    const dash = document.createElement('span');
    dash.textContent = '—';
    style(dash, { color: MUTED });
    const rivalScore = document.createElement('span');
    rivalScore.textContent = '0';
    style(rivalScore, { color: INK });
    const rivalLabel = document.createElement('span');
    rivalLabel.textContent = 'RIVAL';
    style(rivalLabel, { color: RIVAL, fontSize: '12px', letterSpacing: '0.1em' });
    tally.append(youLabel, youScore, dash, rivalScore, rivalLabel);

    const roundLine = document.createElement('div');
    style(roundLine, { color: MUTED, fontSize: '11px', letterSpacing: '0.08em', marginTop: '2px' });

    scoreboard.append(tally, roundLine);

    // CENTER banner: countdown number / ROUND WON-LOST / waiting lobby card.
    const banner = document.createElement('div');
    style(banner, {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      textAlign: 'center',
      padding: '18px 30px',
      background: 'rgba(8, 10, 16, 0.66)',
      border: `1px solid ${BORDER}`,
      borderRadius: '14px',
      boxShadow: '0 14px 50px rgba(0,0,0,0.55)',
    });
    const bannerText = document.createElement('div');
    style(bannerText, {
      font: '900 56px/1 ui-monospace, monospace',
      letterSpacing: '0.1em',
    });
    const bannerSub = document.createElement('div');
    style(bannerSub, {
      color: MUTED,
      letterSpacing: '0.08em',
      marginTop: '8px',
      fontSize: '15px',
    });
    banner.append(bannerText, bannerSub);

    root.append(scoreboard, banner);
    this.parent.appendChild(root);

    this.root = root;
    this.scoreboard = scoreboard;
    this.youScoreEl = youScore;
    this.rivalScoreEl = rivalScore;
    this.roundLineEl = roundLine;
    this.banner = banner;
    this.bannerText = bannerText;
    this.bannerSub = bannerSub;
  }

  /**
   * Reconcile the overlay to the latest duel state. `now` is the authoritative sim clock
   * (state.timeMs) for the countdown; defaults to performance.now() if omitted (e.g. a harness).
   * Passing `undefined` for `duel` (a non-duel snapshot) hides the whole overlay.
   */
  update(duel: NetDuelState | undefined, localPlayerId: string, now?: number): void {
    if (!duel) {
      if (this.root) this.root.style.display = 'none';
      return;
    }
    this.build();
    if (this.root) this.root.style.display = '';
    const clock = now ?? (typeof performance !== 'undefined' ? performance.now() : 0);

    // Scoreboard — hidden in the lobby (no rival yet) + during the full-bleed match result.
    const { yourScore, rivalScore } = duelScoreboard(duel, localPlayerId);
    if (this.youScoreEl) this.youScoreEl.textContent = String(yourScore);
    if (this.rivalScoreEl) this.rivalScoreEl.textContent = String(rivalScore);
    if (this.roundLineEl) {
      this.roundLineEl.textContent = `ROUND ${duel.round} · first to ${duel.roundsToWin}`;
    }
    const showScoreboard = duel.phase !== 'waiting' && duel.phase !== 'match_over';
    if (this.scoreboard) this.scoreboard.style.display = showScoreboard ? '' : 'none';

    const b = duelBanner(duel, localPlayerId, clock);

    // The match-over result is its own full-bleed overlay (built once, with a play-again flow).
    if (duel.phase === 'match_over') {
      if (this.banner) this.banner.style.display = 'none';
      if (!this.resultShown) {
        this.resultShown = true;
        this.showResult(b);
      }
      return;
    }

    // Center banner: shown for waiting / countdown / round_over; hidden during live (scoreboard only).
    if (this.banner && this.bannerText && this.bannerSub) {
      if (b.kind === 'none') {
        this.banner.style.display = 'none';
      } else {
        this.banner.style.display = '';
        this.bannerText.textContent = b.text;
        this.bannerText.style.color = bannerColor(b.kind);
        this.bannerSub.textContent = b.sub;
        // The waiting lobby gets a subtle pulse so it reads as "alive / searching".
        this.bannerText.style.animation =
          b.kind === 'waiting' ? 'duelPulse 1.2s ease-in-out infinite' : '';
        this.ensurePulseKeyframes();
        // Smaller wordmark for the long lobby line so it doesn't overflow a phone.
        this.bannerText.style.fontSize = b.kind === 'waiting' ? '26px' : '56px';
      }
    }
  }

  /** Inject the lobby pulse @keyframes once (inline-style can't express keyframes). */
  private pulseAdded = false;
  private ensurePulseKeyframes(): void {
    if (this.pulseAdded || typeof document === 'undefined') return;
    this.pulseAdded = true;
    const styleEl = document.createElement('style');
    styleEl.textContent =
      '@keyframes duelPulse{0%,100%{opacity:0.55}50%{opacity:1}}';
    document.head.appendChild(styleEl);
  }

  /** Build the full-bleed VICTORY/DEFEAT result with a Play Again / Main Menu flow (reload). */
  private showResult(b: DuelBanner): void {
    const won = b.kind === 'victory';
    const result = document.createElement('div');
    result.id = 'duel-result';
    style(result, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'auto',
      background:
        'radial-gradient(120% 90% at 50% 30%, rgba(36,42,60,0.55), rgba(8,9,14,0.97) 72%), rgba(8,9,14,0.9)',
      color: INK,
      font: '14px/1.5 ui-monospace, monospace',
      userSelect: 'none',
      // Above the duel HUD, on par with the heist results — it owns the screen at match end.
      zIndex: '60',
    });

    const title = document.createElement('div');
    title.textContent = b.text;
    style(title, {
      font: '900 64px/1 ui-monospace, monospace',
      letterSpacing: '0.16em',
      color: won ? WIN : LOSS,
      textShadow: won
        ? '0 0 28px rgba(63,255,208,0.35)'
        : '0 0 24px rgba(255,106,106,0.3)',
      marginBottom: '10px',
    });

    const subtitle = document.createElement('div');
    subtitle.textContent = b.sub;
    style(subtitle, {
      color: MUTED,
      letterSpacing: '0.06em',
      marginBottom: '28px',
      textAlign: 'center',
    });

    const panel = document.createElement('div');
    style(panel, {
      width: 'min(360px, 90vw)',
      padding: '20px',
      background: PANEL_BG,
      border: `1px solid ${BORDER}`,
      borderRadius: '12px',
      boxShadow: '0 18px 60px rgba(0,0,0,0.6)',
    });

    const playAgain = makeButton('Play Again', 'primary');
    playAgain.setAttribute('data-duel-result', 'play-again');
    playAgain.addEventListener('click', () => location.reload());

    const mainMenu = makeButton('Main Menu', 'normal');
    mainMenu.setAttribute('data-duel-result', 'main-menu');
    mainMenu.style.margin = '0';
    mainMenu.addEventListener('click', () => location.reload());

    panel.append(playAgain, mainMenu);
    result.append(title, subtitle, panel);
    this.parent.appendChild(result);
    this.result = result;
  }

  /** Remove the overlay (+ any result) from the DOM (hot-reload teardown). */
  dispose(): void {
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
    if (this.result) {
      this.result.remove();
      this.result = null;
    }
  }
}
