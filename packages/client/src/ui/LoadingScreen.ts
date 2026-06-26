// The match LOADING screen — a full-screen DOM overlay shown while a match is connecting /
// spinning up (the gap between the player committing in the Menu and the first authoritative
// snapshot arriving). A sibling-in-spirit of the Menu (menu/Menu.ts) and the ResultsScreen:
// a plain fixed overlay, dark radial vignette + translucent card, clean monospace, inline
// styles, no framework. Phone-first, so the title + status read large and centered.
//
// Authority: this owns NO gameplay truth. It only PRESENTS connection progress — main.ts
// drives it (show / setStatus / setProgress / hide) around its own connect flow. The screen
// itself just renders text, an animated indeterminate bar, and a rotating spy "tip".
//
// Browser-only (it touches the DOM), so it must NEVER be imported by a Node gate test — only
// main.ts imports the CLASS. The pieces of LOGIC worth testing are the PURE, DOM-free helpers
// `LOADING_TIPS` + `tipAt` below, which loadingScreen.test.ts exercises with no DOM at all.

/**
 * The rotating gameplay "tips" the loading screen cycles through while a match spins up. Pure
 * data (no DOM), so the wrap logic in `tipAt` can be unit-tested in isolation. Short, phone-
 * readable flavour lines that double as onboarding nudges.
 */
export const LOADING_TIPS: readonly string[] = [
  'Tip: Blend in — don’t run near guards.',
  'Tip: Disguises fool cameras, not a guard who watched you swap.',
  'Tip: Walk your cover’s patrol; sprinting blows it.',
  'Tip: The package is loud — grab it last, extract fast.',
  'Tip: A locked door is a clue someone valuable went through it.',
  'Tip: Watch the minimap; a clustered crowd hides a rival agent.',
  'Tip: Spend your Expertise — a saved gadget wins nothing.',
  'Tip: Tailing a target beats ambushing one.',
] as const;

/**
 * PURE tip lookup (no DOM, no Date, no Math.random), the unit-tested seam of the loading
 * screen. Returns `LOADING_TIPS` at `index` with proper modulo wrapping for ANY integer —
 * positive, zero, or negative — so a monotonically-incrementing counter can drive the rotation
 * without ever stepping out of range. See loadingScreen.test.ts.
 */
export function tipAt(index: number): string {
  const n = LOADING_TIPS.length;
  // Double-modulo so negative indices wrap forward instead of producing a negative remainder.
  const tip = LOADING_TIPS[((index % n) + n) % n];
  // n is a compile-time non-empty constant, so this is always defined; the fallback satisfies
  // strict noUncheckedIndexedAccess without introducing a real runtime path.
  return tip ?? LOADING_TIPS[0] ?? '';
}

// --- Palette ------------------------------------------------------------------------------
// Echoes the Menu's tight dark-spy palette (menu/Menu.ts) so the loading screen reads as a
// sibling of the front-of-game overlay. We re-declare the few values we need rather than import
// from Menu (its constants aren't exported, and the brief forbids editing it).
const INK = '#dde'; // primary text
const MUTED = '#9aa'; // labels / secondary text
const ACCENT = '#7fe3ff'; // cyan highlight (spinner / progress sweep)
const PANEL_BG = 'rgba(10, 12, 18, 0.82)';
const BORDER = 'rgba(255, 255, 255, 0.16)';

/** Apply a partial inline style set (typed, matching the HUD/Menu's `Object.assign(...style)`). */
function style(el: HTMLElement, s: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, s);
}

/** How often the spy tip rotates, in milliseconds. */
const TIP_ROTATE_MS = 4000;
/** Fade duration for the show/hide transition, in milliseconds (kept in sync with the CSS). */
const FADE_MS = 220;

/**
 * The match-connecting LOADING overlay. Construct it once, then drive it around a connect flow:
 *   const loading = new LoadingScreen();
 *   loading.show();
 *   loading.setStatus('Connecting…');     // …'Joining match…' …'Spawning agents…'
 *   loading.setProgress(0.4);             // optional determinate bar; omit for indeterminate
 *   loading.hide();                       // when the first snapshot arrives
 *
 * The overlay builds its DOM lazily on first `show()` and reuses it thereafter; `dispose()`
 * tears everything down (element + timers) for hot-reload teardown with no leaks.
 */
