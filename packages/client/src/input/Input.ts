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
  // True while the RIGHT mouse button is held — an alternative look mode that turns the camera by
  // dragging, WITHOUT pointer lock. Lets you look around immediately (no need to click/fire first to
  // capture the mouse), which is what the locked mode required.
  private dragging = false;

  // Bound handlers retained so dispose() can remove the exact same references.
  private readonly onKeyDown = (e: KeyboardEvent) => this.setKey(e, true);
  private readonly onKeyUp = (e: KeyboardEvent) => this.setKey(e, false);
  private readonly onClick = () => {
    // Request pointer lock on LEFT click; the browser shows the unlock-on-Esc affordance. (Right
    // mouse uses the drag-look mode below instead, so looking never requires a captured cursor.)
    if (!this.locked) this.element.requestPointerLock();
  };
  private readonly onMouseDown = (e: MouseEvent) => {
    if (e.button === 2) this.dragging = true; // right button: begin drag-look
  };
  private readonly onMouseUp = (e: MouseEvent) => {
    if (e.button === 2) this.dragging = false;
  };
  // Right-click would pop the context menu mid-drag; suppress it over the play surface.
  private readonly onContextMenu = (e: MouseEvent) => e.preventDefault();
  private readonly onPointerLockChange = () => {
    this.locked = document.pointerLockElement === this.element;
    // Drop any held keys when we lose focus so the avatar doesn't run off on its own.
    if (!this.locked) this.resetKeys();
  };
  private readonly onMouseMove = (e: MouseEvent) => {
    // Turn the look when EITHER the pointer is locked (click-to-capture FPS mode) OR the right
    // button is held (drag-look). Both accumulate from the horizontal motion delta.
    if (!this.locked && !this.dragging) return;
    this.yaw -= e.movementX * MOUSE_SENSITIVITY;
  };

  constructor(element: HTMLElement) {
    this.element = element;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.element.addEventListener('click', this.onClick);
    this.element.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    this.element.addEventListener('contextmenu', this.onContextMenu);
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
    this.element.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    if (this.locked && document.pointerLockElement === this.element) {
      document.exitPointerLock();
    }
  }
}
