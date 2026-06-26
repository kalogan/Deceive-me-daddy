// The match RESULTS screen — a full-screen DOM overlay that takes over when a team extracts
// the package and the match transitions to 'ended' (PROJECT_BRIEF §2: the heist resolves with
// an extraction). It is a sibling-in-spirit of the Menu (menu/Menu.ts) and the HUD: a plain
// fixed overlay, dark + translucent, clean monospace, inline styles, no framework.
//
// Authority (PROJECT_BRIEF §3/§4.2): this owns NO gameplay truth. It only PRESENTS the result
// the server already decided — `objective.winningTeam` against the local player's team. main.ts
// detects the end-of-match transition and shows this once; the screen itself just renders text
// and offers two ways out (both reload to the splash menu, since returning in-process is out of
// scope for this slice).
//
// Browser-only (it touches the DOM), so it must NEVER be imported by a Node gate test — only
// main.ts imports the CLASS. The one piece of LOGIC worth testing is the PURE `resultText`
// helper below, which resultsScreen.test.ts exercises with no DOM at all.

/**
 * The headline + subtitle the results overlay shows, derived PURE from the local player's team
 * and the authoritative winning team. Display-only — the server decided the winner.
 */
export interface ResultText {
  /** 'VICTORY' when the local player's team won, else 'DEFEAT'. */
  headline: 'VICTORY' | 'DEFEAT';
  /** The flavour line, e.g. 'Team 2 extracted the package'. */
  sub: string;
}

/**
 * PURE result-text derivation (no DOM), the one unit-tested seam of the results screen. Given
 * the local player's team and the authoritative `winningTeam`, decide the headline (VICTORY when
 * they match, else DEFEAT) and the descriptive sub-line naming the team that extracted.
 *
 * Isolating this means the win/lose decision lives in ONE tested place rather than smeared
 * through the DOM wiring. See resultsScreen.test.ts.
 */
export function resultText(localTeam: number, winningTeam: number): ResultText {
  const headline: ResultText['headline'] = localTeam === winningTeam ? 'VICTORY' : 'DEFEAT';
  return {
    headline,
    sub: `Team ${winningTeam} extracted the package`,
  };
}

// --- Palette ------------------------------------------------------------------------------
// Echoes the Menu's tight dark-spy palette (menu/Menu.ts) so the results screen reads as a
// sibling of the front-of-game overlay. We re-declare the few values we need rather than import
// from Menu (its constants aren't exported, and the brief forbids editing it).
const INK = '#dde'; // primary text
const MUTED = '#9aa'; // labels / secondary text
const GOLD = '#ffcf3f'; // call-to-action gold (Play Again, the primary)
const VICTORY = '#3fffd0'; // triumphant teal for a win headline (matches the HUD win banner)
const DEFEAT = '#ff6a6a'; // muted red for a loss headline
const CARD_BG = 'rgba(0, 0, 0, 0.5)';
const BORDER = 'rgba(255, 255, 255, 0.16)';

/** Apply a partial inline style set (typed, matching the HUD/Menu's `Object.assign(...style)`). */
function style(el: HTMLElement, s: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, s);
}

/**
 * Build a results button in the house style: a dark translucent pill that lights up on hover.
 * `tone` lets the primary call-to-action (Play Again) read gold while the secondary (Main Menu)
 * stays neutral. Mirrors the Menu's `makeButton` look without depending on it.
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
  btn.addEventListener('pointerdown', () => {
    btn.style.transform = 'translateY(1px)';
  });
  btn.addEventListener('pointerup', () => {
    btn.style.transform = 'translateY(0)';
  });
  return btn;
}

/**
 * The match-end RESULTS overlay. Construct it, then call `show(localTeam, winningTeam)` once the
 * match has ended to render VICTORY/DEFEAT plus a Play-Again flow. `dispose()` removes it from
 * the DOM (used by main.ts's hot-reload teardown).
 *
 * Both buttons simply `location.reload()`: that returns the player cleanly to the splash menu
 * (the app boots into the Menu — see main.ts `bootstrap()`). Returning to the menu in-process,
 * or a true in-match rematch, is out of scope for this slice.
 */
