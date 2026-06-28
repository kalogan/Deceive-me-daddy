// The interactive TUTORIAL coach — a fixed DOM overlay (NOT Three) that shows the six beats of
// the heist and ticks each one off the instant the player does it, driven by the LIVE snapshot
// (tutorialSteps.ts derives the progress; this only renders it). Active only during a tutorial run.
//
// Authority: owns no gameplay truth — it reads the same NetMatchState the HUD/renderer read. The
// offline sim (LocalSimSource) is what actually enacts each step; this just coaches + celebrates.
import type { NetMatchState } from '@deceive/shared';
import { tutorialProgress, type TutorialProgress } from './tutorialSteps';

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const ACCENT = '#ffcf3f';
const DONE = '#7fdca0';
const MUTED = '#9aa';

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

export class TutorialCoach {
  private readonly root: HTMLDivElement;
  private readonly rows: { mark: HTMLSpanElement; label: HTMLSpanElement; hint: HTMLDivElement }[] = [];
  private readonly banner: HTMLDivElement;
  private readonly intelRequired: number;
  private lastSig = '';

  constructor(intelRequired: number, parent: HTMLElement = document.body) {
    this.intelRequired = intelRequired;
    const root = el('div', {
      position: 'fixed',
      left: '18px',
      top: '92px',
      width: 'min(320px, 80vw)',
      background: 'rgba(8,10,18,0.72)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: '10px',
      padding: '12px 14px',
      font: `13px/1.5 ${MONO}`,
      color: '#dfe6f2',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '6',
      boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
    });
    root.id = 'tutorial-coach';

    const title = el('div', {
      color: ACCENT,
      font: `700 12px/1 ${MONO}`,
      letterSpacing: '0.18em',
      marginBottom: '10px',
    }, 'TUTORIAL');
    root.append(title);

    // Six placeholder rows; tutorialSteps supplies the labels/hints on the first update().
    for (let i = 0; i < 6; i++) {
      const row = el('div', { margin: '7px 0' });
      const head = el('div', { display: 'flex', alignItems: 'baseline', gap: '8px' });
      const mark = el('span', { color: MUTED, fontWeight: '800', width: '14px', display: 'inline-block' }, '○');
      const label = el('span', { fontWeight: '700' }, ' ');
      head.append(mark, label);
      const hint = el('div', { color: MUTED, fontSize: '12px', margin: '2px 0 0 22px', display: 'none' }, ' ');
      row.append(head, hint);
      root.append(row);
      this.rows.push({ mark, label, hint });
    }

    this.banner = el('div', {
      marginTop: '10px',
      padding: '7px 9px',
      borderRadius: '6px',
      background: 'rgba(127,220,160,0.14)',
      color: DONE,
      font: `800 12px/1.3 ${MONO}`,
      letterSpacing: '0.04em',
      display: 'none',
    }, '✓ Tutorial complete — you’ve pulled off the heist!');
    root.append(this.banner);

    parent.appendChild(root);
    this.root = root;
  }

  /** Repaint from the live snapshot (cheap: only touches the DOM when progress changes). */
  update(state: NetMatchState, localId: string): void {
    const p: TutorialProgress = tutorialProgress(state, localId, this.intelRequired);
    // Cheap change-detection signature: done-flags + the active index.
    const sig = p.steps.map((s) => (s.done ? '1' : '0')).join('') + p.activeIndex;
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    p.steps.forEach((s, i) => {
      const row = this.rows[i];
      if (!row) return;
      const active = i === p.activeIndex;
      row.label.textContent = s.label;
      row.label.style.color = s.done ? DONE : active ? '#ffffff' : MUTED;
      row.mark.textContent = s.done ? '✓' : '○';
      row.mark.style.color = s.done ? DONE : active ? ACCENT : MUTED;
      // Only the active step shows its hint, to keep the panel quiet.
      row.hint.textContent = s.hint;
      row.hint.style.display = active && !s.done ? 'block' : 'none';
    });

    this.banner.style.display = p.allDone ? 'block' : 'none';
  }

  dispose(): void {
    this.root.remove();
  }
}
