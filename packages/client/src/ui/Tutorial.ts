// The "How to Play" TUTORIAL overlay — a full-screen DOM card that walks a new player through
// the heist in a handful of swipeable/clickable steps. It's a sibling-in-spirit of the Menu
// (menu/Menu.ts) and the ResultsScreen (ui/ResultsScreen.ts): a plain fixed overlay, dark
// vignette + translucent card, clean monospace, inline styles re-declared locally (NOT imported,
// since those siblings don't export them and the brief forbids editing them), no framework.
//
// Authority: this owns NO gameplay truth. It's a pure onboarding read — it teaches the rules the
// rest of the game enforces. The Architect adds the "How to Play" entry to the Menu and awaits
// `show()` to gate entry on the player dismissing it.
//
// Browser-only (it touches the DOM), so it must NEVER be imported by a Node gate test — only the
// Architect's wiring imports the CLASS. The testable seam is the PURE, DOM-free step source below
// (`TUTORIAL_STEPS` + `stepAt`), which tutorial.test.ts exercises with no DOM at all.

/**
 * One screen of the tutorial: a short heading and a plain-text body. `body` may contain `\n`
 * line breaks (rendered via `white-space: pre-line`); it is PLAIN TEXT — set with `textContent`,
 * never `innerHTML`, so authored copy can never inject markup.
 */
export interface TutorialStep {
  title: string;
  body: string;
}

/**
 * The authored tutorial steps, in order. Pure data (no DOM), so they're unit-testable and the
 * one source of onboarding truth. Covers: Goal, Move & Run, Blend & Disguise, Suspicion & Reveal,
 * Intel & Keycards, Vault & Package & Extract, Agents/Expertise, and a sign-off.
 */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    title: 'WELCOME, AGENT',
    body:
      'This is a social-stealth heist. Hidden in plain sight among civilians, you must\n' +
      'gather intel, crack the vault, grab the objective package, and extract it to an\n' +
      'extraction point — before the enemy team beats you to it.',
  },
  {
    title: 'MOVE & RUN',
    body:
      'WASD, or drag the LEFT side of the screen, to move.\n' +
      'Hold Shift (or the run control) to sprint.\n' +
      'But running near guards looks suspicious — keep it to a walk when watched.',
  },
  {
    title: 'BLEND IN',
    body:
      'You start blended in as a civilian. Stay calm and act natural to hold your cover.\n' +
      'Tiered disguises — civilian, staff, security, scientist — get you into\n' +
      'higher-clearance zones. Dress for where you need to go.',
  },
  {
    title: 'SUSPICION & REVEAL',
    body:
      'Running, entering forbidden zones, or being seen where you should not be all raise\n' +
      'suspicion. Let it climb too high and you are REVEALED — enemies and guards can\n' +
      'then shoot you. Aiming and firing also blows your cover, so pick your moments.',
  },
  {
    title: 'INTEL & KEYCARDS',
    body:
      'Collect intel nodes around the map. Intel unlocks doors and is needed to open the\n' +
      'vault. Pick up keycards too — they let you pass clearance-gated doors that your\n' +
      'current disguise alone cannot.',
  },
  {
    title: 'VAULT & EXTRACT',
    body:
      'Once enough intel is gathered, the vault opens. Grab the package — but beware:\n' +
      'grabbing it REVEALS you and makes you a target. Run it to an extraction point to\n' +
      'win the heist before the enemy can take it from you.',
  },
  {
    title: 'AGENTS & EXPERTISE',
    body:
      'Each agent plays differently and brings a signature Expertise — a special ability\n' +
      'that bends the rules in your favour. Pick the agent that suits your style from the\n' +
      'menu before you deploy.',
  },
  {
    title: 'GOOD LUCK',
    body:
      'Stay calm, blend in, and trust your disguise. The best agents are never seen.\n' +
      'Now get in there and pull off the perfect heist.',
  },
];

