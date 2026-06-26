// Top-center MATCH CLOCK + transient phase BANNERS (a plain fixed DOM overlay, NOT Three).
//
// The clock shows the authoritative elapsed match time (MM:SS via the pure formatMatchClock);
// the banners are full-width stingers ("VAULT OPEN", "PACKAGE STOLEN", "PACKAGE DROPPED") fired
// from the pure deriveMatchEvents diff in main.ts and shown for a couple of seconds each.
//
// Authority (PROJECT_BRIEF §3/§4.2): display-only. PHONE-FIRST: pinned TOP-CENTER, clear of the
// top-left awareness HUD and the top-right minimap; the banner sits just below the clock and is
// pointer-transparent so it never blocks the touch look-drag.
import type { BannerKind } from './matchEvents';
import { formatMatchClock } from './matchClock';

/** How long (ms) a banner stays fully visible before it fades out. */
const BANNER_HOLD_MS = 1800;
/** Fade-out duration (ms) — matches the CSS transition below. */
const BANNER_FADE_MS = 400;

/** Per-banner accent colour so each beat reads distinctly. */
const BANNER_COLOR: Record<BannerKind, string> = {
  'VAULT OPEN': '#3fffd0',
  'PACKAGE STOLEN': '#ffcf3f',
  'PACKAGE DROPPED': '#ff8a5a',
};

export class MatchTimer {
  private readonly clock: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private lastText = '';
  /** Wall-clock ms at which the current banner should start fading (0 = none showing). */
  private bannerHideAt = 0;
  private fadeTimer: number | null = null;

  constructor(parent: HTMLElement = document.body) {
    // The clock: a compact pill centered at the very top.
    const clock = document.createElement('div');
    clock.id = 'match-clock';
    Object.assign(clock.style, {
      position: 'fixed',
      left: '50%',
      top: '10px',
      transform: 'translateX(-50%)',
      font: '800 18px/1 ui-monospace, monospace',
      letterSpacing: '0.08em',
      color: '#dde',
      background: 'rgba(0, 0, 0, 0.5)',
      padding: '6px 12px',
      borderRadius: '6px',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '9',
    } satisfies Partial<CSSStyleDeclaration>);
    clock.textContent = '00:00';
    parent.appendChild(clock);

    // The banner: a wide stinger just below the clock, hidden until a transition fires.
    const banner = document.createElement('div');
    banner.id = 'match-banner';
    Object.assign(banner.style, {
      position: 'fixed',
      left: '50%',
      top: '48px',
      transform: 'translateX(-50%)',
      font: '800 22px/1.1 ui-monospace, monospace',
      letterSpacing: '0.14em',
      textAlign: 'center',
      color: '#fff',
      background: 'rgba(0, 0, 0, 0.66)',
      padding: '8px 22px',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.25)',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      userSelect: 'none',
      opacity: '0',
      transition: `opacity ${BANNER_FADE_MS}ms linear`,
      display: 'none',
      zIndex: '9',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(banner);

    this.clock = clock;
    this.banner = banner;
  }

  /** Repaint the clock from the authoritative match time. Touches the DOM only on a change. */
  update(timeMs: number): void {
    const text = formatMatchClock(timeMs);
    if (text !== this.lastText) {
      this.lastText = text;
      this.clock.textContent = text;
    }
    // Auto-hide an expired banner (driven off the frame loop's `now`, no extra timers needed).
    if (this.bannerHideAt !== 0 && performance.now() >= this.bannerHideAt) {
      this.bannerHideAt = 0;
      this.banner.style.opacity = '0';
      this.scheduleFadeOut();
    }
  }

  /**
   * Show a transient banner for the given kind. If several fire on one frame, the LAST one wins
   * (a single banner slot keeps it readable); the hold window restarts each time.
   */
  showBanner(kind: BannerKind): void {
    this.banner.textContent = kind;
    this.banner.style.color = BANNER_COLOR[kind];
    this.banner.style.display = 'block';
    // Force a reflow so re-showing the same banner re-triggers the fade-in transition.
    void this.banner.offsetWidth;
    this.banner.style.opacity = '1';
    this.bannerHideAt = performance.now() + BANNER_HOLD_MS;
    if (this.fadeTimer !== null) {
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
  }

  /** After the fade completes, fully hide the banner (so it can't catch pointer/layout). */
  private scheduleFadeOut(): void {
    if (this.fadeTimer !== null) window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => {
      this.banner.style.display = 'none';
      this.fadeTimer = null;
    }, BANNER_FADE_MS);
  }

  dispose(): void {
    if (this.fadeTimer !== null) window.clearTimeout(this.fadeTimer);
    this.clock.remove();
    this.banner.remove();
  }
}