export class LoadingScreen {
  /** Where the overlay mounts — defaults to <body>, overridable for headless/testing. */
  private readonly parent: HTMLElement;
  /** The fixed full-screen overlay root; null until first `show()` builds it (and after dispose). */
  private root: HTMLDivElement | null = null;
  /** The status line element ("Connecting…", …); held so `setStatus` can update it in place. */
  private statusEl: HTMLDivElement | null = null;
  /** The rotating-tip element; held so the interval can swap its text. */
  private tipEl: HTMLDivElement | null = null;
  /** The indeterminate sweep bar (animated) — hidden once a determinate progress is set. */
  private sweepEl: HTMLDivElement | null = null;
  /** The determinate fill bar — width tracks `setProgress`; hidden until first progress arrives. */
  private fillEl: HTMLDivElement | null = null;
  /** Monotonic counter driving the tip rotation (NOT Date/random — deterministic via `tipAt`). */
  private tipIndex = 0;
  /** The tip-rotation interval handle; 0 when not running. */
  private tipTimer = 0;
  /** A pending hide-removal timeout handle (the post-fade DOM detach); 0 when none. */
  private hideTimer = 0;
  /** Whether the <style> keyframes block has been injected (once per instance). */
  private keyframesEl: HTMLStyleElement | null = null;

  constructor(parent: HTMLElement = document.body) {
    this.parent = parent;
  }