/**
 * PURE step accessor (no DOM, no Date/Math.random): returns the step at `index`, CLAMPED into
 * the valid range [0, length-1] (it does NOT wrap). Below 0 yields the first step, at or above
 * the length yields the last. This is the one tested seam of the overlay's navigation. See
 * tutorial.test.ts.
 */
export function stepAt(index: number): TutorialStep {
  const last = TUTORIAL_STEPS.length - 1;
  const clamped = index < 0 ? 0 : index > last ? last : index;
  // Length is a compile-time-nonempty literal array, so this index is always present.
  return TUTORIAL_STEPS[clamped] as TutorialStep;
}

// --- Palette ------------------------------------------------------------------------------
// Echoes the Menu's / ResultsScreen's tight dark-spy palette so the tutorial reads as a sibling
// of the front-of-game overlays. Re-declared locally (those constants aren't exported, and the
// brief forbids editing those files).
const INK = '#dde'; // primary text
const MUTED = '#9aa'; // labels / secondary text
const ACCENT = '#7fe3ff'; // cyan highlight (active step dot)
const GOLD = '#ffcf3f'; // call-to-action gold (the primary Next / Start)
const PANEL_BG = 'rgba(10, 12, 18, 0.82)';
const CARD_BG = 'rgba(0, 0, 0, 0.5)';
const BORDER = 'rgba(255, 255, 255, 0.16)';

/** Apply a partial inline style set (typed, matching the HUD/Menu's `Object.assign(...style)`). */
function style(el: HTMLElement, s: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, s);
}

/**
 * Build a tutorial button in the house style: a dark translucent pill that lights up on hover,
 * sized as a big touch target (this is a phone-first game). `tone` lets the primary action
 * (Next / Start) read gold while secondary actions (Back) stay neutral. Mirrors the Menu's
 * `makeButton` look without depending on it.
 */
