// DOM input plumbing. Owns the listeners + the live KeyState + accumulated look yaw, and
// produces a PlayerInput each tick via the PURE mapKeysToInput (which knows nothing of the
// DOM). Keeping the pure mapping separate (mapInput.ts) lets it be unit-tested in the
// node-env gate while this thin shell does the side-effectful event binding.
//
// Authority (PROJECT_BRIEF §4.2): the PlayerInput we emit is a REQUEST for a tick — the
// server simulates and is authoritative. Nothing here applies movement as truth.
import type { PlayerInput } from '@deceive/shared';
import { emptyKeyState, mapKeysToInput, type KeyState } from './mapInput';

// Radians of yaw per pixel of horizontal mouse motion. Negative so moving the mouse right
// turns the look to the right (clockwise from above = decreasing yaw in our -Z-forward
// frame). Tunable — flagged for Director taste alongside camera distance.
const MOUSE_SENSITIVITY = 0.0025;

export class Input {
  private readonly element: HTMLElement;
  private readonly keys: KeyState = emptyKeyState();
  private yaw = 0;
  private seq = 0;
  private locked = false;

  // Bound handlers retained so dispose() can remove the exact same references.
  private readonly onKeyDown = (e: KeyboardEvent) => this.setKey(e, true);
  private readonly onKeyUp = (e: KeyboardEvent) => this.setKey(e, false);
  private readonly onClick = () => {
    // Request pointer lock on click; the browser shows the unlock-on-Esc affordance.
    if (!this.locked) this.element.requestPointerLock();
  };
  private readonly onPointerLockChange = () => {
    this.locked = document.pointerLockElement === this.element;
    // Drop any held keys when we lose focus so the avatar doesn't run off on its own.
    if (!this.locked) this.resetKeys();
  };
  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.yaw -= e.movementX * MOUSE_SENSITIVITY;
  };

  constructor(element: HTMLElement) {
    this.element = element;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.element.addEventListener('click', this.onClick);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
  }

  /** The accumulated look yaw (radians), so the camera can face where input points. */
  getYaw(): number {
    return this.yaw;
  }

  /** Produce this tick's PlayerInput from the current key/look state (seq auto-increments). */
  sample(): PlayerInput {
    return mapKeysToInput(this.keys, this.yaw, this.seq++);
  }

  private setKey(e: KeyboardEvent, down: boolean): void {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = down;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.keys.back = down;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = down;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = down;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys.running = down;
        break;
      case 'Space':
        this.keys.jumping = down;
        // Stop the page scrolling when jumping.
        if (down) e.preventDefault();
        break;
      default:
        return;
    }
  }

  private resetKeys(): void {
    const empty = emptyKeyState();
    this.keys.forward = empty.forward;
    this.keys.back = empty.back;
    this.keys.left = empty.left;
    this.keys.right = empty.right;
    this.keys.running = empty.running;
    this.keys.jumping = empty.jumping;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.element.removeEventListener('click', this.onClick);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    if (this.locked && document.pointerLockElement === this.element) {
      document.exitPointerLock();
    }
  }
}
