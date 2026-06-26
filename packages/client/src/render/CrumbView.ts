// CrumbView owns the Three.js representation of the Holo-Crumbs — the tells left at the
// spot where a player stole a disguise (PROJECT_BRIEF §2b). One small spinning, translucent
// shard per crumb in NetMatchState.crumbs, tinted by TIER_COLOR[crumb.tier] so a rival can
// read which tier was taken, hovering at the theft site for the crumb's short window.
//
// Authority (PROJECT_BRIEF §3/§4.2): crumbs are the server's word. The server drops a crumb
// when it applies a disguise-take and removes it when it expires (expiresMs). CrumbView only
// PRESENTS them: it diffs the snapshot's crumb ids each frame, spawning meshes for new ones
// and disposing meshes for ones that vanished (expired) — it owns no lifetime truth itself.
import * as THREE from 'three';
import { TIER_COLOR, type NetCrumbState, type NetMatchState } from '@deceive/shared';

// A crumb floats a little off the ground and is small + distinct so it reads as a "tell"
// rather than a piece of the map. Flagged for Director taste (review queue — Holo-Crumb
// strength: how obvious the theft site should be to other players).
const CRUMB_RADIUS = 0.28;
const CRUMB_HOVER = 1.1; // metres above the floor it hovers at
const SPIN_RATE = 1.6; // radians/second it rotates, to catch the eye

interface Crumb {
  group: THREE.Group;
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  tier: string;
}

export class CrumbView {
  private readonly root = new THREE.Group();
  private readonly crumbs = new Map<string, Crumb>();

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
  }

  /** Sync to the snapshot's crumbs + advance the spin. `dt` is the render delta (seconds). */
  sync(state: NetMatchState, dt: number): void {
    const seen = new Set<string>();
    for (const id of Object.keys(state.crumbs)) {
      const c = state.crumbs[id];
      if (!c) continue;
      seen.add(id);

      let crumb = this.crumbs.get(id);
      if (!crumb) {
        crumb = this.spawn(c);
        this.crumbs.set(id, crumb);
      }
      this.colorByTier(crumb, c.tier);
      // Position is fixed at the theft site; only the spin animates.
      crumb.group.position.set(c.x, c.y + CRUMB_HOVER, c.z);
    }

    // Despawn crumbs no longer in the snapshot — i.e. the server expired them.
    for (const [id, crumb] of this.crumbs) {
      if (seen.has(id)) continue;
      this.disposeCrumb(crumb);
      this.crumbs.delete(id);
    }

    // Spin every live crumb so the tell catches the eye.
    const spin = SPIN_RATE * dt;
    for (const [, crumb] of this.crumbs) {
      crumb.group.rotation.y += spin;
    }
  }

  private spawn(c: NetCrumbState): Crumb {
    const group = new THREE.Group();
    // An octahedron shard — distinct from the capsule avatars + the boxy map geometry.
    const geometry = new THREE.OctahedronGeometry(CRUMB_RADIUS, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.55,
      roughness: 0.3,
    });
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    group.position.set(c.x, c.y + CRUMB_HOVER, c.z);
    this.root.add(group);

    const crumb: Crumb = { group, mesh, geometry, material, tier: '' };
    this.colorByTier(crumb, c.tier);
    return crumb;
  }

  private colorByTier(crumb: Crumb, tier: NetCrumbState['tier']): void {
    if (crumb.tier === tier) return;
    const hex = TIER_COLOR[tier];
    crumb.material.color.set(hex);
    crumb.material.emissive.set(hex);
    crumb.tier = tier;
  }

  private disposeCrumb(crumb: Crumb): void {
    this.root.remove(crumb.group);
    crumb.geometry.dispose();
    crumb.material.dispose();
  }

  dispose(): void {
    for (const [, crumb] of this.crumbs) this.disposeCrumb(crumb);
    this.crumbs.clear();
    this.root.removeFromParent();
  }
}