  /**
   * Show the loading overlay. Idempotent: the first call builds the DOM + starts the tip
   * rotation; later calls just re-reveal an already-built overlay (cancelling any in-flight
   * fade-out from a previous `hide`).
   */
  show(): void {
    if (!this.root) this.build();
    const root = this.root;
    if (!root) return;
    // Cancel a pending post-fade removal so a quick hide→show doesn't blank the overlay.
    if (this.hideTimer) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = 0;
    }
    root.style.display = 'flex';
    // Force a reflow so the opacity transition runs from 0 even on a freshly-shown root.
    void root.offsetWidth;
    root.style.opacity = '1';
    if (!this.tipTimer) this.startTipRotation();
  }

  /**
   * Update the status line (e.g. "Connecting…", "Joining match…", "Spawning agents…"). Safe to
   * call before `show()` (the text is applied once the DOM is built on the next show, since the
   * element only exists after build) — when already built it updates in place.
   */
  setStatus(text: string): void {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  /**
   * OPTIONAL determinate progress, 0..1, driving the fill-bar width (clamped to [0,1]). The
   * default presentation is an indeterminate animated sweep; the first `setProgress` call swaps
   * to the determinate fill bar. No-op-safe before `show()` / after `dispose()`.
   */
  setProgress(fraction: number): void {
    const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
    if (this.sweepEl) this.sweepEl.style.display = 'none';
    if (this.fillEl) {
      this.fillEl.style.display = 'block';
      this.fillEl.style.width = `${clamped * 100}%`;
    }
  }

  /**
   * Fade out + hide the overlay. Idempotent and safe to call when already hidden: it stops the
   * tip rotation, runs the opacity fade, then detaches the root from layout (display:none) after
   * the fade so it stops intercepting input. The DOM is kept for a cheap re-`show()`.
   */
  hide(): void {
    this.stopTipRotation();
    const root = this.root;
    if (!root) return;
    if (this.hideTimer) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = 0;
    }
    root.style.opacity = '0';
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = 0;
      if (this.root) this.root.style.display = 'none';
    }, FADE_MS);
  }

  /**
   * Remove the overlay element and clear every timer (hot-reload teardown / final cleanup). No
   * leaks: the tip interval and any pending hide timeout are cancelled, and the root + injected
   * keyframes are detached from the DOM. Idempotent.
   */
  dispose(): void {
    this.stopTipRotation();
    if (this.hideTimer) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = 0;
    }
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
    if (this.keyframesEl) {
      this.keyframesEl.remove();
      this.keyframesEl = null;
    }
    this.statusEl = null;
    this.tipEl = null;
    this.sweepEl = null;
    this.fillEl = null;
  }

  /** Build the overlay DOM once (root, title, spinner, status, progress bar, tip line). */
  private build(): void {
    // Inject keyframes for the spinner + indeterminate sweep — pure CSS, no external assets.
    const keyframes = document.createElement('style');
    keyframes.textContent = `
@keyframes deceive-spin { to { transform: rotate(360deg); } }
@keyframes deceive-sweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}`;
    this.parent.appendChild(keyframes);
    this.keyframesEl = keyframes;

    const root = document.createElement('div');
    root.id = 'loading';
    style(root, {
      position: 'fixed',
      inset: '0',
      display: 'none', // revealed by show()
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      // The same dark vignette as the Menu so the loading moment reads as the same front-of-game
      // surface and the greybox scene behind never bleeds through.
      background:
        'radial-gradient(120% 90% at 50% 22%, rgba(36,42,60,0.55), rgba(8,9,14,0.97) 72%), #0c0d12',
      color: INK,
      font: '14px/1.5 ui-monospace, monospace',
      userSelect: 'none',
      opacity: '0',
      transition: `opacity ${FADE_MS}ms linear`,
      // Above the menu (50) and HUD (10) — it owns the screen during the connect handshake.
      zIndex: '55',
    });

    // Title: the "DECEIVE" wordmark feel, with a field-entry sub-line beneath it.
    const title = document.createElement('div');
    title.textContent = 'ENTERING THE FIELD';
    style(title, {
      font: '900 clamp(28px, 8vw, 52px)/1.05 ui-monospace, monospace',
      letterSpacing: '0.16em',
      color: INK,
      textShadow: '0 0 24px rgba(127,227,255,0.25)',
      textAlign: 'center',
      marginBottom: '6px',
      padding: '0 16px',
    });
    const wordmark = document.createElement('div');
    wordmark.textContent = 'DECEIVE';
    style(wordmark, {
      font: '700 13px/1.2 ui-monospace, monospace',
      letterSpacing: '0.42em',
      color: MUTED,
      marginBottom: '28px',
      // Trim the trailing letter-spacing so the wordmark stays optically centered.
      textIndent: '0.42em',
    });

    // The translucent card holding the spinner, status, progress bar, and rotating tip.
    const card = document.createElement('div');
    style(card, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: 'min(420px, 90vw)',
      padding: '24px 20px',
      background: PANEL_BG,
      border: `1px solid ${BORDER}`,
      borderRadius: '12px',
      boxShadow: '0 18px 60px rgba(0,0,0,0.6)',
      textAlign: 'center',
    });

    // CSS spinner: a ring with one bright arc, rotating. Pure border trick, no image.
    const spinner = document.createElement('div');
    style(spinner, {
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      border: '3px solid rgba(127,227,255,0.18)',
      borderTopColor: ACCENT,
      animation: 'deceive-spin 0.9s linear infinite',
      marginBottom: '18px',
    });

    // Status line — large + centered for phones, updated via setStatus().
    const status = document.createElement('div');
    status.textContent = 'Connecting…';
    style(status, {
      font: '700 clamp(16px, 4.5vw, 20px)/1.3 ui-monospace, monospace',
      letterSpacing: '0.04em',
      color: INK,
      marginBottom: '16px',
    });

    // Progress track holding BOTH an indeterminate sweep (default) and a determinate fill
    // (revealed by setProgress). Only one shows at a time.
    const track = document.createElement('div');
    style(track, {
      position: 'relative',
      width: '100%',
      height: '6px',
      borderRadius: '3px',
      background: 'rgba(255,255,255,0.08)',
      overflow: 'hidden',
      marginBottom: '18px',
    });
    const sweep = document.createElement('div');
    style(sweep, {
      position: 'absolute',
      left: '0',
      top: '0',
      height: '100%',
      width: '33%',
      borderRadius: '3px',
      background: `linear-gradient(90deg, rgba(127,227,255,0), ${ACCENT}, rgba(127,227,255,0))`,
      animation: 'deceive-sweep 1.3s ease-in-out infinite',
    });
    const fill = document.createElement('div');
    style(fill, {
      display: 'none', // shown once setProgress is called
      height: '100%',
      width: '0%',
      borderRadius: '3px',
      background: ACCENT,
      transition: 'width 0.25s ease-out',
    });
    track.append(sweep, fill);

    // Rotating spy tip — cycled every few seconds by the tip interval via tipAt().
    const tip = document.createElement('div');
    tip.textContent = tipAt(this.tipIndex);
    style(tip, {
      color: MUTED,
      fontSize: '12px',
      lineHeight: '1.5',
      minHeight: '2.5em', // reserve two lines so rotation doesn't jump the layout
      letterSpacing: '0.02em',
    });

    card.append(spinner, status, track, tip);
    root.append(title, wordmark, card);
    this.parent.appendChild(root);

    this.root = root;
    this.statusEl = status;
    this.tipEl = tip;
    this.sweepEl = sweep;
    this.fillEl = fill;
  }

  /** Start (or restart) the tip rotation interval, advancing a deterministic counter via tipAt. */
  private startTipRotation(): void {
    this.stopTipRotation();
    this.tipTimer = window.setInterval(() => {
      this.tipIndex += 1;
      if (this.tipEl) this.tipEl.textContent = tipAt(this.tipIndex);
    }, TIP_ROTATE_MS);
  }

  /** Stop the tip rotation interval, if running (no-op otherwise). */
  private stopTipRotation(): void {
    if (this.tipTimer) {
      window.clearInterval(this.tipTimer);
      this.tipTimer = 0;
    }
  }
}
