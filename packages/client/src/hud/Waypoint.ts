// The OBJECTIVE WAYPOINT indicator (a plain fixed DOM element, NOT Three). A compass-style
// arrow that rotates to point toward the player's CURRENT objective (nearest intel / the loose
// package / nearest extraction), with the distance + a short label.
//
// We draw it as a yaw-relative BEARING arrow (no camera projection / no 3D mesh — staying in the
// HUD layer per the file surface) using the pure waypointModel: pickWaypointTarget chooses the
// world position, bearingTo gives the angle the arrow rotates by. Authority: display-only.
//
// PHONE-FIRST: a small puck pinned center-LEFT (above the left stick's reach), pointer-transparent
// so it never blocks touch input.
import type { ContentPack, NetMatchState } from '@deceive/shared';
import { bearingTo, pickWaypointTarget } from './waypointModel';

/** Per-kind accent so the objective type reads at a glance (matches the minimap palette). */
const KIND_COLOR = {
  intel: '#9b8cff',
  package: '#ffcf3f',
  extract: '#3fffd0',
} as const;

export class Waypoint {
  private readonly root: HTMLDivElement;
  private readonly arrow: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private pack: ContentPack | null = null;
  private lastLabel = '';
  private lastColor = '';
  private lastVisible: boolean | null = null;

  constructor(parent: HTMLElement = document.body) {
    const root = document.createElement('div');
    root.id = 'waypoint';
    Object.assign(root.style, {
      position: 'fixed',
      right: '20px',
      top: '356px',
      display: 'none',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '4px',
      font: '700 11px/1.2 ui-monospace, monospace',
      letterSpacing: '0.06em',
      color: '#dde',
      background: 'rgba(0, 0, 0, 0.42)',
      padding: '8px 9px',
      borderRadius: '10px',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '8',
    } satisfies Partial<CSSStyleDeclaration>);

    // The arrow glyph: a unicode triangle we rotate via transform. 0° points UP (north on the
    // map / straight ahead), matching the bearing convention (0 = dead ahead).
    const arrow = document.createElement('div');
    arrow.textContent = '▲';
    Object.assign(arrow.style, {
      font: '18px/1 ui-monospace, monospace',
      transition: 'transform 0.1s linear, color 0.2s linear',
      transformOrigin: '50% 50%',
    } satisfies Partial<CSSStyleDeclaration>);

    const label = document.createElement('div');
    label.textContent = '';

    root.append(arrow, label);
    parent.appendChild(root);

    this.root = root;
    this.arrow = arrow;
    this.label = label;
  }

  /** Adopt the authored pack (intel nodes + extraction points the waypoint targets). */
  setPack(pack: ContentPack | null): void {
    this.pack = pack;
  }

  /** Repaint from the latest snapshot: pick the objective target, rotate the arrow to its bearing. */
  update(state: NetMatchState, localPlayerId: string): void {
    const player = state.players[localPlayerId];
    const target = player ? pickWaypointTarget(player, state.objective, this.pack) : null;

    if (!player || !target) {
      if (this.lastVisible !== false) {
        this.root.style.display = 'none';
        this.lastVisible = false;
      }
      return;
    }

    if (this.lastVisible !== true) {
      this.root.style.display = 'flex';
      this.lastVisible = true;
    }

    const rad = bearingTo(player, target.x, target.z);
    // CSS rotation is clockwise-positive with 0 pointing up; our bearing is +to-the-right, so a
    // positive bearing rotates the up-arrow clockwise — a direct degree mapping.
    this.arrow.style.transform = `rotate(${(rad * 180) / Math.PI}deg)`;

    if (target.label !== this.lastLabel) {
      const dist = Math.round(Math.hypot(target.x - player.x, target.z - player.z));
      this.label.textContent = `${target.label} · ${dist}m`;
      this.lastLabel = target.label;
    } else {
      // Distance changes every frame; update it cheaply without re-touching the label colour.
      const dist = Math.round(Math.hypot(target.x - player.x, target.z - player.z));
      this.label.textContent = `${target.label} · ${dist}m`;
    }

    const color = KIND_COLOR[target.kind];
    if (color !== this.lastColor) {
      this.arrow.style.color = color;
      this.lastColor = color;
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