export class ResultsScreen {
  /** The fixed full-screen overlay root; null until `show()` builds it (and after `dispose()`). */
  private root: HTMLDivElement | null = null;
  /** Where the overlay mounts — defaults to <body>, overridable for headless/testing. */
  private readonly parent: HTMLElement;

  constructor(parent: HTMLElement = document.body) {
    this.parent = parent;
  }

  /**
   * Build + show the results overlay for a finished match. Idempotent on a per-instance basis:
   * if already shown, it rebuilds with the latest result (main.ts guards against re-showing every
   * frame, but this stays safe regardless). `localTeam` is the LOCAL player's team from the
   * snapshot; `winningTeam` is the authoritative `objective.winningTeam`.
   */
  show(localTeam: number, winningTeam: number): void {
    // Rebuild from scratch so a repeated show() never stacks overlays.
    this.dispose();

    const { headline, sub } = resultText(localTeam, winningTeam);
    const won = headline === 'VICTORY';

    const root = document.createElement('div');
    root.id = 'results';
    style(root, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      // A dark vignette over a near-black base — the same focal treatment as the Menu, so the
      // headline reads as the match-ending moment and the greybox scene behind never bleeds in.
      background:
        'radial-gradient(120% 90% at 50% 30%, rgba(36,42,60,0.55), rgba(8,9,14,0.97) 72%), rgba(8,9,14,0.9)',
      color: INK,
      font: '14px/1.5 ui-monospace, monospace',
      userSelect: 'none',
      // Above the HUD (z-index 10) and its win banner — this overlay owns the screen at match end.
      zIndex: '60',
    });

    // Headline: VICTORY (triumphant teal) or DEFEAT (muted red), oversized like the Menu title.
    const title = document.createElement('div');
    title.textContent = headline;
    style(title, {
      font: '900 64px/1 ui-monospace, monospace',
      letterSpacing: '0.16em',
      color: won ? VICTORY : DEFEAT,
      textShadow: won
        ? '0 0 28px rgba(63,255,208,0.35)'
        : '0 0 24px rgba(255,106,106,0.3)',
      marginBottom: '10px',
    });

    // Sub-line naming the team that extracted, e.g. 'Team 2 extracted the package'.
    const subtitle = document.createElement('div');
    subtitle.textContent = sub;
    style(subtitle, {
      color: MUTED,
      letterSpacing: '0.06em',
      marginBottom: '28px',
      textAlign: 'center',
    });

    // The action panel: a translucent card holding the two ways out, matching the Menu's card.
    const panel = document.createElement('div');
    style(panel, {
      width: 'min(360px, 90vw)',
      padding: '20px',
      background: 'rgba(10, 12, 18, 0.82)',
      border: `1px solid ${BORDER}`,
      borderRadius: '12px',
      boxShadow: '0 18px 60px rgba(0,0,0,0.6)',
    });

    // Play Again (primary) and Main Menu (secondary). Both reload to the splash menu cleanly —
    // an in-process rematch / menu return is out of scope for this slice (see class doc).
    const playAgain = makeButton('Play Again', 'primary');
    playAgain.setAttribute('data-results', 'play-again');
    playAgain.addEventListener('click', () => location.reload());

    const mainMenu = makeButton('Main Menu', 'normal');
    mainMenu.setAttribute('data-results', 'main-menu');
    // Last button: drop its trailing margin so the card hugs its contents.
    mainMenu.style.margin = '0';
    mainMenu.addEventListener('click', () => location.reload());

    panel.append(playAgain, mainMenu);
    root.append(title, subtitle, panel);
    this.parent.appendChild(root);
    this.root = root;
  }

  /** Remove the overlay from the DOM, if shown (hot-reload teardown / re-show safety). */
  dispose(): void {
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
  }
}
