// PackageView owns the Three.js representation of the LIVE objective package — the heist's
// prize (PROJECT_BRIEF §2). A single glowing briefcase mesh driven from NetMatchState.objective:
// `packageX/Y/Z` is the authoritative package position, which the SERVER moves to follow the
// carrier (packageHolderId) and leaves at the last drop point when loose. So PackageView just
// chases those coords each frame — when carried it rides the holder, when loose it sits in the
// world. It rides a little higher when held so it reads as "in someone's hands".
//
// MapView already draws a STATIC objective marker at the authored spawn (a map legend element);
// THIS is the live one that actually moves with play. Both can coexist — the static one marks
// the vault, this one tracks the package — but we lift this clearly above the floor + spin it
// so the live prize is unmistakable.
//
// Authority (PROJECT_BRIEF §3/§4.2): the package position + holder are the server's word.
// PackageView only PRESENTS them; it owns no objective truth.
import * as THREE from 'three';
import type { NetMatchState } from '@deceive/shared';
import { buildBriefcase, type ArtProp } from '../art/props';

const PACKAGE_SIZE = 0.7; // a chunky briefcase, distinct from the avatars
// How high above the authoritative point the briefcase hovers. When held it rides at chest
// height on the carrier; when loose it sits just off the floor.
const HELD_HOVER = 1.3;
const LOOSE_HOVER = 0.55;
const SPIN_RATE = 0.9; // radians/second, a slow glint to catch the eye

export class PackageView {
  private readonly root = new THREE.Group();
  private readonly prop: ArtProp;

  constructor(scene: THREE.Scene) {
    // The SAME briefcase the preview gallery shows (art/props) — one source of truth.
    this.prop = buildBriefcase(PACKAGE_SIZE);
    this.root.add(this.prop.group);
    scene.add(this.root);
  }

  /** Sync to the authoritative package position + advance the spin. `dt` in seconds. */
  sync(state: NetMatchState, dt: number): void {
    const o = state.objective;
    const held = o.packageHolderId !== '';
    const hover = held ? HELD_HOVER : LOOSE_HOVER;
    this.root.position.set(o.packageX, o.packageY + hover, o.packageZ);
    this.prop.group.rotation.y += SPIN_RATE * dt;
  }

  dispose(): void {
    this.prop.dispose();
    this.root.removeFromParent();
  }
}
