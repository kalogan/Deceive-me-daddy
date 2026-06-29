// On-screen touch controls for mobile (PROJECT_BRIEF §3 — the client only emits input
// REQUESTS; the server stays authoritative). A full-screen overlay with:
//   - a DYNAMIC movement stick on the left half (appears where your thumb lands) → analog
//     moveX/moveZ + run-at-the-rim,
//   - a LOOK drag on the right half → accumulates yaw (like the desktop mouse),
//   - an action-button cluster (Fire / Disguise / Intel / Revive / Ability / Gadget) bottom-right.
//
// Multi-touch aware (stick + look + a button can be pressed at once) via Touch.identifier.
// The joystick MATH lives in the pure, unit-tested touchVector.ts; this is the thin DOM shell.
import type { PlayerInput } from '@deceive/shared';
import { clampPitch } from '../render/firstPersonCamera';
import { joystickVector, type JoystickReading } from './touchVector';

/** Action callbacks — wired to the same StateSource requests the desktop keys fire. */
export interface TouchActions {
  onFire(): void;
  /** The unified [E] context interact — intel / package / key / depart / take disguise. */
  onInteract(): void;
  onRevive(): void;
  onAbility(): void;
  onGadget(): void;
}

/** True on touch-capable devices — gate creating the overlay so desktop is untouched. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'ontouchstart' in window ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  );
}

const JOY_RADIUS = 60; // px from stick centre to rim
const LOOK_SENS = 0.005; // radians of yaw per px of horizontal drag
const ZERO: JoystickReading = { moveX: 0, moveZ: 0, magnitude: 0, running: false };

export class TouchControls {
  private readonly root: HTMLDivElement;
  private readonly joyBase: HTMLDivElement;
  private readonly joyThumb: HTMLDivElement;

  private yaw = 0;
  private pitch = 0;
  private reading: JoystickReading = ZERO;
  /** One-shot jump request from the Jump button, consumed by the next getInput(). */
  private jumpQueued = false;

  // Active touch identifiers for the two drag regions (a button press is its own touch).
  private joyId: number | null = null;
  private lookId: number | null = null;
  private joyCx = 0;
  private joyCy = 0;
  private lastLookX = 0;
  private lastLookY = 0;

  constructor(parent: HTMLElement, actions: TouchActions) {
    const root = document.createElement('div');
    root.id = 'touch-controls';
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '6',
      touchAction: 'none',
      userSelect: 'none',
      // The overlay captures touches itself; let the corner HUD (a sibling) stay readable.
      background: 'transparent',
    } satisfies Partial<CSSStyleDeclaration>);

    // --- movement stick (hidden until a thumb lands in the left half) ---
    const joyBase = document.createElement('div');
    Object.assign(joyBase.style, {
      position: 'absolute',
      width: `${JOY_RADIUS * 2}px`,
      height: `${JOY_RADIUS * 2}px`,
      borderRadius: '50%',
      border: '2px solid rgba(255,255,255,0.35)',
      background: 'rgba(255,255,255,0.08)',
      display: 'none',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    const joyThumb = document.createElement('div');
    Object.assign(joyThumb.style, {
      position: 'absolute',
      width: '54px',
      height: '54px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.45)',
      border: '2px solid rgba(255,255,255,0.6)',
      pointerEvents: 'none',
      transform: 'translate(-50%, -50%)',
    } satisfies Partial<CSSStyleDeclaration>);
    joyBase.appendChild(joyThumb);
    root.appendChild(joyBase);

    // --- action buttons (bottom-right cluster) ---
    root.appendChild(this.makeButton('🔫', 'Fire', { bottom: '92px', right: '28px' }, 70, '#c0392b', () => actions.onFire()));
    // ONE context-interact button — intel / package / key / depart / take disguise.
    root.appendChild(this.makeButton('E', 'Use', { bottom: '74px', right: '128px' }, 60, '#3f8a5a', () => actions.onInteract()));
    root.appendChild(this.makeButton('⤒', 'Jump', { bottom: '150px', right: '128px' }, 52, '#3f6d8a', () => { this.jumpQueued = true; }));
    root.appendChild(this.makeButton('G', 'Ability', { bottom: '178px', right: '40px' }, 56, '#8a6d1f', () => actions.onAbility()));
    root.appendChild(this.makeButton('H', 'Gadget', { bottom: '250px', right: '34px' }, 52, '#6d3f8a', () => actions.onGadget()));
    root.appendChild(this.makeButton('R', 'Revive', { bottom: '236px', right: '104px' }, 52, '#2f7a8a', () => actions.onRevive()));

    parent.appendChild(root);
    this.root = root;
    this.joyBase = joyBase;
    this.joyThumb = joyThumb;

    root.addEventListener('touchstart', this.onTouchStart, { passive: false });
    root.addEventListener('touchmove', this.onTouchMove, { passive: false });
    root.addEventListener('touchend', this.onTouchEnd, { passive: false });
    root.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
  }

  /** Build one round action button; its touch is consumed (stopPropagation) so it never pans. */
  private makeButton(
    glyph: string,
    label: string,
    pos: Partial<CSSStyleDeclaration>,
    size: number,
    color: string,
    onPress: () => void,
  ): HTMLDivElement {
    const b = document.createElement('div');
    b.textContent = glyph;
    b.setAttribute('aria-label', label);
    Object.assign(b.style, {
      position: 'absolute',
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      font: `700 ${Math.round(size * 0.34)}px/1 ui-monospace, monospace`,
      color: '#fff',
      background: color,
      opacity: '0.82',
      border: '2px solid rgba(255,255,255,0.5)',
      pointerEvents: 'auto',
      ...pos,
    } satisfies Partial<CSSStyleDeclaration>);
    const press = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      b.style.opacity = '1';
      onPress();
    };
    const release = () => {
      b.style.opacity = '0.82';
    };
    b.addEventListener('touchstart', press, { passive: false });
    b.addEventListener('touchend', release, { passive: false });
    b.addEventListener('touchcancel', release, { passive: false });
    return b;
  }

  private readonly onTouchStart = (e: TouchEvent): void => {
    for (const t of Array.from(e.changedTouches)) {
      const leftHalf = t.clientX < window.innerWidth / 2;
      if (leftHalf && this.joyId === null) {
        this.joyId = t.identifier;
        this.joyCx = t.clientX;
        this.joyCy = t.clientY;
        this.joyBase.style.left = `${t.clientX - JOY_RADIUS}px`;
        this.joyBase.style.top = `${t.clientY - JOY_RADIUS}px`;
        this.joyBase.style.display = 'block';
        this.setThumb(0, 0);
      } else if (!leftHalf && this.lookId === null) {
        this.lookId = t.identifier;
        this.lastLookX = t.clientX;
        this.lastLookY = t.clientY;
      }
    }
    e.preventDefault();
  };

  private readonly onTouchMove = (e: TouchEvent): void => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.joyId) {
        const dx = t.clientX - this.joyCx;
        const dy = t.clientY - this.joyCy;
        this.reading = joystickVector(dx, dy, JOY_RADIUS);
        // Clamp the visual thumb to the rim.
        const mag = Math.hypot(dx, dy);
        const k = mag > JOY_RADIUS ? JOY_RADIUS / mag : 1;
        this.setThumb(dx * k, dy * k);
      } else if (t.identifier === this.lookId) {
        // Horizontal drag turns (yaw); vertical drag looks up/down (pitch, clamped past vertical).
        // Drag-up = look-up, matching the desktop mouse.
        this.yaw -= (t.clientX - this.lastLookX) * LOOK_SENS;
        this.pitch = clampPitch(this.pitch - (t.clientY - this.lastLookY) * LOOK_SENS);
        this.lastLookX = t.clientX;
        this.lastLookY = t.clientY;
      }
    }
    e.preventDefault();
  };

  private readonly onTouchEnd = (e: TouchEvent): void => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.joyId) {
        this.joyId = null;
        this.reading = ZERO;
        this.joyBase.style.display = 'none';
      } else if (t.identifier === this.lookId) {
        this.lookId = null;
      }
    }
    e.preventDefault();
  };

  private setThumb(dx: number, dy: number): void {
    this.joyThumb.style.left = `${JOY_RADIUS + dx}px`;
    this.joyThumb.style.top = `${JOY_RADIUS + dy}px`;
  }

  /** This tick's PlayerInput from the stick + accumulated look yaw. */
  getInput(seq: number): PlayerInput {
    const jumping = this.jumpQueued;
    this.jumpQueued = false; // one-shot: consumed this tick
    return {
      seq,
      moveX: this.reading.moveX,
      moveZ: this.reading.moveZ,
      yaw: this.yaw,
      running: this.reading.running,
      jumping,
    };
  }

  /** The accumulated cosmetic look pitch (radians, clamped) from the right-hand drag. */
  getPitch(): number {
    return this.pitch;
  }

  dispose(): void {
    this.root.remove();
  }
}