function makeButton(label: string, tone: 'primary' | 'normal'): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  const base = tone === 'primary' ? GOLD : INK;
  const idleBorder = tone === 'primary' ? 'rgba(255,207,63,0.55)' : BORDER;
  const hotBorder = tone === 'primary' ? 'rgba(255,207,63,0.9)' : 'rgba(255,255,255,0.4)';
  style(btn, {
    display: 'block',
    minWidth: '120px',
    // Big touch targets for phones — a comfortable tap height with generous padding.
    minHeight: '52px',
    padding: '15px 22px',
    font: '600 16px/1.2 ui-monospace, monospace',
    letterSpacing: '0.04em',
    color: base,
    background: CARD_BG,
    border: `1px solid ${idleBorder}`,
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'center',
    touchAction: 'manipulation',
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
  btn.addEventListener('pointerdown', () => {
    btn.style.transform = 'translateY(1px)';
  });
  btn.addEventListener('pointerup', () => {
    btn.style.transform = 'translateY(0)';
  });
  return btn;
}

/**
 * The "How to Play" TUTORIAL overlay. Construct it, then `await show()` to display the steps and
 * resolve once the player finishes (last step's "Start") or taps "Skip" — the overlay hides
 * itself just before resolving so the caller can take over the screen cleanly. `dispose()`
 * removes the overlay + listeners and is idempotent (hot-reload teardown / re-show safety).
 *
 * Wiring (for the Architect): add a "How to Play" Menu entry whose handler does
 *   `await new Tutorial().show();`
 * (or hold one instance and call `show()` on click). Nothing here connects or starts a match —
 * it's purely an onboarding read the player dismisses.
 */
export class Tutorial {
  /** The fixed full-screen overlay root; null until `show()` builds it (and after `dispose()`). */
  private root: HTMLDivElement | null = null;
  /** Where the overlay mounts — defaults to <body>, overridable for headless/testing. */
  private readonly parent: HTMLElement;
  /** The step currently rendered. */
  private index = 0;
  /** Resolver for the active `show()` Promise; null when no view is pending. */
  private resolveShow: (() => void) | null = null;
  /** Detaches the keyboard handler; null when nothing is bound. */
  private detachKeys: (() => void) | null = null;

  constructor(parent: HTMLElement = document.body) {
    this.parent = parent;
  }

  /**
   * Build + show the overlay starting at step 0. Resolves when the player finishes the last step
   * ("Start") OR taps "Skip". Idempotent on a per-instance basis: a repeated `show()` rebuilds
   * from scratch rather than stacking overlays (the prior, un-finished view is torn down).
   */
  show(): Promise<void> {
    // Rebuild from scratch so a repeated show() never stacks overlays or leaks the old promise.
    this.dispose();
    this.index = 0;

    const root = document.createElement('div');
    root.id = 'tutorial';
    style(root, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      // The same dark focal vignette as the Menu so the greybox scene behind never bleeds in.
      background:
        'radial-gradient(120% 90% at 50% 22%, rgba(36,42,60,0.55), rgba(8,9,14,0.96) 70%), #0c0d12',
      color: INK,
      font: '14px/1.5 ui-monospace, monospace',
      userSelect: 'none',
      // Above the Menu (z-index 50) so it sits over the front-of-game overlay when opened there.
      zIndex: '70',
      padding: '24px',
      boxSizing: 'border-box',
    });

    // Skip affordance, pinned top-right — always available to bail out of onboarding.
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.textContent = 'Skip ✕';
    skip.setAttribute('data-tutorial', 'skip');
    style(skip, {
      position: 'absolute',
      top: '18px',
      right: '18px',
      minHeight: '44px',
      padding: '10px 16px',
      font: '600 14px/1 ui-monospace, monospace',
      letterSpacing: '0.04em',
      color: MUTED,
      background: 'transparent',
      border: `1px solid ${BORDER}`,
      borderRadius: '8px',
      cursor: 'pointer',
      touchAction: 'manipulation',
    });
    skip.addEventListener('pointerenter', () => {
      skip.style.color = INK;
      skip.style.borderColor = 'rgba(255,255,255,0.4)';
    });
    skip.addEventListener('pointerleave', () => {
      skip.style.color = MUTED;
      skip.style.borderColor = BORDER;
    });
    skip.addEventListener('click', () => this.finish());

    // Section label so the player knows what this overlay is.
    const kicker = document.createElement('div');
    kicker.textContent = 'HOW TO PLAY';
    style(kicker, {
      color: ACCENT,
      letterSpacing: '0.18em',
      fontSize: '12px',
      fontWeight: '700',
      marginBottom: '14px',
      textAlign: 'center',
    });

    // The translucent card holding the step's heading + body. A single card so the layout stays
    // stable as the content swaps between steps.
    const panel = document.createElement('div');
    style(panel, {
      width: 'min(440px, 92vw)',
      padding: '22px',
      background: PANEL_BG,
      border: `1px solid ${BORDER}`,
      borderRadius: '12px',
      boxShadow: '0 18px 60px rgba(0,0,0,0.6)',
      boxSizing: 'border-box',
    });

    const title = document.createElement('div');
    title.setAttribute('data-tutorial', 'title');
    style(title, {
      font: '800 22px/1.2 ui-monospace, monospace',
      letterSpacing: '0.06em',
      color: INK,
      marginBottom: '12px',
    });

    const body = document.createElement('div');
    body.setAttribute('data-tutorial', 'body');
    style(body, {
      color: MUTED,
      fontSize: '15px',
      lineHeight: '1.6',
      // Render authored `\n` line breaks without ever building DOM from a split (no innerHTML).
      whiteSpace: 'pre-line',
    });

    panel.append(title, body);

    // Step indicator: a row of dots, the active one lit with the cyan accent.
    const dots = document.createElement('div');
    dots.setAttribute('data-tutorial', 'dots');
    style(dots, {
      display: 'flex',
      gap: '8px',
      justifyContent: 'center',
      margin: '20px 0 16px',
    });

    // Nav row: Back (left) + Next/Start (right), big touch targets sitting side by side.
    const nav = document.createElement('div');
    style(nav, {
      display: 'flex',
      gap: '12px',
      width: 'min(440px, 92vw)',
      justifyContent: 'space-between',
    });
    const back = makeButton('◂ Back', 'normal');
    back.setAttribute('data-tutorial', 'back');
    back.addEventListener('click', () => this.go(this.index - 1));
    const next = makeButton('Next ▸', 'primary');
    next.setAttribute('data-tutorial', 'next');
    next.addEventListener('click', () => {
      if (this.index >= TUTORIAL_STEPS.length - 1) {
        this.finish();
      } else {
        this.go(this.index + 1);
      }
    });
    style(back, { flex: '1' });
    style(next, { flex: '1' });
    nav.append(back, next);

    root.append(skip, kicker, panel, dots, nav);
    this.parent.appendChild(root);
    this.root = root;

    // Keyboard nav (desktop convenience): arrows page, Escape skips.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') this.go(this.index + 1);
      else if (e.key === 'ArrowLeft') this.go(this.index - 1);
      else if (e.key === 'Escape') this.finish();
    };
    window.addEventListener('keydown', onKey);
    this.detachKeys = () => window.removeEventListener('keydown', onKey);

    // Paint the first step.
    this.render();

    return new Promise<void>((resolve) => {
      this.resolveShow = resolve;
    });
  }

  /** Move to `target` (clamped via the pure `stepAt` mapping) and repaint. */
  private go(target: number): void {
    const clamped = target < 0 ? 0 : target > TUTORIAL_STEPS.length - 1 ? TUTORIAL_STEPS.length - 1 : target;
    if (clamped === this.index) return;
    this.index = clamped;
    this.render();
  }

  /** Repaint the card + dots + nav buttons to reflect the current step. */
  private render(): void {
    if (!this.root) return;
    const step = stepAt(this.index);
    const last = this.index >= TUTORIAL_STEPS.length - 1;

    const title = this.root.querySelector<HTMLElement>('[data-tutorial="title"]');
    const body = this.root.querySelector<HTMLElement>('[data-tutorial="body"]');
    if (title) title.textContent = step.title;
    if (body) body.textContent = step.body;

    // Back is hidden on step 0 (nothing to go back to); kept in layout so Next stays put.
    const back = this.root.querySelector<HTMLElement>('[data-tutorial="back"]');
    if (back) {
      back.style.visibility = this.index === 0 ? 'hidden' : 'visible';
    }

    // Primary button reads "Start" on the last step (it resolves), "Next ▸" otherwise.
    const next = this.root.querySelector<HTMLElement>('[data-tutorial="next"]');
    if (next) next.textContent = last ? 'Start' : 'Next ▸';

    this.renderDots();
  }

  /** Rebuild the step-indicator dots, lighting the active one. */
  private renderDots(): void {
    if (!this.root) return;
    const dots = this.root.querySelector<HTMLElement>('[data-tutorial="dots"]');
    if (!dots) return;
    dots.replaceChildren();
    for (let i = 0; i < TUTORIAL_STEPS.length; i += 1) {
      const dot = document.createElement('span');
      const active = i === this.index;
      style(dot, {
        width: active ? '20px' : '8px',
        height: '8px',
        borderRadius: '999px',
        background: active ? ACCENT : 'rgba(255,255,255,0.22)',
        transition: 'width 0.12s linear, background 0.12s linear',
      });
      dots.append(dot);
    }
  }

  /** Hide the overlay and resolve the pending `show()` Promise (Start / Skip / Escape). */
  private finish(): void {
    const resolve = this.resolveShow;
    this.resolveShow = null;
    this.dispose();
    resolve?.();
  }

  /**
   * Remove the overlay + detach listeners. Idempotent (safe to call when nothing is shown, and
   * called again by `finish()`); no leaks. Does NOT resolve a pending promise — only `finish()`
   * does, so an external dispose() of an open tutorial leaves the awaiter pending by design.
   */
  dispose(): void {
    if (this.detachKeys) {
      this.detachKeys();
      this.detachKeys = null;
    }
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
  }
}
